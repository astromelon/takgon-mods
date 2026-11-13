import type { On, SessionMessage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { TaskItem } from '../types'
import { toTasks, toggleTask } from '../src/shared/tasks'
import { fit } from '../src/shared/text'
import {
  formatPrBadge,
  hadToolUseThisTurn,
  mergeTasks,
  needsCoach,
  parseCoachArgs,
  parseCoachReply,
  parseNextSteps,
  shouldFork,
} from '../src/m4-composer/logic'

const task = (id: string, text: string, isDone = false, createdAt = 0): TaskItem => ({
  id,
  text,
  kind: 'checkbox',
  isDone,
  createdAt,
})

describe('composer 순수 로직', () => {
  test('PR 배지는 리뷰·체크 상태를 짧게, 비어 있는 상태는 생략한다', () => {
    const pr = { number: 12, url: 'u', reviewDecision: 'APPROVED', checks: 'failure' } as const
    expect(formatPrBadge('ko', pr)).toBe('PR #12 · 승인됨 · 체크 실패')
    expect(formatPrBadge('en', { ...pr, reviewDecision: '', checks: 'none' })).toBe('PR #12')
    expect(formatPrBadge('ko', { ...pr, reviewDecision: 'WEIRD', checks: 'pending' })).toBe(
      'PR #12 · 체크 진행 중',
    )
  })

  test('fork 응답은 코드펜스·문자열·객체 형식을 받아 최대 3개로 파싱하고 실패는 빈 목록', () => {
    const text = '제안:\n```json\n[{"text":"테스트 추가","kind":"checkbox"},"README 갱신",' +
      '{"text":"PR 올리기","kind":"pr"},{"text":"넷째"}]\n```'
    expect(parseNextSteps(text)).toEqual([
      { text: '테스트 추가', kind: 'checkbox' },
      { text: 'README 갱신', kind: 'checkbox' },
      { text: 'PR 올리기', kind: 'pr' },
    ])
    expect(parseNextSteps('없음')).toEqual([])
    expect(parseNextSteps('[oops')).toEqual([])
    expect(parseNextSteps('{"a":1}')).toEqual([])
    expect(parseNextSteps('[{"text":"  "}, 3, {"text":"x","kind":"bogus"}]')).toEqual([
      { text: 'x', kind: 'checkbox' },
    ])
    expect(parseNextSteps('[{"text":"a\\nb\\u0007c"}]')).toEqual([{ text: 'a b c', kind: 'checkbox' }])
  })

  test('병합은 같은 text(공백·대소문자 무시)를 빼고, 미완료 우선 최근 20개만 남긴다', () => {
    const existing = [task('a', 'Run tests'), task('b', '끝난 일', true, 5)]
    const merged = mergeTasks(existing, [{ text: 'run  TESTS', kind: 'checkbox' }, { text: '새 일', kind: 'issue' }], 100)
    expect(merged.map(t => t.text)).toEqual(['새 일', 'Run tests', '끝난 일'])
    expect(merged[0]).toMatchObject({ kind: 'issue', isDone: false, createdAt: 100 })

    const many = Array.from({ length: 25 }, (_, i) => task(`d${i}`, `done ${i}`, true, i))
    const capped = mergeTasks(many, [{ text: 'fresh', kind: 'checkbox' }], 1000)
    expect(capped).toHaveLength(20)
    expect(capped[0]?.text).toBe('fresh')
    expect(capped[1]?.text).toBe('done 24')
  })

  test('store 값 검증·토글·폭 맞춤', () => {
    expect(toTasks([task('a', 'x'), { id: 1 }, null])).toEqual([task('a', 'x')])
    expect(toTasks('nope')).toEqual([])
    expect(toggleTask([task('a', 'x'), task('b', 'y')], 'b')[1]?.isDone).toBe(true)
    expect(fit('abcdef', 4)).toBe('abc…')
    expect(fit('가나다라', 5)).toBe('가나…')
    expect(fit('short', 10)).toBe('short')
  })

  test('이번 턴 도구 사용과 fork 간격 판정', () => {
    const user = { role: 'user', text: 'go', toolUses: [] } as const
    const toolCall = { role: 'assistant', text: '', toolUses: [{ id: 'x' }] } as const
    const toolResult = { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'x' }] } as const
    const answer = { role: 'assistant', text: 'done', toolUses: [] } as const
    expect(hadToolUseThisTurn([user, toolCall, toolResult, answer])).toBe(true)
    expect(hadToolUseThisTurn([user, toolCall, toolResult, answer, user, answer])).toBe(false)
    expect(hadToolUseThisTurn([])).toBe(false)

    expect(shouldFork(true, undefined, 0)).toBe(true)
    expect(shouldFork(false, undefined, 0)).toBe(false)
    expect(shouldFork(true, 0, 119_999)).toBe(false)
    expect(shouldFork(true, 0, 120_000)).toBe(true)
  })

  test('코치 휴리스틱: 짧고 모호한 요청만 모델에 묻는다', () => {
    expect(needsCoach('고쳐줘')).toBe(true)
    expect(needsCoach('make it better')).toBe(true)
    expect(needsCoach('/compact')).toBe(false)
    expect(needsCoach('네')).toBe(false)
    expect(needsCoach('continue')).toBe(false)
    expect(needsCoach('src/app.ts 고쳐줘')).toBe(false)
    expect(needsCoach('fix parseArgs')).toBe(false)
    expect(needsCoach('user_id 버그')).toBe(false)
    expect(needsCoach('`npm test` 실패')).toBe(false)
    expect(needsCoach('https://x.dev 확인')).toBe(false)
    expect(needsCoach('a'.repeat(81))).toBe(false)
    expect(needsCoach('   ')).toBe(false)
  })

  test('코치 응답 파싱과 /coach 인자', () => {
    expect(parseCoachReply('```json\n{"ambiguous":true,"refined":" X 고치기 "}\n```')).toEqual({
      ambiguous: true,
      refined: 'X 고치기',
    })
    expect(parseCoachReply('{"ambiguous":"yes"}')).toBeNull()
    expect(parseCoachReply('nope')).toBeNull()
    expect(parseCoachArgs('')).toEqual({ kind: 'show' })
    expect(parseCoachArgs(' OFF ')).toEqual({ kind: 'set', isOn: false })
    expect(parseCoachArgs('maybe')).toEqual({ kind: 'usage' })
  })
})

const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const
const TASKS_KEY = 'p/b1a59c26/m4/tasks'
const SURFACES = ['terminal', 'desktop'] as const
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const TURN = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const BAND = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 60,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}
const COMPOSER = { wait: false, origin: { kind: 'composer' } } as const

type World = {
  submitted: { text: string; origin: string; asUser?: boolean }[]
  forks: string[]
  completes: number
  asks: { question: string; options: readonly string[] }[]
  messages: SessionMessage[]
}

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

/** 엔진 자리: 세션·루트·fork·complete·ask·프롬프트 바닥을 메모리로 답한다. */
const engine = (
  on: On,
  store: Record<string, unknown> = {},
  isForkOk = true,
  sets?: { key: string; value: unknown }[],
): World => {
  const world: World = { submitted: [], forks: [], completes: 0, asks: [], messages: [] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: 'C:/proj' }))
  on('session.messages', () => ({ value: world.messages }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('model.fork', ($, e) => {
    world.forks.push(e.prompt)
    if (!isForkOk) {
      return { value: { isAnswered: false, reason: 'nothing-to-fork' } }
    }
    const text = '[{"text":"테스트 추가","kind":"checkbox"},{"text":"Run tests"}]'
    return { value: { isAnswered: true, text, usage: ZERO } }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => {
    world.submitted.push({
      text: e.text,
      origin: e.origin.kind,
      asUser: e.origin.kind === 'plugin' ? e.origin.asUser : undefined,
    })
    return { text: e.text }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-band</Text>
  })
  if (sets === undefined) {
    mock.store(on, store)
  } else {
    recordingStore(on, sets, store)
  }
  return world
}

/** 코치 응답과 ask 답을 정한다. */
const coach = (on: On, world: World, reply: string, answer: string | null): void => {
  on('model.complete', () => {
    world.completes += 1
    return { value: { isAnswered: true, text: reply, usage: ZERO } }
  })
  // $.ui.ask는 AskUserQuestion 도구 호출로 엔진에 내려온다.
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const [one] = e.questions
    const question = one?.question ?? ''
    world.asks.push({ question, options: one?.options.map(o => o.label) ?? [] })
    if (answer === null) {
      return { deny: 'dismissed' }
    }
    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })
}

const TOOL_TURN: SessionMessage[] = [
  { role: 'user', text: 'go', toolUses: [] },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'x', tool: 'Bash', input: {} }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'x', text: 'ok', isError: false, result: 'ok' }] },
  { role: 'assistant', text: 'done', toolUses: [] },
]

/** 그려진 트리 노드 중 판정에 쓰는 부분. */
type DrawnNode = { text?: string; part?: { plugin?: string }; children?: readonly unknown[] }

/** 트리에서 takgon-mods가 그린 부분(`part.plugin`)을 찾는다. 부분 표시가 없는 엔진이면 트리 자체. */
const ownPart = (node: unknown): DrawnNode | undefined => {
  const root = node as DrawnNode | undefined
  const visit = (one: DrawnNode | null | undefined): DrawnNode | undefined => {
    if (one === null || one === undefined || typeof one !== 'object') {
      return undefined
    }
    if (one.part?.plugin === 'takgon-mods') {
      return one
    }
    for (const child of one.children ?? []) {
      const found = visit(child as DrawnNode)
      if (found !== undefined) {
        return found
      }
    }
    return undefined
  }
  return visit(root) ?? root
}

/** 노드 아래 글자를 이어 붙인다(`find` 결과가 아닌 하위 노드에는 `text`가 없다). */
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  const one = node as DrawnNode | null | undefined
  return (one?.children ?? []).map(textOf).join('')
}

describe('AbovePrompt band', () => {
  test('표시할 것이 없거나 설문 중이면 엔진 band를 그린다', async ($, on) => {
    engine(on, { [TASKS_KEY]: [{ id: 'a', text: '할 일', kind: 'checkbox', isDone: false, createdAt: 1 }] })
    await $.session.start(START)
    for (const surface of SURFACES) {
      const survey = await $.ui.mount({
        plugin: 'takgon-mods', surface, component: 'AbovePrompt', props: { ...BAND, hasSurvey: true },
      })
      expect(await survey.find({ text: 'engine-band' })).toBeDefined()
    }
  })

  test('비어 있으면 next', async ($, on) => {
    engine(on)
    await $.session.start(START)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'takgon-mods', surface, component: 'AbovePrompt', props: BAND })
      expect(await ui.find({ text: 'engine-band' })).toBeDefined()
    }
  })

  test('PR 배지를 표시한다', async ($, on) => {
    engine(on)
    // M5가 채우는 pr state를 엔진 자리에서 답한다.
    const pr = { number: 12, url: 'u', reviewDecision: 'APPROVED', checks: 'failure' }
    // 세션 시작 뒤 읽기에만 답한다. 시작 중에도 답하면 M5의 `update(pr)`가 매번 "다른 쓰기가 끼었다"로 보고 재시도 상한에서
    // 실패해(2.1.323의 update 버전 비교) session.start 훅이 실패하고, 같은 플러그인의 뒤쪽 초기화가 건너뛰어진다.
    let isStarted = false
    on('state.get', ($, e, next) => (isStarted && e.key === 'pr' ? { value: { value: pr, version: 1 } } : next(e)))
    await $.session.start(START)
    isStarted = true
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'takgon-mods', surface, component: 'AbovePrompt', props: BAND })
      expect((await ui.find({ key: 'pr-badge' }))?.text).toBe('PR #12 · 승인됨 · 체크 실패')
      // 배지를 그리면 next(엔진 band)를 부르지 않는다: takgon-mods 부분에 engine-band가 없어야 한다.
      // 2.1.323부터 테스트 킷은 테스트의 ui.render 훅을 별도 부분(`part.plugin: 'test'`)으로 band에 나란히 두므로
      // 트리 전체가 아니라 takgon-mods 부분만 본다(2.1.296은 부분 표시가 없어 트리 전체가 곧 플러그인 부분).
      expect(textOf(ownPart(await ui.find({ type: 'Box' })))).toBe('PR #12 · 승인됨 · 체크 실패')
    }
  })

  test('미완료 최대 3개를 그리고, 텍스트는 제출·체크는 토글 후 저장한다', async ($, on) => {
    const stored = [1, 2, 3, 4].map(i => ({ id: `t${i}`, text: `작업 ${i}`, kind: 'checkbox', isDone: false, createdAt: i }))
    const world = engine(on, { [TASKS_KEY]: stored })
    await $.session.start(START)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'takgon-mods', surface, component: 'AbovePrompt', props: BAND })
      const buttons = await ui.findAll({ type: 'Button' })
      expect(buttons.filter(b => b.key?.startsWith('task-'))).toHaveLength(3)
      await ui.unmount()
    }

    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await ui.press({ key: 'task-t2' })
    expect(world.submitted).toEqual([{ text: '작업 2', origin: 'plugin', asUser: undefined }])

    await ui.press({ key: 'check-t4' })
    expect(await ui.find({ key: 'task-t4' })).toBeUndefined()
    expect(await ui.find({ key: 'task-t1' })).toBeDefined()
  })

  test('할 일 토글 시 다른 세션이 store에 추가한 할 일이 유실되지 않는다', async ($, on) => {
    const data = new Map<string, unknown>([
      [TASKS_KEY, [task('t1', '기존 일', false, 1)]],
    ])
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: 'C:/proj' }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine-band</Text>
    })
    on('store.get', ($, e) => ({ value: data.get(e.key) }))
    on('store.set', ($, e) => {
      data.set(e.key, e.value)
      return { value: undefined }
    })
    on('store.delete', ($, e) => {
      data.delete(e.key)
      return { value: undefined }
    })
    on('store.keys', () => ({ value: [...data.keys()] }))
    await $.session.start(START)

    data.set(TASKS_KEY, [task('t1', '기존 일', false, 1), task('ext', '외부 할 일', false, 2)])
    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await ui.press({ key: 'check-t1' })

    const saved = data.get(TASKS_KEY) as TaskItem[]
    expect(saved.find(one => one.id === 't1')?.isDone).toBe(true)
    expect(saved.find(one => one.id === 'ext')?.text).toBe('외부 할 일')
  })
})

describe('/clear 뒤 복원', () => {
  test('state가 비어 있으면(session.start 없음) 첫 명령에서 store의 task를 복원한다', async ($, on) => {
    engine(on, { [TASKS_KEY]: [{ id: 'k1', text: '저장된 할 일', kind: 'checkbox', isDone: false, createdAt: 1 }] })
    mock.clock(on)

    await $.command.run({
      command: 'coach',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })

    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect((await ui.find({ key: 'task-k1' }))?.text).toContain('저장된 할 일')
  })
})

describe('Next-steps', () => {
  test('도구를 쓴 턴에만 fork하고 2분 간격을 지키며, 결과는 중복 없이 band에 보인다', async ($, on) => {
    const world = engine(on, { [TASKS_KEY]: [{ id: 'a', text: 'Run tests', kind: 'checkbox', isDone: false, createdAt: 1 }] })
    const clock = mock.clock(on, { now: 1_000_000 })
    await $.session.start(START)

    world.messages = [{ role: 'user', text: 'hi', toolUses: [] }, { role: 'assistant', text: 'hello', toolUses: [] }]
    await $.turn.complete(TURN)
    await clock.settle()
    expect(world.forks).toHaveLength(0)

    world.messages = TOOL_TURN
    await $.turn.complete(TURN)
    // fork는 타이머로 떼어 내므로 turn.complete는 fork를 기다리지 않고 돌아온다.
    expect(world.forks).toHaveLength(0)
    await clock.settle()
    expect(world.forks).toHaveLength(1)
    expect(world.forks[0]).toContain('Run tests')

    await clock.advance(60_000)
    await $.turn.complete(TURN)
    await clock.settle()
    expect(world.forks).toHaveLength(1)

    await clock.advance(60_000)
    await $.turn.complete(TURN)
    await clock.settle()
    expect(world.forks).toHaveLength(2)

    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    const labels = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('task-')).map(b => b.text)
    expect(labels).toEqual(['테스트 추가', 'Run tests'])
  })

  test('nothing-to-fork·모듈 off는 조용히 무시한다', async ($, on) => {
    const world = engine(on, { 'g/core/modules': { composer: false } })
    mock.clock(on)
    await $.session.start(START)
    world.messages = TOOL_TURN
    const out = await $.turn.complete(TURN)
    expect(out.text).toBe('ok')
    expect(world.forks).toHaveLength(0)
  })

  test('fork 실패면 task를 추가하지 않는다', async ($, on) => {
    const world = engine(on, {}, false)
    const clock = mock.clock(on)
    await $.session.start(START)
    world.messages = TOOL_TURN
    expect((await $.turn.complete(TURN)).text).toBe('ok')
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ text: 'engine-band' })).toBeDefined()
  })
})

describe('Prompt-coach', () => {
  const AMBIGUOUS = '{"ambiguous":true,"refined":"src/app.ts의 로그인 버그를 고쳐줘"}'

  test('원문 그대로를 고르면 원문이 들어간다', async ($, on) => {
    const world = engine(on)
    coach(on, world, AMBIGUOUS, '원문 그대로')
    await $.session.start(START)
    const out = await $.prompt.submit({ text: '고쳐줘', ...COMPOSER })
    expect(out.text).toBe('고쳐줘')
    expect(world.asks[0]?.options).toEqual(['원문 그대로', '다듬은 버전', '취소'])
    expect(world.asks[0]?.question).toContain('로그인 버그')
  })

  test('다듬은 버전을 고르면 refined로 바꿔 넘긴다', async ($, on) => {
    const world = engine(on)
    coach(on, world, AMBIGUOUS, '다듬은 버전')
    await $.session.start(START)
    const out = await $.prompt.submit({ text: '고쳐줘', ...COMPOSER })
    expect(out.text).toBe('src/app.ts의 로그인 버그를 고쳐줘')
    expect(world.submitted.at(-1)?.text).toBe('src/app.ts의 로그인 버그를 고쳐줘')
  })

  test('취소를 고르면 drop한다', async ($, on) => {
    const world = engine(on)
    coach(on, world, AMBIGUOUS, '취소')
    await $.session.start(START)
    const out = await $.prompt.submit({ text: '고쳐줘', ...COMPOSER })
    expect(out.drop).toBe('프롬프트 전송을 취소했습니다.')
    expect(world.submitted).toHaveLength(0)
  })

  test('ask가 reject하면 원문 통과', async ($, on) => {
    const world = engine(on)
    coach(on, world, AMBIGUOUS, null)
    await $.session.start(START)
    const out = await $.prompt.submit({ text: '고쳐줘', ...COMPOSER })
    expect(out.text).toBe('고쳐줘')
  })

  test('명확·구체적·파싱 실패·코치 off면 묻지 않는다', async ($, on) => {
    const world = engine(on)
    coach(on, world, 'not json', '취소')
    await $.session.start(START)

    expect((await $.prompt.submit({ text: 'src/app.ts 고쳐줘', ...COMPOSER })).text).toBe('src/app.ts 고쳐줘')
    expect(world.completes).toBe(0)

    expect((await $.prompt.submit({ text: '고쳐줘', ...COMPOSER })).text).toBe('고쳐줘')
    expect(world.completes).toBe(1)
    expect(world.asks).toHaveLength(0)

    const off = await $.command.run({ command: 'coach', args: 'off', ...RUN })
    expect(off.text).toContain('꺼짐')
    expect((await $.prompt.submit({ text: '고쳐줘', ...COMPOSER })).text).toBe('고쳐줘')
    expect(world.completes).toBe(1)

    const state = await $.command.run({ command: 'coach', args: '', ...RUN })
    expect(state.text).toBe('프롬프트 코치: 꺼짐')
  })
})

describe('빈 store 첫 사용', () => {
  test('읽기는 쓰지 않고, 코치 설정과 첫 Next-steps가 각자의 키를 만든다', async ($, on) => {
    const sets: { key: string; value: unknown }[] = []
    const world = engine(on, {}, true, sets)
    const clock = mock.clock(on, { now: 1_000_000 })
    await $.session.start(START)

    expect((await $.command.run({ command: 'coach', args: '', ...RUN })).text).toContain('켜짐')
    expect(sets.filter(one => one.key === 'g/m4/coach' || one.key === TASKS_KEY)).toHaveLength(0)

    await $.command.run({ command: 'coach', args: 'off', ...RUN })
    expect(sets.filter(one => one.key === 'g/m4/coach')).toEqual([{ key: 'g/m4/coach', value: false }])

    world.messages = TOOL_TURN
    await $.turn.complete(TURN)
    await clock.settle()

    const saved = sets.filter(one => one.key === TASKS_KEY)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.value).toMatchObject([{ text: '테스트 추가' }, { text: 'Run tests' }])
  })
})
