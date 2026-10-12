import type { Register } from 'claude-code'

/**
 * 엔진 제약 1번 감시용: user 범위 플러그인의 classic.* 훅이 내장 보안 플러그인(cc-plugin-sec-default)에 의해 건너뛰어지는지.
 * classic.SessionStart 훅이 실제로 실행되면 debug 로그에 CLASSIC-PROBE 줄을 남긴다. /probe-classic은 로드 확인용이다.
 */
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'probe-classic', description: 'classic probe' })
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    $.ui.log(`CLASSIC-PROBE SessionStart ran source=${String(e.source)}`)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'probe-classic' }, async () => ({ text: 'PROBE-CLASSIC OK' }))
}
