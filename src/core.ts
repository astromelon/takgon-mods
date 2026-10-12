import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Lang, ModuleFlags } from '../types'
import { t, toLang } from './shared/i18n'
import type { MessageKey } from './shared/i18n'
import { projectId } from './shared/keys'
import { LANG_KEY, MODULES_KEY, parseModsArgs, toFlags } from './shared/settings'
import { ALL_ON, MODULE_IDS } from './shared/state'

const langAtom = atom({ plugin: 'takgon-mods', key: 'lang' } as const, 'ko')
const modulesAtom = atom({ plugin: 'takgon-mods', key: 'modules' } as const, ALL_ON)
const projectIdAtom = atom({ plugin: 'takgon-mods', key: 'projectId' } as const, '')
const notifiedAtom = atom({ plugin: 'takgon-mods', key: 'notified' } as const, [])

/** store 기준 현재 설정. 세션 상태가 아직 없을 수 있는 명령 처리에서도 쓴다. */
const settings = async ($: EngineInterface): Promise<{ flags: ModuleFlags; lang: Lang }> => ({
  flags: toFlags(await $.store.get(MODULES_KEY)),
  lang: toLang(await $.store.get(LANG_KEY)),
})

/** 세션 시작·복원 때 공통 상태를 store에서 다시 채우고 `/mods`를 등록한다. */
const start = async ($: EngineInterface): Promise<void> => {
  const root = await $.session.root()
  const { flags, lang } = await settings($)
  await update($, projectIdAtom, () => projectId(root))
  await update($, notifiedAtom, () => [])
  await update($, modulesAtom, () => flags)
  await update($, langAtom, () => lang)
  await $.command.register({
    name: 'mods',
    description: t(lang, 'mods.description'),
    argumentHint: '[<module> on|off | lang ko|en]',
  })
}

/**
 * 공통 코어: 세션 상태 복원과 `/mods` 명령.
 *
 * `$`는 import 경계를 넘길 수 없으므로, 이 파일이 쓰는 store·state 접근은 모두 이 파일 안에 둔다.
 */
export const registerCore = (on: On): void => {
  on('session.start', async ($, e, next) => {
    await start($)
    return next(e)
  })

  // /clear·/resume·compact 뒤 복원. 실패해도 세션 시작을 막지 않는다.
  on('classic.SessionStart', async ($, e, next) => {
    await start($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'mods' }, async ($, e) => {
    const action = parseModsArgs(e.args)
    const { flags, lang } = await settings($)

    if (action.kind === 'toggle') {
      const next = { ...flags, [action.module]: action.isOn }
      await $.store.set(MODULES_KEY, next)
      await update($, modulesAtom, () => next)
      const state = t(lang, action.isOn ? 'mods.state.on' : 'mods.state.off')
      return { text: t(lang, 'mods.toggled', { module: action.module, state }) }
    }
    if (action.kind === 'lang') {
      await $.store.set(LANG_KEY, action.lang)
      await update($, langAtom, () => action.lang)
      return { text: t(action.lang, 'mods.langChanged', { lang: action.lang }) }
    }
    if (action.kind === 'usage') {
      return { text: t(lang, 'mods.usage', { modules: MODULE_IDS.join(', ') }) }
    }
    return { text: listText(flags, lang) }
  })
}

const listText = (flags: ModuleFlags, lang: Lang): string => {
  const rows = MODULE_IDS.map(id => {
    const state = t(lang, flags[id] ? 'mods.state.on' : 'mods.state.off')
    return `- ${id} (${t(lang, `module.${id}` as MessageKey)}): ${state}`
  })
  return [t(lang, 'mods.title'), ...rows, t(lang, 'mods.lang', { lang })].join('\n')
}
