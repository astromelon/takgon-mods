/**
 * M3 Select-to-Edit의 순수 로직: `/edit` 인자 해석, 경로 정규화, 행 범위 발췌, Edit 범위 판정,
 * headless 출력 해석, 모델 컨텍스트 문구.
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
  let matches = 0
  for (let at = body.indexOf(needle); at !== -1; at = body.indexOf(needle, at + needle.length)) {
    matches += 1
    const from = countNewlines(body.slice(0, at)) + 1
    const to = from + countNewlines(needle)
    if (from < start || to > end) {
      return { isAllowed: false, reason: 'outside', lines: [from, to] }
    }
  }
  return matches === 0 ? { isAllowed: false, reason: 'not-found' } : { isAllowed: true, matches }
}

/** 허용된 Edit 뒤 대상 범위 끝의 이동량(늘어난 행 수). */
export const lineDelta = (oldString: string, newString: string, matches: number): number =>
  (countNewlines(newString.replace(/\r\n/g, '\n')) - countNewlines(oldString.replace(/\r\n/g, '\n'))) *
  matches

/** headless 스크립트 결과(stdout 마지막 줄 JSON). */
export type HeadlessResult = {
  ok: boolean
  status: number
  title?: string
  consoleErrors: string[]
  screenshot?: string
  element?: { selector: string; computedStyle: Record<string, string>; screenshot?: string }
  error?: string
}

/** stdout의 마지막 비어 있지 않은 줄을 JSON으로 읽는다. 아니면 `undefined`. */
export const parseHeadlessOutput = (stdout: string): HeadlessResult | undefined => {
  const last = stdout.split(/\r?\n/).filter(line => line.trim() !== '').at(-1)
  if (last === undefined) {
    return undefined
  }
  try {
    const value: unknown = JSON.parse(last)
    return typeof value === 'object' && value !== null && 'ok' in value ? (value as HeadlessResult) : undefined
  } catch {
    return undefined
  }
}

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
