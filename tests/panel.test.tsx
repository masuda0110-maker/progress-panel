import { expect, test } from 'claude-code/testing'

const PLAN = 'mcp__ccd_turn__update_plan'
const WRAP_UP = 'mcp__ccd_turn__wrap_up'
const DIR = '/home/me/.claude/progress-panel/sessions'
const NOW = 1_800_000_000_000

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

/** 共有フォルダを含む、エンジン側の振る舞いの代わり */
function engine(on: any, options: { messages?: unknown[]; files?: Record<string, unknown>; failWrite?: boolean } = {}) {
  const files = new Map<string, string>(
    Object.entries(options.files ?? {}).map(([name, value]) => [`${DIR}/${name}`, JSON.stringify(value)]),
  )
  on('command.register', () => ({ value: { command: 'progress-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: options.messages ?? [] }))
  on('session.id', () => ({ value: 'self' }))
  on('session.cwd', () => ({ value: '/Users/me/projects/shop-site' }))
  on('clock.now', () => ({ value: NOW }))
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    if (options.failWrite) throw new Error('EACCES')
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files.get(e.path) ?? '' }))
  on('fs.list', () => ({
    value: [...files.keys()].map(path => ({
      name: path.slice(DIR.length + 1),
      kind: 'file',
      size: 1,
      mtimeMs: NOW,
      isLink: false,
    })),
  }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  return files
}

const STEPS = [
  { content: '調べる', status: 'in_progress' },
  { content: '作る', status: 'pending' },
]

function summary(id: string, project: string, done: number, total: number, extra: object = {}) {
  return { id, project, title: '', current: '', done, total, isWorking: false, updatedAt: NOW - 2 * 3600_000, ...extra }
}

test('タスクの進行が全画面で反映される', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: PLAN, items: STEPS })
  await $.tool.call({ tool: PLAN, advance: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /このチャット 1\/2/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /✅ 調べる/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /🔧 作る/ }))?.text).toBeTruthy()
    await ui.unmount()
  }
})

test('全プロジェクトの進捗を一覧にする', async ($, on) => {
  const files = engine(on, {
    files: {
      'a.json': summary('a', 'mail-tool', 4, 4),
      'b.json': summary('b', 'dashboard', 3, 10, { current: 'グラフ修正' }),
      'old.json': summary('old', 'old-project', 1, 2, { updatedAt: NOW - 8 * 86400_000 }),
      'week.json': summary('week', 'week-project', 1, 2, { updatedAt: NOW - 6 * 86400_000 }),
      'broken.json': { nope: true },
    },
  })
  await $.turn.start({ text: '商品一覧の表示を直して', turnId: 't1' })
  await $.tool.call({ tool: PLAN, items: STEPS })

  const mine = JSON.parse(files.get(`${DIR}/self.json`) ?? '{}')
  expect(mine.project).toBe('shop-site')
  expect(mine.title).toBe('商品一覧の表示を直して')
  expect(mine.done).toBe(0)
  expect(mine.total).toBe(2)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /🔧 shop-site 0\/2/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /調べる · このチャット/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /✅ mail-tool 完了/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /⏸ dashboard 3\/10/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /███░░░░░░░ グラフ修正 · 2時間前/ }))?.text).toBeTruthy()
    // 1週間以内に動いたものだけ：6日前は出て、8日前は出ない
    expect((await ui.find({ type: 'Text', text: /week-project/ }))?.text).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /old-project/ })).toBeFalsy()
    // 状態ごとの色：完了は緑、作業中は青、途中で止まっているものは黄
    expect((await ui.find({ type: 'Text', text: /^完了$/ }))?.props.color).toBe('success')
    expect((await ui.find({ type: 'Text', text: /^0\/2$/ }))?.props.color).toBe('suggestion')
    expect((await ui.find({ type: 'Text', text: /^3\/10$/ }))?.props.color).toBe('warning')
    expect((await ui.find({ type: 'Text', text: /^███$/ }))?.props.color).toBe('warning')
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
  expect(await shown.find({ type: 'Markdown', text: /やったこと/ })).toBeFalsy()
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

test('読み込み時にこれまでの会話から復元して共有フォルダに書く', async ($, on) => {
  const files = engine(on, {
    messages: [
      { role: 'user', text: '<system-reminder>\nThe user started this session\n</system-reminder>\nModsを活用したい', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: '1', tool: PLAN, input: { items: STEPS, scope: 'first_task' } }] },
      { role: 'assistant', text: '👉 あなたのネクストアクション\n1. 確認する', toolUses: [] },
    ],
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /🔧 調べる/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Markdown', text: /確認する/ }))?.text).toBeTruthy()
  await ui.unmount()
  expect(JSON.parse(files.get(`${DIR}/self.json`) ?? '{}').title).toBe('Modsを活用したい')
})

test('共有フォルダに書けなくてもパネルは動く', async ($, on) => {
  engine(on, { failWrite: true })
  await $.tool.call({ tool: PLAN, items: STEPS })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /🔧 調べる/ }))?.text).toBeTruthy()
  await ui.unmount()
})
