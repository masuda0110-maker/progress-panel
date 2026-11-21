import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { Overview, PlanItem, PlanStatus, Progress, SessionSummary } from '../types'

const PANE = 'progress-panel'
const TITLE = '進捗'
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const WRAP_UP_TOOL = 'mcp__ccd_turn__wrap_up'

/** 一覧に出すのは、この期間内に動いたチャットだけ */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000
const REFRESH_MS = 15 * 1000
const MAX_ROWS = 10

const EMPTY: Progress = {
  items: [],
  recap: '',
  ask: '',
  nextAction: '',
  isWorking: false,
  title: '',
}

const EMPTY_OVERVIEW: Overview = { sessions: [], selfId: '', now: 0 }

const progress = atom({ plugin: 'progress-panel', key: 'progress' } as const, EMPTY, {
  shape: 'progress-3',
})

const overview = atom({ plugin: 'progress-panel', key: 'overview' } as const, EMPTY_OVERVIEW, {
  shape: 'overview-1',
})

const MARK: Record<PlanStatus, string> = {
  completed: '✅',
  in_progress: '🔧',
  pending: '・',
}

/** 色はテーマの名前で指定し、ライト／ダークどちらでも読める色にする */
const COLOR = {
  done: 'success',
  working: 'suggestion',
  waiting: 'warning',
  idle: 'inactive',
} as const satisfies Record<string, Color>

const ITEM_COLOR: Record<PlanStatus, Color | undefined> = {
  completed: COLOR.done,
  in_progress: COLOR.working,
  pending: undefined,
}

// ---------- タスクリストの読み取り ----------

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

/** 依頼文から一覧用の短い見出しを作る */
function toTitle(text: string): string {
  // システムが依頼文に添える <system-reminder> などのタグ付きブロックは除く
  const plain = text.replace(/<([a-zA-Z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g, '')
  const line = plain
    .split('\n')
    .map(one => one.trim())
    .find(one => one !== '' && !one.startsWith('<'))
  if (!line) return ''

  return line.length > 24 ? `${line.slice(0, 24)}…` : line
}

type Row = { role: string; text: string; toolUses: readonly { tool: string; input: Record<string, unknown> }[] }

function replay(rows: readonly Row[]): Progress {
  let state = EMPTY
  for (const row of rows) {
    if (state.title === '' && row.role === 'user') state = { ...state, title: toTitle(row.text) }
    for (const use of row.toolUses ?? []) {
      if (use.tool === PLAN_TOOL) state = { ...state, items: applyPlan(state.items, use.input) }
      if (use.tool === WRAP_UP_TOOL) state = applyWrapUp(state, use.input)
    }
  }
  const last = [...rows].reverse().find(row => row.role === 'assistant' && row.text.trim() !== '')

  return { ...state, nextAction: (last && extractNextAction(last.text)) || state.ask }
}

// ---------- 全プロジェクト共有フォルダ ----------

async function sharedDir($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME')

  return home ? `${home}/.claude/progress-panel/sessions` : undefined
}

function projectName(cwd: string): string {
  if (cwd.includes('/scratch-workspaces/')) return 'フォルダなし'

  return cwd.split('/').filter(Boolean).pop() ?? cwd
}

function isSummary(value: unknown): value is SessionSummary {
  const v = value as Partial<SessionSummary> | null
  return (
    !!v &&
    typeof v.id === 'string' &&
    typeof v.project === 'string' &&
    typeof v.done === 'number' &&
    typeof v.total === 'number' &&
    typeof v.updatedAt === 'number'
  )
}

/** このチャットの要約を共有フォルダに書き出す */
async function publish($: EngineInterface): Promise<void> {
  const dir = await sharedDir($)
  if (!dir) return
  const [id, cwd, state, now] = await Promise.all([
    $.session.id(),
    $.session.cwd(),
    read($, progress),
    $.clock.now(),
  ])
  const summary: SessionSummary = {
    id,
    project: projectName(cwd),
    title: state.title,
    current: state.items.find(item => item.status === 'in_progress')?.content ?? '',
    done: state.items.filter(item => item.status === 'completed').length,
    total: state.items.length,
    isWorking: state.isWorking,
    updatedAt: now,
  }
  await $.fs.write(`${dir}/${id}.json`, JSON.stringify(summary))
}

/** 共有フォルダから最近のチャットを読み集める */
async function collect($: EngineInterface): Promise<void> {
  const dir = await sharedDir($)
  if (!dir) return
  const [selfId, now] = await Promise.all([$.session.id(), $.clock.now()])
  const entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
  const fresh = entries.filter(
    entry => entry.kind === 'file' && entry.name.endsWith('.json') && now - entry.mtimeMs < RECENT_MS,
  )
  const read_ = await Promise.all(
    fresh.map(entry =>
      $.fs
        .read(`${dir}/${entry.name}`)
        .then(text => JSON.parse(String(text)) as unknown)
        .catch(() => undefined),
    ),
  )
  const sessions = read_
    .filter(isSummary)
    .filter(one => now - one.updatedAt < RECENT_MS)
    .sort((a, b) => Number(b.isWorking) - Number(a.isWorking) || b.updatedAt - a.updatedAt)
    .slice(0, MAX_ROWS)

  await update($, overview, old => {
    const same = old && old.selfId === selfId && JSON.stringify(old.sessions) === JSON.stringify(sessions)
    // 中身が変わらないときも「◯分前」を進めるため、1分ごとには描き直す
    if (same && now - old.now < 60 * 1000) return old

    return { sessions, selfId, now }
  })
}

/** 進捗を書き換え、共有フォルダにも反映する */
async function commit($: EngineInterface, fn: (state: Progress) => Progress): Promise<void> {
  await update($, progress, state => fn(state ?? EMPTY))
  try {
    await publish($)
    await collect($)
  } catch {
    // 共有フォルダに書けなくても、このチャットのパネルは動かす
  }
}

// ---------- 表示用 ----------

const BAR_WIDTH = 10

function filledOf(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * BAR_WIDTH)
}

function ago(ms: number): string {
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}時間前`

  return `${Math.floor(hour / 24)}日前`
}

function statusOf(one: SessionSummary): { mark: string; label: string; color: Color } {
  if (one.isWorking) return { mark: '🔧', label: `${one.done}/${one.total}`, color: COLOR.working }
  if (one.total > 0 && one.done === one.total) return { mark: '✅', label: '完了', color: COLOR.done }
  if (one.total === 0) return { mark: '・', label: 'タスクなし', color: COLOR.idle }

  // 途中で止まっている（返事待ちなど）
  return { mark: '⏸', label: `${one.done}/${one.total}`, color: COLOR.waiting }
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
      await commit($, () => seeded)
    } else {
      await commit($, state => state)
    }

    try {
      $.clock.every(REFRESH_MS, () => {
        void collect($).catch(() => undefined)
      })
    } catch {
      // タイマーが使えない環境では、自分の更新時だけ読み直す
    }

    return ran
  })

  on('command.run', { command: 'progress-panel' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: '進捗パネルを開きました。' }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await commit($, state => ({
        ...state,
        isWorking: true,
        ask: '',
        nextAction: '',
        title: state.title || toTitle(e.text),
      }))
    }

    return next(e)
  })

  on('tool.call', { tool: PLAN_TOOL }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId && !ran.isError) {
      await commit($, state => ({ ...state, items: applyPlan(state.items, e as Record<string, unknown>) }))
    }

    return ran
  })

  on('tool.call', { tool: WRAP_UP_TOOL }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId && !ran.isError) {
      await commit($, state => applyWrapUp(state, e as Record<string, unknown>))
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await commit($, state => ({
        ...state,
        isWorking: false,
        nextAction: extractNextAction(e.answer) || state.ask,
      }))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const [state, all] = await Promise.all([read($, progress), read($, overview)])
    const doneCount = state.items.filter(item => item.status === 'completed').length
    const now = all.now

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
          <Text bold>全体の進捗</Text>
          {all.sessions.length === 0 && <Text dimColor>ここ1週間に動いたチャットはありません</Text>}
          {all.sessions.map(one => {
            const { mark, label, color } = statusOf(one)
            const filled = filledOf(one.done, one.total)
            const isSelf = one.id === all.selfId
            const detail = [one.current || one.title, isSelf ? 'このチャット' : ago(now - one.updatedAt)]
              .filter(Boolean)
              .join(' · ')

            return (
              <Box flexDirection="column">
                <Text bold={isSelf}>
                  {mark} {one.project} <Text color={color}>{label}</Text>
                </Text>
                <Text>
                  {'   '}
                  <Text color={color}>{'█'.repeat(filled)}</Text>
                  <Text dimColor>{'░'.repeat(BAR_WIDTH - filled)}</Text>
                  <Text dimColor> {detail}</Text>
                </Text>
              </Box>
            )
          })}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            このチャット {doneCount}/{state.items.length}
          </Text>
          {state.items.length === 0 && <Text dimColor>タスクはまだありません</Text>}
          {state.items.map(item => (
            <Text color={ITEM_COLOR[item.status]} dimColor={item.status === 'pending'}>
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
