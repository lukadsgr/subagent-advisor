import { expect, test } from 'claude-code/testing'

import { bandSvg } from './band'
import { estimate } from './estimate'

const BAND = {
  plugin: 'subagent-advisor',
  component: 'AbovePrompt',
  props: { hasSurvey: false, bodyColumns: 100 },
} as const

const base = { steps: 5, independent: 2, readTokens: 20000, isRisky: false, context: 25000, model: 'claude-opus-5-5' }

test('sequential work is never shown', () => {
  const r = estimate({ ...base, independent: 1, isRisky: true, readTokens: 300000 })
  expect(r.isShown).toBe(false)
  expect(r.verdict).toBe('skip')
})

test('a single step is never shown', () => {
  expect(estimate({ ...base, steps: 1, independent: 3 }).isShown).toBe(false)
})

test('parallel work that does not pay off is shown as not recommended', () => {
  const r = estimate({ ...base, steps: 3, readTokens: 5000 })
  expect(r.isShown).toBe(true)
  expect(r.verdict).toBe('skip')
  expect(r.delegated.usd > r.solo.usd).toBe(true)
})

test('independent steps are recommended for the time they save', () => {
  const r = estimate({ ...base, steps: 4, independent: 4, readTokens: 100000, context: 60000 })
  expect(r.verdict).toBe('use')
  expect(r.delegated.seconds < r.solo.seconds).toBe(true)
  expect(r.reason.includes('4 etapas rodam ao mesmo tempo')).toBe(true)
})

test('heavy reading that would fill the session is recommended', () => {
  const r = estimate({ ...base, readTokens: 200000, context: 80000 })
  expect(r.verdict).toBe('use')
  expect(r.delegated.tokens < r.solo.tokens).toBe(true)
})

test('a small task in a full session is not recommended', () => {
  expect(estimate({ ...base, steps: 2, readTokens: 3000, context: 300000 }).verdict).toBe('skip')
})

test('a risky parallel task is left to the person', () => {
  expect(estimate({ ...base, isRisky: true }).verdict).toBe('maybe')
})

test('the drawing takes the verdict color and escapes the title', () => {
  const plan = { tokens: 100000, usd: 0.5, seconds: 300 }
  const a = { title: 'a<b', verdict: 'skip', reason: 'Motivo.', solo: plan, delegated: plan } as const
  const svg = bandSvg(a, { tokens: 0, usd: 0, workers: 0 }, 800)
  expect(svg.includes('#f85149')).toBe(true)
  expect(svg.includes('a&lt;b')).toBe(true)
  expect(svg.includes('SEM SUBAGENTES')).toBe(true)
  expect(svg.includes('$0,50')).toBe(true)
  expect(svg.includes('Created by LUKADSGR')).toBe(true)
})

test('parallel work reaches the band on every surface', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('clock.now', () => ({ value: 1000 }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__subagent-advisor__assess', title: 'Telas novas', steps: 4, independent: 4, readTokens: 100000 } as never)

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect((await terminal.find({ type: 'Text', text: /recomendados/ }))?.text).toBe('Subagentes recomendados')
  await terminal.unmount()

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect((await desktop.find({ type: 'Svg' })) !== undefined).toBe(true)
  await desktop.unmount()
})

test('sequential work leaves no band, and clears an earlier one', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('clock.now', () => ({ value: 1000 }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__subagent-advisor__assess', title: 'Antes', steps: 4, independent: 4, readTokens: 30000 } as never)
  await $.tool.call({ tool: 'mcp__subagent-advisor__assess', title: 'Depois', steps: 4, independent: 1, readTokens: 30000 } as never)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Subagentes/ })).toBe(undefined)
  await ui.unmount()
})

test('a subagent cannot assess', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__subagent-advisor__assess', agentId: 'a1', title: 'x', steps: 3, independent: 3, readTokens: 0 } as never)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Subagentes/ })).toBe(undefined)
  await ui.unmount()
})
