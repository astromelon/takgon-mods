import type { On, SessionMessage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import {
  AUTO_LOAD_MAX_AGE_MS,
  buildForkPrompt,
  formatStamp,
  handoffContext,
  handoffFileName,
  isAutoCandidate,
  isHandoffPath,
  parseHandoffArgs,
  shouldTrigger,
  summarize,
  toAutoLoad,
  toThreshold,
} from '../src/m7-handoff/logic'

/** 훅 테스트 시간 제한. 킷 기본 5초는 외부 부하가 겹치면 넘길 수 있다(스위트 3개 동시 실행에서 최대 6.7초 실측). 훅 예산 10초보다 길어, 멈춘 훅은 10초에 건너뛰어진 뒤 단언에서 걸린다. */
const HOOK_TIMEOUT = { timeoutMs: 15_000 } as const

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

  test('/tk-handoff threshold·auto 인자 해석', () => {
    expect(parseHandoffArgs('threshold')).toEqual({ kind: 'threshold', value: null })
    expect(parseHandoffArgs('threshold 30')).toEqual({ kind: 'threshold', value: 30 })
    expect(parseHandoffArgs('threshold 0')).toBe('usage')
    expect(parseHandoffArgs('threshold abc')).toBe('usage')
    expect(parseHandoffArgs('auto')).toEqual({ kind: 'auto', value: null })
    expect(parseHandoffArgs('auto on')).toEqual({ kind: 'auto', value: true })
    expect(parseHandoffArgs('auto OFF')).toEqual({ kind: 'auto', value: false })
    expect(parseHandoffArgs('auto maybe')).toBe('usage')
    expect(parseHandoffArgs('auto on x')).toBe('usage')
    expect(parseHandoffArgs('show')).toBe('show')
  })

  test('toAutoLoad는 undefined·true를 켜짐, false만 꺼짐으로 본다', () => {
    expect(toAutoLoad(undefined)).toBe(true)
    expect(toAutoLoad(true)).toBe(true)
    expect(toAutoLoad(false)).toBe(false)
  })

  test('isAutoCandidate는 미소비·24시간 이내·대화 시작 이전 문서만 허용한다', () => {
    const N = 200_000_000
    const HOUR = 3_600_000
    const path = 'C:/proj/.claude/takgon/handoff/20261012-0805.md'
    const base = { path, summary: '요약', createdAt: N - HOUR }
    expect(isAutoCandidate(base, undefined, N, 0)).toBe(true)
    expect(isAutoCandidate(base, path, N, 0)).toBe(false)
    expect(isAutoCandidate({ ...base, createdAt: N - AUTO_LOAD_MAX_AGE_MS }, undefined, N, 0)).toBe(true)
    expect(isAutoCandidate({ ...base, createdAt: N - AUTO_LOAD_MAX_AGE_MS - 1 }, undefined, N, 0)).toBe(false)
    expect(isAutoCandidate({ ...base, createdAt: N + 1 }, undefined, N, 0)).toBe(false)
    expect(isAutoCandidate(base, undefined, N, N - 2 * HOUR)).toBe(false)
    expect(isAutoCandidate(base, undefined, N, N)).toBe(true)
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

  test('isHandoffPath는 프로젝트 handoff 폴더의 .md만 허용한다', () => {
    expect(isHandoffPath('C:/proj', 'C:/proj/.claude/takgon/handoff/20261012-0905.md')).toBe(true)
    expect(isHandoffPath('C:\\proj\\', 'c:\\PROJ\\.claude\\takgon\\handoff\\note.MD')).toBe(true)
    expect(isHandoffPath('C:/proj', 'C:/proj/.claude/takgon/handoff/../secret.md')).toBe(false)
    expect(isHandoffPath('C:/proj', 'C:/other/.claude/takgon/handoff/20261012-0905.md')).toBe(false)
    expect(isHandoffPath('C:/proj', 'C:/proj/.claude/takgon/handoff/note.txt')).toBe(false)
  })

  test('handoffContext는 출처와 동적 길이 펜스로 본문을 감싸고 앞뒤 공백을 trim한다', () => {
    const path = 'C:/proj/.claude/takgon/handoff/20261012-0905.md'
    const out = handoffContext(path, '  \n```markdown\n## 목표\n```\n  ')
    const lines = out.split('\n')
    expect(lines[0]).toContain(path)
    expect(lines[0]).toContain('/tk-handoff load')
    expect(lines[2]).toBe('````')
    expect(lines.at(-1)).toBe('````')
    expect(lines.slice(3, -1).join('\n')).toBe('```markdown\n## 목표\n```')

    const autoOut = handoffContext(path, '  \n```markdown\n## 목표\n```\n  ', true)
    const autoLines = autoOut.split('\n')
    expect(autoLines[0]).toContain(path)
    expect(autoLines[0]).toContain('automatically')
    expect(autoLines[0]).not.toContain('/tk-handoff load')
    expect(autoLines[2]).toBe('````')
    expect(autoLines.at(-1)).toBe('````')
    expect(autoLines.slice(3, -1).join('\n')).toBe('```markdown\n## 목표\n```')
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
  /** 값이 있으면 `model.fork`가 이 약속이 풀릴 때까지 기다린다(생성이 겹치는 상황을 만든다). */
  forkGate: { wait?: Promise<void>; started?: () => void }
  context: (readonly string[] | undefined)[]
  messages: SessionMessage[]
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
    forkGate: {},
    context: [],
    messages: [],
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('session.messages', () => ({ value: world.messages }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: world.percent.value }, rateLimits: [] },
  }))
  on('model.fork', async ($, e) => {
    world.forks.push(e.prompt)
    world.forkGate.started?.()
    await world.forkGate.wait
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

describe('생성 겹침', () => {
  const handoffFiles = (world: World): string[] =>
    [...world.files.keys()].filter(path => path.startsWith(`${DIR}/handoff/`))

  test('자동 생성 중에 /tk-handoff를 부르면 두 번째 문서를 만들지 않고 안내한다', HOOK_TIMEOUT, async ($, on) => {
    const world = engine(on)
    const started = new Promise<void>(resolve => { world.forkGate.started = resolve })
    let release!: () => void
    world.forkGate.wait = new Promise<void>(resolve => { release = resolve })
    const clock = mock.clock(on, { now: new Date(2026, 9, 12, 9, 5).getTime() })
    await $.session.start(START)

    world.percent.value = 80
    await $.turn.complete(TURN)
    const settling = clock.settle()
    await started

    const out = await $.command.run({ command: 'tk-handoff', args: '', ...RUN })
    expect(out.text).toContain('만드는 중')
    expect(world.forks).toHaveLength(1)

    release()
    await settling
    expect(handoffFiles(world)).toHaveLength(1)
  })

  test('/tk-handoff가 만드는 중이면 자동 생성은 겹쳐 돌지 않는다', HOOK_TIMEOUT, async ($, on) => {
    const world = engine(on)
    const started = new Promise<void>(resolve => { world.forkGate.started = resolve })
    let release!: () => void
    world.forkGate.wait = new Promise<void>(resolve => { release = resolve })
    const clock = mock.clock(on, { now: new Date(2026, 9, 12, 9, 5).getTime() })
    await $.session.start(START)

    const running = $.command.run({ command: 'tk-handoff', args: '', ...RUN })
    await started

    world.percent.value = 80
    await $.turn.complete(TURN)
    await clock.settle()
    expect(world.forks).toHaveLength(1)

    release()
    await running
    expect(handoffFiles(world)).toHaveLength(1)
  })
})

describe('자동 트리거', () => {
  test('75% 미만이면 만들지 않고, 이상이면 세션당 1회만 만든다', HOOK_TIMEOUT, async ($, on) => {
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

  test('모듈이 꺼져 있으면 아무것도 하지 않는다', HOOK_TIMEOUT, async ($, on) => {
    const world = engine(on, { 'g/core/modules': { handoff: false } })
    const clock = mock.clock(on)
    await $.session.start(START)
    world.percent.value = 90
    await $.turn.complete(TURN)
    await clock.settle()
    expect(world.forks).toHaveLength(0)
  })

  test('fork 실패는 자동이면 조용히, 수동이면 안내한다', HOOK_TIMEOUT, async ($, on) => {
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

  test('자동 fork가 실패하면 다음 답변 턴에 재시도하고, 3번 실패 뒤에는 멈춘다', HOOK_TIMEOUT, async ($, on) => {
    const world = engine(on)
    world.isForkOk.value = false
    const clock = mock.clock(on)
    await $.session.start(START)
    world.percent.value = 90

    for (let i = 0; i < 4; i += 1) {
      await $.turn.complete(TURN)
      await clock.settle()
    }

    expect(world.forks).toHaveLength(3)
  })
})

describe('임계치 설정', () => {
  test('/tk-handoff threshold로 바꾼 임계치에서 자동 생성하고, 인자 없이 부르면 현재 값을 보여준다', HOOK_TIMEOUT, async ($, on) => {
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
  test('같은 분에 두 번 만들면 -2 접미, show는 최신본을 보여준다', HOOK_TIMEOUT, async ($, on) => {
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

  test('load 후 다음 composer 프롬프트 1회에만 파일 내용을 context로 붙인다', HOOK_TIMEOUT, async ($, on) => {
    const world = engine(on)
    mock.clock(on)
    await $.session.start(START)
    await $.command.run({ command: 'tk-handoff', args: '', ...RUN })

    await $.command.run({ command: 'tk-handoff', args: 'load', ...RUN })
    const prompt = { wait: false, origin: { kind: 'composer' } } as const
    await $.prompt.submit({ text: '이어서', ...prompt })
    await $.prompt.submit({ text: '다음', ...prompt })

    expect(world.context[0]).toEqual([handoffContext(`${DIR}/handoff/${formatStamp(0)}.md`, '## 목표\n인수인계 본문')])
    expect(world.context[1] ?? []).toHaveLength(0)
  })

  test('새 세션은 store의 최신본 파일이 있으면 toast로 안내하고, 없으면 load가 안내한다', HOOK_TIMEOUT, async ($, on) => {
    const path = `${DIR}/handoff/20261011-1800.md`
    const latest = { path, summary: '요약', createdAt: 1 }
    // 수동 안내 경로를 시험한다(자동 첨부 끔).
    const world = engine(on, { 'p/b1a59c26/m7/latest': latest, 'g/m7/auto': false })
    world.files.set(path, '이전 문서')
    mock.clock(on)
    await $.session.start(START)
    expect(world.toasts.join('\n')).toContain('/tk-handoff load')
    expect(world.toasts.filter(text => text.includes('/tk-handoff load'))).toHaveLength(1)
    // 첫 프롬프트에서 안내가 다시 뜨지 않는다(시작 때 이미 안내함).
    await $.prompt.submit({ text: '이어서', wait: false, origin: { kind: 'composer' } })
    expect(world.toasts.filter(text => text.includes('/tk-handoff load'))).toHaveLength(1)

    world.files.delete(path)
    const out = await $.command.run({ command: 'tk-handoff', args: 'load', ...RUN })
    expect(out.text).toContain(path)
  })

  test('store에 프로젝트 밖 경로가 들어 있으면 /tk-handoff load가 missing으로 거부한다', HOOK_TIMEOUT, async ($, on) => {
    const outside = 'C:/other/secret.md'
    const world = engine(on, { 'p/b1a59c26/m7/latest': { path: outside, summary: '외부', createdAt: 1 } })
    world.files.set(outside, '민감 정보')
    mock.clock(on)
    await $.session.start(START)

    const out = await $.command.run({ command: 'tk-handoff', args: 'load', ...RUN })
    expect(out.text).toContain('찾을 수 없습니다')
    expect(out.text).toContain(outside)
    expect(world.toasts.join('\n')).not.toContain('/tk-handoff load')
  })
})

describe('/clear 뒤 복원', () => {
  test('state가 비어 있으면(session.start 없음) 첫 프롬프트에서 최신본을 다시 안내한다', HOOK_TIMEOUT, async ($, on) => {
    const path = `${DIR}/handoff/20261011-1800.md`
    // 수동 안내 경로를 시험한다(자동 첨부 끔).
    const world = engine(on, { 'p/b1a59c26/m7/latest': { path, summary: '요약', createdAt: 1 }, 'g/m7/auto': false })
    world.files.set(path, '이전 문서')
    mock.clock(on)

    await $.prompt.submit({ text: '이어서 작업', wait: false, origin: { kind: 'composer' } })

    expect(world.toasts.join('\n')).toContain('/tk-handoff load')
    expect(world.toasts.filter(text => text.includes('/tk-handoff load'))).toHaveLength(1)
  })
})

describe('빈 store 첫 사용', () => {
  test('읽기는 쓰지 않고, 임계치 설정과 첫 생성이 각자의 키를 만든다', HOOK_TIMEOUT, async ($, on) => {
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

describe('새 대화 자동 첨부', () => {
  const NOW = new Date(2026, 9, 12, 9, 5).getTime()
  const HOUR = 3_600_000
  const PATH = `${DIR}/handoff/20261012-0805.md`
  const LATEST = { path: PATH, summary: '요약', createdAt: NOW - HOUR }
  const BODY = '## 목표\n이전 작업'
  const PROMPT = { wait: false, origin: { kind: 'composer' } } as const

  test('기본 켜짐이면 첫 프롬프트에 1회 자동 첨부하고 consumed를 남긴다', HOOK_TIMEOUT, async ($, on) => {
    const sets: { key: string; value: unknown }[] = []
    const world = engine(on, { 'p/b1a59c26/m7/latest': LATEST }, sets)
    world.files.set(PATH, BODY)
    mock.clock(on, { now: NOW })
    await $.session.start(START)
    expect(world.toasts.join('\n')).not.toContain('/tk-handoff load')

    await $.prompt.submit({ text: '이어서', ...PROMPT })
    expect(world.context[0]).toEqual([handoffContext(PATH, BODY, true)])
    expect(world.toasts.join('\n')).toContain('자동으로 첨부')
    expect(world.toasts.join('\n')).not.toContain('/tk-handoff load')

    await $.prompt.submit({ text: '다음', ...PROMPT })
    expect(world.context[1] ?? []).toHaveLength(0)
    expect(sets.filter(one => one.key === 'p/b1a59c26/m7/consumed')).toEqual([
      { key: 'p/b1a59c26/m7/consumed', value: PATH },
    ])
  })

  test('session.start가 없어도(/clear 경로) 첫 프롬프트에 자동 첨부한다', HOOK_TIMEOUT, async ($, on) => {
    const world = engine(on, { 'p/b1a59c26/m7/latest': LATEST })
    world.files.set(PATH, BODY)
    mock.clock(on, { now: NOW })

    await $.prompt.submit({ text: '이어서', ...PROMPT })
    expect(world.context[0]).toEqual([handoffContext(PATH, BODY, true)])
    expect(world.toasts.filter(text => text.includes('자동으로 첨부'))).toHaveLength(1)
    expect(world.toasts.join('\n')).not.toContain('/tk-handoff load')
  })

  test('이미 consumed에 기록된 문서면 붙이지 않고 안내 toast도 띄우지 않는다', HOOK_TIMEOUT, async ($, on) => {
    const world = engine(on, { 'p/b1a59c26/m7/latest': LATEST, 'p/b1a59c26/m7/consumed': PATH })
    world.files.set(PATH, BODY)
    mock.clock(on, { now: NOW })
    await $.session.start(START)

    await $.prompt.submit({ text: '이어서', ...PROMPT })
    expect(world.context[0] ?? []).toHaveLength(0)
    expect(world.toasts.join('\n')).not.toContain('/tk-handoff load')
    expect(world.toasts.join('\n')).not.toContain('자동으로 첨부')
  })

  test('24시간이 지난 문서면 붙이지 않고 첫 프롬프트에 안내 toast를 1회 띄운다', HOOK_TIMEOUT, async ($, on) => {
    const expired = { path: PATH, summary: '요약', createdAt: NOW - 25 * HOUR }
    const world = engine(on, { 'p/b1a59c26/m7/latest': expired })
    world.files.set(PATH, BODY)
    mock.clock(on, { now: NOW })
    await $.session.start(START)
    expect(world.toasts.join('\n')).not.toContain('/tk-handoff load')

    await $.prompt.submit({ text: '이어서', ...PROMPT })
    expect(world.context[0] ?? []).toHaveLength(0)
    const available = world.toasts.filter(text => text.includes('/tk-handoff load'))
    expect(available).toHaveLength(1)

    await $.prompt.submit({ text: '다음', ...PROMPT })
    expect(world.toasts.filter(text => text.includes('/tk-handoff load'))).toHaveLength(1)
  })

  test('이미 assistant 응답이 있으면(/resume 경로) 붙이지 않고 첫 프롬프트에 안내 toast를 1회 띄운다', HOOK_TIMEOUT, async ($, on) => {
    const world = engine(on, { 'p/b1a59c26/m7/latest': LATEST })
    world.files.set(PATH, BODY)
    world.messages = [
      { role: 'user', text: '이전 질문', toolUses: [] },
      { role: 'assistant', text: '이전 응답', toolUses: [] },
    ]
    mock.clock(on, { now: NOW })
    await $.session.start(START)
    expect(world.toasts.join('\n')).not.toContain('/tk-handoff load')

    await $.prompt.submit({ text: '이어서', ...PROMPT })
    expect(world.context[0] ?? []).toHaveLength(0)
    expect(world.toasts.filter(text => text.includes('/tk-handoff load'))).toHaveLength(1)
  })

  test('문서 내용이 공백뿐이면 예약·첨부하지 않고 consumed도 쓰지 않는다', HOOK_TIMEOUT, async ($, on) => {
    const sets: { key: string; value: unknown }[] = []
    const world = engine(on, { 'p/b1a59c26/m7/latest': LATEST }, sets)
    world.files.set(PATH, '   \n\t  ')
    mock.clock(on, { now: NOW })
    await $.session.start(START)

    await $.prompt.submit({ text: '이어서', ...PROMPT })
    expect(world.context[0] ?? []).toHaveLength(0)
    expect(sets.filter(one => one.key === 'p/b1a59c26/m7/consumed')).toHaveLength(0)
  })

  test('병렬 세션: 대화 시작보다 늦게 만든 문서는 붙이지 않는다', HOOK_TIMEOUT, async ($, on) => {
    const world = engine(on, {
      'p/b1a59c26/m7/latest': LATEST,
      'g/core/modules': { integrations: false },
    })
    world.files.set(PATH, BODY)
    const clock = mock.clock(on, { now: NOW - 2 * HOUR })
    await $.session.start(START)
    await clock.set(NOW)

    await $.prompt.submit({ text: '이어서', ...PROMPT })
    expect(world.context[0] ?? []).toHaveLength(0)
    // 이번 대화가 시작된 뒤 만든 문서는 "이전" 문서가 아니므로 안내도 하지 않는다(기능 전에도 안내는 시작 시점에만 했다).
    expect(world.toasts.filter(text => text.includes('/tk-handoff load'))).toHaveLength(0)
  })

  test('/tk-handoff auto [on|off] 명령과 비활성 설정을 처리한다', HOOK_TIMEOUT, async ($, on) => {
    const sets: { key: string; value: unknown }[] = []
    const world = engine(on, { 'p/b1a59c26/m7/latest': LATEST }, sets)
    world.files.set(PATH, BODY)
    mock.clock(on, { now: NOW })
    await $.session.start(START)

    expect((await $.command.run({ command: 'tk-handoff', args: 'auto', ...RUN })).text).toContain('켜짐')
    expect(sets.filter(one => one.key === 'g/m7/auto')).toHaveLength(0)

    expect((await $.command.run({ command: 'tk-handoff', args: 'auto off', ...RUN })).text).toContain('꺼짐')
    expect(sets.filter(one => one.key === 'g/m7/auto')).toEqual([{ key: 'g/m7/auto', value: false }])

    await $.prompt.submit({ text: '이어서', ...PROMPT })
    expect(world.context[0] ?? []).toHaveLength(0)
    expect(world.toasts.filter(text => text.includes('/tk-handoff load'))).toHaveLength(1)

    expect((await $.command.run({ command: 'tk-handoff', args: 'auto on', ...RUN })).text).toContain('켜짐')
  })

  test('첫 제출이 로컬 명령이면 붙이지 않고 다음 일반 프롬프트에 붙인다', HOOK_TIMEOUT, async ($, on) => {
    const world = engine(on, { 'p/b1a59c26/m7/latest': LATEST })
    world.files.set(PATH, BODY)
    mock.clock(on, { now: NOW })
    await $.session.start(START)

    await $.prompt.submit({ text: '/mods', command: { name: 'mods', args: '' }, ...PROMPT })
    expect(world.context[0] ?? []).toHaveLength(0)

    await $.prompt.submit({ text: '이어서', ...PROMPT })
    expect(world.context[1]).toEqual([handoffContext(PATH, BODY, true)])
  })

  test('handoff 모듈이 꺼져 있으면 붙이지 않고 consumed도 쓰지 않는다', HOOK_TIMEOUT, async ($, on) => {
    const sets: { key: string; value: unknown }[] = []
    const world = engine(on, { 'p/b1a59c26/m7/latest': LATEST, 'g/core/modules': { handoff: false } }, sets)
    world.files.set(PATH, BODY)
    mock.clock(on, { now: NOW })
    await $.session.start(START)

    await $.prompt.submit({ text: '이어서', ...PROMPT })
    expect(world.context[0] ?? []).toHaveLength(0)
    expect(sets.filter(one => one.key === 'p/b1a59c26/m7/consumed')).toHaveLength(0)
    expect(world.toasts.join('\n')).not.toContain('/tk-handoff load')
  })

  test('첫 프롬프트 전에 /tk-handoff load를 했으면 수동 문구로 붙이고 자동 첨부 toast는 없다', HOOK_TIMEOUT, async ($, on) => {
    const world = engine(on, { 'p/b1a59c26/m7/latest': LATEST })
    world.files.set(PATH, BODY)
    mock.clock(on, { now: NOW })
    await $.session.start(START)

    await $.command.run({ command: 'tk-handoff', args: 'load', ...RUN })
    await $.prompt.submit({ text: '이어서', ...PROMPT })

    expect(world.context[0]).toEqual([handoffContext(PATH, BODY)])
    expect(world.toasts.join('\n')).not.toContain('자동으로 첨부')
    expect(world.toasts.join('\n')).not.toContain('/tk-handoff load')
  })

  test('잘못된 인자에는 auto [on|off]를 포함한 usage를 돌려준다', HOOK_TIMEOUT, async ($, on) => {
    engine(on)
    mock.clock(on, { now: NOW })
    await $.session.start(START)

    const out = await $.command.run({ command: 'tk-handoff', args: 'x', ...RUN })
    expect(out.text).toContain('auto [on|off]')
  })
})
