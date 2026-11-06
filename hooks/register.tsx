import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Assessment, Plan } from '../types'
import { bandSvg, COLOR, CREDIT, heightOf, HEADLINE } from './band'
import { estimate, formatDelta, formatTime, formatTokens, formatUsd, spentOn } from './estimate'

const TOOL = 'mcp__subagent-advisor__assess'
const NOTHING_SPENT = { tokens: 0, usd: 0, workers: 0 }

const assessment = atom({ plugin: 'subagent-advisor', key: 'assessment' } as const, null)
const spending = atom({ plugin: 'subagent-advisor', key: 'spending' } as const, NOTHING_SPENT)
const mainContext = atom({ plugin: 'subagent-advisor', key: 'mainContext' } as const, 0)
const mainModel = atom({ plugin: 'subagent-advisor', key: 'mainModel' } as const, '')
const isHidden = atom({ plugin: 'subagent-advisor', key: 'isHidden' } as const, false)

// Only work that could run in parallel ever shows a band, so assessing anything else spends a turn on nothing.
const GUIDANCE =
  'At the very start of a task you can already see splitting into two or more steps that could run at the same time, ' +
  `before doing the work, call ${TOOL} once with your honest estimate of the task. ` +
  'Skip it for short questions, for sequential or one-step work, and for a task you already assessed. ' +
  'When its result says to ask, tell the user the recommendation and the numbers in one or two lines, ' +
  'then wait for them to choose before starting the work.'

type AssessInput = {
  title?: string
  steps?: number
  independent?: number
  readTokens?: number
  isRisky?: boolean
}

const planText = (p: Plan): string => `~${formatTokens(p.tokens)} tokens, ~${formatUsd(p.usd)}, ~${formatTime(p.seconds)}`

const compare = (a: Assessment): string =>
  `Sem subagentes: ${planText(a.solo)}. Com subagentes: ${planText(a.delegated)}. ` +
  `Diferença com subagentes: ${formatDelta(a.solo.tokens, a.delegated.tokens)} tokens, ${formatDelta(a.solo.usd, a.delegated.usd)} custo, ${formatDelta(a.solo.seconds, a.delegated.seconds)} tempo.`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({
      name: 'assess',
      description:
        'Estimate whether a task is better done with subagents, and show the user the tokens, dollars and time with and without them. ' +
        'Call it once at the start of a task with two or more steps that could run at the same time, before the work.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the task, a few words.' },
          steps: { type: 'integer', minimum: 1, description: 'Distinct pieces of work the task splits into.' },
          independent: {
            type: 'integer',
            minimum: 1,
            description: 'The most steps that could run at the same time, none needing another. 1 for a strict sequence.',
          },
          readTokens: {
            type: 'integer',
            minimum: 0,
            description: 'Tokens of files and logs the task must read: about 3000 per ordinary source file, or 300 per KB.',
          },
          isRisky: {
            type: 'boolean',
            description: 'True when a mistake is costly, such as deleting data, so an independent review is worth paying for.',
          },
        },
        required: ['title', 'steps', 'independent', 'readTokens'],
      },
      isDeferred: false,
    })
    return started
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return {
      sections: [...composed.sections, { id: 'subagent-advisor:assess', text: GUIDANCE, scope: 'session' as const }],
    }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId) return { result: 'ignored: only the main session assesses a task' }

    const input = e as unknown as AssessInput
    const result = estimate({
      steps: input.steps ?? 1,
      independent: input.independent ?? 1,
      readTokens: input.readTokens ?? 0,
      isRisky: input.isRisky === true,
      context: await read($, mainContext),
      model: await read($, mainModel),
    })

    await update($, spending, () => NOTHING_SPENT)
    if (!result.isShown) {
      await update($, assessment, () => null)
      return { result: 'No steps can run at the same time, so nothing is shown. Go on with the task; no need to mention this.' }
    }

    const a: Assessment = {
      title: (input.title ?? '').trim().slice(0, 60) || 'Tarefa',
      verdict: result.verdict,
      reason: result.reason,
      solo: result.solo,
      delegated: result.delegated,
    }
    await update($, assessment, () => a)
    await update($, isHidden, () => false)
    if (a.verdict === 'use') $.ui.toast(`${HEADLINE.use}: ${a.title}`)

    const action =
      a.verdict === 'skip'
        ? 'Go on with the task; no need to mention this.'
        : // savvy-flow is optional: name it only when the session can actually run it.
          'Ask: tell the user, and wait for them to choose between going on here and splitting the work into subagents. ' +
          'Offer /savvy-flow:savvy-flow for the split only if it is among your available skills; otherwise offer your own subagents.'
    return { result: `${HEADLINE[a.verdict]}. ${a.reason} ${compare(a)} ${action}` }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny === undefined) await update($, spending, s => ({ ...s, workers: s.workers + 1 }))
    return started
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage
    if (!usage) return result

    const model = usage.model || e.model
    if (!e.agentId) {
      const context = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens
      await update($, mainContext, () => context)
      await update($, mainModel, () => model)
    }
    if (await read($, assessment)) {
      const spent = spentOn(model, usage)
      await update($, spending, s => ({ ...s, tokens: s.tokens + spent.tokens, usd: s.usd + spent.usd }))
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const a = await read($, assessment)
    if (a === null || e.props.hasSurvey || (await read($, isHidden))) return next(e)

    // Keep the other mods' bands beneath this one, never the engine's own placeholder:
    // the desktop drops a band that nests it.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const spent = await read($, spending)
    const hide = <Button key="advisor-hide" label="✕" plain role="dismiss" onPress={() => update($, isHidden, () => true)} />

    // The terminal's table holds an `Svg` that draws nothing: test the surface too.
    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const width = Math.max(320, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 48))
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="flex-start" gap={1}>
            <Svg source={bandSvg(a, spent, width)} alt={`${HEADLINE[a.verdict]}. ${a.reason} ${compare(a)}`} width={width} height={heightOf(width)} />
            {hide}
          </Box>
          {below}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={COLOR[a.verdict]} bold>{HEADLINE[a.verdict]}</Text>
          <Text dimColor wrap="truncate-end">{a.title}</Text>
          {hide}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text bold>Sem subagentes:</Text>
          <Text>{planText(a.solo)}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text bold>Com subagentes:</Text>
          <Text>{planText(a.delegated)}</Text>
        </Box>
        <Text dimColor>{a.reason}</Text>
        <Text dimColor>{CREDIT}</Text>
        {below}
      </Box>
    )
  })
}
