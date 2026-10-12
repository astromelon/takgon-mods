import type { Register } from 'claude-code'

export const register: Register = on => {
  // 다른 플러그인의 같은 이벤트 훅: 실행되는지, catch-probe보다 먼저인지 나중인지 기록한다.
  on('command.run', async ($, e, next) => {
    $.ui.log(`B ran args=${e.args} beneath=${next.trace.length}`)
    const result = await next(e)
    $.ui.log(`B after next trace=${next.trace.map(t => `${t.plugin}:${t.outcome}`).join(',')}`)
    return result
  }).catch(($, e, next) => next(e))
}
