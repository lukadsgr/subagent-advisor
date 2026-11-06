import type { Plan, Verdict } from '../types'

// Measured on 2026-11-06 from real transcripts, not guessed:
// `small` is the median of 215 solo tasks with a plan, `medium` their 90th percentile,
// `large` the subagents of one real session (only 3, so the weakest of the three).
export type StepSize = 'small' | 'medium' | 'large'

type Step = { turns: number; fresh: number; output: number; secondsPerTurn: number }

export const STEP: Record<StepSize, Step> = {
  small: { turns: 3.5, fresh: 8000, output: 3500, secondsPerTurn: 12 },
  medium: { turns: 9, fresh: 30000, output: 10000, secondsPerTurn: 20 },
  large: { turns: 20, fresh: 190000, output: 65000, secondsPerTurn: 35 },
}

export const ASSUMED = {
  defaultContext: 25000,
  // A subagent opens with the system prompt and every tool: 62-64 mil in all 3 measured.
  workerStartTokens: 63000,
  workerStartSeconds: 15,
  briefTokens: 1000,
  summaryTokens: 800,
  rereadOverlap: 1.2,
  mainTurnsPerWorker: 2,
  mainTurnSeconds: 15,
  // The context stops growing here: past it the session compacts.
  contextCap: 400000,
  // Real tasks reached about 3x the typical one (90th percentile over the median).
  highFactor: 3,
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
    tokens: u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
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
  size: StepSize
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

// Every token counts, cached re-reads included, so the number matches the agents panel.
const tokensOf = (w: Work): number => w.fresh + w.output + w.rereads

const contextOf = (tokens: number): number => Math.min(tokens, A.contextCap)

const usdOf = (w: Work, model: string): number => {
  const [, output, read, write] = ratesOf(model)
  return (w.fresh * write + w.output * output + w.rereads * read) / 1e6
}

const plan = (tokens: number, usd: number, seconds: number): Plan => ({
  tokens: Math.round(tokens),
  usd,
  seconds,
  tokensHigh: Math.round(tokens * A.highFactor),
  usdHigh: usd * A.highFactor,
  secondsHigh: seconds * A.highFactor,
})

const solo = (t: Task): Plan => {
  const step = STEP[t.size]
  const fresh = Math.max(t.steps * step.fresh, t.readTokens)
  const output = t.steps * step.output
  const turns = t.steps * step.turns
  const work: Work = { fresh, output, rereads: turns * contextOf(t.context + (fresh + output) / 2) }
  return plan(tokensOf(work), usdOf(work, t.model), turns * step.secondsPerTurn)
}

const delegated = (t: Task): Plan => {
  const step = STEP[t.size]
  const read = Math.max(step.fresh, (t.readTokens * A.rereadOverlap) / t.steps)
  const start = A.workerStartTokens + A.briefTokens
  const worker: Work = {
    fresh: start + read,
    output: step.output,
    rereads: step.turns * contextOf(start + (read + step.output) / 2),
  }

  // The main session writes each brief, then reads the summary and the change.
  const added = t.steps * (A.briefTokens + A.summaryTokens + step.output)
  const main: Work = {
    fresh: t.steps * (A.summaryTokens + step.output),
    output: t.steps * A.briefTokens,
    rereads: A.mainTurnsPerWorker * t.steps * contextOf(t.context + added / 2),
  }

  const waves = Math.ceil(t.steps / Math.min(t.independent, t.steps))
  const wave = A.workerStartSeconds + step.turns * step.secondsPerTurn
  const review = t.steps * A.mainTurnsPerWorker * A.mainTurnSeconds
  return plan(t.steps * tokensOf(worker) + tokensOf(main), t.steps * usdOf(worker, t.model) + usdOf(main, t.model), waves * wave + review)
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
  const peak = t.context + t.readTokens + t.steps * STEP[t.size].output
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

const range = (low: string, high: string): string => (low === high ? low : `${low}–${high}`)

export const tokenRange = (p: Plan): string => range(formatTokens(p.tokens), formatTokens(p.tokensHigh))

export const usdRange = (p: Plan): string => range(formatUsd(p.usd), formatUsd(p.usdHigh))

export const timeRange = (p: Plan): string => {
  const low = formatTime(p.seconds)
  const high = formatTime(p.secondsHigh)
  return low.endsWith(' min') && high.endsWith(' min') ? range(low.replace(' min', ''), high) : range(low, high)
}

// How the delegated plan compares with the solo one: "+44%" costs more.
export function formatDelta(without: number, withAgents: number): string {
  if (!(without > 0)) return withAgents > 0 ? '+∞' : '0%'
  const share = Math.round(((withAgents - without) / without) * 100)
  return `${share > 0 ? '+' : ''}${share}%`
}
