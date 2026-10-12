import type { AgentStatus, On, SessionMeasureInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { projectId } from '../src/shared/keys'
import {
  addPin,
  fit,
  parsePinArgs,
  applyAgentStatuses,
  startAgent,
  toSnapshot,
  usageAlerts,
  visible,
} from '../src/m6-panel/logic'

describe('M6 순수 로직', () => {
  test('/pin 인자 해석', () => {
    expect(parsePinArgs('')).toEqual({ kind: 'last' })
    expect(parsePinArgs(' list ')).toEqual({ kind: 'list' })
    expect(parsePinArgs('배포 전 확인')).toEqual({ kind: 'add', text: '배포 전 확인' })
  })

  test('핀은 최근 100개만, 에이전트는 id로 짝지어 최근 50개만 남긴다', () => {
    let pins = addPin([], { id: 'a', text: 'a', createdAt: 0 })
    for (let i = 0; i < 120; i += 1) {
      pins = addPin(pins, { id: `p${i}`, text: 't', createdAt: i })
    }
    expect(pins).toHaveLength(100)
    expect(pins[0]?.id).toBe('p20')

    let agents = startAgent([], 'x', 'Explore', 1)
    agents = applyAgentStatuses(agents, [{ id: 'x', type: 'Explore', status: 'completed' }], 5)
    expect(agents).toEqual([{ agentId: 'x', agentType: 'Explore', status: 'done', startedAt: 1, endedAt: 5 }])
    // 이미 끝난 기록의 종료 시각은 다시 덮지 않고, 목록에만 있는 에이전트(복원 전 시작)는 새로 더한다.
    agents = applyAgentStatuses(
      agents,
      [
        { id: 'x', type: 'Explore', status: 'completed' },
        { id: 'y', type: 'Plan', status: 'killed' },
        { id: 'z', type: 'Plan', status: 'waiting' },
      ],
      9,
    )
    expect(agents.map(one => [one.agentId, one.status, one.endedAt])).toEqual([
      ['x', 'done', 5],
      ['y', 'failed', 9],
      ['z', 'running', undefined],
    ])
    for (let i = 0; i < 60; i += 1) {
      agents = startAgent(agents, `a${i}`, 'Plan', i)
    }
    expect(agents).toHaveLength(50)
  })

  test('임계치 80% 이상만 경고하고, 줄 맞춤은 2칸 문자를 센다', () => {
    const snap = toSnapshot(
      {
        context: { tokens: 160_000, window: 200_000, percent: 80 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 79.9 },
          { kind: 'seven_day', percentUsed: 92 },
        ],
      },
      0,
    )
    expect(usageAlerts(snap).map(alert => alert.cause)).toEqual(['m6:context80', 'm6:rate80:seven_day'])
    expect(fit('가나다라마', 6)).toBe('가나…')
    expect(fit('abc', 6)).toBe('abc')
    expect(visible([1, 2, 3, 4], 3)).toEqual({ shown: [1, 2], hidden: 2 })
  })
})

const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const
const PID = projectId('C:/proj')
const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  title: '작업 패널',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

/** 엔진 자리: 세션 시작, 루트, pane 열기·닫기, toast 기록, 측정 응답. */
const engine = (on: On, toasts: string[] = [], opened: string[] = []): void => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: 'C:/proj' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    opened.push(`close:${e.id}`)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  mock.clock(on)
}

const run = (command: string, args = '') => ({
  command,
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
}) as const

describe('M6 명령·패널', () => {
  test('/panel은 takgon-panel pane을 열고, close는 닫는다', async ($, on) => {
    const opened: string[] = []
    engine(on, [], opened)
    mock.store(on)
    await $.session.start(START)

    await $.command.run(run('panel'))
    await $.command.run(run('panel', 'close'))

    expect(opened).toEqual(['takgon-panel', 'close:takgon-panel'])
  })

  test('탭 버튼으로 탭을 바꾼다(terminal·desktop)', async ($, on) => {
    engine(on)
    mock.store(on)
    await $.session.start(START)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'takgon-mods', surface, component: 'Pane', props: PANE, requestId: 'takgon-panel' })
      await ui.press({ key: 'tab-pinboard' })
      expect(await ui.find({ type: 'Text', text: /핀이 없습니다/ })).toBeDefined()
      await ui.press({ key: 'tab-usage' })
      expect(await ui.find({ type: 'Text', text: /사용량 측정값이 없습니다/ })).toBeDefined()
      await ui.press({ key: 'tab-handoff' })
      expect(await ui.find({ type: 'Text', text: /인수인계 문서가 없습니다/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('/pin <내용>과 /pin(직전 응답)으로 핀을 추가하고, 패널에서 삭제한다', async ($, on) => {
    engine(on)
    on('session.messages', () => ({
      value: [
        { role: 'user', text: '질문', toolUses: [] },
        { role: 'assistant', text: '첫 답', toolUses: [] },
        { role: 'assistant', text: '마지막 답변', toolUses: [] },
        { role: 'user', text: '다음 질문', toolUses: [] },
      ],
    }))
    mock.store(on)
    await $.session.start(START)

    expect((await $.command.run(run('pin', '배포 전 확인'))).text).toContain('배포 전 확인')
    expect((await $.command.run(run('pin'))).text).toContain('마지막 답변')
    const listed = (await $.command.run(run('pin', 'list'))).text ?? ''
    expect(listed).toContain('배포 전 확인')
    expect(listed).toContain('마지막 답변')

    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'terminal', component: 'Pane', props: PANE, requestId: 'takgon-panel' })
    await ui.press({ key: 'tab-pinboard' })
    const removes = (await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('unpin-'))
    expect(removes).toHaveLength(2)
    // 최신 핀이 위에 온다: 두 번째(아래) 버튼이 먼저 추가한 '배포 전 확인'.
    await ui.press({ key: removes[1]?.key ?? '' })

    expect(await ui.find({ type: 'Text', text: /배포 전 확인/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /마지막 답변/ })).toBeDefined()
    expect((await $.command.run(run('pin', 'list'))).text).not.toContain('배포 전 확인')
  })

  test('/pin은 직전 응답이 없으면 안내만 한다', async ($, on) => {
    engine(on)
    on('session.messages', () => ({ value: [{ role: 'user', text: '질문', toolUses: [] }] }))
    mock.store(on)
    await $.session.start(START)

    expect((await $.command.run(run('pin'))).text).toContain('직전 응답이 없습니다')
  })

  test('할 일 체크 토글은 m4 tasks 키에 저장돼 복원 후에도 유지된다', async ($, on) => {
    engine(on)
    mock.store(on, {
      [`p/${PID}/m4/tasks`]: [
        { id: 't1', text: '테스트 보강', kind: 'checkbox', isDone: false, createdAt: 1 },
      ],
    })
    await $.session.start(START)

    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'desktop', component: 'Pane', props: PANE, requestId: 'takgon-panel' })
    await ui.press({ key: 'tab-tasks' })
    expect((await ui.find({ key: 'task-t1' }))?.text).toContain('[ ]')
    await ui.press({ key: 'task-t1' })
    expect((await ui.find({ key: 'task-t1' }))?.text).toContain('[x]')
  })

  test('agent.spawn으로 시작을, $.agent.list()로 완료·실패를 Agents 탭에 기록한다', async ($, on) => {
    engine(on)
    mock.store(on)
    const infos: Array<{ id: string; type: string; status: AgentStatus }> = []
    on('agent.spawn', ($, e) => ({ model: 'haiku', agentId: e.description }))
    on('agent.list', () => ({
      value: infos.map(one => ({ ...one, description: one.type })),
    }))
    await $.session.start(START)

    const spawn = (agentId: string, subagentType: string) =>
      $.agent.spawn({
        tool_use_id: `tu-${agentId}`,
        prompt: 'p',
        description: agentId,
        subagentType,
        provider: { plugin: 'engine', tier: 'core' },
        parentModel: 'opus',
        background: false,
        fork: false,
      })
    await spawn('ag-1', 'Explore')
    await spawn('ag-2', 'Plan')
    await spawn('ag-3', 'Plan')
    infos.push(
      { id: 'ag-1', type: 'Explore', status: 'completed' },
      { id: 'ag-2', type: 'Plan', status: 'running' },
      { id: 'ag-3', type: 'Plan', status: 'failed' },
    )
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: [] })

    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'terminal', component: 'Pane', props: PANE, requestId: 'takgon-panel' })
    await ui.press({ key: 'tab-agents' })
    expect((await ui.find({ type: 'Text', text: /Explore/ }))?.text).toContain('완료')
    expect((await ui.findAll({ type: 'Text', text: /Plan/ })).map(one => one.text).join('|')).toMatch(
      /실행 중.*실패|실패.*실행 중/,
    )
  })

  test('/clear 뒤처럼 state가 비어 있으면 첫 명령에서 store의 핀을 복원한다', async ($, on) => {
    engine(on)
    const pid = projectId('C:/proj')
    mock.store(on, { [`p/${pid}/m6/pins`]: [{ id: 'p1', text: '저장된 결정', createdAt: 1 }] })

    // session.start 없이(= /clear 직후) 바로 명령을 실행한다.
    const listed = await $.command.run(run('pin', 'list'))

    expect(listed.text).toContain('저장된 결정')
  })

  test('session.measure에서 컨텍스트 80% 이상이면 세션당 1회만 toast하고 Usage 탭에 표시한다', async ($, on) => {
    const toasts: string[] = []
    engine(on, toasts)
    mock.store(on)
    await $.session.start(START)

    const reading: SessionMeasureInput = {
      context: { tokens: 170_000, window: 200_000, percent: 85 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 40 }],
      cost: { usd: 1.234 },
      changed: ['context', 'rateLimits', 'cost'],
    }
    await $.session.measure(reading)
    await $.session.measure({ ...reading, context: { tokens: 180_000, window: 200_000, percent: 90 }, changed: ['context'] })

    expect(toasts.filter(text => text.includes('컨텍스트'))).toHaveLength(1)
    expect(toasts).toHaveLength(1)

    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'terminal', component: 'Pane', props: PANE, requestId: 'takgon-panel' })
    await ui.press({ key: 'tab-usage' })
    expect((await ui.find({ type: 'Text', text: /컨텍스트/ }))?.text).toContain('90%')
    expect(await ui.find({ type: 'Text', text: /five_hour: 40%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.23/ })).toBeDefined()
  })

  test('panel 모듈이 꺼지면 명령은 안내만 하고 pane을 열지 않는다', async ($, on) => {
    const opened: string[] = []
    engine(on, [], opened)
    mock.store(on, { 'g/core/modules': { panel: false } })
    await $.session.start(START)

    expect((await $.command.run(run('panel'))).text).toContain('꺼져')
    expect(opened).toEqual([])
  })
})
