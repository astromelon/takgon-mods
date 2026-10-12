/**
 * 모듈 on/off·언어 설정의 순수 로직.
 *
 * 엔진은 `$`를 import 경계 너머로 전달하는 것을 거부한다(같은 파일 안 함수로만 추적). 그래서 shared에는
 * `$`를 받는 함수를 두지 않고, store 읽기·쓰기는 각 모듈 파일이 아래 키와 변환 함수로 직접 한다.
 */
import type { Lang, ModuleFlags, ModuleId } from '../../types'
import { LANGS } from './i18n'
import { globalKey } from './keys'
import { ALL_ON, MODULE_IDS } from './state'

/** 모듈 on/off store 키. */
export const MODULES_KEY = globalKey('core', 'modules')

/** UI 언어 store 키. */
export const LANG_KEY = globalKey('i18n', 'lang')

/** `/mods` 인자의 해석 결과. */
export type ModsAction =
  | { kind: 'list' }
  | { kind: 'toggle'; module: ModuleId; isOn: boolean }
  | { kind: 'lang'; lang: Lang }
  | { kind: 'usage' }

const SWITCHES: Readonly<Record<string, boolean>> = { on: true, off: false }

/** `/mods` 인자를 해석한다. 알 수 없는 입력은 `usage`. */
export const parseModsArgs = (args: string): ModsAction => {
  const [head, value, ...rest] = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (head === undefined) {
    return { kind: 'list' }
  }
  if (value === undefined || rest.length > 0) {
    return { kind: 'usage' }
  }
  if (head === 'lang') {
    return LANGS.includes(value as Lang) ? { kind: 'lang', lang: value as Lang } : { kind: 'usage' }
  }
  const isOn = SWITCHES[value]
  if (!MODULE_IDS.includes(head as ModuleId) || isOn === undefined) {
    return { kind: 'usage' }
  }
  return { kind: 'toggle', module: head as ModuleId, isOn }
}

/** 저장된 값을 모듈 플래그로 맞춘다. 없거나 모르는 값은 기본(on)으로 채운다. */
export const toFlags = (value: unknown): ModuleFlags => {
  const stored = (value ?? {}) as Partial<Record<string, unknown>>
  const flags = { ...ALL_ON }
  for (const id of MODULE_IDS) {
    const one = stored[id]
    if (typeof one === 'boolean') {
      flags[id] = one
    }
  }
  return flags
}

/** 이미 알린 원인 목록에 `cause`가 없으면 추가한 목록을, 있으면 `null`을 돌려준다(toast 1회 판정). */
export const markNotified = (notified: readonly string[], cause: string): string[] | null =>
  notified.includes(cause) ? null : [...notified, cause]

/** 프로젝트 산출물 폴더: `{root}/.claude/takgon`. 처음 쓸 때 `*` 한 줄 `.gitignore`를 함께 만든다. */
export const outputDir = (root: string): string =>
  `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/.claude/takgon`

/** 산출물 폴더의 `.gitignore` 내용. 어느 저장소에서도 미추적 파일로 잡히지 않게 한다. */
export const OUTPUT_GITIGNORE = '*\n'

/** 퍼센트 임계치로 유효한지: 1~99 정수. */
const isPercent = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 99

/** 저장된 퍼센트 임계치. 없거나 범위 밖이면 `fallback`. */
export const toPercent = (value: unknown, fallback: number): number => (isPercent(value) ? value : fallback)

/** 명령 인자의 퍼센트(숫자만, 1~99). 아니면 null. */
export const parsePercent = (text: string): number | null => {
  const trimmed = text.trim()
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
  return isPercent(value) ? value : null
}
