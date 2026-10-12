import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import {
  formatDuration,
  translateBackgroundHint,
  translateModes,
  translatePromptHint,
  translateSpinnerWord,
} from '../src/m1-i18n/builtin'

describe('builtin 번역(순수)', () => {
  test('Spinner 단어는 모드별 한국어로, desktop은 Working만 바꾼다', () => {
    expect(translateSpinnerWord('Sauteing', 'thinking', 'terminal')).toBe('생각하는 중')
    expect(translateSpinnerWord('Sauteing', 'tool-use', 'terminal')).toBe('도구 실행 중')
    expect(translateSpinnerWord('Working', 'responding', 'desktop')).toBe('작업 중')
    expect(translateSpinnerWord('Creating notes.md', 'tool-use', 'desktop')).toBeUndefined()
  })

  test('경과 시간 포맷', () => {
    expect(formatDuration(3_000)).toBe('3초')
    expect(formatDuration(64_000)).toBe('1분 4초')
    expect(formatDuration(3_725_000)).toBe('1시간 2분')
  })

  test('백그라운드 실행 힌트는 사용자 키 바인딩을 유지한다', () => {
    expect(translateBackgroundHint('(ctrl+b to run in background)')).toBe('(ctrl+b: 백그라운드로 실행)')
    expect(translateBackgroundHint('something else')).toBeUndefined()
  })

  test('프롬프트 힌트는 알려진 문구와 정확히 같을 때만 바꾼다', () => {
    expect(translatePromptHint('? for shortcuts')).toBe('? 단축키')
    expect(translatePromptHint('? for shortcuts · 2 files')).toBeUndefined()
  })

  test('모드 라벨은 아는 것만 바꾸고 나머지는 유지한다', () => {
    expect(translateModes(['focus', 'custom-mode'])).toEqual(['집중', 'custom-mode'])
    expect(translateModes(['custom-mode'])).toBeUndefined()
  })
})

const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const

/** 엔진 자리에서 세션 시작과 프로젝트 루트를 답한다. */
const engine = (on: On): void => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: 'C:/proj' }))
}

const SPINNER = {
  word: 'Sauteing',
  message: null,
  suffix: '…',
  mode: 'thinking',
} as const

describe('ui.render 훅', () => {
  test('ko에서는 Spinner 단어를 바꿔 엔진에 넘기고, en·모듈 off면 그대로 둔다', async ($, on) => {
    const words: string[] = []
    on('ui.render', { component: 'Spinner' }, ($, e) => {
      words.push(e.props.word)
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.word}</Text>
    })

    engine(on)
    mock.store(on, { 'g/i18n/lang': 'ko' })
    await $.session.start(START)
    await (await $.ui.mount({ plugin: 'takgon-mods', surface: 'terminal', component: 'Spinner', props: SPINNER })).unmount()

    expect(words.at(-1)).toBe('생각하는 중')
  })

  test('TurnDuration은 terminal에서 한국어 한 줄을 직접 그린다', async ($, on) => {
    engine(on)
    mock.store(on)
    await $.session.start(START)

    const ui = await $.ui.mount({
      plugin: 'takgon-mods',
      surface: 'terminal',
      component: 'TurnDuration',
      props: { word: 'Baked', durationMs: 64_000 },
    })

    expect((await ui.find({ type: 'Text', text: /1분 4초/ }))?.text).toContain('작업')
  })

  test('i18n 모듈이 꺼지면 TurnDuration을 엔진에 맡긴다', async ($, on) => {
    let isEngineDrawn = false
    on('ui.render', { component: 'TurnDuration' }, ($, e) => {
      isEngineDrawn = true
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.word}</Text>
    })
    engine(on)
    mock.store(on, { 'g/core/modules': { i18n: false } })
    await $.session.start(START)

    await $.ui.mount({
      plugin: 'takgon-mods',
      surface: 'terminal',
      component: 'TurnDuration',
      props: { word: 'Baked', durationMs: 3_000 },
    })

    expect(isEngineDrawn).toBe(true)
  })
})
