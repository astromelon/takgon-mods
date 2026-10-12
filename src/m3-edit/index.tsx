import { atom, read, update } from 'claude-code'
import type { CommandSpec, EngineInterface, On } from 'claude-code'

import type { CommandRegistration, EditTarget, Lang } from '../../types'
import { projectId } from '../shared/keys'
import { OUTPUT_GITIGNORE, commandsKey, markNotified, outputDir, refusalReason, registerCause, toCommandMap } from '../shared/settings'
import { t } from '../shared/i18n'
import { ALL_ON } from '../shared/state'
import {
  describeForModel,
  isSamePath,
  judgeEdit,
  lineDelta,
  parseEditArgs,
  parseHeadlessOutput,
  resolvePath,
  sliceLines,
  summarizeTarget,
} from './logic'
import type { EditAction } from './logic'
import { tr } from './messages'

const langAtom = atom({ plugin: 'takgon-mods', key: 'lang' } as const, 'ko')
const modulesAtom = atom({ plugin: 'takgon-mods', key: 'modules' } as const, ALL_ON)
const notifiedAtom = atom({ plugin: 'takgon-mods', key: 'notified' } as const, [])
const commandsAtom = atom({ plugin: 'takgon-mods', key: 'commands' } as const, {})
const browserAtom = atom({ plugin: 'takgon-mods', key: 'browser' } as const, null)
const editTargetAtom = atom({ plugin: 'takgon-mods', key: 'editTarget' } as const, null)

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

/** headless 스크립트 실행 제한 시간. */
const HEADLESS_TIMEOUT_MS = 90_000

const isOn = async ($: EngineInterface): Promise<boolean> => (await read($, modulesAtom)).edit

/** `/edit` 등록. 세션 시작과 /clear·/resume 복원에서 부른다. */
const registerEditCommand = async ($: EngineInterface): Promise<void> => {
  const lang = await read($, langAtom)
  await registerCommand($, {
    name: 'edit',
    description: tr(lang, 'edit.description'),
    argumentHint: '<path>:<start>-<end> | sel | dom <selector> [url] | clear',
  })
}

/** 같은 원인의 toast는 세션당 1회만. */
const toastOnce = async ($: EngineInterface, cause: string, text: string): Promise<void> => {
  const marked = markNotified(await read($, notifiedAtom), cause)
  if (marked === null) {
    return
  }
  await update($, notifiedAtom, () => marked)
  $.ui.toast(text)
}

const setTarget = async ($: EngineInterface, lang: Lang, target: EditTarget): Promise<string> => {
  await update($, editTargetAtom, () => target)
  return tr(lang, 'edit.set', { target: summarizeTarget(lang, target) })
}

/** `/edit <path>:<start>-<end>`: 파일을 읽어 범위를 확인하고 대상으로 둔다. */
const targetRange = async (
  $: EngineInterface,
  lang: Lang,
  action: Extract<EditAction, { kind: 'range' }>,
): Promise<string> => {
  const path = resolvePath(await $.session.root(), action.path)
  let text: string
  try {
    text = await $.fs.read(path)
  } catch {
    return tr(lang, 'edit.readFailed', { path })
  }
  const { lineCount, excerpt } = sliceLines(text, action.start, action.end)
  if (excerpt === undefined) {
    return tr(lang, 'edit.outOfRange', { lines: lineCount, start: action.start, end: action.end })
  }
  return setTarget($, lang, { kind: 'text', path, startLine: action.start, endLine: action.end, excerpt })
}

/** `/edit sel`: fullscreen 선택 영역을 발췌로만 쓴다(어느 파일인지 알 수 없다). */
const targetSelection = async ($: EngineInterface, lang: Lang): Promise<string> => {
  const selected = await $.ui.selection()
  const excerpt = selected?.text.trim().slice(0, 2000) ?? ''
  if (excerpt === '') {
    return tr(lang, 'edit.noSelection')
  }
  return setTarget($, lang, { kind: 'text', path: '', startLine: 0, endLine: 0, excerpt })
}

/** 산출물 폴더의 `.gitignore`를 처음 한 번 만든다. */
const ensureOutputDir = async ($: EngineInterface, dir: string): Promise<void> => {
  const ignore = `${dir}/.gitignore`
  if (!(await $.fs.exists(ignore))) {
    await $.fs.write(ignore, OUTPUT_GITIGNORE)
  }
}

/** `/edit dom <selector> [url]`: M2 headless 스크립트로 요소 정보를 모은다. */
const targetDom = async (
  $: EngineInterface,
  lang: Lang,
  action: Extract<EditAction, { kind: 'dom' }>,
): Promise<string> => {
  const url = action.url ?? (await read($, browserAtom))?.url
  if (url === undefined || url === '') {
    return tr(lang, 'edit.noUrl')
  }
  const script = `${$.plugin.root.replace(/\\/g, '/')}/tools/headless.mjs`
  if (!(await $.fs.exists(script))) {
    const text = tr(lang, 'edit.headlessMissing')
    await toastOnce($, 'm3/headless-missing', text)
    return text
  }
  const dir = outputDir(await $.session.root())
  await ensureOutputDir($, dir)
  const argv = ['node', script, '--url', url, '--out', `${dir}/browse`, '--selector', action.selector]
  let stdout = ''
  let exitCode = 1
  try {
    const ran = await $.process.run(argv, { timeoutMs: HEADLESS_TIMEOUT_MS })
    stdout = ran.stdout
    exitCode = ran.exitCode
  } catch (error) {
    const text = tr(lang, 'edit.headlessFailed', { reason: error instanceof Error ? error.message : 'error' })
    await toastOnce($, 'm3/headless-failed', text)
    return text
  }
  const result = parseHeadlessOutput(stdout)
  if (exitCode === 2 || result?.error === 'playwright-missing') {
    const text = tr(lang, 'edit.playwrightMissing')
    await toastOnce($, 'm3/playwright-missing', text)
    return text
  }
  const element = result?.ok ? result.element : undefined
  if (element === undefined) {
    const text = tr(lang, 'edit.headlessFailed', { reason: result?.error ?? `exit ${exitCode}` })
    await toastOnce($, 'm3/headless-failed', text)
    return text
  }
  return setTarget($, lang, {
    kind: 'dom',
    url,
    selector: action.selector,
    computedStyle: element.computedStyle,
    screenshot: element.screenshot ?? result?.screenshot,
  })
}

const runEdit = async ($: EngineInterface, args: string): Promise<string> => {
  const lang = await read($, langAtom)
  if (!(await isOn($))) {
    return tr(lang, 'edit.off')
  }
  const action = parseEditArgs(args)
  if (action.kind === 'range') {
    return targetRange($, lang, action)
  }
  if (action.kind === 'sel') {
    return targetSelection($, lang)
  }
  if (action.kind === 'dom') {
    return targetDom($, lang, action)
  }
  if (action.kind === 'clear') {
    await update($, editTargetAtom, () => null)
    return tr(lang, 'edit.cleared')
  }
  if (action.kind === 'usage') {
    return tr(lang, 'edit.usage')
  }
  const target = await read($, editTargetAtom)
  return target === null
    ? `${tr(lang, 'edit.none')}\n${tr(lang, 'edit.usage')}`
    : tr(lang, 'edit.current', { target: summarizeTarget(lang, target) })
}

/** 가드가 볼 활성 파일 범위. 모듈 off·대상 없음·선택 발췌(파일 모름)·다른 파일이면 `undefined`. */
const guardedRange = async (
  $: EngineInterface,
  filePath: string,
): Promise<Extract<EditTarget, { kind: 'text' }> | undefined> => {
  if (!(await isOn($))) {
    return undefined
  }
  const target = await read($, editTargetAtom)
  if (target === null || target.kind !== 'text' || target.path === '') {
    return undefined
  }
  const path = resolvePath(await $.session.root(), filePath)
  return isSamePath(path, target.path) ? target : undefined
}

/** Edit 판정. 거부 사유 문자열 또는 허용 시 매치 수. */
const judgeEditCall = async (
  $: EngineInterface,
  target: Extract<EditTarget, { kind: 'text' }>,
  filePath: string,
  oldString: string,
): Promise<{ deny: string } | { matches: number }> => {
  const lang = await read($, langAtom)
  const vars = { path: target.path, start: target.startLine, end: target.endLine }
  let text: string
  try {
    text = await $.fs.read(filePath)
  } catch {
    return { deny: tr(lang, 'edit.deny.unreadable', vars) }
  }
  const verdict = judgeEdit(text, oldString, target.startLine, target.endLine)
  if (verdict.isAllowed) {
    return { matches: verdict.matches }
  }
  if (verdict.reason === 'not-found') {
    return { deny: tr(lang, 'edit.deny.notFound', vars) }
  }
  const [from, to] = verdict.lines
  return { deny: tr(lang, 'edit.deny.outside', { ...vars, from, to }) }
}

/** 허용된 Edit가 끝난 뒤 행 수 변화만큼 대상 범위 끝을 옮긴다. */
const shiftTarget = async ($: EngineInterface, delta: number): Promise<void> => {
  if (delta === 0) {
    return
  }
  await update($, editTargetAtom, target =>
    target?.kind === 'text' ? { ...target, endLine: Math.max(target.startLine, target.endLine + delta) } : target,
  )
}

/** 가드 실패 시 거부 사유. catch 안에서 `$` 읽기가 거부될 수 있어 실패하면 ko로 둔다. */
const guardFailedText = async ($: EngineInterface): Promise<string> => {
  try {
    return tr(await read($, langAtom), 'edit.deny.guardFailed')
  } catch {
    return tr('ko', 'edit.deny.guardFailed')
  }
}

/**
 * M3 Select-to-Edit.
 *
 * `/edit`로 대상(파일 행 범위·fullscreen 선택 발췌·DOM 요소)을 지정하면 사용자가 직접 친 프롬프트마다 대상 지시를
 * `context`로 붙이고, 파일 대상이면 같은 파일의 범위 밖 Edit와 Write를 `tool.call`에서 거부한다.
 * 이 빌드에는 MultiEdit 도구가 없어 Edit·Write만 가드한다.
 */
export const registerEdit = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await registerEditCommand($)
    return next(e)
  })

  on('command.run', { command: 'edit' }, async ($, e) => ({ text: await runEdit($, e.args) }))

  on('prompt.submit', { origin: { kind: 'composer' } }, async ($, e, next) => {
    const target = await read($, editTargetAtom)
    if (target === null || !(await isOn($))) {
      return next(e)
    }
    const context = describeForModel(await read($, langAtom), target)
    return next({ ...e, context: [...(e.context ?? []), context] })
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const target = await guardedRange($, e.file_path)
    if (target === undefined) {
      return next(e)
    }
    const judged = await judgeEditCall($, target, e.file_path, e.old_string)
    if ('deny' in judged) {
      return { deny: judged.deny }
    }
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await shiftTarget($, lineDelta(e.old_string, e.new_string, e.replace_all === true ? judged.matches : 1))
    }
    return ran
  }).catch(async ($, e, next) => (next.called ? next(e) : { deny: await guardFailedText($) }))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const target = await guardedRange($, e.file_path)
    if (target === undefined) {
      return next(e)
    }
    const lang = await read($, langAtom)
    const vars = { path: target.path, start: target.startLine, end: target.endLine }
    return { deny: tr(lang, 'edit.deny.write', vars) }
  }).catch(async ($, e, next) => (next.called ? next(e) : { deny: await guardFailedText($) }))
}
