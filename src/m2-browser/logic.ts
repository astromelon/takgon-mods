/**
 * M2 브라우저의 순수 로직(URL 감지·headless 출력 해석·외부 열기 명령·콘솔 첨부 문구).
 *
 * `$`를 받지 않으므로 단위 테스트로 직접 검증한다.
 */
import type { BrowserInfo } from '../../types'

/** pane id이자 `ui.render`의 requestId. */
export const PANE_ID = 'takgon-browser'

/** 화면·첨부에 남기는 콘솔 에러 최대 건수. */
export const MAX_ERRORS = 20

/** headless 스크립트 실행 제한 시간. 스크립트의 기본 대기(3초)와 브라우저 기동을 넉넉히 덮는다. */
export const HEADLESS_TIMEOUT_MS = 45_000

/** headless 실패 원인. toast 1회 판정 키(`m2/<원인>`)로도 쓴다. */
export type HeadlessCause = 'node-missing' | 'playwright-missing' | 'headless-failed'

/** `tools/headless.mjs`가 stdout 마지막 줄에 내는 JSON. M3도 같은 계약을 쓴다. */
export type HeadlessResult = {
  ok: boolean
  status: number
  title?: string
  consoleErrors: string[]
  screenshot?: string
  element?: { selector: string; computedStyle: Record<string, string>; screenshot?: string }
  error?: string
}

/** 외부 브라우저를 여는 방법을 가르는 플랫폼. */
export type Platform = 'windows' | 'mac' | 'linux'

const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+[^\s'"]*/

/** 텍스트에서 첫 로컬 개발 서버 URL. 없으면 `undefined`. */
export const extractLocalUrl = (text: string): string | undefined => LOCAL_URL.exec(text)?.[0]

/** http(s) URL인지. `/browse` 인자 검증용. */
export const isHttpUrl = (value: string): boolean => /^https?:\/\/\S+$/i.test(value)

/**
 * Bash `tool.call` 결과에서 출력 텍스트를 모은다. 엔진이 준 결과는 `text`가 있고,
 * 훅이 직접 만든 결과는 `result.stdout`/`stderr`만 있다.
 */
export const bashOutputText = (ran: unknown): string => {
  const parts: string[] = []
  const one = (ran ?? {}) as { text?: unknown; result?: unknown }
  if (typeof one.text === 'string') {
    parts.push(one.text)
  }
  const result = (one.result ?? {}) as { stdout?: unknown; stderr?: unknown }
  for (const stream of [result.stdout, result.stderr]) {
    if (typeof stream === 'string') {
      parts.push(stream)
    }
  }
  return parts.join('\n')
}

/** stdout의 마지막 비어 있지 않은 줄을 계약 JSON으로 읽는다. 형태가 다르면 `undefined`. */
export const parseHeadlessOutput = (stdout: string): HeadlessResult | undefined => {
  const last = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1)
  if (last === undefined) {
    return undefined
  }
  try {
    const value = JSON.parse(last) as Partial<HeadlessResult> | null
    const isValid =
      value !== null &&
      typeof value === 'object' &&
      typeof value.ok === 'boolean' &&
      typeof value.status === 'number' &&
      Array.isArray(value.consoleErrors)
    return isValid ? (value as HeadlessResult) : undefined
  } catch {
    return undefined
  }
}

/** 실행 결과로 실패 원인을 정한다. 정상이면 `undefined`. exit 2는 계약상 playwright 없음이다. */
export const headlessCause = (
  exitCode: number,
  result: HeadlessResult | undefined,
): HeadlessCause | undefined => {
  if (exitCode === 2 || result?.error === 'playwright-missing') {
    return 'playwright-missing'
  }
  return result === undefined ? 'headless-failed' : undefined
}

/** headless 스크립트 argv. */
export const headlessArgv = (script: string, url: string, out: string): string[] => [
  'node',
  script,
  '--url',
  url,
  '--out',
  out,
]

/** 절대 경로 모양으로 플랫폼을 고른다(엔진이 OS를 알려주지 않으므로 플러그인 루트 경로로 판단). */
export const platformOf = (path: string): Platform => {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')) {
    return 'windows'
  }
  return path.startsWith('/Users/') ? 'mac' : 'linux'
}

/** 외부 브라우저로 여는 argv. shell 없이 실행된다. */
export const openExternalArgv = (platform: Platform, url: string): string[] => {
  if (platform === 'windows') {
    return ['cmd', '/c', 'start', '', url]
  }
  return platform === 'mac' ? ['open', url] : ['xdg-open', url]
}

/** HTTP 상태와 headless 결과를 합쳐 상태 값을 만든다. HTTP 확인이 실패했으면 headless 상태를 쓴다. */
export const toBrowserInfo = (
  url: string,
  httpStatus: number,
  result: HeadlessResult | undefined,
  now: number,
): BrowserInfo => {
  const info: BrowserInfo = {
    url,
    status: httpStatus > 0 ? httpStatus : (result?.status ?? 0),
    consoleErrors: (result?.consoleErrors ?? []).slice(0, MAX_ERRORS).map(String),
    checkedAt: now,
  }
  if (result?.title !== undefined && result.title !== '') {
    info.title = result.title
  }
  if (result?.screenshot !== undefined && result.screenshot !== '') {
    info.screenshot = result.screenshot
  }
  return info
}

/** 다음 프롬프트에 붙일 콘솔 에러 블록(모델만 읽는다). */
export const consoleContext = (info: BrowserInfo): string =>
  [
    `Browser console errors captured from ${info.url} (HTTP ${info.status}):`,
    ...info.consoleErrors.slice(0, MAX_ERRORS).map(error => `- ${error}`),
  ].join('\n')
