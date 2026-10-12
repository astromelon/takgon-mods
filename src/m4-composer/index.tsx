import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PromptSubmitInput, PromptSubmitResult } from 'claude-code'

import type { TaskItem } from '../../types'
import { globalKey, projectId, projectKey } from '../shared/keys'
import { ALL_ON } from '../shared/state'
import {
  buildForkPrompt,
  fit,
  formatPrBadge,
  hadToolUseThisTurn,
  mergeTasks,
  needsCoach,
  openTasks,
  parseCoachArgs,
  parseCoachReply,
  parseNextSteps,
  shouldFork,
  toTasks,
  toggleTask,
} from './logic'
import { tr } from './messages'

const langAtom = atom({ plugin: 'takgon-mods', key: 'lang' } as const, 'ko')
const modulesAtom = atom({ plugin: 'takgon-mods', key: 'modules' } as const, ALL_ON)
const prAtom = atom({ plugin: 'takgon-mods', key: 'pr' } as const, null)
const tasksAtom = atom({ plugin: 'takgon-mods', key: 'tasks' } as const, [])
const coachOnAtom = atom({ plugin: 'takgon-mods', key: 'coachOn' } as const, true)
const restoredAtom = atom({ plugin: 'takgon-mods', key: 'restored' } as const, [])

/** 코치 on/off 전역 store 키. */
const COACH_KEY = globalKey('m4', 'coach')

/** 코치 판정에 쓰는 작은 모델과 시간 상한. */
const COACH_MODEL = 'haiku'
const COACH_TIMEOUT_MS = 4000

/** task 줄에서 버튼 표식·여백이 차지하는 칸. */
const ROW_CHROME = 8

/** 현재 프로젝트의 task store 키. */
const tasksKey = async ($: EngineInterface): Promise<string> =>
  projectKey(projectId(await $.session.root()), 'm4', 'tasks')

/** composer 모듈이 켜져 있는지. */
const isOn = async ($: EngineInterface): Promise<boolean> => (await read($, modulesAtom)).composer

/** store에서 task 목록과 코치 설정을 불러와 state에 둔다. */
const restore = async ($: EngineInterface): Promise<void> => {
  const tasks = toTasks(await $.store.get(await tasksKey($)))
  const coach = await $.store.get(COACH_KEY)
  await update($, tasksAtom, () => tasks)
  await update($, coachOnAtom, () => coach !== false)
}

/**
 * 이번 세션에 아직 복원하지 않았으면 store에서 불러온다. `/clear`·`/resume`은 state(복원 표시 포함)를 비우고
 * `session.start`를 다시 보내지 않으므로, 이 모듈의 훅에 처음 들어올 때 다시 채운다.
 */
const ensureRestored = async ($: EngineInterface): Promise<void> => {
  if ((await read($, restoredAtom)).includes('m4')) {
    return
  }
  await update($, restoredAtom, list => (list.includes('m4') ? list : [...list, 'm4']))
  try {
    await restore($)
  } catch {
    // 훅 실패로 번지면 같은 이벤트의 뒤쪽 훅이 건너뛰어지므로 삼키고, 다음 진입에서 다시 시도한다.
    await update($, restoredAtom, list => list.filter(one => one !== 'm4'))
    return
  }
}

/** task 목록을 state와 store에 함께 쓴다. */
const saveTasks = async ($: EngineInterface, fn: (tasks: TaskItem[]) => TaskItem[]): Promise<void> => {
  const next = fn(await read($, tasksAtom))
  await update($, tasksAtom, () => next)
  await $.store.set(await tasksKey($), next)
}

/** 체크 토글: 완료 상태를 뒤집어 저장한다. */
const onToggle = async ($: EngineInterface, id: string): Promise<void> => {
  await saveTasks($, tasks => toggleTask(tasks, id))
}

/** task 텍스트를 프롬프트로 제출한다. 사용자가 고른 것이므로 본인 말로 보낸다. */
const onSubmitTask = async ($: EngineInterface, text: string): Promise<void> => {
  await $.prompt.submit({ text, asUser: true })
}

/** 이번 턴에 도구를 썼고 간격이 지났으면 fork로 다음 작업 후보를 만든다. 실패는 조용히 무시한다. */
const suggestNextSteps = async (
  $: EngineInterface,
  lastAt: number | undefined,
): Promise<number | undefined> => {
  const now = await $.clock.now()
  const hadTools = hadToolUseThisTurn(await $.session.messages())
  if (!shouldFork(hadTools, lastAt, now)) {
    return lastAt
  }
  const lang = await read($, langAtom)
  const reply = await $.model.fork({ prompt: buildForkPrompt(lang, await read($, tasksAtom)) })
  if (!reply.isAnswered) {
    // nothing-to-fork는 요청이 없었으니 간격도 소모하지 않는다.
    return reply.reason === 'nothing-to-fork' ? lastAt : now
  }
  const steps = parseNextSteps(reply.text)
  if (steps.length > 0) {
    await saveTasks($, tasks => mergeTasks(tasks, steps, now))
  }
  return now
}

/** 모호한 요청이면 다듬은 버전을 제안하고 사용자가 고른 대로 진행한다. 실패는 원문 통과. */
const coachPrompt = async (
  $: EngineInterface,
  e: PromptSubmitInput,
  next: (e: PromptSubmitInput) => Promise<PromptSubmitResult>,
): Promise<PromptSubmitResult> => {
  const isSkipped =
    !(await isOn($)) ||
    !(await read($, coachOnAtom)) ||
    (e.attachments?.length ?? 0) > 0 ||
    !needsCoach(e.text)
  if (isSkipped) {
    return next(e)
  }
  const lang = await read($, langAtom)
  // 판정 호출이 거부(차단된 모델 등)돼도 훅 실패로 번지지 않게 여기서 잡는다. 훅이 실패해 `.catch`가 답하면
  // 같은 이벤트에 걸린 다른 모듈(M2·M3·M7의 context 첨부)까지 건너뛰어진다.
  let verdict: ReturnType<typeof parseCoachReply> = null
  try {
    const reply = await $.model.complete({
      model: COACH_MODEL,
      system: tr(lang, 'coach.system'),
      prompt: tr(lang, 'coach.prompt', { text: e.text }),
      maxTokens: 300,
      timeoutMs: COACH_TIMEOUT_MS,
    })
    verdict = reply.isAnswered ? parseCoachReply(reply.text) : null
  } catch {
    return next(e)
  }
  if (verdict === null || !verdict.ambiguous || verdict.refined === '' || verdict.refined === e.text.trim()) {
    return next(e)
  }

  const keep = tr(lang, 'coach.keep')
  const refined = tr(lang, 'coach.refined')
  const cancel = tr(lang, 'coach.cancel')
  let answer: string
  try {
    answer = await $.ui.ask(tr(lang, 'coach.question', { refined: verdict.refined }), {
      options: [keep, refined, cancel],
      header: tr(lang, 'coach.header'),
    })
  } catch {
    return next(e)
  }
  if (answer === refined) {
    return next({ ...e, text: verdict.refined })
  }
  if (answer === cancel) {
    return { drop: tr(lang, 'coach.dropped') }
  }
  return next(e)
}

/**
 * M4: 프롬프트 위 Composer Bar.
 *
 * - band(`AbovePrompt`): M5의 PR 배지와 미완료 Next-steps 최대 3개. 표시할 것이 없거나 설문 중이면 엔진에 맡긴다.
 * - Next-steps: 도구를 쓴 턴이 끝나면(2분 간격) `$.model.fork`로 후보를 만들어 `tasks`(M6와 공유)에 더한다.
 * - Prompt-coach: 사용자가 직접 친 짧고 모호한 요청만 작은 모델로 판정하고 `$.ui.ask`로 고르게 한다.
 */
export const registerComposer = (on: On): void => {
  let lastForkAt: number | undefined
  let isForking = false

  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await ensureRestored($)
    const lang = await read($, langAtom)
    await $.command.register({
      name: 'coach',
      description: tr(lang, 'coach.description'),
      argumentHint: '[on|off]',
    }).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
    await ensureRestored($)
    const result = await next(e)
    if (e.agentId === undefined && !isForking && (await isOn($))) {
      // fork는 시간 상한을 줄 수 없어 턴 마무리를 붙잡지 않도록 타이머로 떼어 낸다. 한 번에 하나만 돈다.
      isForking = true
      $.clock.after(0, async () => {
        try {
          lastForkAt = await suggestNextSteps($, lastForkAt)
        } catch {
          // Next-steps는 부가 기능이므로 실패해도 조용히 넘어간다.
        } finally {
          isForking = false
        }
      })
    }
    return result
  })

  on('prompt.submit', { origin: { kind: 'composer' } }, async ($, e, next) => {
    await ensureRestored($)
    return coachPrompt($, e, next)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'coach' }, async ($, e) => {
    await ensureRestored($)
    const lang = await read($, langAtom)
    if (!(await isOn($))) {
      return { text: tr(lang, 'coach.moduleOff') }
    }
    const action = parseCoachArgs(e.args)
    if (action.kind === 'usage') {
      return { text: tr(lang, 'coach.usage') }
    }
    if (action.kind === 'set') {
      await $.store.set(COACH_KEY, action.isOn)
      await update($, coachOnAtom, () => action.isOn)
    }
    const isCoachOn = action.kind === 'set' ? action.isOn : await read($, coachOnAtom)
    return { text: tr(lang, 'coach.state', { state: tr(lang, isCoachOn ? 'coach.on' : 'coach.off') }) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await isOn($))) {
      return next(e)
    }
    const pr = await read($, prAtom)
    const tasks = openTasks(await read($, tasksAtom))
    if (pr === null && tasks.length === 0) {
      return next(e)
    }
    const lang = await read($, langAtom)
    const width = e.props.bodyColumns
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" width={width}>
        {pr === null ? null : (
          <Box key="pr-badge">
            <Text bold wrap="truncate-end">
              {formatPrBadge(lang, pr)}
            </Text>
          </Box>
        )}
        {tasks.map(one => {
          const chip = one.kind === 'checkbox' ? '' : `[${tr(lang, `task.kind.${one.kind}`)}] `
          const label = fit(`${chip}${one.text}`, Math.max(width - ROW_CHROME, 8))
          return (
            <Box key={`row-${one.id}`} flexDirection="row" gap={1}>
              {one.kind === 'checkbox' ? (
                <Button
                  key={`check-${one.id}`}
                  plain
                  label={one.isDone ? '[x]' : '[ ]'}
                  onPress={() => onToggle($, one.id)}
                />
              ) : null}
              <Button key={`task-${one.id}`} plain label={label} onPress={() => onSubmitTask($, one.text)} />
            </Box>
          )
        })}
      </Box>
    )
  })
}
