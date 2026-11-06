export type Verdict = 'use' | 'maybe' | 'skip'

export type Plan = {
  tokens: number
  usd: number
  seconds: number
}

export type Assessment = {
  title: string
  verdict: Verdict
  reason: string
  solo: Plan
  delegated: Plan
}

export type Spending = {
  tokens: number
  usd: number
  workers: number
}

// What a task looked like when assessed: the estimator's inputs, numbers only.
export type TaskShape = {
  steps: number
  independent: number
  readTokens: number
  isRisky: boolean
  context: number
  model: string
}

// An assessed task still running: measured until the next assessment or the session's end.
export type OpenTask = {
  startedAt: number
  lastActiveAt: number
  prompts: number
  task: TaskShape
  verdict: Verdict
  estimate: { solo: Plan; delegated: Plan }
}

// One finished task, as kept in the store.
export type Measured = {
  v: number
  at: number
  task: TaskShape
  verdict: Verdict
  estimate: { solo: Plan; delegated: Plan }
  path: 'solo' | 'delegated'
  real: { tokens: number; usd: number; seconds: number; workers: number; prompts: number }
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-advisor': {
      assessment: Assessment | null
      spending: Spending
      mainContext: number
      mainModel: string
      isHidden: boolean
      current: OpenTask | null
    }
  }
}
