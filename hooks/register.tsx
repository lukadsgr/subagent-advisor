import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Assessment, Choice, Plan } from '../types'
import { bandSvg, COLOR, CREDIT, heightOf, HEADLINE } from './band'
import { estimate, formatDelta, spentOn, STEP, timeRange, tokenRange, usdRange } from './estimate'
import type { StepSize } from './estimate'

const TOOL = 'mcp__subagent-advisor__assess'
const NOTHING_SPENT = { tokens: 0, usd: 0, workers: 0 }

const assessment = atom({ plugin: 'subagent-advisor', key: 'assessment' } as const, null)
const spending = atom({ plugin: 'subagent-advisor', key: 'spending' } as const, NOTHING_SPENT)
const mainContext = atom({ plugin: 'subagent-advisor', key: 'mainContext' } as const, 0)
const mainModel = atom({ plugin: 'subagent-advisor', key: 'mainModel' } as const, '')
const isHidden = atom({ plugin: 'subagent-advisor', key: 'isHidden' } as const, false)
const choice = atom({ plugin: 'subagent-advisor', key: 'choice' } as const, null)

const CHOICE_PROMPT: Record<Choice, string> = {
  solo: 'Siga sem subagentes, aqui nesta sessão.',
  delegated: 'Siga com subagentes: use /savvy-flow:savvy-flow se estiver disponível; se não, delegue com a ferramenta Agent.',
}

const CHOICE_LABEL: Record<Choice, string> = { solo: 'Seguindo sem subagentes', delegated: 'Seguindo com subagentes' }

const GUIDANCE =
  'At the very start of any task that involves editing files or running more than one command, ' +
  `before doing the work, call ${TOOL} once with your honest estimate of the task. ` +
  'Skip it for short questions and for a task you already assessed. ' +
  'When its result says to ask, tell the user the recommendation and the numbers in one or two lines, ' +
  'then wait for them to choose before starting the work.'

type AssessInput = {
  title?: string
  steps?: number
  independent?: number
  readTokens?: number
  isRisky?: boolean
  size?: string
}

const planText = (p: Plan): string => `${tokenRange(p)} tokens, ${usdRange(p)}, ${timeRange(p)}`

const sizeOf = (size: string | undefined): StepSize => (size !== undefined && size in STEP ? (size as StepSize) : 'medium')

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
        'Call it once at the start of a task, before the work.',
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
            description: 'Tokens of everything the task must read, web pages and research included: about 3000 per ordinary source file, or 300 per KB.',
          },
          size: {
            type: 'string',
            enum: ['small', 'medium', 'large'],
            description:
              'How big a typical step is. small: a quick edit or check. medium: a change across a few files. ' +
              'large: research, a whole feature or anything open-ended. When unsure, pick the larger one.',
          },
          isRisky: {
            type: 'boolean',
            description: 'True when a mistake is costly, such as deleting data, so an independent review is worth paying for.',
          },
        },
        required: ['title', 'steps', 'independent', 'readTokens', 'size'],
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
      size: sizeOf(input.size),
      context: await read($, mainContext),
      model: await read($, mainModel),
    })

    await update($, spending, () => NOTHING_SPENT)
    await update($, choice, () => null)
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
        : 'Ask: tell the user, then end your turn and wait. They choose with the buttons on the band, which send their answer, or by replying.'
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
    const chosen = await read($, choice)
    const hide = <Button key="advisor-hide" label="✕" plain role="dismiss" onPress={() => update($, isHidden, () => true)} />

    const choose = async (picked: Choice): Promise<void> => {
      if ((await read($, choice)) !== null) return
      await update($, choice, () => picked)
      await $.prompt.submit({ text: CHOICE_PROMPT[picked], asUser: true })
    }

    // Only a verdict the session waits on takes an answer: on `skip` it is already working.
    const best: Choice = a.verdict === 'use' ? 'delegated' : 'solo'
    const buttons =
      chosen !== null ? (
        <Text dimColor>{CHOICE_LABEL[chosen]}</Text>
      ) : a.verdict === 'skip' ? null : (
        <Box flexDirection="row" gap={1}>
          <Button key="advisor-solo" label="Sem subagentes" variant={best === 'solo' ? 'primary' : 'secondary'} onPress={() => choose('solo')} />
          <Button key="advisor-delegated" label="Com subagentes" variant={best === 'delegated' ? 'primary' : 'secondary'} onPress={() => choose('delegated')} />
        </Box>
      )

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
          {buttons}
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
        {buttons}
        {below}
      </Box>
    )
  })
}
