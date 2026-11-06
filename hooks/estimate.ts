import type { Plan, Verdict } from '../types'

// Every number here is an assumption to tune, not a measurement.
// "Tokens" are effective tokens: new input + output + 10% of cached re-reads,
// because a cached re-read costs far less than a new token.
export const ASSUMED = {
  turnsPerStep: 4,
  secondsPerTurn: 20,
  outputPerStep: 1500,
  defaultContext: 25000,
  cacheWeight: 0.1,
  workerStartTokens: 8000,
  workerStartSeconds: 15,
  briefTokens: 1000,
  summaryTokens: 800,
  rereadOverlap: 1.2,
  mainTurnsPerWorker: 2,
  mainTurnSeconds: 15,
  heavyContext: 120000,
  heavyRead: 30000,
}

// Dollars per million tokens: input, output, cache read, cache write (1-hour rate).
// List prices as kept by savvy-progress on 2026-10-10. The first match wins.
type Rates = [input: number, output: number, cacheRead: number, cacheWrite: number]

const RATES: [RegExp, Rates][] = [
  [/(fable|mythos)-5-1/, [10, 50, 0.25, 20]],
  [/fable|mythos/, [10, 50, 1, 20]],
  [/opus-5-5/, [4, 20, 0.2, 8]],
  [/opus/, [5, 25, 0.5, 10]],
  [/sonnet-5-5/, [2, 10, 0.1, 4]],
  [/sonnet-5/, [2, 10, 0.2, 4]],
  [/sonnet/, [3, 15, 0.3, 6]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]],
  [/haiku/, [1, 5, 0.1, 2]],
]

const ratesOf = (model: string): Rates => RATES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? [4, 20, 0.2, 8]

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// What one model request really spent, in the same units as the estimate.
export const spentOn = (model: string, u: Usage): { tokens: number; usd: number } => {
  const [input, output, read, write] = ratesOf(model)
  return {
    tokens: u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + ASSUMED.cacheWeight * u.cache_read_input_tokens,
    usd:
      (u.input_tokens * input +
        u.output_tokens * output +
        u.cache_read_input_tokens * read +
        u.cache_creation_input_tokens * write) /
      1e6,
  }
}

export type Task = {
  steps: number
  independent: number
  readTokens: number
  isRisky: boolean
  context: number
  model: string
}

export type Estimate = {
  solo: Plan
  delegated: Plan
  verdict: Verdict
  reason: string
  // Only work that could run at the same time is worth showing the person.
  isShown: boolean
}

type Work = { fresh: number; output: number; rereads: number }

const A = ASSUMED

const tokensOf = (w: Work): number => w.fresh + w.output + A.cacheWeight * w.rereads

const usdOf = (w: Work, model: string): number => {
  const [, output, read, write] = ratesOf(model)
  return (w.fresh * write + w.output * output + w.rereads * read) / 1e6
}

const solo = (t: Task): Plan => {
  const added = t.readTokens + t.steps * A.outputPerStep
  const turns = t.steps * A.turnsPerStep
  const work: Work = {
    fresh: t.readTokens,
    output: t.steps * A.outputPerStep,
    rereads: turns * (t.context + added / 2),
  }
  return { tokens: Math.round(tokensOf(work)), usd: usdOf(work, t.model), seconds: turns * A.secondsPerTurn }
}

const delegated = (t: Task): Plan => {
  const read = (t.readTokens * A.rereadOverlap) / t.steps
  const start = A.workerStartTokens + A.briefTokens
  const worker: Work = {
    fresh: start + read,
    output: A.outputPerStep,
    rereads: A.turnsPerStep * (start + (read + A.outputPerStep) / 2),
  }

  // The main session writes each brief, then reads the summary and the change.
  const added = t.steps * (A.briefTokens + A.summaryTokens + A.outputPerStep)
  const main: Work = {
    fresh: t.steps * (A.summaryTokens + A.outputPerStep),
    output: t.steps * A.briefTokens,
    rereads: A.mainTurnsPerWorker * t.steps * (t.context + added / 2),
  }

  const waves = Math.ceil(t.steps / Math.min(t.independent, t.steps))
  const wave = A.workerStartSeconds + A.turnsPerStep * A.secondsPerTurn
  const review = t.steps * A.mainTurnsPerWorker * A.mainTurnSeconds
  return {
    tokens: Math.round(t.steps * tokensOf(worker) + tokensOf(main)),
    usd: t.steps * usdOf(worker, t.model) + usdOf(main, t.model),
    seconds: waves * wave + review,
  }
}

const saved = (without: number, withAgents: number): number => (without - withAgents) / without

const percent = (share: number): string => `${Math.round(Math.abs(share) * 100)}%`

const costTrade = (share: number): string =>
  share >= 0.01 ? `e ainda custa ${percent(share)} menos` : share <= -0.01 ? `custando ${percent(share)} a mais` : 'pelo mesmo custo'

const judge = (t: Task, a: Plan, b: Plan): Pick<Estimate, 'verdict' | 'reason'> => {
  if (t.steps < 2 || t.independent < 2) return { verdict: 'skip', reason: 'Sem etapas simultâneas, não há o que dividir.' }

  // Judged in dollars: cached re-reads count little there, so tokens alone flatter delegating.
  const cost = saved(a.usd, b.usd)
  const time = saved(a.seconds, b.seconds)
  const peak = t.context + t.readTokens + t.steps * A.outputPerStep
  // A full session alone is no reason to delegate: the task itself must read a lot.
  const readsALot = t.readTokens >= A.heavyRead
  const together = Math.min(t.independent, t.steps)

  if (time >= 0.25 && cost >= -0.5) {
    return { verdict: 'use', reason: `${together} etapas rodam ao mesmo tempo: termina ${percent(time)} mais rápido, ${costTrade(cost)}.` }
  }
  if (readsALot && cost >= 0.1) {
    return { verdict: 'use', reason: `Cada subagente lê sua parte longe da sessão principal, que não relê tudo a cada passo: custa ${percent(cost)} menos.` }
  }
  if (readsALot && peak >= A.heavyContext && cost >= -0.3) {
    return { verdict: 'use', reason: 'A leitura encheria o contexto da sessão principal. Nos subagentes, ela fica separada e a sessão continua leve.' }
  }
  if (t.isRisky && cost >= -1.25) {
    return { verdict: 'maybe', reason: `A mudança é arriscada e ganha uma revisão independente, ${costTrade(cost)}.` }
  }
  if (time >= 0.1 && cost >= -1.25) {
    return { verdict: 'maybe', reason: `Termina ${percent(time)} mais rápido, ${costTrade(cost)}.` }
  }
  return {
    verdict: 'skip',
    reason: `Mesmo em paralelo, dividir sairia ${formatDelta(a.usd, b.usd)} em custo e ${formatDelta(a.seconds, b.seconds)} em tempo, e a sessão resolve sozinha.`,
  }
}

export const estimate = (task: Task): Estimate => {
  const t: Task = {
    ...task,
    steps: Math.max(1, Math.round(task.steps)),
    independent: Math.max(1, Math.round(task.independent)),
    readTokens: Math.max(0, task.readTokens),
    context: task.context > 0 ? task.context : A.defaultContext,
  }
  const a = solo(t)
  const b = delegated(t)
  return { solo: a, delegated: b, isShown: t.steps >= 2 && t.independent >= 2, ...judge(t, a, b) }
}

export const formatTokens = (n: number): string =>
  n >= 1000000 ? `${(n / 1000000).toFixed(1).replace('.', ',')} mi` : n >= 1000 ? `${Math.round(n / 1000)} mil` : `${Math.round(n)}`

export const formatTime = (seconds: number): string =>
  seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`

export const formatUsd = (usd: number): string =>
  usd > 0 && usd < 0.01 ? '<$0,01' : `$${usd.toFixed(2).replace('.', ',')}`

// How the delegated plan compares with the solo one: "+44%" costs more.
export function formatDelta(without: number, withAgents: number): string {
  if (!(without > 0)) return withAgents > 0 ? '+∞' : '0%'
  const share = Math.round(((withAgents - without) / without) * 100)
  return `${share > 0 ? '+' : ''}${share}%`
}
