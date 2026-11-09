import { expect, test } from 'claude-code/testing'

const PLAN = 'mcp__ccd_turn__update_plan'
const WRAP_UP = 'mcp__ccd_turn__wrap_up'

const PANE = {
  plugin: 'progress-panel',
  component: 'Pane',
  requestId: 'progress-panel',
  props: {
    title: '進捗',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

function engine(on: any, messages: unknown[] = []) {
  on('command.register', () => ({ value: { command: 'progress-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: messages }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

const STEPS = [
  { content: '調べる', status: 'in_progress' },
  { content: '作る', status: 'pending' },
]

test('タスクの進行が全画面で反映される', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: PLAN, items: STEPS })
  await $.tool.call({ tool: PLAN, advance: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /進捗 1\/2/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /✅ 調べる/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /🔧 作る/ }))?.text).toBeTruthy()
    await ui.unmount()
  }
})

test('done と start で順番を飛ばせる', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: PLAN, items: [...STEPS, { content: '試す', status: 'pending' }] })
  await $.tool.call({ tool: PLAN, done: [2], start: 3 })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /✅ 作る/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /🔧 試す/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('返答の👉欄を次にやることとして表示し、次の依頼で消す', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: WRAP_UP, recap: 'パネルを作りました。' })
  const answer = '✅ やったこと\n- 作成\n\n👉 あなたのネクストアクション\n1. ボタンを押す'
  await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const shown = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await shown.find({ type: 'Markdown', text: /1\. ボタンを押す/ }))?.text).toContain('ボタン')
  expect((await shown.find({ type: 'Markdown', text: /やったこと/ }))).toBeFalsy()
  expect((await shown.find({ type: 'Text', text: /パネルを作りました/ }))?.text).toBeTruthy()
  await shown.unmount()

  await $.turn.start({ text: '次', turnId: 't2' })
  const busy = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await busy.find({ type: 'Text', text: /作業中/ }))?.text).toBeTruthy()
  await busy.unmount()
})

test('1行だけの「なし」と、👉がないときの質問', async ($, on) => {
  engine(on)
  await $.turn.complete({
    answer: '👉 ネクストアクション：なし（このまま次の指示をどうぞ）',
    durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer',
  })
  const none = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await none.find({ type: 'Markdown', text: /なし/ }))?.text).toBeTruthy()
  await none.unmount()

  await $.tool.call({ tool: WRAP_UP, recap: 'r', ask: 'どれにしますか？' })
  await $.turn.complete({ answer: '完了', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  const asked = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await asked.find({ type: 'Markdown', text: /どれにしますか/ }))?.text).toBeTruthy()
  await asked.unmount()
})

test('サブエージェントの操作では変わらない', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: PLAN, items: STEPS, agentId: 'a1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /タスクはまだありません/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('読み込み時にこれまでの会話から復元する', async ($, on) => {
  engine(on, [
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: '1', tool: PLAN, input: { items: STEPS, scope: 'first_task' } }] },
    { role: 'assistant', text: '👉 あなたのネクストアクション\n1. 確認する', toolUses: [] },
  ])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /🔧 調べる/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Markdown', text: /確認する/ }))?.text).toBeTruthy()
  await ui.unmount()
})
