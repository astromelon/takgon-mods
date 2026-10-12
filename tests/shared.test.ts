import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { t } from '../src/shared/i18n'
import { globalKey, projectId, projectKey } from '../src/shared/keys'
import { parseModsArgs, parsePercent, toPercent } from '../src/shared/settings'

const mods = ($: Engine, args: string) =>
  $.command.run({
    command: 'mods',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })

describe('keys', () => {
  test('projectId는 경로 표기 차이를 무시하고 8자리 hex를 낸다', () => {
    const a = projectId('C:\\workspace\\aichatbot\\')
    const b = projectId('c:/workspace/aichatbot')

    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(projectId('C:\\workspace\\other')).not.toBe(a)
  })

  test('키에 콜론을 쓰지 않고 / 로 네임스페이싱한다', () => {
    expect(projectKey('abcd1234', 'm5', 'linked')).toBe('p/abcd1234/m5/linked')
    expect(globalKey('core', 'modules')).toBe('g/core/modules')
  })
})

describe('i18n', () => {
  test('언어별 문자열과 변수 치환', () => {
    expect(t('ko', 'mods.toggled', { module: 'panel', state: 'off' })).toContain('panel')
    expect(t('en', 'mods.title')).not.toBe(t('ko', 'mods.title'))
  })
})

describe('퍼센트 설정(임계치)', () => {
  test('저장 값은 1~99 정수만, 그 밖은 기본값', () => {
    expect(toPercent(30, 80)).toBe(30)
    expect(toPercent(undefined, 80)).toBe(80)
    expect(toPercent(0, 80)).toBe(80)
    expect(toPercent(100, 75)).toBe(75)
    expect(toPercent(12.5, 80)).toBe(80)
    expect(toPercent('30', 80)).toBe(80)
  })

  test('입력 문자열은 1~99 정수만 받는다', () => {
    expect(parsePercent('30')).toBe(30)
    expect(parsePercent(' 99 ')).toBe(99)
    expect(parsePercent('0')).toBeNull()
    expect(parsePercent('100')).toBeNull()
    expect(parsePercent('abc')).toBeNull()
    expect(parsePercent('5%')).toBeNull()
  })
})

describe('parseModsArgs', () => {
  test('인자 없음은 목록', () => {
    expect(parseModsArgs('')).toEqual({ kind: 'list' })
  })

  test('모듈 토글', () => {
    expect(parseModsArgs('panel off')).toEqual({ kind: 'toggle', module: 'panel', isOn: false })
    expect(parseModsArgs(' Diagram  ON ')).toEqual({ kind: 'toggle', module: 'diagram', isOn: true })
  })

  test('언어 전환', () => {
    expect(parseModsArgs('lang en')).toEqual({ kind: 'lang', lang: 'en' })
  })

  test('잘못된 입력은 usage', () => {
    expect(parseModsArgs('nope on')).toEqual({ kind: 'usage' })
    expect(parseModsArgs('lang jp')).toEqual({ kind: 'usage' })
    expect(parseModsArgs('panel maybe')).toEqual({ kind: 'usage' })
  })
})

describe('/mods 명령', () => {
  test('기본값은 전부 on이고 토글하면 목록에 반영된다', async ($, on) => {
    mock.store(on)

    const listed = await mods($, '')
    expect(listed.text).toContain('panel')
    expect(listed.text).not.toContain(t('ko', 'mods.state.off'))

    await mods($, 'panel off')
    const after = await mods($, '')

    expect(after.text).toContain(`- panel (${t('ko', 'module.panel')}): ${t('ko', 'mods.state.off')}`)
    expect(after.text).toContain(`- diagram (${t('ko', 'module.diagram')}): ${t('ko', 'mods.state.on')}`)
  })

  test('store에 저장된 설정을 읽는다(g/ 네임스페이스)', async ($, on) => {
    mock.store(on, { 'g/core/modules': { panel: false }, 'g/i18n/lang': 'en' })

    const listed = await mods($, '')

    expect(listed.text).toContain(t('en', 'mods.title'))
    expect(listed.text).toContain(`- panel (${t('en', 'module.panel')}): off`)
  })

  test('lang en 전환 후 출력이 영어가 된다', async ($, on) => {
    mock.store(on)

    await mods($, 'lang en')
    const en = await mods($, '')

    expect(en.text).toContain(t('en', 'mods.title'))
  })

  test('잘못된 인자는 사용법을 보여준다', async ($, on) => {
    mock.store(on)

    const usage = await mods($, 'panel maybe')

    expect(usage.text).toContain('/mods <')
  })
})
