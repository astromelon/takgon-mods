import { atom, read, update } from 'claude-code'
import type { CommandSpec, EngineInterface, On, Timer } from 'claude-code'

import type { CommandRegistration, IssueItem, Lang, PrStatus } from '../../types'
import { t, toLang } from '../shared/i18n'
import { projectId, projectKey } from '../shared/keys'
import { LANG_KEY, MODULES_KEY, commandsKey, markNotified, refusalReason, registerCause, toCommandMap, toFlags } from '../shared/settings'
import { ALL_ON } from '../shared/state'
import {
  addLinked,
  formatIssues,
  parseIssueArgs,
  removeLinked,
  replaceIssue,
  toIssueList,
} from './command'
import { GH_PR_VIEW, GH_TIMEOUT_MS, classifyGhExit, parsePrView, shouldRefresh } from './github'
import type { GhFailure } from './github'
import {
  GIT_REMOTE_URL,
  GLAB_MR_VIEW,
  approvalDecision,
  classifyGlabExit,
  detectForge,
  glabApprovals,
  parseMrView,
} from './gitlab'
import type { Forge, GlabFailure } from './gitlab'
import {
  LINEAR_URL,
  LINK_LIMIT,
  findState,
  httpFailure,
  issueBody,
  parseIssue,
  parseSearch,
  parseUpdate,
  searchBody,
  updateBody,
} from './linear'
import type { IssueLookup } from './linear'
import { tr } from './messages'
import type { M5Key } from './messages'

const langAtom = atom({ plugin: 'takgon-mods', key: 'lang' } as const, 'ko')
const modulesAtom = atom({ plugin: 'takgon-mods', key: 'modules' } as const, ALL_ON)
const notifiedAtom = atom({ plugin: 'takgon-mods', key: 'notified' } as const, [])
const commandsAtom = atom({ plugin: 'takgon-mods', key: 'commands' } as const, {})
const prAtom = atom({ plugin: 'takgon-mods', key: 'pr' } as const, null)
const issueResultsAtom = atom({ plugin: 'takgon-mods', key: 'issueResults' } as const, [])
const linkedIssuesAtom = atom({ plugin: 'takgon-mods', key: 'linkedIssues' } as const, [])
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

/** PR 폴링 주기. */
const POLL_MS = 60_000

/** turn.complete 갱신을 생략하는 최소 간격. */
const TURN_GAP_MS = 10_000

/** 진행 중인 폴링 타이머와 직전 갱신 시각(세션 단위). */
let poller: Timer | null = null
let lastRefreshAt: number | null = null

/** 원인 키 → toast 문구. */
const TOAST_OF: Readonly<Record<string, M5Key>> = {
  'gh-missing': 'toast.ghMissing',
  'gh-auth': 'toast.ghAuth',
  'glab-missing': 'toast.glabMissing',
  'glab-auth': 'toast.glabAuth',
  'linear-auth': 'toast.linearAuth',
  'linear-http': 'toast.linearHttp',
}

/** 명령 처리처럼 세션 상태가 아직 없을 수 있는 곳에서도 store 기준 설정을 읽는다. */
const settingsOf = async ($: EngineInterface): Promise<{ isOn: boolean; lang: Lang }> => ({
  isOn: toFlags(await $.store.get(MODULES_KEY)).integrations,
  lang: toLang(await $.store.get(LANG_KEY)),
})

/** 이 프로젝트의 연결 이슈 store 키. */
const linkedKey = async ($: EngineInterface): Promise<string> =>
  projectKey(projectId(await $.session.root()), 'm5', 'linkedIssues')

/** 원인별 toast 1회. 같은 원인은 세션 동안 다시 알리지 않는다. */
const notifyOnce = async ($: EngineInterface, cause: string): Promise<void> => {
  const next = markNotified(await read($, notifiedAtom), cause)
  const key = TOAST_OF[cause]
  if (next === null || key === undefined) {
    return
  }
  await update($, notifiedAtom, () => next)
  $.ui.toast(tr(await read($, langAtom), key))
}

/** 원격 주소로 forge를 고른다. 원격이 없거나 git을 못 돌리면 null(배지를 조용히 숨긴다). */
const forgeOf = async ($: EngineInterface): Promise<Forge | null> => {
  try {
    const run = await $.process.run(GIT_REMOTE_URL, { timeoutMs: GH_TIMEOUT_MS })
    return run.exitCode === 0 ? detectForge(run.stdout) : null
  } catch {
    return null
  }
}

/** `gh pr view`로 현재 브랜치 PR을 읽는다. */
const githubStatus = async (
  $: EngineInterface,
): Promise<{ pr: PrStatus | null; failure: GhFailure | null }> => {
  try {
    const run = await $.process.run(GH_PR_VIEW, { timeoutMs: GH_TIMEOUT_MS })
    return run.exitCode === 0
      ? { pr: parsePrView(run.stdout), failure: null }
      : { pr: null, failure: classifyGhExit(run.exitCode, run.stderr) }
  } catch {
    return { pr: null, failure: 'gh-missing' }
  }
}

/** `glab mr view`로 현재 브랜치 MR을, 승인 API로 리뷰 상태를 읽는다. 승인 조회 실패는 MR 정보만 쓴다. */
const gitlabStatus = async (
  $: EngineInterface,
): Promise<{ pr: PrStatus | null; failure: GlabFailure | null }> => {
  let mr: PrStatus | null
  try {
    const run = await $.process.run(GLAB_MR_VIEW, { timeoutMs: GH_TIMEOUT_MS })
    if (run.exitCode !== 0) {
      return { pr: null, failure: classifyGlabExit(run.exitCode, run.stderr) }
    }
    mr = parseMrView(run.stdout)
  } catch {
    return { pr: null, failure: 'glab-missing' }
  }
  if (mr === null) {
    return { pr: null, failure: null }
  }
  try {
    const run = await $.process.run(glabApprovals(mr.number), { timeoutMs: GH_TIMEOUT_MS })
    if (run.exitCode === 0) {
      mr = { ...mr, reviewDecision: approvalDecision(mr.reviewDecision, run.stdout) }
    }
  } catch {
    // 승인 정보는 부가 정보라 MR 배지는 그대로 보인다.
  }
  return { pr: mr, failure: null }
}

/**
 * getStatus에 해당: 원격이 GitHub면 `gh`, 그 밖(GitLab·사내 셀프호스팅)이면 `glab`으로 현재 브랜치 PR/MR을 읽어
 * `pr` atom을 갱신한다. PR/MR 없음은 조용히 null, 그 밖의 실패는 원인별 toast 1회.
 */
const getStatus = async ($: EngineInterface): Promise<void> => {
  if (!(await read($, modulesAtom)).integrations) {
    return
  }
  lastRefreshAt = await $.clock.now()
  const forge = await forgeOf($)
  if (forge === null) {
    await update($, prAtom, () => null)
    return
  }
  const { pr, failure } = forge === 'github' ? await githubStatus($) : await gitlabStatus($)
  await update($, prAtom, () => pr)
  if (failure !== null && failure !== 'no-pr') {
    await notifyOnce($, failure)
  }
}

/** Linear 키를 읽는다. 값은 요청 헤더에만 쓰고 어디에도 남기지 않는다. */
const linearKey = async ($: EngineInterface): Promise<string | undefined> => {
  const key = await $.env.get('LINEAR_API_KEY')
  return key === undefined || key.trim() === '' ? undefined : key.trim()
}

/** Linear GraphQL 호출. 실패는 원인별 toast 1회 후 원인 키를 돌려준다. */
const linearCall = async (
  $: EngineInterface,
  key: string,
  body: string,
): Promise<{ text: string } | { cause: string }> => {
  let cause: string
  try {
    const res = await $.http.fetch(LINEAR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key },
      body,
    })
    if (res.ok) {
      return { text: res.text }
    }
    cause = httpFailure(res.status)
  } catch {
    cause = 'linear-http'
  }
  await notifyOnce($, cause)
  return { cause }
}

/** search에 해당: Linear 이슈 검색. 실패는 원인 키. */
const search = async (
  $: EngineInterface,
  key: string,
  q: string,
): Promise<IssueItem[] | string> => {
  const res = await linearCall($, key, searchBody(q))
  if ('cause' in res) {
    return res.cause
  }
  return parseSearch(res.text) ?? 'linear-http'
}

/** identifier로 이슈와 팀 workflow states를 조회한다. */
const lookup = async (
  $: EngineInterface,
  key: string,
  id: string,
): Promise<IssueLookup | string> => {
  const res = await linearCall($, key, issueBody(id))
  return 'cause' in res ? res.cause : parseIssue(res.text)
}

/** link에 해당: 이슈를 이 프로젝트의 로컬 매핑에 추가하고 store에 저장한다. */
const link = async ($: EngineInterface, key: string, id: string, lang: Lang): Promise<string> => {
  const found = await lookup($, key, id)
  if (typeof found === 'string' || found.kind === 'error') {
    return tr(lang, 'issue.failed', { cause: typeof found === 'string' ? found : 'linear-http' })
  }
  if (found.kind === 'missing') {
    return tr(lang, 'issue.notFound', { id })
  }
  const storeKey = await linkedKey($)
  const result = addLinked(toIssueList(await $.store.get(storeKey)), found.issue)
  if (result.kind === 'duplicate') {
    return tr(lang, 'issue.alreadyLinked', { identifier: found.issue.identifier })
  }
  if (result.kind === 'full') {
    return tr(lang, 'issue.linkLimit', { max: LINK_LIMIT })
  }
  await $.store.set(storeKey, result.list)
  await update($, linkedIssuesAtom, () => result.list)
  return tr(lang, 'issue.linked', { identifier: found.issue.identifier })
}

/** 연결 해제. */
const unlink = async ($: EngineInterface, id: string, lang: Lang): Promise<string> => {
  const storeKey = await linkedKey($)
  const next = removeLinked(toIssueList(await $.store.get(storeKey)), id)
  if (next === null) {
    return tr(lang, 'issue.notLinked', { identifier: id })
  }
  await $.store.set(storeKey, next)
  await update($, linkedIssuesAtom, () => next)
  return tr(lang, 'issue.unlinked', { identifier: id })
}

/** 상태 변경. 쓰기 작업이므로 `$.ui.ask`로 확인하고, 거절·dismiss면 취소한다. */
const setStatus = async (
  $: EngineInterface,
  key: string,
  id: string,
  stateName: string,
  lang: Lang,
): Promise<string> => {
  const found = await lookup($, key, id)
  if (typeof found === 'string' || found.kind === 'error') {
    return tr(lang, 'issue.failed', { cause: typeof found === 'string' ? found : 'linear-http' })
  }
  if (found.kind === 'missing') {
    return tr(lang, 'issue.notFound', { id })
  }
  const target = findState(found.states, stateName)
  if (target === undefined) {
    const states = found.states.map(s => s.name).join(', ')
    return tr(lang, 'issue.stateNotFound', { state: stateName, states })
  }
  const yes = tr(lang, 'issue.confirmYes')
  const question = tr(lang, 'issue.confirmStatus', {
    identifier: found.issue.identifier,
    from: found.issue.state,
    to: target.name,
  })
  let answer: string
  try {
    answer = await $.ui.ask(question, [yes, tr(lang, 'issue.confirmNo')])
  } catch {
    return tr(lang, 'issue.cancelled')
  }
  if (answer !== yes) {
    return tr(lang, 'issue.cancelled')
  }
  const res = await linearCall($, key, updateBody(found.issue.id, target.id))
  const changed = 'cause' in res ? null : parseUpdate(res.text)
  if (changed === null) {
    return tr(lang, 'issue.failed', { cause: 'cause' in res ? res.cause : 'linear-http' })
  }
  const storeKey = await linkedKey($)
  const linked = toIssueList(await $.store.get(storeKey))
  if (linked.some(one => one.identifier === changed.identifier)) {
    const next = replaceIssue(linked, changed)
    await $.store.set(storeKey, next)
    await update($, linkedIssuesAtom, () => next)
  }
  await update($, issueResultsAtom, list => replaceIssue(list, changed))
  return tr(lang, 'issue.statusChanged', { identifier: changed.identifier, state: changed.state })
}

/** `/issue` 처리. */
const runIssue = async ($: EngineInterface, args: string): Promise<string> => {
  const { isOn, lang } = await settingsOf($)
  if (!isOn) {
    return tr(lang, 'issue.moduleOff')
  }
  const key = await linearKey($)
  if (key === undefined) {
    return tr(lang, 'issue.noKey')
  }
  const action = parseIssueArgs(args)
  if (action.kind === 'usage') {
    return tr(lang, 'issue.usage')
  }
  if (action.kind === 'link') {
    return link($, key, action.id, lang)
  }
  if (action.kind === 'unlink') {
    return unlink($, action.id, lang)
  }
  if (action.kind === 'status') {
    return setStatus($, key, action.id, action.state, lang)
  }
  if (action.kind === 'search') {
    const found = await search($, key, action.q)
    if (typeof found === 'string') {
      return tr(lang, 'issue.failed', { cause: found })
    }
    await update($, issueResultsAtom, () => found)
    return found.length === 0
      ? tr(lang, 'issue.searchEmpty', { q: action.q })
      : formatIssues(
          lang,
          tr(lang, 'issue.searchTitle', { q: action.q, count: found.length }),
          found,
        )
  }
  const linked = toIssueList(await $.store.get(await linkedKey($)))
  await update($, linkedIssuesAtom, () => linked)
  return linked.length === 0
    ? tr(lang, 'issue.linkedEmpty')
    : formatIssues(lang, tr(lang, 'issue.linkedTitle', { count: linked.length }), linked)
}

/** 연결 이슈를 store에서 복원한다. Linear 키가 없으면 Linear 요소는 숨긴다(빈 목록). */
const restore = async ($: EngineInterface): Promise<void> => {
  const hasKey = (await linearKey($)) !== undefined
  const linked = hasKey ? toIssueList(await $.store.get(await linkedKey($))) : []
  await update($, linkedIssuesAtom, () => linked)
  await update($, issueResultsAtom, () => [])
}

/**
 * 이번 세션에 아직 복원하지 않았으면 연결 이슈를 불러오고 PR 상태를 곧바로 다시 읽는다. `/clear`·`/resume`은
 * state를 비우고 `session.start`를 다시 보내지 않으므로(폴링 타이머는 남는다), 훅에 처음 들어올 때 채운다.
 */
const ensureRestored = async ($: EngineInterface): Promise<void> => {
  if ((await read($, restoredAtom)).includes('m5')) {
    return
  }
  await update($, restoredAtom, list => (list.includes('m5') ? list : [...list, 'm5']))
  try {
    await restore($)
  } catch {
    // 훅 실패로 번지면 같은 이벤트의 뒤쪽 훅이 건너뛰어지므로 삼키고, 다음 진입에서 다시 시도한다.
    await update($, restoredAtom, list => list.filter(one => one !== 'm5'))
    return
  }
  $.clock.after(0, () => void getStatus($))
}

/** 세션 초기화: 명령 등록, 상태 복원, PR 폴링 시작. */
const init = async ($: EngineInterface): Promise<void> => {
  const { lang } = await settingsOf($)
  // 등록이 거부돼도(이름 충돌 등) PR 폴링과 상태 복원은 계속한다.
  await registerCommand($, {
      name: 'issue',
      description: tr(lang, 'issue.description'),
      argumentHint: tr(lang, 'issue.argumentHint'),
    })
  await update($, restoredAtom, list => (list.includes('m5') ? list : [...list, 'm5']))
  await restore($)
  await update($, prAtom, () => null)
  poller?.cancel()
  lastRefreshAt = null
  // 첫 갱신은 세션 시작을 막지 않도록 타이머로 미룬다(gh 응답 최대 15초).
  $.clock.after(0, () => void getStatus($))
  poller = $.clock.every(POLL_MS, () => void getStatus($))
}

/**
 * M5: GitHub PR 상태와 Linear 이슈 연동.
 *
 * Provider 인터페이스(`shared/providers.ts`)는 `$`를 import 경계 너머로 넘겨야 해 그대로 쓸 수 없다.
 * 같은 의미의 getStatus·search·link를 이 파일 최상위에 두고, 쿼리·해석은 `github.ts`·`linear.ts`로 분리했다.
 */
export const registerIntegrations = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const result = await next(e)
    await init($)
    return result
  })

  // M7 인수인계가 연결 이슈를 읽으므로, /clear 뒤 첫 프롬프트에서 미리 복원해 둔다.
  on('prompt.submit', { origin: { kind: 'composer' } }, async ($, e, next) => {
    await ensureRestored($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
    await ensureRestored($)
    const result = await next(e)
    if (
      (await read($, modulesAtom)).integrations &&
      shouldRefresh(await $.clock.now(), lastRefreshAt, TURN_GAP_MS)
    ) {
      lastRefreshAt = await $.clock.now()
      $.clock.after(0, () => void getStatus($))
    }
    return result
  })

  on('command.run', { command: 'issue' }, async ($, e) => {
    await ensureRestored($)
    return { text: await runIssue($, e.args) }
  })
}
