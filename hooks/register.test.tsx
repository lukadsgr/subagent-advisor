import { expect, test } from 'claude-code/testing'

import { bandSvg, wrap } from './band'
import { estimate, formatDelta } from './estimate'

const BAND = {
  plugin: 'subagent-advisor',
  component: 'AbovePrompt',
  props: { hasSurvey: false, bodyColumns: 100 },
} as const

const base = { steps: 5, independent: 2, readTokens: 20000, isRisky: false, size: 'medium', context: 25000, model: 'claude-opus-5-5' } as const

test('sequential work is never shown', () => {
  const r = estimate({ ...base, independent: 1, isRisky: true, readTokens: 300000 })
  expect(r.isShown).toBe(false)
  expect(r.verdict).toBe('skip')
})

test('a single step is never shown', () => {
  expect(estimate({ ...base, steps: 1, independent: 3 }).isShown).toBe(false)
})

test('parallel work that does not pay off is shown as not recommended', () => {
  const r = estimate({ ...base, steps: 3, readTokens: 5000, size: 'small' })
  expect(r.isShown).toBe(true)
  expect(r.verdict).toBe('skip')
  expect(r.delegated.usd > r.solo.usd).toBe(true)
})

test('independent steps are recommended for the time they save', () => {
  const r = estimate({ ...base, steps: 4, independent: 4, readTokens: 100000, size: 'large', context: 60000 })
  expect(r.verdict).toBe('use')
  expect(r.delegated.seconds < r.solo.seconds).toBe(true)
  expect(r.reason.includes('4 etapas rodam ao mesmo tempo')).toBe(true)
})

test('heavy reading that would fill the session is recommended', () => {
  const r = estimate({ ...base, readTokens: 200000, size: 'large', context: 80000 })
  expect(r.verdict).toBe('use')
  expect(r.delegated.tokens < r.solo.tokens).toBe(true)
})

test('a small task in a full session is not recommended', () => {
  expect(estimate({ ...base, steps: 2, readTokens: 3000, size: 'small', context: 300000 }).verdict).toBe('skip')
})

test('a risky parallel task is left to the person', () => {
  expect(estimate({ ...base, isRisky: true }).verdict).toBe('maybe')
})

test('the drawing takes the verdict color and escapes the title', () => {
  const plan = { tokens: 100000, usd: 0.5, seconds: 300, tokensHigh: 300000, usdHigh: 1.5, secondsHigh: 900 }
  const a = { title: 'a<b', verdict: 'skip', reason: 'Motivo.', solo: plan, delegated: plan } as const
  const svg = bandSvg(a, { tokens: 0, usd: 0, workers: 0 }, 800)
  expect(svg.includes('#f85149')).toBe(true)
  expect(svg.includes('a&lt;b')).toBe(true)
  expect(svg.includes('SEM SUBAGENTES')).toBe(true)
  expect(svg.includes('$0,50')).toBe(true)
  expect(svg.includes('Created by LUKADSGR')).toBe(true)
})

test('more independent steps than steps run in one wave', () => {
  const capped = estimate({ ...base, steps: 3, independent: 3 })
  const over = estimate({ ...base, steps: 3, independent: 9 })
  expect(over.delegated.seconds).toBe(capped.delegated.seconds)
  expect(over.isShown).toBe(true)
})

test('an unknown model is priced like the default', () => {
  const known = estimate({ ...base, model: 'claude-opus-5-5' })
  const unknown = estimate({ ...base, model: 'some-other-model' })
  expect(unknown.solo.usd).toBe(known.solo.usd)
})

test('a missing context falls back to the default', () => {
  expect(estimate({ ...base, context: 0 }).solo.tokens).toBe(estimate({ ...base, context: 25000 }).solo.tokens)
})

test('a delta from zero never prints NaN', () => {
  expect(formatDelta(0, 5)).toBe('+∞')
  expect(formatDelta(0, 0)).toBe('0%')
  expect(formatDelta(100, 144)).toBe('+44%')
})

test('a first word wider than the line leaves no empty line', () => {
  const lines = wrap('Supercalifragilisticexpialidocious e mais', 12.5, 60, 2)
  expect(lines[0] !== '').toBe(true)
})

test('parallel work reaches the band on every surface', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__subagent-advisor__assess', title: 'Telas novas', steps: 4, independent: 4, readTokens: 100000, size: 'large' } as never)

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

test('a real heavy session lands inside the range, where 0.2.2 said $1,76', () => {
  // A real session on 2026-11-06: the input it gave, and $16,11 spent with 2 subagents still running.
  const r = estimate({ ...base, steps: 6, independent: 3, readTokens: 60000, isRisky: true, size: 'large', context: 103000 })
  expect(r.delegated.usd > 10).toBe(true)
  expect(r.delegated.usdHigh >= 16.11).toBe(true)
  expect(r.delegated.secondsHigh >= 48 * 60).toBe(true)
})

test('small steps do not pay for a subagent each', () => {
  const r = estimate({ ...base, steps: 4, independent: 4, readTokens: 5000, size: 'small' })
  expect(r.delegated.usd > r.solo.usd).toBe(true)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pressing a choice on ${surface} sends it once and leaves the buttons`, async ($, on) => {
    const sent: string[] = []
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('tool.register', () => ({ value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('prompt.submit', (_, e) => {
      sent.push(e.text)
      return { drop: 'test' } as never
    })
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)

      return <Text>engine</Text>
    })

    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.tool.call({ tool: 'mcp__subagent-advisor__assess', title: 'Telas', steps: 4, independent: 4, readTokens: 100000, size: 'large', isRisky: true } as never)

    const ui = await $.ui.mount({ ...BAND, surface } as never)
    await ui.press({ key: 'advisor-delegated' })
    expect(sent.length).toBe(1)
    expect(sent[0].includes('com subagentes')).toBe(true)
    expect((await ui.find({ type: 'Text', text: /Seguindo com subagentes/ })) !== undefined).toBe(true)
    await ui.unmount()
  })
}

const assessed = async ($: never, on: never, input: object): Promise<void> => {
  const engine = $ as any
  const hook = on as any
  hook('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  hook('tool.register', () => ({ value: undefined }))
  hook('ui.toast', () => ({ value: undefined }))
  hook('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  hook('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)

    return <Text>engine</Text>
  })
  await engine.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await engine.tool.call({ tool: 'mcp__subagent-advisor__assess', title: 'Telas', steps: 4, independent: 4, readTokens: 100000, ...input })
}

const typed = (text: string, more: object = {}) => ({ text, wait: false, origin: { kind: 'sdk' }, ...more }) as never

test('a typed reply answers the band and takes the buttons away, then the next task clears it', async ($, on) => {
  await assessed($ as never, on as never, { size: 'large', isRisky: true })

  await $.prompt.submit(typed('sem subagentes'))
  const answered = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect((await answered.find({ type: 'Text', text: /Respondido por mensagem/ })) !== undefined).toBe(true)
  await answered.unmount()

  await $.prompt.submit(typed('outra tarefa'))
  const next = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await next.find({ type: 'Text', text: /Subagentes/ })).toBe(undefined)
  await next.unmount()
})

test('a band the session does not wait on clears on the next task', async ($, on) => {
  await assessed($ as never, on as never, { readTokens: 5000, size: 'small' })

  await $.prompt.submit(typed('outra tarefa'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Subagentes/ })).toBe(undefined)
  await ui.unmount()
})

test('a message typed over a running turn leaves the band alone', async ($, on) => {
  await assessed($ as never, on as never, { size: 'large', isRisky: true })

  await $.prompt.submit(typed('uma correção', { turnId: 't1' }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Respondido por mensagem/ })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /Subagentes/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('a background notification leaves the band alone', async ($, on) => {
  await assessed($ as never, on as never, { size: 'large', isRisky: true })

  await $.prompt.submit({ text: 'tarefa concluída', wait: false, origin: { kind: 'task-notification' } } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Respondido por mensagem/ })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /Subagentes/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('the button press itself keeps the band and its real spend', async ($, on) => {
  await assessed($ as never, on as never, { size: 'large', isRisky: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  await ui.press({ key: 'advisor-solo' })
  expect((await ui.find({ type: 'Text', text: /Seguindo sem subagentes/ })) !== undefined).toBe(true)
  await ui.unmount()
})
