/**
 * 모듈 목록과 기본값.
 *
 * atom은 여기서 export하지 않는다: 엔진 스캔은 `update`/`read`의 대상이 같은 파일에서 `atom(...)`으로 만든 것이어야
 * 읽을 수 있다. 여러 모듈이 같은 값을 공유할 때는 각 파일이 같은 `plugin`/`key` 리터럴로 atom을 선언한다.
 */
import type { ModuleFlags, ModuleId } from '../../types'

/** 플러그인 이름. `$.state` 참조의 `plugin`과 같다. */
export const PLUGIN = 'takgon-mods'

/** 모듈 식별자 전체, `/mods` 목록 순서. */
export const MODULE_IDS: readonly ModuleId[] = [
  'i18n',
  'integrations',
  'composer',
  'panel',
  'handoff',
  'browser',
  'edit',
  'diagram',
]

/** 모든 모듈 on. */
export const ALL_ON: ModuleFlags = {
  i18n: true,
  integrations: true,
  composer: true,
  panel: true,
  handoff: true,
  browser: true,
  edit: true,
  diagram: true,
}
