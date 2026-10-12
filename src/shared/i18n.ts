import type { Lang } from '../../types'

/** 기본(ko) 사전. 키 목록의 단일 출처다. */
const ko = {
  'mods.title': 'takgon-mods 모듈',
  'mods.state.on': '켜짐',
  'mods.state.off': '꺼짐',
  'mods.lang': '언어: {lang}',
  'mods.toggled': '{module} 모듈: {state}',
  'mods.langChanged': '언어를 {lang}(으)로 바꿨습니다.',
  'mods.usage': '사용법: /mods | /mods <모듈> on|off | /mods lang ko|en\n모듈: {modules}',
  'mods.description': 'takgon-mods 모듈 목록·토글·언어 설정',
  'mods.registerRefused': '/{name} 명령을 등록하지 못했습니다({reason}). 같은 이름의 명령·스킬이 대신 실행됩니다.',
  'module.i18n': '다국어',
  'module.integrations': 'GitHub PR·Linear 연동',
  'module.composer': '프롬프트 위 작업 바',
  'module.panel': '작업 패널',
  'module.handoff': '자동 인수인계',
  'module.browser': '브라우저 미리보기',
  'module.edit': '선택 영역 수정',
  'module.diagram': '다이어그램 렌더링',
} as const

/** 메시지 키. */
export type MessageKey = keyof typeof ko

const en: Record<MessageKey, string> = {
  'mods.title': 'takgon-mods modules',
  'mods.state.on': 'on',
  'mods.state.off': 'off',
  'mods.lang': 'Language: {lang}',
  'mods.toggled': '{module} module: {state}',
  'mods.langChanged': 'Language set to {lang}.',
  'mods.usage': 'Usage: /mods | /mods <module> on|off | /mods lang ko|en\nModules: {modules}',
  'mods.description': 'List and toggle takgon-mods modules, set language',
  'mods.registerRefused': 'Could not register /{name} ({reason}). A command or skill with the same name runs instead.',
  'module.i18n': 'Localization',
  'module.integrations': 'GitHub PR / Linear',
  'module.composer': 'Composer bar',
  'module.panel': 'Work panel',
  'module.handoff': 'Auto handoff',
  'module.browser': 'Browser preview',
  'module.edit': 'Select to edit',
  'module.diagram': 'Diagram render',
}

const dictionaries: Record<Lang, Record<MessageKey, string>> = { ko, en }

/** 지원 언어. */
export const LANGS: readonly Lang[] = ['ko', 'en']

/** 기본 언어. */
export const DEFAULT_LANG: Lang = 'ko'

/** 자리표시자 값. */
export type MessageVars = Readonly<Record<string, string | number>>

/** `{name}` 자리표시자를 채운다. */
export const format = (template: string, vars: MessageVars = {}): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))

/** 코어 사전의 `key`를 `lang`으로 번역한다. */
export const t = (lang: Lang, key: MessageKey, vars: MessageVars = {}): string =>
  format(dictionaries[lang][key], vars)

/**
 * 모듈 전용 사전으로 번역기를 만든다. 각 모듈은 `src/m<N>-<name>/messages.ts`에 ko(키의 단일 출처)와 en을 두고
 * `export const tr = createTranslator(ko, en)`으로 쓴다. 사전을 모듈별로 나눠 병렬 작업 시 충돌을 피한다.
 */
export const createTranslator =
  <K extends string>(ko: Readonly<Record<K, string>>, en: Readonly<Record<K, string>>) =>
  (lang: Lang, key: K, vars: MessageVars = {}): string =>
    format((lang === 'en' ? en : ko)[key], vars)

/** 저장된 값이 지원 언어면 그대로, 아니면 기본 언어. */
export const toLang = (value: unknown): Lang =>
  LANGS.includes(value as Lang) ? (value as Lang) : DEFAULT_LANG
