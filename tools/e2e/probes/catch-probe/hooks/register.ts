import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'probe2', description: 'catch probe' })
    return next(e)
  })

  // 바깥 훅: args가 boom이면 next 전에 예외. .catch가 next(e)로 대신 답한다.
  on('command.run', async ($, e, next) => {
    $.ui.log(`OUTER ran args=${e.args}`)
    if (e.args === 'boom') {
      throw new Error('outer boom')
    }
    return next(e)
  }).catch(($, e, next) => {
    $.ui.log(`CATCH ran called=${String(next.called)}`)
    return next(e)
  })

  // 안쪽 훅: 같은 플러그인의 명령 처리.
  on('command.run', { command: 'probe2' }, async ($, e) => {
    $.ui.log(`INNER ran args=${e.args}`)
    return { text: `PROBE2 OK args=${e.args}` }
  })
}
