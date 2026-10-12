/** UI 언어. */
export type Lang = 'ko' | 'en'

/** `/mods`로 켜고 끄는 모듈 식별자. */
export type ModuleId =
  | 'i18n'
  | 'integrations'
  | 'composer'
  | 'panel'
  | 'handoff'
  | 'browser'
  | 'edit'
  | 'diagram'

/** 모듈별 on/off. 저장된 값이 없는 모듈은 on으로 본다. */
export type ModuleFlags = Record<ModuleId, boolean>

declare module 'claude-code' {
  interface PluginState {
    'takgon-mods': {
      /** 현재 UI 언어(`g/i18n/lang` 미러). */
      lang: Lang
      /** 모듈 on/off(`g/core/modules` 미러). */
      modules: ModuleFlags
      /** 세션 프로젝트 루트의 해시. 세션 시작 전에는 빈 문자열. */
      projectId: string
      /** 이번 세션에 이미 toast로 알린 실패 원인 키. */
      notified: string[]
    }
  }
}
