import type { Register } from 'claude-code'

import { registerCore } from './core'
import { registerI18n } from './m1-i18n'
import { registerBrowser } from './m2-browser'
import { registerEdit } from './m3-edit'
import { registerComposer } from './m4-composer'
import { registerIntegrations } from './m5-integrations'
import { registerPanel } from './m6-panel'
import { registerHandoff } from './m7-handoff'
import { registerDiagram } from './m8-diagram'

/**
 * takgon-mods 단일 진입점. `hooks.json`의 `modules`는 경로 하나만 받으므로 각 모듈의 register를 여기서 묶는다.
 *
 * 제약: 엔진은 `$`를 import 경계 너머 함수로 넘기는 것을 거부하고, `read`/`update`의 atom은 같은 파일에서
 * 선언돼야 한다. 모듈마다 자기 파일 안에서만 `$`를 쓰고, 모듈 사이 데이터는 같은 `plugin`/`key` 리터럴의
 * atom(`types/index.d.ts` 계약)으로 주고받는다.
 */
export const register: Register = on => {
  registerCore(on)
  registerI18n(on)
  registerIntegrations(on)
  registerComposer(on)
  registerPanel(on)
  registerHandoff(on)
  registerBrowser(on)
  registerEdit(on)
  registerDiagram(on)
}
