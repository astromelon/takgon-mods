/**
 * `tools/headless.mjs` 출력 계약(M2 /browse, M3 /edit dom 공용)의 순수 해석.
 *
 * `$`를 받지 않는다. 스크립트 실행은 각 모듈의 index.tsx가 하고, 여기서는 stdout 마지막 줄 JSON만 읽는다.
 */

/** headless 스크립트 실행 제한 시간 기본값. 모듈은 자기 사정에 맞춰 덮어쓴다(M2 45초, M3 90초). */
export const HEADLESS_TIMEOUT_MS = 45_000

/** `tools/headless.mjs`가 stdout 마지막 줄에 내는 JSON. */
export type HeadlessResult = {
  ok: boolean
  status: number
  title?: string
  consoleErrors: string[]
  screenshot?: string
  element?: { selector: string; computedStyle: Record<string, string>; screenshot?: string }
  error?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `element`가 있으면 `selector`(문자열)와 `computedStyle`(객체)을 갖춘 모양인지. */
const isElement = (value: unknown): boolean =>
  isRecord(value) && typeof value.selector === 'string' && isRecord(value.computedStyle)

/** stdout의 마지막 비어 있지 않은 줄을 계약 JSON으로 읽는다. 형태가 다르면 `undefined`. */
export const parseHeadlessOutput = (stdout: string): HeadlessResult | undefined => {
  const last = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1)
  if (last === undefined) {
    return undefined
  }
  try {
    const value: unknown = JSON.parse(last)
    const isValid =
      isRecord(value) &&
      typeof value.ok === 'boolean' &&
      typeof value.status === 'number' &&
      Array.isArray(value.consoleErrors) &&
      (value.element === undefined || isElement(value.element))
    return isValid ? (value as HeadlessResult) : undefined
  } catch {
    return undefined
  }
}
