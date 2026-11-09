/**
 * M3 Select-to-Edit의 순수 로직: `/edit` 인자 해석, 경로 정규화, 행 범위 발췌, Edit 범위 판정,
 * 모델 컨텍스트 문구. headless 출력 해석은 `shared/headless.ts`(M2와 공용).
 *
 * `$`를 받지 않으므로 단위 테스트로 직접 검증한다.
 */
import type { EditTarget, Lang } from '../../types'
import { tr } from './messages'

/** 발췌 상한(문자). */
export const EXCERPT_MAX = 2000

/** computed style 첨부 상한(문자). */
const STYLE_MAX = 4000

/** `/edit` 인자 해석 결과. */
export type EditAction =
  | { kind: 'show' }
  | { kind: 'clear' }
  | { kind: 'sel' }
  | { kind: 'dom'; selector: string; url: string | undefined }
  | { kind: 'range'; path: string; start: number; end: number }
  | { kind: 'usage' }

const RANGE = /^(.+):(\d+)(?:-(\d+))?$/
const URL_TOKEN = /^https?:\/\/\S+$/i

/** `/edit` 인자를 해석한다. 행 번호는 1부터, 끝 포함. */
export const parseEditArgs = (args: string): EditAction => {
  const trimmed = args.trim()
  if (trimmed === '') {
    return { kind: 'show' }
  }
  if (trimmed === 'clear') {
    return { kind: 'clear' }
  }
  if (trimmed === 'sel') {
    return { kind: 'sel' }
  }
  const tokens = trimmed.split(/\s+/)
  if (tokens[0] === 'dom') {
    const rest = tokens.slice(1)
    const last = rest.at(-1)
    const url = last !== undefined && URL_TOKEN.test(last) ? last : undefined
    const selector = (url === undefined ? rest : rest.slice(0, -1)).join(' ')
    return selector === '' ? { kind: 'usage' } : { kind: 'dom', selector, url }
  }
  const match = RANGE.exec(trimmed)
  if (!match) {
    return { kind: 'usage' }
  }
  const start = Number(match[2])
  const end = match[3] === undefined ? start : Number(match[3])
  if (start < 1 || end < start) {
    return { kind: 'usage' }
  }
  return { kind: 'range', path: match[1] ?? '', start, end }
}

const isAbsolute = (path: string): boolean => /^[A-Za-z]:\//.test(path) || path.startsWith('/')

/** `.`·`..`를 접고 `/` 구분으로 맞춘다. */
const collapse = (path: string): string => {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '.' || (part === '' && out.length > 0)) {
      continue
    }
    if (part === '..' && out.length > 1) {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

/** 경로를 절대·`/` 구분으로. 상대 경로는 `root` 기준. */
export const resolvePath = (root: string, path: string): string => {
  const slashed = path.replace(/\\/g, '/')
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return collapse(isAbsolute(slashed) ? slashed : `${base}/${slashed}`)
}

/** 같은 파일인지(Windows 대소문자·구분자 무시). */
export const isSamePath = (a: string, b: string): boolean =>
  resolvePath('', a).toLowerCase() === resolvePath('', b).toLowerCase()

const toLines = (text: string): string[] => {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length > 1 && lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

/** 행 범위 발췌. 범위가 파일 밖이면 `excerpt`가 없다. */
export const sliceLines = (
  text: string,
  start: number,
  end: number,
): { lineCount: number; excerpt: string | undefined } => {
  const lines = toLines(text)
  if (end > lines.length) {
    return { lineCount: lines.length, excerpt: undefined }
  }
  return { lineCount: lines.length, excerpt: lines.slice(start - 1, end).join('\n').slice(0, EXCERPT_MAX) }
}

/** Edit 범위 판정 결과. */
export type EditVerdict =
  | { isAllowed: true; matches: number }
  | { isAllowed: false; reason: 'not-found' }
  | { isAllowed: false; reason: 'outside'; lines: [number, number] }

const countNewlines = (text: string): number => text.split('\n').length - 1

/**
 * `old_string`이 놓인 행 범위가 모두 `[start, end]` 안이면 허용한다.
 * 여러 곳에 있으면 하나라도 밖이면 거부한다(replace_all이나 모호한 매치가 범위 밖을 바꾸지 않게).
 * 줄바꿈은 LF로 맞춰 비교한다.
 */
export const judgeEdit = (text: string, oldString: string, start: number, end: number): EditVerdict => {
  const body = text.replace(/\r\n/g, '\n')
  const needle = oldString.replace(/\r\n/g, '\n')
  if (needle === '') {
    return { isAllowed: false, reason: 'not-found' }
  }
  // 줄 번호는 직전 매치 위치부터 이어서 센다(매치마다 처음부터 세면 큰 파일에서 O(n·m)).
  const needleLines = countNewlines(needle)
  let matches = 0
  let line = 1
  let scanned = 0
  for (let at = body.indexOf(needle); at !== -1; at = body.indexOf(needle, at + needle.length)) {
    matches += 1
    line += countNewlines(body.slice(scanned, at))
    scanned = at
    const to = line + needleLines
    if (line < start || to > end) {
      return { isAllowed: false, reason: 'outside', lines: [line, to] }
    }
  }
  return matches === 0 ? { isAllowed: false, reason: 'not-found' } : { isAllowed: true, matches }
}

/** 허용된 Edit 뒤 대상 범위 끝의 이동량(늘어난 행 수). */
export const lineDelta = (oldString: string, newString: string, matches: number): number =>
  (countNewlines(newString.replace(/\r\n/g, '\n')) - countNewlines(oldString.replace(/\r\n/g, '\n'))) *
  matches

/** 발췌 안의 백틱보다 긴 코드 펜스. */
const fenceFor = (text: string): string => {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length))
  return '`'.repeat(longest + 1)
}

/** `/edit` 출력용 한 줄 요약. */
export const summarizeTarget = (lang: Lang, target: EditTarget): string => {
  if (target.kind === 'dom') {
    return tr(lang, 'edit.target.dom', { url: target.url, selector: target.selector })
  }
  if (target.path === '') {
    return tr(lang, 'edit.target.sel', { chars: target.excerpt.length })
  }
  return tr(lang, 'edit.target.text', { path: target.path, start: target.startLine, end: target.endLine })
}

/** `prompt.submit` context로 붙일 모델용 지시문. */
export const describeForModel = (lang: Lang, target: EditTarget): string => {
  if (target.kind === 'dom') {
    const style = Object.entries(target.computedStyle)
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n')
      .slice(0, STYLE_MAX)
    const body = tr(lang, 'edit.ctx.dom', { url: target.url, selector: target.selector, style })
    return target.screenshot === undefined
      ? body
      : `${body}\n${tr(lang, 'edit.ctx.screenshot', { path: target.screenshot })}`
  }
  const fence = fenceFor(target.excerpt)
  if (target.path === '') {
    return tr(lang, 'edit.ctx.sel', { fence, excerpt: target.excerpt })
  }
  return tr(lang, 'edit.ctx.text', {
    path: target.path,
    start: target.startLine,
    end: target.endLine,
    fence,
    excerpt: target.excerpt,
  })
}

/** 파이프라인 [Handoff] 계획서(`.git/ai-task.md`)에서 읽은 범위. */
export type PlanScope = { branch: string | undefined; files: string[] }

const HEADING = /^#\s+(.+?)\s*$/
const LIST_ITEM = /^\s*(?:[-*]|\d+[.)])\s+(.*)$/
const BACKTICK_TOKEN = /`([^`]+)`/

const pickToken = (raw: string): string => {
  const tick = BACKTICK_TOKEN.exec(raw)
  if (tick?.[1] !== undefined) {
    return tick[1].trim()
  }
  return raw.trim().split(/\s+/)[0] ?? ''
}

const normalizePlanEntry = (raw: string): string => {
  const slashed = raw.replace(/\\/g, '/')
  const isDir = slashed.endsWith('/')
  const collapsed = collapse(slashed)
  return isDir && collapsed !== '' ? `${collapsed}/` : collapsed
}

/** 파이프라인 계획서 마크다운에서 `# 브랜치`와 `# 변경 대상 파일` 목록을 추출한다. */
export const parsePlanScope = (text: string): PlanScope => {
  const sections = new Map<string, string[]>()
  let current: string[] | undefined
  let isFenced = false
  for (const line of toLines(text)) {
    if (/^\s*```/.test(line)) {
      isFenced = !isFenced
      continue
    }
    if (isFenced) {
      continue
    }
    const heading = HEADING.exec(line)
    if (heading?.[1] !== undefined) {
      const title = heading[1]
      if (sections.has(title)) {
        current = undefined
      } else {
        current = []
        sections.set(title, current)
      }
      continue
    }
    current?.push(line)
  }

  let branch: string | undefined
  for (const line of sections.get('브랜치') ?? []) {
    if (line.trim() === '') {
      continue
    }
    const body = LIST_ITEM.exec(line)?.[1] ?? line
    const token = pickToken(body)
    if (token !== '') {
      branch = token
    }
    break
  }

  const files: string[] = []
  for (const line of sections.get('변경 대상 파일') ?? []) {
    const item = LIST_ITEM.exec(line)?.[1]
    if (item === undefined) {
      continue
    }
    const normalized = normalizePlanEntry(pickToken(item))
    if (normalized !== '' && !files.includes(normalized)) {
      files.push(normalized)
    }
  }

  return { branch, files }
}

/** 계획서 범위 판정. 저장소 밖·git 디렉터리 안은 판정 대상이 아니므로 허용. */
export type ScopeVerdict =
  | { isAllowed: true; reason: 'outside-repo' | 'git-dir' | 'listed' }
  | { isAllowed: false }

const isInsideDir = (dir: string, filePath: string): boolean => {
  const prefix = dir.replace(/\/+$/, '').toLowerCase()
  const target = filePath.toLowerCase()
  return target === prefix || target.startsWith(`${prefix}/`)
}

/** 파일 경로가 계획서 `# 변경 대상 파일` 범위 안인지 판정한다. */
export const judgeScope = (input: {
  top: string
  gitDir: string
  filePath: string
  files: readonly string[]
}): ScopeVerdict => {
  const top = resolvePath('', input.top).replace(/\/+$/, '')
  const gitDir = resolvePath(top, input.gitDir).replace(/\/+$/, '')
  const target = resolvePath(top, input.filePath)

  if (isInsideDir(gitDir, target) || isInsideDir(`${top}/.git`, target)) {
    return { isAllowed: true, reason: 'git-dir' }
  }
  if (!isInsideDir(top, target)) {
    return { isAllowed: true, reason: 'outside-repo' }
  }

  const targetLower = target.toLowerCase()
  for (const entry of input.files) {
    if (entry === '') {
      continue
    }
    if (/[\\/]$/.test(entry)) {
      const dir = resolvePath(top, entry)
      if (isInsideDir(dir, target)) {
        return { isAllowed: true, reason: 'listed' }
      }
      continue
    }
    if (resolvePath(top, entry).toLowerCase() === targetLower) {
      return { isAllowed: true, reason: 'listed' }
    }
  }

  return { isAllowed: false }
}

