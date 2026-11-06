import { expect, test } from 'claude-code/testing'

import type { Measured, OpenTask } from '../types'
import { appended, close, isWorthKeeping, MAX_RECORDS, records, STORE_KEY, summary } from './history'

const plan = { tokens: 100000, usd: 1, seconds: 600 }
const task: OpenTask = {
  startedAt: 1_000_000,
  lastActiveAt: 1_000_000 + 300_000,
  prompts: 2,
  task: { steps: 4, independent: 4, readTokens: 30000, isRisky: false, context: 25000, model: 'claude-opus-5-5' },
  verdict: 'use',
  estimate: { solo: plan, delegated: { tokens: 120000, usd: 1.2, seconds: 300 } },
}

test('a task with subagents is measured on the delegated path', () => {
  const r = close(task, { tokens: 90000.4, usd: 1.5, workers: 3 })
  expect(r.path).toBe('delegated')
  expect(r.real.tokens).toBe(90000)
  expect(r.real.seconds).toBe(300)
  expect(r.real.prompts).toBe(2)
  expect(r.v).toBe(1)
})

test('a task with no subagents is measured on the solo path', () => {
  expect(close(task, { tokens: 1, usd: 0.1, workers: 0 }).path).toBe('solo')
})

test('a task that did no work is not kept', () => {
  expect(isWorthKeeping(task, { tokens: 0, usd: 0, workers: 0 })).toBe(false)
  expect(isWorthKeeping({ ...task, lastActiveAt: task.startedAt }, { tokens: 10, usd: 0, workers: 0 })).toBe(false)
  expect(isWorthKeeping(task, { tokens: 10, usd: 0, workers: 0 })).toBe(true)
})

test('records of another version or shape are left out', () => {
  const good = close(task, { tokens: 1, usd: 1, workers: 0 })
  expect(records([good, { v: 0 }, null, 'x']).length).toBe(1)
  expect(records({ not: 'a list' }).length).toBe(0)
  expect(records(undefined).length).toBe(0)
})

test('the history keeps only the newest records', () => {
  const r = close(task, { tokens: 1, usd: 1, workers: 0 })
  const full = Array.from({ length: MAX_RECORDS }, (_, i) => ({ ...r, at: i }))
  const next = appended(full, { ...r, at: -1 })
  expect(next.length).toBe(MAX_RECORDS)
  expect(next[next.length - 1].at).toBe(-1)
  expect(next[0].at).toBe(1)
})

test('the summary compares the real numbers with the estimate of the path taken', () => {
  // Delegated estimate: $1,20 and 300 s. Real: $1,50 and 300 s, so +25% cost and +0% time.
  const r: Measured = close(task, { tokens: 90000, usd: 1.5, workers: 2 })
  const text = summary([r])
  expect(text.includes('Tarefas medidas: 1.')).toBe(true)
  expect(text.includes('Sem subagentes: nenhuma tarefa ainda.')).toBe(true)
  expect(text.includes('custo +25%')).toBe(true)
  expect(text.includes('tempo 0%')).toBe(true)
})

test('an empty history says how tasks get measured', () => {
  expect(summary([]).startsWith('Nenhuma tarefa medida ainda.')).toBe(true)
})

test('the history command reads the store, and "limpar" erases it', async ($, on) => {
  const stored = new Map<string, unknown>([[STORE_KEY, [close(task, { tokens: 5, usd: 0.5, workers: 0 })]]])
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.delete', (_, e) => {
    stored.delete(e.key)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const shown = await $.command.run({ command: 'advisor-history' })
  expect(shown.text?.includes('Tarefas medidas: 1.')).toBe(true)

  await $.command.run({ command: 'advisor-history', args: 'limpar' })
  expect(stored.has(STORE_KEY)).toBe(false)
})

test('a task assessed but never worked on leaves nothing in the store', async ($, on) => {
  let writes = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1000 }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => {
    writes += 1
    return { value: undefined }
  })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__subagent-advisor__assess', title: 'x', steps: 4, independent: 4, readTokens: 100000 } as never)
  await $.session.end({ reason: 'other', sessionId: 's1' } as never)
  expect(writes).toBe(0)
})
