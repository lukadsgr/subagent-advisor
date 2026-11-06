import type { Measured, OpenTask, Spending } from '../types'
import { formatDelta, formatTime, formatTokens, formatUsd } from './estimate'

// Each assessed task is measured against its estimate, so the constants (and later a learner)
// can be tuned from what really happened. Only numbers are kept, never the task's words.
export const STORE_KEY = 'history'
// Change it when a record's fields change: records of another version are left out of the summary.
export const RECORD_VERSION = 1
// Newest first beats everything: about 300 bytes a record keeps the store far under its 4 MiB.
export const MAX_RECORDS = 500

export const close = (task: OpenTask, spent: Spending): Measured => ({
  v: RECORD_VERSION,
  at: task.startedAt,
  task: task.task,
  verdict: task.verdict,
  estimate: task.estimate,
  path: spent.workers > 0 ? 'delegated' : 'solo',
  real: {
    tokens: Math.round(spent.tokens),
    usd: spent.usd,
    // Up to the last model request, so an idle prompt doesn't count as work.
    seconds: Math.max(0, Math.round((task.lastActiveAt - task.startedAt) / 1000)),
    workers: spent.workers,
    prompts: task.prompts,
  },
})

// A task with no model request after its assessment did no work worth keeping.
export const isWorthKeeping = (task: OpenTask, spent: Spending): boolean => spent.tokens > 0 && task.lastActiveAt > task.startedAt

export const records = (stored: unknown): Measured[] =>
  Array.isArray(stored) ? stored.filter((r): r is Measured => !!r && typeof r === 'object' && (r as Measured).v === RECORD_VERSION) : []

export const appended = (stored: unknown, record: Measured): Measured[] => [...records(stored), record].slice(-MAX_RECORDS)

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// How far the real numbers ran from the estimate of the path taken: "+30%" means it cost more than estimated.
const drift = (list: Measured[], pick: (p: { usd: number; seconds: number }) => number): string => {
  const ratios = list.map(r => pick(r.real) / pick(r.estimate[r.path])).filter(Number.isFinite)
  return ratios.length ? formatDelta(1, median(ratios)) : '—'
}

const line = (label: string, list: Measured[]): string => {
  if (list.length === 0) return `${label}: nenhuma tarefa ainda.`
  const n = list.length
  const sum = (f: (r: Measured) => number) => list.reduce((s, r) => s + f(r), 0)
  return (
    `${label}: ${n} ${n === 1 ? 'tarefa' : 'tarefas'}, em média ${formatTokens(sum(r => r.real.tokens) / n)} tokens, ` +
    `${formatUsd(sum(r => r.real.usd) / n)}, ${formatTime(sum(r => r.real.seconds) / n)} e ` +
    `${(sum(r => r.real.prompts) / n).toFixed(1).replace('.', ',')} pedidos. ` +
    `Real contra o estimado (mediana): custo ${drift(list, p => p.usd)}, tempo ${drift(list, p => p.seconds)}.`
  )
}

export const summary = (list: Measured[]): string => {
  if (list.length === 0) return 'Nenhuma tarefa medida ainda. Cada tarefa avaliada é medida quando a próxima começa ou a sessão termina.'
  return [
    `Tarefas medidas: ${list.length}.`,
    line('Sem subagentes', list.filter(r => r.path === 'solo')),
    line('Com subagentes', list.filter(r => r.path === 'delegated')),
    'Só números ficam guardados, neste computador. Para apagar: /advisor-history limpar',
  ].join('\n')
}
