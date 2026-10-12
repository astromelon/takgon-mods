import type { EngineInterface } from 'claude-code'

/** 외부 연동 상태. `isAvailable`이 false면 해당 UI 요소를 숨긴다. */
export type ProviderStatus<T> =
  | { isAvailable: true; data: T }
  | { isAvailable: false; reason: string }

/** 검색 결과 한 건. */
export type ProviderItem = { id: string; title: string; url?: string; state?: string }

/** M5 연동 공통 인터페이스. 구현체는 토큰을 store·로그·toast에 남기지 않는다. */
export type Provider<T> = {
  /** 연동 이름(i18n 키·toast 원인 키에 쓴다). */
  readonly name: string
  getStatus: ($: EngineInterface) => Promise<ProviderStatus<T>>
  search: ($: EngineInterface, q: string) => Promise<readonly ProviderItem[]>
  link: ($: EngineInterface, id: string) => Promise<void>
}
