import { atom, read, update } from 'claude-code'
import type { CommandSpec, EngineInterface, On } from 'claude-code'

import type { Lang, ModuleFlags } from '../types'
import { t, toLang } from './shared/i18n'
import type { MessageKey } from './shared/i18n'
import { projectId } from './shared/keys'
import { LANG_KEY, MODULES_KEY, markNotified, parseModsArgs, refusalReason, registerCause, toFlags } from './shared/settings'
import { ALL_ON, MODULE_IDS } from './shared/state'

const langAtom = atom({ plugin: 'takgon-mods', key: 'lang' } as const, 'ko')
const modulesAtom = atom({ plugin: 'takgon-mods', key: 'modules' } as const, ALL_ON)
const projectIdAtom = atom({ plugin: 'takgon-mods', key: 'projectId' } as const, '')
const notifiedAtom = atom({ plugin: 'takgon-mods', key: 'notified' } as const, [])
const restoredAtom = atom({ plugin: 'takgon-mods', key: 'restored' } as const, [])

/**
 * 명령을 등록한다. 같은 이름의 사용자·내장 명령 때문에 거부되면 예외를 삼켜 다른 초기화(이 모듈과 뒤쪽 모듈)를 막지 않고,
 * 명령마다 세션당 1회 toast로 알린다. `$`는 import 경계를 넘을 수 없어 모듈 파일마다 같은 헬퍼를 둔다.
 */
const registerCommand = async ($: EngineInterface, spec: CommandSpec): Promise<void> => {
  try {
    await $.command.register(spec)
  } catch (error) {
    try {
      const marked = markNotified(await read($, notifiedAtom), registerCause(spec.name))
      if (marked !== null) {
        await update($, notifiedAtom, () => marked)
        const vars = { name: spec.name, reason: refusalReason(error) }
        $.ui.toast(t(await read($, langAtom), 'mods.registerRefused', vars))
      }
    } catch {
      // 알림 실패도 초기화를 막지 않는다.
    }
  }
}

/** store 기준 현재 설정. 세션 상태가 아직 없을 수 있는 명령 처리에서도 쓴다. */
const settings = async ($: EngineInterface): Promise<{ flags: ModuleFlags; lang: Lang }> => ({
  flags: toFlags(await $.store.get(MODULES_KEY)),
  lang: toLang(await $.store.get(LANG_KEY)),
})

/** 공통 상태(프로젝트·모듈 on/off·언어)를 store에서 다시 채우고 복원 표시를 남긴다. */
const restore = async ($: EngineInterface): Promise<void> => {
  await update($, restoredAtom, list => (list.includes('core') ? list : [...list, 'core']))
  const root = await $.session.root()
  const { flags, lang } = await settings($)
  await update($, projectIdAtom, () => projectId(root))
  await update($, notifiedAtom, () => [])
  await update($, modulesAtom, () => flags)
  await update($, langAtom, () => lang)
}

/**
 * `/clear`·`/resume` 뒤에는 state가 비고 `session.start`도 오지 않는다(classic.SessionStart는 내장 보안 플러그인이
 * user 플러그인을 건너뛰게 해 전달되지 않는다). 복원 표시가 없으면 첫 프롬프트·명령에서 다시 채운다.
 */
const ensureRestored = async ($: EngineInterface): Promise<void> => {
  // 훅이 실패해 `.catch`가 답하면 같은 이벤트의 뒤쪽 훅(다른 명령 처리 등)이 건너뛰어지므로 여기서 삼킨다.
  try {
    if (!(await read($, restoredAtom)).includes('core')) {
      await restore($)
    }
  } catch {
    // 복원 실패 시 기본값으로 계속한다. 다음 진입에서 다시 시도하도록 표시를 되돌린다.
    await update($, restoredAtom, list => list.filter(one => one !== 'core')).catch(() => undefined)
  }
}

/** 세션 시작: 공통 상태 복원과 `/mods` 등록. */
const start = async ($: EngineInterface): Promise<void> => {
  await restore($)
  const { lang } = await settings($)
  await registerCommand($, {
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

  // /clear·/resume 뒤 첫 프롬프트·명령에서 복원한다. core가 먼저 등록돼 다른 모듈 훅보다 바깥에서 돈다.
  // 복원이 실패해도 프롬프트·명령은 그대로 진행한다.
  on('prompt.submit', async ($, e, next) => {
    await ensureRestored($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', async ($, e, next) => {
    await ensureRestored($)
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
