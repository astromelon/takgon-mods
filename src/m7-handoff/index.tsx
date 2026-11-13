import { atom, read, update } from 'claude-code'
import type { CommandSpec, EngineInterface, On } from 'claude-code'

import type { CommandRegistration, HandoffInfo, Lang } from '../../types'
import { t, toLang } from '../shared/i18n'
import { globalKey, projectId, projectKey } from '../shared/keys'
import { LANG_KEY, MODULES_KEY, OUTPUT_GITIGNORE, commandsKey, markNotified, outputDir, refusalReason, registerCause, toCommandMap, toFlags } from '../shared/settings'
import { ALL_ON } from '../shared/state'
import {
  MAX_SUFFIX,
  buildForkPrompt,
  formatStamp,
  formatTime,
  handoffFileName,
  isHandoffPath,
  parseHandoffArgs,
  shouldTrigger,
  summarize,
  toHandoffInfo,
  toThreshold,
} from './logic'
import { tr } from './messages'

const langAtom = atom({ plugin: 'takgon-mods', key: 'lang' } as const, 'ko')
const notifiedAtom = atom({ plugin: 'takgon-mods', key: 'notified' } as const, [])
const commandsAtom = atom({ plugin: 'takgon-mods', key: 'commands' } as const, {})
const modulesAtom = atom({ plugin: 'takgon-mods', key: 'modules' } as const, ALL_ON)
const pinsAtom = atom({ plugin: 'takgon-mods', key: 'pins' } as const, [])
const prAtom = atom({ plugin: 'takgon-mods', key: 'pr' } as const, null)
const linkedIssuesAtom = atom({ plugin: 'takgon-mods', key: 'linkedIssues' } as const, [])
const tasksAtom = atom({ plugin: 'takgon-mods', key: 'tasks' } as const, [])
const handoffAtom = atom({ plugin: 'takgon-mods', key: 'handoff' } as const, null)
const pendingAtom = atom({ plugin: 'takgon-mods', key: 'handoffPending' } as const, false)
const firedAtom = atom({ plugin: 'takgon-mods', key: 'handoffFired' } as const, false)
const restoredAtom = atom({ plugin: 'takgon-mods', key: 'restored' } as const, [])

/**
 * 명령을 등록한다. 같은 이름의 사용자·내장 명령 때문에 거부되면 예외를 삼켜 다른 초기화(이 모듈과 뒤쪽 모듈)를 막지 않고,
 * 명령마다 세션당 1회 toast로 알린다. 결과는 `/mods` 목록용으로 기록한다. `$`는 import 경계를 넘을 수 없어 모듈 파일마다 같은 헬퍼를 둔다.
 */
const registerCommand = async ($: EngineInterface, spec: CommandSpec): Promise<void> => {
  let result: CommandRegistration = { isListed: true }
  try {
    await $.command.register(spec)
  } catch (error) {
    result = { isListed: false, reason: refusalReason(error) }
    try {
      const marked = markNotified(await read($, notifiedAtom), registerCause(spec.name))
      if (marked !== null) {
        await update($, notifiedAtom, () => marked)
        const vars = { name: spec.name, reason: result.reason ?? '' }
        $.ui.toast(t(await read($, langAtom), 'mods.registerRefused', vars))
      }
    } catch {
      // 알림 실패도 초기화를 막지 않는다.
    }
  }
  // `/mods` 목록이 보여 줄 수 있게 결과를 state와 프로젝트 store(`/clear` 뒤 복원용)에 남긴다.
  try {
    await update($, commandsAtom, map => ({ ...map, [spec.name]: result }))
    const key = commandsKey(projectId(await $.session.root()))
    await $.store.set(key, { ...toCommandMap(await $.store.get(key)), [spec.name]: result })
  } catch {
    // 기록 실패도 초기화를 막지 않는다.
  }
}

/** 자동 인수인계 임계치(컨텍스트 %) 전역 store 키. 없으면 75. */
const THRESHOLD_KEY = globalKey('m7', 'threshold')

/** 이 시간이 지나도 끝나지 않은 생성은 멈춘 것으로 보고 새로 시작한다(`$.model.fork`에는 시간 상한이 없다). */
const GENERATING_STUCK_MS = 5 * 60_000

/** 자동 인수인계 실패 시 최대 재시도 횟수. */
const AUTO_RETRY_MAX = 3
let autoFailures = 0

/** 최신본 store 키: `p/{pid}/m7/latest`. */
const latestKey = async ($: EngineInterface): Promise<string> =>
  projectKey(projectId(await $.session.root()), 'm7', 'latest')

/**
 * 모듈 on/off·언어. 초기화 훅은 core보다 먼저 돌 수 있으므로 store를 직접 읽고,
 * 그 밖의 훅은 core가 채운 atom을 읽는다.
 */
const settingsFromStore = async ($: EngineInterface): Promise<{ isOn: boolean; lang: Lang }> => ({
  isOn: toFlags(await $.store.get(MODULES_KEY)).handoff,
  lang: toLang(await $.store.get(LANG_KEY)),
})

const isOn = async ($: EngineInterface): Promise<boolean> => (await read($, modulesAtom)).handoff

/** 같은 분 파일이 있으면 `-2`, `-3`…을 붙인 첫 빈 경로. */
const freePath = async ($: EngineInterface, dir: string, stamp: string): Promise<string> => {
  for (let n = 1; n < MAX_SUFFIX; n += 1) {
    const path = `${dir}/${handoffFileName(stamp, n)}`
    if (!(await $.fs.exists(path))) {
      return path
    }
  }
  return `${dir}/${handoffFileName(stamp, MAX_SUFFIX)}`
}

/** fork로 인수인계 문서를 만들어 파일·atom·store에 남긴다. 실패하면 원인을 돌려준다. */
const generate = async (
  $: EngineInterface,
): Promise<{ isSaved: true; info: HandoffInfo } | { isSaved: false; reason: string }> => {
  const lang = await read($, langAtom)
  const prompt = buildForkPrompt(lang, {
    pins: await read($, pinsAtom),
    pr: await read($, prAtom),
    linkedIssues: await read($, linkedIssuesAtom),
    tasks: await read($, tasksAtom),
  })
  const reply = await $.model.fork({ prompt })
  if (!reply.isAnswered) {
    return { isSaved: false, reason: reply.reason }
  }

  const dir = outputDir(await $.session.root())
  if (!(await $.fs.exists(`${dir}/.gitignore`))) {
    await $.fs.write(`${dir}/.gitignore`, OUTPUT_GITIGNORE)
  }
  const now = await $.clock.now()
  const path = await freePath($, `${dir}/handoff`, formatStamp(now))
  await $.fs.write(path, reply.text)

  const info: HandoffInfo = { path, summary: summarize(reply.text), createdAt: now }
  await update($, handoffAtom, () => info)
  await $.store.set(await latestKey($), info)
  return { isSaved: true, info }
}

/** 최신본 정보: 세션 상태, 없으면 store. */
const latest = async ($: EngineInterface): Promise<HandoffInfo | null> =>
  (await read($, handoffAtom)) ?? toHandoffInfo(await $.store.get(await latestKey($)))

/** 최신본이 있으면 상태를 채우고 toast로 `/tk-handoff load`를 안내한다. */
const restore = async ($: EngineInterface): Promise<void> => {
  const { isOn: isEnabled, lang } = await settingsFromStore($)
  if (!isEnabled) {
    return
  }
  const info = toHandoffInfo(await $.store.get(await latestKey($)))
  if (info === null || !isHandoffPath(await $.session.root(), info.path) || !(await $.fs.exists(info.path))) {
    return
  }
  await update($, handoffAtom, () => info)
  $.ui.toast(tr(lang, 'toast.available', { time: formatTime(info.createdAt) }))
}

/**
 * 이번 세션에 아직 복원하지 않았으면 최신본을 불러온다. `/clear`·`/resume`은 state(복원 표시·세션당 1회 플래그 포함)를
 * 비우고 `session.start`를 다시 보내지 않으므로, 이 모듈의 훅에 처음 들어올 때 다시 채우고 안내한다.
 */
const ensureRestored = async ($: EngineInterface): Promise<void> => {
  if ((await read($, restoredAtom)).includes('m7')) {
    return
  }
  await update($, restoredAtom, list => (list.includes('m7') ? list : [...list, 'm7']))
  // 자동 생성 실패 횟수는 대화(세션 시작·`/clear` 뒤) 단위로 센다. 모듈 변수라 /clear 뒤에도 남기 때문에 여기서 되돌린다.
  autoFailures = 0
  try {
    await restore($)
  } catch {
    // 훅 실패로 번지면 같은 이벤트의 뒤쪽 훅이 건너뛰어지므로 삼키고, 다음 진입에서 다시 시도한다.
    await update($, restoredAtom, list => list.filter(one => one !== 'm7'))
  }
}

/** 세션 시작: 명령 등록과 복원. */
const start = async ($: EngineInterface): Promise<void> => {
  let lang: Lang = 'ko'
  try {
    lang = (await settingsFromStore($)).lang
  } catch {
    // 설정을 못 읽어도 명령은 기본 언어로 등록한다.
  }
  await registerCommand($, {
    name: 'tk-handoff',
    description: tr(lang, 'cmd.description'),
    argumentHint: '[show | load | threshold <1-99>]',
  })
  await ensureRestored($)
}

/** `/tk-handoff [show|load|threshold]` 처리. 새 문서 생성(`create`)의 겹침 검사는 호출하는 훅이 한다. */
const runCommand = async ($: EngineInterface, args: string): Promise<string> => {
  const lang = await read($, langAtom)
  if (!(await isOn($))) {
    return tr(lang, 'cmd.off')
  }
  const action = parseHandoffArgs(args)
  if (action === 'usage') {
    return tr(lang, 'cmd.usage')
  }
  if (typeof action === 'object') {
    if (action.value !== null) {
      await $.store.set(THRESHOLD_KEY, action.value)
    }
    const value = action.value ?? toThreshold(await $.store.get(THRESHOLD_KEY))
    return tr(lang, 'cmd.threshold', { value })
  }
  if (action === 'create') {
    const result = await generate($)
    return result.isSaved
      ? tr(lang, 'cmd.saved', { path: result.info.path })
      : tr(lang, 'cmd.failed', { reason: result.reason })
  }

  const info = await latest($)
  if (info === null) {
    return tr(lang, 'cmd.none')
  }
  if (action === 'show') {
    return tr(lang, 'cmd.show', { time: formatTime(info.createdAt), path: info.path, summary: info.summary })
  }
  if (!isHandoffPath(await $.session.root(), info.path) || !(await $.fs.exists(info.path))) {
    return tr(lang, 'cmd.missing', { path: info.path })
  }
  await update($, handoffAtom, () => info)
  await update($, pendingAtom, () => true)
  return tr(lang, 'cmd.pending', { path: info.path })
}

/** 턴 종료 뒤 컨텍스트 사용률을 보고 세션당 1회 자동 생성한다. 실패하면 최대 3회까지 재시도한다. */
const autoHandoff = async ($: EngineInterface): Promise<void> => {
  if (!(await isOn($)) || (await read($, firedAtom))) {
    return
  }
  const usage = await $.session.usage()
  const threshold = toThreshold(await $.store.get(THRESHOLD_KEY))
  if (!shouldTrigger(usage.context.percent, false, threshold)) {
    return
  }
  await update($, firedAtom, () => true)
  try {
    const result = await generate($)
    if (result.isSaved) {
      autoFailures = 0
      $.ui.toast(tr(await read($, langAtom), 'toast.saved', { path: result.info.path }))
      return
    }
  } catch {
    // 실패 시 아래 재시도 판정으로 넘긴다.
  }
  autoFailures += 1
  if (autoFailures < AUTO_RETRY_MAX) {
    await update($, firedAtom, () => false)
  }
}

/** load 대기 중이면 이번 프롬프트에 붙일 파일 내용을, 아니면 null(대기는 1회로 해제). */
const takePending = async ($: EngineInterface): Promise<string | null> => {
  if (!(await read($, pendingAtom)) || !(await isOn($))) {
    return null
  }
  await update($, pendingAtom, () => false)
  const info = await read($, handoffAtom)
  if (info === null || !isHandoffPath(await $.session.root(), info.path) || !(await $.fs.exists(info.path))) {
    return null
  }
  const text = await $.fs.read(info.path)
  return text.trim() === '' ? null : text
}

/**
 * M7 Auto-handoff.
 *
 * 컨텍스트 사용률이 75% 이상이 된 첫 답변 뒤(세션당 1회) 또는 `/tk-handoff`로 `$.model.fork`에 인수인계 문서를 쓰게 해
 * `{project}/.claude/takgon/handoff/`에 저장한다. 새 세션에서는 최신본을 안내하고, `/tk-handoff load`면 다음 프롬프트
 * 1회에 문서를 context로 붙인다. 임계 판정은 `session.measure`(M6 전용) 대신 `turn.complete`에서 한다.
 */
export const registerHandoff = (on: On): void => {
  // 자동 생성과 수동 `/tk-handoff`가 같이 쓴다. 시작 시각을 남겨 GENERATING_STUCK_MS가 지나면 끝난 것으로 본다.
  let generatingStartedAt: number | undefined

  /** 생성 중이 아니면 시작 표시를 남기고 그 표시를 돌려준다. 이미 생성 중이면 `undefined`. `$`는 import 경계 규칙상 받지 않는다. */
  const claimGenerating = (now: number): number | undefined => {
    if (generatingStartedAt !== undefined && now - generatingStartedAt < GENERATING_STUCK_MS) {
      return undefined
    }
    generatingStartedAt = now
    return now
  }

  /** 멈췄다 풀려난 오래된 생성이 새 생성의 표시를 지우지 않게 자기 표시일 때만 해제한다. */
  const releaseGenerating = (claim: number): void => {
    if (generatingStartedAt === claim) {
      generatingStartedAt = undefined
    }
  }

  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await start($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'tk-handoff' }, async ($, e) => {
    await ensureRestored($)
    if (parseHandoffArgs(e.args) !== 'create') {
      return { text: await runCommand($, e.args) }
    }
    const claim = claimGenerating(await $.clock.now())
    if (claim === undefined) {
      return { text: tr(await read($, langAtom), 'cmd.busy') }
    }
    try {
      return { text: await runCommand($, e.args) }
    } finally {
      releaseGenerating(claim)
    }
  })

  on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
    await ensureRestored($)
    const result = await next(e)
    const claim = e.agentId === undefined ? claimGenerating(await $.clock.now()) : undefined
    if (claim !== undefined) {
      // fork는 시간 상한을 줄 수 없어 턴 마무리를 붙잡지 않도록 타이머로 떼어 낸다. 한 번에 하나만 돈다.
      $.clock.after(0, async () => {
        try {
          await autoHandoff($)
        } catch {
          // 자동 생성 실패는 답변 흐름에 영향을 주지 않는다.
        } finally {
          releaseGenerating(claim)
        }
      })
    }
    return result
  })

  // load 대기 중이면 사용자가 직접 친 다음 프롬프트 1회에 문서를 붙인다. 실패하면 프롬프트를 그대로 보낸다.
  on('prompt.submit', { origin: { kind: 'composer' } }, async ($, e, next) => {
    await ensureRestored($)
    const text = await takePending($)
    return text === null ? next(e) : next({ ...e, context: [...(e.context ?? []), text] })
  }).catch(($, e, next) => next(e))
}
