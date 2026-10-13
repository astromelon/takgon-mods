import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import {
  buildForkPrompt,
  formatStamp,
  handoffFileName,
  parseHandoffArgs,
  shouldTrigger,
  summarize,
  toThreshold,
} from '../src/m7-handoff/logic'

describe('handoff 순수 로직', () => {
  test('파일명 시각은 로컬 시간 yyyyMMdd-HHmm, 같은 분이면 -2 접미', () => {
    const at = new Date(2026, 9, 12, 9, 5, 42).getTime()
    expect(formatStamp(at)).toBe('20261012-0905')
    expect(handoffFileName('20261012-0905', 1)).toBe('20261012-0905.md')
    expect(handoffFileName('20261012-0905', 2)).toBe('20261012-0905-2.md')
  })

  test('트리거는 75% 이상이고 아직 안 했을 때만', () => {
    expect(shouldTrigger(74, false)).toBe(false)
    expect(shouldTrigger(75, false)).toBe(true)
    expect(shouldTrigger(90, true)).toBe(false)
    expect(shouldTrigger(undefined, false)).toBe(false)
    expect(shouldTrigger(10, false, 10)).toBe(true)
    expect(shouldTrigger(9, false, 10)).toBe(false)
  })

  test('임계치는 1~99 정수만, 그 밖은 기본 75', () => {
    expect(toThreshold(undefined)).toBe(75)
    expect(toThreshold(30)).toBe(30)
    expect(toThreshold(0)).toBe(75)
    expect(toThreshold(100)).toBe(75)
    expect(toThreshold(12.5)).toBe(75)
    expect(toThreshold('30')).toBe(75)
  })

  test('/tk-handoff threshold 인자 해석', () => {
    expect(parseHandoffArgs('threshold')).toEqual({ kind: 'threshold', value: null })
    expect(parseHandoffArgs('threshold 30')).toEqual({ kind: 'threshold', value: 30 })
    expect(parseHandoffArgs('threshold 0')).toBe('usage')
    expect(parseHandoffArgs('threshold abc')).toBe('usage')
    expect(parseHandoffArgs('show')).toBe('show')
  })

  test('프롬프트에 섹션과 핀·PR·이슈·미완료 작업을 넣는다', () => {
    const prompt = buildForkPrompt('ko', {
      pins: [{ id: 'p1', text: 'ULID PK 유지', createdAt: 0 }],
      pr: { number: 7, url: 'https://gh/pr/7', reviewDecision: 'APPROVED', checks: 'success' },
      linkedIssues: [{ id: 'i', identifier: 'ENG-1', title: '버그', url: 'https://l/1', state: 'Todo' }],
      tasks: [
        { id: 't1', text: '테스트 보강', kind: 'checkbox', isDone: false, createdAt: 0 },
        { id: 't2', text: '끝난 일', kind: 'checkbox', isDone: true, createdAt: 0 },
      ],
    })
    for (const part of ['## 목표', '## 완료', '## 진행중', '## 결정사항', '## 열린 이슈/PR', '## 다음 단계']) {
      expect(prompt).toContain(part)
    }
    expect(prompt).toContain('ULID PK 유지')
    expect(prompt).toContain('#7')
    expect(prompt).toContain('ENG-1')
    expect(prompt).toContain('테스트 보강')
    expect(prompt).not.toContain('끝난 일')
  })

  test('요약은 앞 300자', () => {
    expect(summarize(`  ${'가'.repeat(400)}`)).toHaveLength(300)
  })
})

const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const
const ROOT = 'C:/proj'
const DIR = 'C:/proj/.claude/takgon'
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const TURN = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

type World = {
  files: Map<string, string>
  toasts: string[]
  forks: string[]
  percent: { value: number | undefined }
  isForkOk: { value: boolean }
  context: (readonly string[] | undefined)[]
}

/** 엔진은 Windows에서 fs 경로를 역슬래시로 바꿔 넘기므로 비교용으로 `/`로 맞춘다. */
const slash = (path: string): string => path.replace(/\\/g, '/')

/** 쓰기를 기록하는 메모리 store. `store.set`은 한 번만 등록할 수 있어 mock.store 대신 쓴다. */
const recordingStore = (
  on: On,
  sets: { key: string; value: unknown }[],
  initial: Record<string, unknown> = {},
): void => {
  const data = new Map<string, unknown>(Object.entries(initial))
  on('store.get', ($, e) => ({ value: data.get(e.key) }))
  on('store.set', ($, e) => {
    sets.push({ key: e.key, value: e.value })
    data.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    data.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...data.keys()] }))
}

/** 엔진 자리: 세션·루트·사용량·fork·fs·toast·턴/프롬프트 바닥을 메모리로 답한다. */
const engine = (
  on: On,
  store: Record<string, unknown> = {},
  sets?: { key: string; value: unknown }[],
): World => {
  const world: World = {
    files: new Map(),
    toasts: [],
    forks: [],
    percent: { value: 50 },
    isForkOk: { value: true },
    context: [],
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: world.percent.value }, rateLimits: [] },
  }))
  on('model.fork', ($, e) => {
    world.forks.push(e.prompt)
    return world.isForkOk.value
      ? { value: { isAnswered: true, text: '## 목표\n인수인계 본문', usage: ZERO } }
      : { value: { isAnswered: false, reason: 'nothing-to-fork' } }
  })
  on('fs.exists', ($, e) => ({ value: world.files.has(slash(e.path)) }))
  on('fs.write', ($, e) => {
    world.files.set(slash(e.path), e.text)
    return { value: undefined }
  })
  on('fs.read', ($, e) => ({ value: world.files.get(slash(e.path)) ?? '' }))
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => {
    world.context.push(e.context)
    return { text: e.text, context: e.context }
  })
  if (sets === undefined) {
    mock.store(on, store)
  } else {
    recordingStore(on, sets, store)
  }
  return world
}

describe('자동 트리거', () => {
  test('75% 미만이면 만들지 않고, 이상이면 세션당 1회만 만든다', async ($, on) => {
    const world = engine(on)
    const clock = mock.clock(on, { now: new Date(2026, 9, 12, 9, 5).getTime() })
    await $.session.start(START)

    await $.turn.complete(TURN)
    await clock.settle()
    expect(world.forks).toHaveLength(0)

    world.percent.value = 80
    await $.turn.complete(TURN)
    // 생성은 타이머로 떼어 내므로 turn.complete는 fork를 기다리지 않는다.
    expect(world.forks).toHaveLength(0)
    await clock.settle()
    await $.turn.complete(TURN)
    await clock.settle()
    expect(world.forks).toHaveLength(1)
    expect(world.files.get(`${DIR}/handoff/20261012-0905.md`)).toContain('인수인계 본문')
    expect(world.files.get(`${DIR}/.gitignore`)).toBe('*\n')
  })

  test('모듈이 꺼져 있으면 아무것도 하지 않는다', async ($, on) => {
    const world = engine(on, { 'g/core/modules': { handoff: false } })
    const clock = mock.clock(on)
    await $.session.start(START)
    world.percent.value = 90
    await $.turn.complete(TURN)
    await clock.settle()
    expect(world.forks).toHaveLength(0)
  })

  test('fork 실패는 자동이면 조용히, 수동이면 안내한다', async ($, on) => {
    const world = engine(on)
    world.isForkOk.value = false
    const clock = mock.clock(on)
    await $.session.start(START)
    world.percent.value = 90
    await $.turn.complete(TURN)
    await clock.settle()
    // 같은 턴에 다른 모듈(M5의 gh 확인)이 띄우는 toast는 제외하고 M7 것만 본다.
    expect(world.toasts.filter(text => !text.includes('gh'))).toEqual([])

    const out = await $.command.run({ command: 'tk-handoff', args: '', ...RUN })
    expect(out.text).toContain('nothing-to-fork')
  })
})

describe('임계치 설정', () => {
  test('/tk-handoff threshold로 바꾼 임계치에서 자동 생성하고, 인자 없이 부르면 현재 값을 보여준다', async ($, on) => {
    const world = engine(on)
    const clock = mock.clock(on, { now: new Date(2026, 9, 12, 9, 5).getTime() })
    await $.session.start(START)

    expect((await $.command.run({ command: 'tk-handoff', args: 'threshold', ...RUN })).text).toContain('75%')
    expect((await $.command.run({ command: 'tk-handoff', args: 'threshold 20', ...RUN })).text).toContain('20%')

    world.percent.value = 25
    await $.turn.complete(TURN)
    await clock.settle()
    expect(world.forks).toHaveLength(1)
  })
})

describe('수동 실행과 load', () => {
  test('같은 분에 두 번 만들면 -2 접미, show는 최신본을 보여준다', async ($, on) => {
    const world = engine(on)
    mock.clock(on, { now: new Date(2026, 9, 12, 14, 30).getTime() })
    await $.session.start(START)

    await $.command.run({ command: 'tk-handoff', args: '', ...RUN })
    const second = await $.command.run({ command: 'tk-handoff', args: '', ...RUN })
    expect(second.text).toContain('20261012-1430-2.md')
    expect(world.files.has(`${DIR}/handoff/20261012-1430.md`)).toBe(true)

    const shown = await $.command.run({ command: 'tk-handoff', args: 'show', ...RUN })
    expect(shown.text).toContain('20261012-1430-2.md')
    expect(shown.text).toContain('인수인계 본문')
  })

  test('load 후 다음 composer 프롬프트 1회에만 파일 내용을 context로 붙인다', async ($, on) => {
    const world = engine(on)
    mock.clock(on)
    await $.session.start(START)
    await $.command.run({ command: 'tk-handoff', args: '', ...RUN })

    await $.command.run({ command: 'tk-handoff', args: 'load', ...RUN })
    const prompt = { wait: false, origin: { kind: 'composer' } } as const
    await $.prompt.submit({ text: '이어서', ...prompt })
    await $.prompt.submit({ text: '다음', ...prompt })

    expect(world.context[0]).toEqual(['## 목표\n인수인계 본문'])
    expect(world.context[1] ?? []).toHaveLength(0)
  })

  test('새 세션은 store의 최신본 파일이 있으면 toast로 안내하고, 없으면 load가 안내한다', async ($, on) => {
    const path = `${DIR}/handoff/20261011-1800.md`
    const latest = { path, summary: '요약', createdAt: 1 }
    const world = engine(on, { 'p/b1a59c26/m7/latest': latest })
    world.files.set(path, '이전 문서')
    mock.clock(on)
    await $.session.start(START)
    expect(world.toasts.join('\n')).toContain('/tk-handoff load')

    world.files.delete(path)
    const out = await $.command.run({ command: 'tk-handoff', args: 'load', ...RUN })
    expect(out.text).toContain(path)
  })
})

describe('/clear 뒤 복원', () => {
  test('state가 비어 있으면(session.start 없음) 첫 프롬프트에서 최신본을 다시 안내한다', async ($, on) => {
    const path = `${DIR}/handoff/20261011-1800.md`
    const world = engine(on, { 'p/b1a59c26/m7/latest': { path, summary: '요약', createdAt: 1 } })
    world.files.set(path, '이전 문서')
    mock.clock(on)

    await $.prompt.submit({ text: '이어서 작업', wait: false, origin: { kind: 'composer' } })

    expect(world.toasts.join('\n')).toContain('/tk-handoff load')
  })
})

describe('빈 store 첫 사용', () => {
  test('읽기는 쓰지 않고, 임계치 설정과 첫 생성이 각자의 키를 만든다', async ($, on) => {
    const sets: { key: string; value: unknown }[] = []
    engine(on, {}, sets)
    mock.clock(on, { now: new Date(2026, 9, 12, 9, 5).getTime() })
    await $.session.start(START)

    expect((await $.command.run({ command: 'tk-handoff', args: 'threshold', ...RUN })).text).toContain('75%')
    await $.command.run({ command: 'tk-handoff', args: 'show', ...RUN })
    expect(sets.filter(one => one.key.startsWith('g/m7/') || one.key.startsWith('p/b1a59c26/m7/'))).toHaveLength(0)

    await $.command.run({ command: 'tk-handoff', args: 'threshold 20', ...RUN })
    expect(sets.filter(one => one.key === 'g/m7/threshold')).toEqual([{ key: 'g/m7/threshold', value: 20 }])

    await $.command.run({ command: 'tk-handoff', args: '', ...RUN })
    const saved = sets.filter(one => one.key === 'p/b1a59c26/m7/latest')
    expect(saved).toHaveLength(1)
    expect(saved[0]?.value).toMatchObject({ path: `${DIR}/handoff/20261012-0905.md` })
  })
})
