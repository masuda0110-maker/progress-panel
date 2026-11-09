import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { PlanItem, PlanStatus, Progress } from '../types'

const PANE = 'progress-panel'
const TITLE = '進捗'
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const WRAP_UP_TOOL = 'mcp__ccd_turn__wrap_up'

const EMPTY: Progress = {
  items: [],
  recap: '',
  ask: '',
  nextAction: '',
  isWorking: false,
}

const progress = atom({ plugin: 'progress-panel', key: 'progress' } as const, EMPTY, {
  shape: 'progress-1',
})

const MARK: Record<PlanStatus, string> = {
  completed: '✅',
  in_progress: '🔧',
  pending: '・',
}

function toItems(value: unknown): PlanItem[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(raw => {
    const { content, status } = raw as { content?: unknown; status?: unknown }
    if (typeof content !== 'string') return []
    const known = status === 'completed' || status === 'in_progress'

    return [{ content, status: known ? status : 'pending' }]
  })
}

function indexes(value: unknown): number[] {
  return Array.isArray(value) ? value.filter(n => typeof n === 'number') : []
}

function applyPlan(items: PlanItem[], input: Record<string, unknown>): PlanItem[] {
  if (Array.isArray(input.items)) return toItems(input.items)

  let next = items
  if (input.advance === true) {
    const started = next.findIndex(item => item.status === 'pending')
    next = next.map((item, i) => {
      if (item.status === 'in_progress') return { ...item, status: 'completed' }

      return i === started ? { ...item, status: 'in_progress' } : item
    })
  }

  const done = indexes(input.done)
  const start = typeof input.start === 'number' ? input.start : undefined

  return next.map((item, i) => {
    if (done.includes(i + 1)) return { ...item, status: 'completed' }

    return i + 1 === start ? { ...item, status: 'in_progress' } : item
  })
}

function applyWrapUp(state: Progress, input: Record<string, unknown>): Progress {
  return {
    ...state,
    items: state.items.map(item => ({ ...item, status: 'completed' })),
    recap: typeof input.recap === 'string' ? input.recap : state.recap,
    ask: typeof input.ask === 'string' ? input.ask : '',
  }
}

const OTHER_HEADING = /^\W*(✅|🔧|⚠️|❌|❓)/u

/** 返答の最後の「👉」欄を取り出す。見出しだけの行は本文を優先する。 */
function extractNextAction(answer: string): string {
  const lines = answer.split('\n')
  let start = -1
  lines.forEach((line, i) => {
    if (/^[\s*_#>]*👉/u.test(line)) start = i
  })
  if (start < 0) return ''

  const heading = (lines[start] ?? '').replace(/^[\s*_#>]*👉\s*/u, '').replace(/[*_]+$/u, '').trim()
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => OTHER_HEADING.test(line))
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()

  return body || heading
}

function replay(rows: readonly { role: string; text: string; toolUses: readonly { tool: string; input: Record<string, unknown> }[] }[]): Progress {
  let state = EMPTY
  for (const row of rows) {
    for (const use of row.toolUses ?? []) {
      if (use.tool === PLAN_TOOL) state = { ...state, items: applyPlan(state.items, use.input) }
      if (use.tool === WRAP_UP_TOOL) state = applyWrapUp(state, use.input)
    }
  }
  const last = [...rows].reverse().find(row => row.role === 'assistant' && row.text.trim() !== '')

  return { ...state, nextAction: (last && extractNextAction(last.text)) || state.ask }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'progress-panel',
      description: '進捗と次にやることのパネルを開く',
    })
    if (e.surface !== 'terminal') void $.ui.open({ id: PANE, title: TITLE })
    const ran = await next(e)

    const current = await read($, progress)
    if (current.items.length === 0 && current.recap === '' && current.nextAction === '') {
      const seeded = replay(await $.session.messages())
      await update($, progress, () => seeded)
    }

    return ran
  })

  on('command.run', { command: 'progress-panel' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: '進捗パネルを開きました。' }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await update($, progress, state => ({
        ...(state ?? EMPTY),
        isWorking: true,
        ask: '',
        nextAction: '',
      }))
    }

    return next(e)
  })

  on('tool.call', { tool: PLAN_TOOL }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId && !ran.isError) {
      await update($, progress, state => {
        const base = state ?? EMPTY

        return { ...base, items: applyPlan(base.items, e as Record<string, unknown>) }
      })
    }

    return ran
  })

  on('tool.call', { tool: WRAP_UP_TOOL }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId && !ran.isError) {
      await update($, progress, state => applyWrapUp(state ?? EMPTY, e as Record<string, unknown>))
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await update($, progress, state => {
        const base = state ?? EMPTY

        return {
          ...base,
          isWorking: false,
          nextAction: extractNextAction(e.answer) || base.ask,
        }
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const state = await read($, progress)
    const doneCount = state.items.filter(item => item.status === 'completed').length

    return (
      <Box flexDirection="column">
        <Text bold>👉 次にやること</Text>
        {state.isWorking ? (
          <Text dimColor>Claude が作業中です</Text>
        ) : state.nextAction ? (
          <Markdown text={state.nextAction} />
        ) : (
          <Text dimColor>今はありません</Text>
        )}

        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            進捗 {doneCount}/{state.items.length}
          </Text>
          {state.items.length === 0 && <Text dimColor>タスクはまだありません</Text>}
          {state.items.map(item => (
            <Text dimColor={item.status === 'completed'}>
              {MARK[item.status]} {item.content}
            </Text>
          ))}
        </Box>

        {state.recap !== '' && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>ここまでの状況</Text>
            <Text>{state.recap}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
