import type { Register } from 'claude-code'

import { registerCore } from './core'

/**
 * takgon-mods 단일 진입점. `hooks.json`의 `modules`는 경로 하나만 받으므로 각 모듈의 register를 여기서 묶는다.
 *
 * 제약: 엔진은 `$`를 import 경계 너머 함수로 넘기는 것을 거부한다. 모듈마다 자기 파일 안에서만 `$`를 쓰고,
 * 모듈 사이 데이터는 `$.state`(같은 atom 참조)로 주고받는다.
 * matcher 없는 `session.start`는 core에 하나만 두고, `/clear`·`/resume`은 `classic.SessionStart`가 받는다.
 */
export const register: Register = on => {
  registerCore(on)
}
