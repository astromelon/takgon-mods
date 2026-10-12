import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { HandoffInfo, Lang } from '../../types'
import { toLang } from '../shared/i18n'
import { projectId, projectKey } from '../shared/keys'
import { LANG_KEY, MODULES_KEY, OUTPUT_GITIGNORE, outputDir, toFlags } from '../shared/settings'
import { ALL_ON } from '../shared/state'
import {
  MAX_SUFFIX,
  buildForkPrompt,
  formatStamp,
  formatTime,
  handoffFileName,
  parseHandoffArgs,
  shouldTrigger,
  summarize,
  toHandoffInfo,
} from './logic'
import { tr } from './messages'

const langAtom = atom({ plugin: 'takgon-mods', key: 'lang' } as const, 'ko')
const modulesAtom = atom({ plugin: 'takgon-mods', key: 'modules' } as const, ALL_ON)
const pinsAtom = atom({ plugin: 'takgon-mods', key: 'pins' } as const, [])
const prAtom = atom({ plugin: 'takgon-mods', key: 'pr' } as const, null)
const linkedIssuesAtom = atom({ plugin: 'takgon-mods', key: 'linkedIssues' } as const, [])
const tasksAtom = atom({ plugin: 'takgon-mods', key: 'tasks' } as const, [])
const handoffAtom = atom({ plugin: 'takgon-mods', key: 'handoff' } as const, null)
const pendingAtom = atom({ plugin: 'takgon-mods', key: 'handoffPending' } as const, false)
const firedAtom = atom({ plugin: 'takgon-mods', key: 'handoffFired' } as const, false)

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

/** 세션 시작·복원: 플래그 초기화, 명령 등록, 최신본이 있으면 상태를 채우고 toast로 안내한다. */
const start = async ($: EngineInterface): Promise<void> => {
  const { isOn: isEnabled, lang } = await settingsFromStore($)
  await update($, firedAtom, () => false)
  await update($, pendingAtom, () => false)
  await $.command.register({
    name: 'handoff',
    description: tr(lang, 'cmd.description'),
    argumentHint: '[show | load]',
  })
  if (!isEnabled) {
    return
  }
  const info = toHandoffInfo(await $.store.get(await latestKey($)))
  if (info === null || !(await $.fs.exists(info.path))) {
    return
  }
  await update($, handoffAtom, () => info)
  $.ui.toast(tr(lang, 'toast.available', { time: formatTime(info.createdAt) }))
}

/** `/handoff [show|load]` 처리. */
const runCommand = async ($: EngineInterface, args: string): Promise<string> => {
  const lang = await read($, langAtom)
  if (!(await isOn($))) {
    return tr(lang, 'cmd.off')
  }
  const action = parseHandoffArgs(args)
  if (action === 'usage') {
    return tr(lang, 'cmd.usage')
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
  if (!(await $.fs.exists(info.path))) {
    return tr(lang, 'cmd.missing', { path: info.path })
  }
  await update($, handoffAtom, () => info)
  await update($, pendingAtom, () => true)
  return tr(lang, 'cmd.pending', { path: info.path })
}

/** 턴 종료 뒤 컨텍스트 사용률을 보고 세션당 1회 자동 생성한다. 실패는 조용히 넘긴다. */
const autoHandoff = async ($: EngineInterface): Promise<void> => {
  if (!(await isOn($)) || (await read($, firedAtom))) {
    return
  }
  const usage = await $.session.usage()
  if (!shouldTrigger(usage.context.percent, false)) {
    return
  }
  await update($, firedAtom, () => true)
  const result = await generate($)
  if (result.isSaved) {
    $.ui.toast(tr(await read($, langAtom), 'toast.saved', { path: result.info.path }))
  }
}

/** load 대기 중이면 이번 프롬프트에 붙일 파일 내용을, 아니면 null(대기는 1회로 해제). */
const takePending = async ($: EngineInterface): Promise<string | null> => {
  if (!(await read($, pendingAtom)) || !(await isOn($))) {
    return null
  }
  await update($, pendingAtom, () => false)
  const info = await read($, handoffAtom)
  if (info === null || !(await $.fs.exists(info.path))) {
    return null
  }
  const text = await $.fs.read(info.path)
  return text.trim() === '' ? null : text
}

/**
 * M7 Auto-handoff.
 *
 * 컨텍스트 사용률이 75% 이상이 된 첫 답변 뒤(세션당 1회) 또는 `/handoff`로 `$.model.fork`에 인수인계 문서를 쓰게 해
 * `{project}/.claude/takgon/handoff/`에 저장한다. 새 세션에서는 최신본을 안내하고, `/handoff load`면 다음 프롬프트
 * 1회에 문서를 context로 붙인다. 임계 판정은 `session.measure`(M6 전용) 대신 `turn.complete`에서 한다.
 */
export const registerHandoff = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await start($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SessionStart', { source: 'clear' }, async ($, e, next) => {
    await start($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SessionStart', { source: 'resume' }, async ($, e, next) => {
    await start($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'handoff' }, async ($, e) => ({ text: await runCommand($, e.args) }))

  on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      try {
        await autoHandoff($)
      } catch {
        // 자동 생성 실패는 답변 흐름에 영향을 주지 않는다.
      }
    }
    return result
  })

  // load 대기 중이면 사용자가 직접 친 다음 프롬프트 1회에 문서를 붙인다. 실패하면 프롬프트를 그대로 보낸다.
  on('prompt.submit', { origin: { kind: 'composer' } }, async ($, e, next) => {
    const text = await takePending($)
    return text === null ? next(e) : next({ ...e, context: [...(e.context ?? []), text] })
  }).catch(($, e, next) => next(e))
}
