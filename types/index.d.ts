export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export type PlanItem = { content: string; status: PlanStatus }

export type Progress = {
  items: PlanItem[]
  recap: string
  ask: string
  nextAction: string
  isWorking: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'progress-panel': { progress: Shaped<Progress> }
  }
}
