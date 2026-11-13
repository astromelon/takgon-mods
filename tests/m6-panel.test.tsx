import type { AgentStatus, On, SessionMeasureInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { GateView } from '../types'
import { globalKey, projectId } from '../src/shared/keys'
import { fit } from '../src/shared/text'
import {
  GATE_COMMAND_MAX,
  MAX_PIN_TEXT,
  SYNC_SHOWN,
  TABS,
  addPin,
  gatePaths,
  mergeGateRecords,
  parseGateLog,
  parsePanelArgs,
  parsePinArgs,
  parseSyncEvents,
  applyAgentStatuses,
  shortTs,
  startAgent,
  syncFailuresToNotify,
  toPins,
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
  })

  test('핀 텍스트는 MAX_PIN_TEXT자로 자르고, 저장된 긴 핀도 복원할 때 자른다', () => {
    const long = 'x'.repeat(MAX_PIN_TEXT + 500)
    expect(addPin([], { id: 'a', text: long, createdAt: 0 })[0]?.text).toHaveLength(MAX_PIN_TEXT)
    expect(toPins([{ id: 'a', text: long, createdAt: 1 }])[0]?.text).toHaveLength(MAX_PIN_TEXT)

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
    // 임계치를 낮추면 79.9%도 경고하고, 높이면 92%만 경고한다.
    expect(usageAlerts(snap, 50).map(alert => alert.cause)).toEqual([
      'm6:context80',
      'm6:rate80:five_hour',
      'm6:rate80:seven_day',
    ])
    expect(usageAlerts(snap, 90).map(alert => alert.cause)).toEqual(['m6:rate80:seven_day'])
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

describe('/panel 인자(순수)', () => {
  test('탭 이름을 주면 그 탭으로 연다', () => {
    expect(parsePanelArgs('')).toBe('open')
    expect(parsePanelArgs('close')).toBe('close')
    expect(parsePanelArgs(' Agents ')).toBe('agents')
    expect(parsePanelArgs('usage')).toBe('usage')
    expect(parsePanelArgs('help')).toBe('help')
    expect(parsePanelArgs('nope')).toBe('help')
    expect(parsePanelArgs('threshold')).toEqual({ kind: 'threshold', value: null })
    expect(parsePanelArgs('threshold 60')).toEqual({ kind: 'threshold', value: 60 })
    expect(parsePanelArgs('threshold 0')).toBe('help')
    expect(parsePanelArgs('threshold 60 70')).toBe('help')
  })
})

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
      expect(await ui.find({ type: 'Text', text: /경고 임계치: 80%/ })).toBeDefined()
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

  test('/pin을 동시에 여러 번 불러도 핀이 유실되지 않는다', async ($, on) => {
    engine(on)
    mock.store(on)
    await $.session.start(START)

    await Promise.all(['가', '나', '다', '라'].map(text => $.command.run(run('pin', text))))
    const listed = (await $.command.run(run('pin', 'list'))).text ?? ''
    for (const text of ['가', '나', '다', '라']) {
      expect(listed).toContain(text)
    }
  })

  test('세션 시작 뒤 다른 세션이 store에 추가한 핀이 /pin 실행 후에도 남는다', async ($, on) => {
    engine(on)
    const key = `p/${PID}/m6/pins`
    const data = new Map<string, unknown>([
      [key, [{ id: 'p0', text: '기존 핀', createdAt: 1 }]],
    ])
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

    data.set(key, [
      { id: 'p0', text: '기존 핀', createdAt: 1 },
      { id: 'other', text: '다른 세션 핀', createdAt: 2 },
    ])
    await $.command.run(run('pin', '새 핀'))

    const saved = data.get(key) as Array<{ text: string }>
    expect(saved.map(one => one.text)).toEqual(['기존 핀', '다른 세션 핀', '새 핀'])
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

  test('/panel agents는 Agents 탭으로 열고, 탭 버튼에는 숫자 단축키가 있다', async ($, on) => {
    engine(on)
    mock.store(on)
    await $.session.start(START)

    await $.command.run(run('panel', 'agents'))

    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'terminal', component: 'Pane', props: PANE, requestId: 'takgon-panel' })
    expect((await ui.find({ key: 'tab-agents' }))?.props).toMatchObject({ variant: 'primary', hotkey: '3' })
    expect((await ui.find({ key: 'tab-pinboard' }))?.props).toMatchObject({ variant: 'secondary', hotkey: '1' })
  })

  test('/clear 뒤처럼 state가 비어 있으면 첫 명령에서 store의 핀·임계치를 복원한다', async ($, on) => {
    engine(on)
    const pid = projectId('C:/proj')
    mock.store(on, {
      [`p/${pid}/m6/pins`]: [{ id: 'p1', text: '저장된 결정', createdAt: 1 }],
      'g/m6/threshold': 65,
    })

    // session.start 없이(= /clear 직후) 바로 명령을 실행한다.
    const listed = await $.command.run(run('pin', 'list'))

    expect(listed.text).toContain('저장된 결정')
    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'desktop', component: 'Pane', props: PANE, requestId: 'takgon-panel' })
    await ui.press({ key: 'tab-usage' })
    expect(await ui.find({ type: 'Text', text: /경고 임계치: 65%/ })).toBeDefined()
  })

  test('store가 비어 있어도 목록은 빈 안내만 하고 쓰지 않으며, 첫 /pin·임계치 설정이 각자의 키를 만든다', async ($, on) => {
    const sets: Array<{ key: string; value: unknown }> = []
    engine(on)
    const data = new Map<string, unknown>()
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
    await $.session.start(START)

    expect((await $.command.run(run('pin', 'list'))).text).toContain('핀이 없습니다')
    expect(sets.filter(one => one.key === `p/${PID}/m6/pins`)).toHaveLength(0)

    await $.command.run(run('pin', '첫 핀'))

    const saved = sets.filter(one => one.key === `p/${PID}/m6/pins`)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.value).toMatchObject([{ text: '첫 핀' }])

    await $.command.run(run('panel', 'threshold 50'))
    expect(sets.filter(one => one.key === 'g/m6/threshold')).toEqual([{ key: 'g/m6/threshold', value: 50 }])
  })

  test('/panel threshold로 바꾼 임계치로 경고하고, 인자 없이 부르면 현재 값을 보여준다', async ($, on) => {
    const toasts: string[] = []
    engine(on, toasts)
    mock.store(on)
    await $.session.start(START)
    const at60: SessionMeasureInput = {
      context: { tokens: 120_000, window: 200_000, percent: 60 },
      rateLimits: [],
      changed: ['context'],
    }

    expect((await $.command.run(run('panel', 'threshold'))).text).toContain('80%')
    await $.session.measure(at60)
    expect(toasts).toHaveLength(0)

    expect((await $.command.run(run('panel', 'threshold 50'))).text).toContain('50%')
    await $.session.measure(at60)
    expect(toasts.filter(text => text.includes('컨텍스트'))).toHaveLength(1)

    // Usage 탭에도 바뀐 임계치가 보인다.
    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'terminal', component: 'Pane', props: PANE, requestId: 'takgon-panel' })
    await ui.press({ key: 'tab-usage' })
    expect(await ui.find({ type: 'Text', text: /경고 임계치: 50%/ })).toBeDefined()
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

describe('게이트 로그·동기화 이벤트(순수)', () => {
  test('parseGateLog: 정상 JSONL을 정규화하고 깨진 줄·비정상 줄은 건너뛴다', () => {
    const ts1 = '2026-11-10T02:38:47+09:00'
    const ts2 = '2026-11-10T02:39:00+09:00'
    const longCmd = `  echo\n   ${'a'.repeat(GATE_COMMAND_MAX + 10)}  `
    const raw = [
      JSON.stringify({
        ts: ts1,
        session_id: 's1',
        tool: 'Bash',
        cwd: 'C:\\workspace\\x',
        hits: ['rm', 123, 'git push'],
        decision: 'ask',
        command: 'rm -rf build',
      }),
      '',
      '{broken json',
      JSON.stringify({ tool: 'Bash', command: 'ls' }),
      JSON.stringify({ ts: 'not-a-date', command: 'ls' }),
      JSON.stringify({
        ts: ts2,
        conversation_id: 'c1',
        workspace: ['C:\\a', 'C:\\b'],
        hits: 'not-array',
        decision: 'logged-only (prompt rule)',
        command: longCmd,
      }),
      JSON.stringify({
        ts: ts2,
        command: '  git   status \n --short ',
      }),
    ].join('\r\n')

    const records = parseGateLog(raw, 'codex')
    expect(records).toHaveLength(3)
    expect(records[0]).toEqual({
      ts: ts1,
      at: Date.parse(ts1),
      tool: 'codex',
      decision: 'ask',
      hits: ['rm', 'git push'],
      command: 'rm -rf build',
      cwd: 'C:\\workspace\\x',
    })
    expect(records[1]?.decision).toBe('log')
    expect(records[1]?.cwd).toBe('C:\\a')
    expect(records[1]?.hits).toEqual([])
    expect(records[1]?.command).toHaveLength(GATE_COMMAND_MAX)
    expect(records[1]?.command.endsWith('…')).toBe(true)
    expect(records[2]?.decision).toBe('?')
    expect(records[2]?.cwd).toBe('')
    expect(records[2]?.command).toBe('git status --short')
  })

  test('mergeGateRecords: 여러 목록을 합쳐 at 내림차순(동률이면 입력 순서 유지)으로 limit건만 돌려준다', () => {
    expect(mergeGateRecords([], 10)).toEqual([])
    const base = { ts: '2026-11-10T00:00:00Z', decision: 'ask', hits: [], cwd: '' }
    const r1 = { ...base, at: 100, tool: 'claude' as const, command: 'c1' }
    const r2 = { ...base, at: 300, tool: 'claude' as const, command: 'c2' }
    const r3 = { ...base, at: 200, tool: 'agy' as const, command: 'a1' }
    const r4 = { ...base, at: 300, tool: 'codex' as const, command: 'x1' }

    const merged = mergeGateRecords([[r1, r2], [r3], [r4]], 3)
    expect(merged.map(r => r.command)).toEqual(['c2', 'x1', 'a1'])
  })

  test('parseSyncEvents: 정상·오류·대체 lastId 처리', () => {
    const longReason = `\n  ${'실'.repeat(210)}\n둘째 줄`
    const json = JSON.stringify({
      last_id: 45,
      events: [
        {
          ts: '2026-11-09T18:25:27+09:00',
          detector: 'claude',
          changed: ['README.md', 42],
          passed: false,
          reason: '[게이트 훅 동기화 테스트 실패] 수정된 파일: README.md\nERROR: fail',
          id: 1,
        },
        {
          ts: '2026-11-09T18:26:00+09:00',
          changed: ['x.py'],
          passed: true,
          notice: '\n  [파이프라인 규칙 자동 갱신] 완료\n세부 내용',
          id: 2,
        },
        {
          ts: '2026-11-09T18:27:00+09:00',
          changed: 'not-array',
          passed: false,
          reason: longReason,
          id: 3,
        },
        {
          ts: '2026-11-09T18:28:00+09:00',
          passed: true,
          id: 4,
        },
        { id: 'bad', passed: true },
        { id: 5, passed: 'yes' },
      ],
    })

    const parsed = parseSyncEvents(json)
    expect(parsed.lastId).toBe(45)
    expect(parsed.events).toHaveLength(4)
    expect(parsed.events[0]).toEqual({
      id: 1,
      ts: '2026-11-09T18:25:27+09:00',
      passed: false,
      changed: ['README.md'],
      summary: '[게이트 훅 동기화 테스트 실패] 수정된 파일: README.md',
    })
    expect(parsed.events[1]?.summary).toBe('[파이프라인 규칙 자동 갱신] 완료')
    expect(parsed.events[2]?.changed).toEqual([])
    expect(parsed.events[2]?.summary).toHaveLength(200)
    expect(parsed.events[2]?.summary.endsWith('…')).toBe(true)
    expect(parsed.events[3]?.summary).toBe('')

    // last_id가 숫자가 아니면 이벤트 id 최댓값(없으면 0)
    expect(parseSyncEvents(JSON.stringify({ last_id: 'no', events: parsed.events })).lastId).toBe(4)
    expect(parseSyncEvents(JSON.stringify({ events: [] })).lastId).toBe(0)
    expect(parseSyncEvents('')).toEqual({ lastId: 0, events: [] })
    expect(parseSyncEvents('{bad')).toEqual({ lastId: 0, events: [] })
    expect(parseSyncEvents(JSON.stringify({ last_id: 3, events: 'nope' }))).toEqual({ lastId: 0, events: [] })
  })

  test('syncFailuresToNotify: 처음(undefined)이거나 seenId 이후 마지막 이벤트가 실패일 때만 반환한다', () => {
    const fail1 = { id: 1, ts: 't1', passed: false, changed: ['a'], summary: 's1' }
    const pass2 = { id: 2, ts: 't2', passed: true, changed: ['a'], summary: 's2' }
    const fail3 = { id: 3, ts: 't3', passed: false, changed: ['b'], summary: 's3' }

    expect(syncFailuresToNotify([], undefined)).toEqual([])
    expect(syncFailuresToNotify([fail1], undefined)).toEqual([fail1])
    expect(syncFailuresToNotify([fail1, pass2], undefined)).toEqual([])

    expect(syncFailuresToNotify([fail1, pass2], 2)).toEqual([])
    expect(syncFailuresToNotify([fail1, pass2], 1)).toEqual([])
    expect(syncFailuresToNotify([fail1, pass2, fail3], 1)).toEqual([fail3])
    expect(syncFailuresToNotify([fail1, pass2, fail3], 3)).toEqual([])
  })
})

const HOME = 'C:/Users/u'
const PATHS = gatePaths(HOME)
const SYNC_SEEN_KEY = globalKey('m6', 'syncSeen')
const MEASURE_INPUT: SessionMeasureInput = {
  context: { window: 200_000 },
  rateLimits: [],
  changed: [],
}

type GateMockOptions = {
  home?: string | undefined
  files?: Record<string, string>
  unreadable?: readonly string[]
  syncMtime?: number | null
  store?: Record<string, unknown>
}

const setupGateWorld = (on: On, opts: GateMockOptions = {}) => {
  const toasts: string[] = []
  const opened: string[] = []
  const reads: string[] = []
  const stats: string[] = []
  const state: Record<string, unknown> = {}
  const storeData = new Map<string, unknown>(Object.entries(opts.store ?? {}))
  const files = new Map<string, string>(Object.entries(opts.files ?? {}))
  const unreadable = new Set<string>(opts.unreadable ?? [])
  let syncMtime: number | null = opts.syncMtime ?? null
  const hasHome = 'home' in opts ? opts.home : HOME

  engine(on, toasts, opened)
  on('state.set', ($, e, next) => {
    state[e.key] = e.value
    return next(e)
  })
  on('store.get', ($, e) => ({ value: storeData.get(e.key) }))
  on('store.set', ($, e) => {
    storeData.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    storeData.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...storeData.keys()] }))
  on('env.get', ($, e) => ({
    value: e.name === 'USERPROFILE' ? hasHome : undefined,
  }))
  on('fs.exists', ($, e) => {
    const p = e.path.replace(/\\/g, '/')
    return { value: files.has(p) || unreadable.has(p) }
  })
  on('fs.read', ($, e) => {
    const p = e.path.replace(/\\/g, '/')
    reads.push(p)
    if (unreadable.has(p)) {
      return { deny: `EACCES: ${p}` }
    }
    const text = files.get(p)
    if (text === undefined) {
      return { deny: `ENOENT: ${p}` }
    }
    return { value: text }
  })
  on('fs.stat', ($, e) => {
    const p = e.path.replace(/\\/g, '/')
    stats.push(p)
    if (p === PATHS.sync && syncMtime !== null) {
      return { value: { kind: 'file', size: 10, mtimeMs: syncMtime, isLink: false } }
    }
    return { deny: `ENOENT: ${p}` }
  })

  return {
    toasts,
    opened,
    reads,
    stats,
    state,
    storeData,
    files,
    setSyncMtime: (mtime: number | null) => {
      syncMtime = mtime
    },
  }
}

describe('gate 탭', () => {
  test('순수: gatePaths·shortTs·parsePanelArgs·TABS', () => {
    expect(gatePaths('C:\\Users\\u\\')).toEqual({
      logs: {
        claude: 'C:/Users/u/.claude/hooks/node4-approval-gate.log',
        agy: 'C:/Users/u/.gemini/config/hooks/node4-approval-gate-agy.log',
        codex: 'C:/Users/u/.codex/hooks/node4-approval-gate-codex.log',
      },
      sync: 'C:/Users/u/.ai-gate/.sync-events.json',
    })
    expect(shortTs('2026-11-10T02:38:47+09:00')).toBe('11-10 02:38')
    expect(shortTs('not-iso-timestamp-string')).toBe('not-iso-timestam')
    expect(parsePanelArgs('gate')).toBe('gate')
    expect(TABS.at(-1)).toBe('gate')
    expect(SYNC_SHOWN).toBe(5)
  })

  test('a. /panel gate: 회전 파일(.1)과 현재 로그를 합쳐 시각 내림차순으로 채운다', async ($, on) => {
    const line = (ts: string, cmd: string) =>
      JSON.stringify({ ts, decision: 'ask', hits: ['rule-a'], command: cmd, cwd: 'C:/proj' })
    const world = setupGateWorld(on, {
      files: {
        [`${PATHS.logs.claude}.1`]: line('2026-11-10T01:00:00+09:00', 'blocked-cmd-1'),
        [PATHS.logs.claude]: [
          line('2026-11-10T02:00:00+09:00', 'blocked-cmd-2'),
          line('2026-11-10T04:00:00+09:00', 'blocked-cmd-4'),
        ].join('\n'),
        [PATHS.logs.agy]: line('2026-11-10T03:00:00+09:00', 'blocked-cmd-3'),
      },
    })
    await $.session.start(START)

    const out = await $.command.run(run('panel', 'gate'))
    expect(out.text).toContain('열었습니다')
    expect(world.state.panelTab).toBe('gate')
    const gate = world.state.gate as GateView | null | undefined
    expect(gate?.unreadable).toEqual([])
    expect(gate?.records.map(r => r.command)).toEqual([
      'blocked-cmd-4',
      'blocked-cmd-3',
      'blocked-cmd-2',
      'blocked-cmd-1',
    ])

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'takgon-mods',
        surface,
        component: 'Pane',
        props: PANE,
        requestId: 'takgon-panel',
      })
      expect((await ui.find({ key: 'tab-gate' }))?.props).toMatchObject({ variant: 'primary', hotkey: '6' })
      expect(await ui.find({ type: 'Text', text: /blocked-cmd-4/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('b. 로그·동기화 파일이 전부 없어도 빈 배열로 채우고 패널을 연다', async ($, on) => {
    const world = setupGateWorld(on)
    await $.session.start(START)

    const out = await $.command.run(run('panel', 'gate'))
    expect(out.text).toContain('열었습니다')
    expect(world.opened).toContain('takgon-panel')
    const gate = world.state.gate as GateView | null | undefined
    expect(gate?.records).toEqual([])
    expect(gate?.sync).toEqual([])
    expect(gate?.unreadable).toEqual([])
  })

  test('c. fs.exists는 true인데 fs.read가 거부되면 그 출처만 unreadable에 기록한다', async ($, on) => {
    const line = JSON.stringify({
      ts: '2026-11-10T02:00:00+09:00',
      decision: 'deny',
      hits: ['rule-b'],
      command: 'blocked-cmd-x',
    })
    const world = setupGateWorld(on, {
      files: { [PATHS.logs.claude]: line },
      unreadable: [PATHS.logs.agy],
    })
    await $.session.start(START)

    await $.command.run(run('panel', 'gate'))
    const gate = world.state.gate as GateView | null | undefined
    expect(gate?.unreadable).toEqual(['agy'])
    expect(gate?.records).toHaveLength(1)
    expect(gate?.records[0]?.tool).toBe('claude')
  })

  test('d. session.measure: 새 실패 이벤트는 toast 1회 + syncSeen 저장, mtime 그대로면 다시 읽지 않는다', async ($, on) => {
    const syncJson = JSON.stringify({
      last_id: 7,
      events: [
        { id: 7, ts: '2026-11-10T02:00:00+09:00', passed: false, changed: ['a.py'], reason: '불일치 발생' },
      ],
    })
    const world = setupGateWorld(on, {
      files: { [PATHS.sync]: syncJson },
      syncMtime: 100,
    })
    await $.session.start(START)

    await $.session.measure(MEASURE_INPUT)
    expect(world.toasts).toHaveLength(1)
    expect(world.toasts[0]).toContain('#7')
    expect(world.toasts[0]).toContain('불일치 발생')
    expect(world.storeData.get(SYNC_SEEN_KEY)).toBe(7)
    const readsAfterFirst = world.reads.filter(p => p === PATHS.sync).length
    expect(readsAfterFirst).toBe(1)

    await $.session.measure(MEASURE_INPUT)
    expect(world.reads.filter(p => p === PATHS.sync).length).toBe(1)
    expect(world.toasts).toHaveLength(1)
  })

  test('e. mtime이 바뀌어도 같은 id나 통과면 toast 없고, 새 실패 id 9면 toast 1회·seen 9', async ($, on) => {
    const fail7 = { id: 7, ts: '2026-11-10T02:00:00+09:00', passed: false, changed: ['a.py'], reason: '실패7' }
    const pass8 = { id: 8, ts: '2026-11-10T02:05:00+09:00', passed: true, changed: ['a.py'], notice: '통과8' }
    const fail9 = { id: 9, ts: '2026-11-10T02:10:00+09:00', passed: false, changed: ['b.py'], reason: '실패9' }
    const world = setupGateWorld(on, {
      files: { [PATHS.sync]: JSON.stringify({ last_id: 7, events: [fail7] }) },
      syncMtime: 100,
      store: { [SYNC_SEEN_KEY]: 7 },
    })
    await $.session.start(START)

    // mtime 100이지만 이미 seen=7 → toast 없음
    await $.session.measure(MEASURE_INPUT)
    expect(world.toasts).toHaveLength(0)

    // mtime 200으로 바뀌고 마지막이 통과(id 8) → toast 없음, seen=8
    world.files.set(PATHS.sync, JSON.stringify({ last_id: 8, events: [fail7, pass8] }))
    world.setSyncMtime(200)
    await $.session.measure(MEASURE_INPUT)
    expect(world.toasts).toHaveLength(0)
    expect(world.storeData.get(SYNC_SEEN_KEY)).toBe(8)

    // mtime 300으로 바뀌고 새 실패(id 9) → toast 1회, seen=9
    world.files.set(PATHS.sync, JSON.stringify({ last_id: 9, events: [fail7, pass8, fail9] }))
    world.setSyncMtime(300)
    await $.session.measure(MEASURE_INPUT)
    expect(world.toasts).toHaveLength(1)
    expect(world.toasts[0]).toContain('#9')
    expect(world.toasts[0]).toContain('실패9')
    expect(world.storeData.get(SYNC_SEEN_KEY)).toBe(9)
  })

  test('f. /clear 뒤처럼 state가 비어 있어도 store의 syncSeen이 같으면 다시 toast하지 않는다', async ($, on) => {
    const syncJson = JSON.stringify({
      last_id: 7,
      events: [{ id: 7, ts: '2026-11-10T02:00:00+09:00', passed: false, changed: ['a.py'], reason: '실패7' }],
    })
    const world = setupGateWorld(on, {
      files: { [PATHS.sync]: syncJson },
      syncMtime: 100,
      store: { [SYNC_SEEN_KEY]: 7 },
    })

    // session.start 없이(= /clear 직후 state가 비어 있는 상태) 바로 measure 실행
    await $.session.measure(MEASURE_INPUT)
    expect(world.reads.filter(p => p === PATHS.sync)).toHaveLength(1)
    expect(world.toasts).toHaveLength(0)
  })

  test('g. /mods panel off이면 session.measure에서 fs.stat·fs.read를 부르지 않는다', async ($, on) => {
    const world = setupGateWorld(on, {
      files: { [PATHS.sync]: '{"last_id":1,"events":[]}' },
      syncMtime: 100,
      store: { 'g/core/modules': { panel: false } },
    })
    await $.session.start(START)

    await $.session.measure(MEASURE_INPUT)
    expect(world.stats).toHaveLength(0)
    expect(world.reads).toHaveLength(0)
  })

  test('h. USERPROFILE·HOME이 모두 undefined면 아무것도 읽지 않고 gate.records는 빈 배열이다', async ($, on) => {
    const world = setupGateWorld(on, {
      home: undefined,
      files: { [PATHS.logs.claude]: '{"ts":"2026-11-10T01:00:00Z","command":"blocked-cmd"}' },
      syncMtime: 100,
    })
    await $.session.start(START)

    await $.command.run(run('panel', 'gate'))
    await $.session.measure(MEASURE_INPUT)
    expect(world.reads).toHaveLength(0)
    expect(world.stats).toHaveLength(0)
    const gate = world.state.gate as GateView | null | undefined
    expect(gate?.records).toEqual([])
  })
})
