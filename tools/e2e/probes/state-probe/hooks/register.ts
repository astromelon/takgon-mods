import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const v = atom({ plugin: 'state-probe', key: 'v' } as const, 'unset')
const ends = atom({ plugin: 'state-probe', key: 'ends' } as const, [])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'probe', description: 'probe' })
    return next(e)
  })
  on('session.end', { reason: 'clear' }, async ($, e, next) => {
    await update($, ends, list => [...list, `clear:${e.sessionId.slice(0, 6)}`])
    return next(e)
  })
  on('command.run', { command: 'probe' }, async ($, e) => {
    if (e.args.startsWith('set ')) {
      await update($, v, () => e.args.slice(4))
    }
    const id = await $.session.id()
    return { text: `PROBE v=${await read($, v)} ends=${(await read($, ends)).join(',')} sid=${id.slice(0, 6)}` }
  })
}
