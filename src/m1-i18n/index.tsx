import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { ALL_ON } from '../shared/state'
import {
  formatDuration,
  translateBackgroundHint,
  translateModes,
  translatePromptHint,
  translateSpinnerWord,
} from './builtin'

const langAtom = atom({ plugin: 'takgon-mods', key: 'lang' } as const, 'ko')
const modulesAtom = atom({ plugin: 'takgon-mods', key: 'modules' } as const, ALL_ON)

/** i18n 모듈이 켜져 있고 언어가 ko일 때만 내장 UI를 번역한다. */
const isKorean = async ($: EngineInterface): Promise<boolean> =>
  (await read($, modulesAtom)).i18n && (await read($, langAtom)) === 'ko'

/**
 * M1: 내장 UI 요소의 한국어화.
 *
 * 교체 가능한 범위는 `ui.render` 대상 중 문자열 prop이 있는 Spinner, TurnDuration, ToolProgress, PromptHint,
 * SessionMode뿐이다. `/config`·`/help`·슬래시 메뉴·권한 다이얼로그·내장 명령 출력·status line은 교체할 수 없다.
 * 이 플러그인 자체 UI는 각 모듈이 `t()`로 그린다.
 */
export const registerI18n = (on: On): void => {
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const word = (await isKorean($)) ? translateSpinnerWord(e.props.word, e.props.mode, e.surface) : undefined
    return word === undefined ? next(e) : next({ ...e, props: { ...e.props, word } })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isKorean($))) {
      return next(e)
    }
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>✻ {formatDuration(e.props.durationMs)} 동안 작업</Text>
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    const hint = (await isKorean($)) ? translateBackgroundHint(e.props.hint) : undefined
    return hint === undefined ? next(e) : next({ ...e, props: { ...e.props, hint } })
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = (await isKorean($)) ? translatePromptHint(e.props.hint) : undefined
    return hint === undefined ? next(e) : next({ ...e, props: { ...e.props, hint } })
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const modes = (await isKorean($)) ? translateModes(e.props.modes) : undefined
    return modes === undefined ? next(e) : next({ ...e, props: { ...e.props, modes } })
  })
}
