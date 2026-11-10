/**
 * M2 브라우저의 순수 로직(URL 감지·headless 출력 해석·외부 열기 명령·콘솔 첨부 문구).
 *
 * `$`를 받지 않으므로 단위 테스트로 직접 검증한다.
 */
import type { BrowserInfo } from '../../types'
import type { HeadlessResult } from '../shared/headless'

/** pane id이자 `ui.render`의 requestId. */
export const PANE_ID = 'takgon-browser'

/** 화면·첨부에 남기는 콘솔 에러 최대 건수. */
export const MAX_ERRORS = 20

/** headless 스크립트 실행 제한 시간. 스크립트의 기본 대기(3초)와 브라우저 기동을 넉넉히 덮는다. */
export const HEADLESS_TIMEOUT_MS = 45_000

/** headless 실패 원인. toast 1회 판정 키(`m2/<원인>`)로도 쓴다. */
export type HeadlessCause = 'node-missing' | 'playwright-missing' | 'headless-failed'

/** 외부 브라우저를 여는 방법을 가르는 플랫폼. */
export type Platform = 'windows' | 'mac' | 'linux'

const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+[^\s'"]*/g

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])

/** 문장 속 URL 뒤에 붙은 문장부호(`).`, `,` 등). */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>]+$/

/**
 * 후보가 진짜 로컬 URL인지 파싱해서 확인한다. 정규식만으로는 `http://localhost:3000@evil.example/`처럼
 * 앞부분이 userinfo이고 실제 호스트는 다른 주소인 URL을 구분하지 못한다.
 */
const isLocalUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return LOCAL_HOSTS.has(url.hostname) && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

/** 텍스트에서 첫 로컬 개발 서버 URL(끝 문장부호 제외, 호스트가 실제로 로컬인 것만). 없으면 `undefined`. */
export const extractLocalUrl = (text: string): string | undefined => {
  for (const match of text.matchAll(LOCAL_URL)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, '')
    if (isLocalUrl(candidate)) {
      return candidate
    }
  }
  return undefined
}

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

/**
 * `$.process.run`이 거부됐을 때의 원인. 엔진은 시작 실패와 시간 초과를 같은 거부로 알리고 오류 문구도 정해 두지
 * 않았으므로, 문구 대신 걸린 시간으로 가른다. 제한 시간에 거의 다 찼으면 시간 초과(headless 실패), 그보다 빨리
 * 거부됐으면 시작 실패(node 없음)다.
 */
export const spawnFailureCause = (elapsedMs: number, timeoutMs: number): HeadlessCause =>
  elapsedMs >= timeoutMs * 0.9 ? 'headless-failed' : 'node-missing'

/** 절대 경로 모양으로 플랫폼을 고른다(엔진이 OS를 알려주지 않으므로 플러그인 루트 경로로 판단). */
export const platformOf = (path: string): Platform => {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')) {
    return 'windows'
  }
  return path.startsWith('/Users/') ? 'mac' : 'linux'
}

/** 외부 브라우저로 열어도 되는 URL인지: 파싱되고 http(s)인 것만. */
export const isSafeExternalUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 외부 브라우저로 여는 argv. shell 없이 실행된다. Windows에서 `cmd /c start`를 쓰면 cmd가 명령줄을
 * 다시 해석해 URL의 `&`·`|`·`^`가 명령으로 실행되므로, cmd를 거치지 않는 rundll32를 쓴다.
 */
export const openExternalArgv = (platform: Platform, url: string): string[] => {
  if (platform === 'windows') {
    return ['rundll32', 'url.dll,FileProtocolHandler', url]
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
