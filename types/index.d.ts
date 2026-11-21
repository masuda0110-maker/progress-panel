export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export type PlanItem = { content: string; status: PlanStatus }

export type Progress = {
  items: PlanItem[]
  recap: string
  ask: string
  nextAction: string
  isWorking: boolean
  /** このチャットの最初の依頼（一覧の見出しに使う） */
  title: string
}

/** 共有フォルダに書き出す、チャット1つ分の要約 */
export type SessionSummary = {
  id: string
  /** サイドバーに出ているチャット名（取れないときは空） */
  chatName: string
  project: string
  title: string
  current: string
  done: number
  total: number
  isWorking: boolean
  updatedAt: number
}

export type Overview = { sessions: SessionSummary[]; selfId: string; now: number }

declare module 'claude-code' {
  interface PluginState {
    'progress-panel': {
      progress: Shaped<Progress>
      overview: Shaped<Overview>
    }
  }
}
