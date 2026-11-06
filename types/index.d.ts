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

declare module 'claude-code' {
  interface PluginState {
    'subagent-advisor': {
      assessment: Assessment | null
      spending: Spending
      mainContext: number
      mainModel: string
      isHidden: boolean
    }
  }
}
