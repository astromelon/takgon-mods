import { atom, read, update } from 'claude-code'
import type { CommandSpec, EngineInterface, On } from 'claude-code'

import type { AgentRun, CommandRegistration, Lang, PanelTab, Pin, TaskItem, UsageSnapshot } from '../../types'
import { t, toLang } from '../shared/i18n'
import { globalKey, projectId, projectKey } from '../shared/keys'
import { commandsKey, markNotified, refusalReason, registerCause, toCommandMap, toPercent } from '../shared/settings'
import { ALL_ON } from '../shared/state'
import {
  PANE_ID,
  TABS,
  USAGE_THRESHOLD,
  addPin,
  fit,
  formatTokens,
  lastAssistantText,
  parsePanelArgs,
  parsePinArgs,
  removePin,
  applyAgentStatuses,
  startAgent,
  toPins,
  toSnapshot,
  toTasks,
  toggleTask,
  usageAlerts,
  visible,
} from './logic'
import type { UsageReading } from './logic'
import { tr } from './messages'

const langAtom = atom({ plugin: 'takgon-mods', key: 'lang' } as const, 'ko')
const modulesAtom = atom({ plugin: 'takgon-mods', key: 'modules' } as const, ALL_ON)
const projectIdAtom = atom({ plugin: 'takgon-mods', key: 'projectId' } as const, '')
const notifiedAtom = atom({ plugin: 'takgon-mods', key: 'notified' } as const, [])
const commandsAtom = atom({ plugin: 'takgon-mods', key: 'commands' } as const, {})
const panelTabAtom = atom({ plugin: 'takgon-mods', key: 'panelTab' } as const, 'pinboard')
const pinsAtom = atom({ plugin: 'takgon-mods', key: 'pins' } as const, [])
const tasksAtom = atom({ plugin: 'takgon-mods', key: 'tasks' } as const, [])
const agentsAtom = atom({ plugin: 'takgon-mods', key: 'agents' } as const, [])
const usageAtom = atom({ plugin: 'takgon-mods', key: 'usage' } as const, null)
const usageThresholdAtom = atom({ plugin: 'takgon-mods', key: 'usageThreshold' } as const, USAGE_THRESHOLD)
const handoffAtom = atom({ plugin: 'takgon-mods', key: 'handoff' } as const, null)
const restoredAtom = atom({ plugin: 'takgon-mods', key: 'restored' } as const, [])

/**
 * 명령을 등록한다. 같은 이름의 사용자·내장 명령 때문에 거부되면 예외를 삼켜 다른 초기화(이 모듈과 뒤쪽 모듈)를 막지 않고,
 * 명령마다 세션당 1회 toast로 알린다. 결과는 `/mods` 목록용으로 기록한다. `$`는 import 경계를 넘을 수 없어 모듈 파일마다 같은 헬퍼를 둔다.
 */
const registerCommand = async ($: EngineInterface, spec: CommandSpec): Promise<void> => {
  let result: CommandRegistration = { isListed: true }
  try {
    await $.command.register(spec)
  } catch (error) {
    result = { isListed: false, reason: refusalReason(error) }
    try {
      const marked = markNotified(await read($, notifiedAtom), registerCause(spec.name))
      if (marked !== null) {
        await update($, notifiedAtom, () => marked)
        const vars = { name: spec.name, reason: result.reason ?? '' }
        $.ui.toast(t(await read($, langAtom), 'mods.registerRefused', vars))
      }
    } catch {
      // 알림 실패도 초기화를 막지 않는다.
    }
  }
  // `/mods` 목록이 보여 줄 수 있게 결과를 state와 프로젝트 store(`/clear` 뒤 복원용)에 남긴다.
  try {
    await update($, commandsAtom, map => ({ ...map, [spec.name]: result }))
    const key = commandsKey(projectId(await $.session.root()))
    await $.store.set(key, { ...toCommandMap(await $.store.get(key)), [spec.name]: result })
  } catch {
    // 기록 실패도 초기화를 막지 않는다.
  }
}

const isOn = async ($: EngineInterface): Promise<boolean> => (await read($, modulesAtom)).panel

const langOf = async ($: EngineInterface): Promise<Lang> => toLang(await read($, langAtom))

/** 프로젝트 식별자. core가 아직 채우지 않았으면 루트에서 직접 계산한다. */
const pidOf = async ($: EngineInterface): Promise<string> => {
  const pid = await read($, projectIdAtom)
  return pid !== '' ? pid : projectId(await $.session.root())
}

const pinsKey = (pid: string): string => projectKey(pid, 'm6', 'pins')

/** M4와 같은 키. */
const tasksKey = (pid: string): string => projectKey(pid, 'm4', 'tasks')

/** 사용량 경고 임계치(%) 전역 store 키. 없으면 80. */
const THRESHOLD_KEY = globalKey('m6', 'threshold')

/** 핀·할 일을 store에서 다시 읽는다. 에이전트·사용량은 세션 범위라 복원하지 않는다. */
const restore = async ($: EngineInterface): Promise<void> => {
  const pid = await pidOf($)
  const pins = toPins(await $.store.get(pinsKey(pid)))
  const tasks = toTasks(await $.store.get(tasksKey(pid)))
  const threshold = toPercent(await $.store.get(THRESHOLD_KEY), USAGE_THRESHOLD)
  await update($, pinsAtom, () => pins)
  await update($, tasksAtom, () => tasks)
  await update($, usageThresholdAtom, () => threshold)
}

/**
 * 이번 세션에 아직 복원하지 않았으면 store에서 불러온다. `/clear`·`/resume`은 state(복원 표시 포함)를 비우고
 * `session.start`를 다시 보내지 않으므로, 이 모듈의 훅에 처음 들어올 때 다시 채운다. 실패는 삼키고 다음에 재시도한다.
 */
const ensureRestored = async ($: EngineInterface): Promise<void> => {
  if ((await read($, restoredAtom)).includes('m6')) {
    return
  }
  await update($, restoredAtom, list => (list.includes('m6') ? list : [...list, 'm6']))
  try {
    await restore($)
  } catch {
    await update($, restoredAtom, list => list.filter(one => one !== 'm6'))
  }
}

/** 세션 시작: 명령 등록과 복원. */
const init = async ($: EngineInterface): Promise<void> => {
  const lang = await langOf($)
  await registerCommand($, { name: 'panel', description: tr(lang, 'panel.description'), argumentHint: '[close | pinboard | tasks | agents | usage | handoff | threshold <1-99>]' })
  await registerCommand($, { name: 'pin', description: tr(lang, 'pin.description'), argumentHint: '[<text>|list]' })
  await ensureRestored($)
}

/** `$.agent.list()`로 서브에이전트 상태(완료·실패 포함)를 갱신한다. 목록을 못 읽으면 그대로 둔다. */
const refreshAgents = async ($: EngineInterface): Promise<void> => {
  try {
    const listing = (await $.agent.list()).map(one => ({ id: one.id, type: one.type, status: one.status }))
    const now = await $.clock.now()
    await update($, agentsAtom, list => applyAgentStatuses(list, listing, now))
  } catch {
    // 상태 갱신은 부가 정보라 실패해도 넘어간다.
  }
}

const savePins = async ($: EngineInterface, next: Pin[]): Promise<void> => {
  await update($, pinsAtom, () => next)
  await $.store.set(pinsKey(await pidOf($)), next)
}

/** 핀 추가. id는 시각 + 같은 시각 핀 개수로 만든다(난수 없이 고유). */
const pinText = async ($: EngineInterface, text: string): Promise<void> => {
  const pins = await read($, pinsAtom)
  const now = await $.clock.now()
  const base = `pin-${now.toString(36)}`
  const id = `${base}-${pins.filter(pin => pin.id.startsWith(base)).length}`
  await savePins($, addPin(pins, { id, text, createdAt: now }))
}

const unpin = async ($: EngineInterface, id: string): Promise<void> => {
  await savePins($, removePin(await read($, pinsAtom), id))
}

/** 체크 토글 → atom과 M4 store 키에 같이 쓴다. */
const toggle = async ($: EngineInterface, id: string): Promise<void> => {
  const next = toggleTask(await read($, tasksAtom), id)
  await update($, tasksAtom, () => next)
  await $.store.set(tasksKey(await pidOf($)), next)
}

/** 사용량 상태를 갱신하고 80% 이상 항목을 원인별 세션당 1회 toast한다. */
const measure = async ($: EngineInterface, reading: UsageReading): Promise<void> => {
  const snapshot = toSnapshot(reading, await $.clock.now())
  await update($, usageAtom, () => snapshot)
  const lang = await langOf($)
  const threshold = toPercent(await $.store.get(THRESHOLD_KEY), USAGE_THRESHOLD)
  for (const alert of usageAlerts(snapshot, threshold)) {
    const marked = markNotified(await read($, notifiedAtom), alert.cause)
    if (marked === null) {
      continue
    }
    await update($, notifiedAtom, () => marked)
    $.ui.toast(
      alert.kind === 'context'
        ? tr(lang, 'usage.contextToast', { percent: alert.percent })
        : tr(lang, 'usage.rateToast', { kind: alert.limit, percent: alert.percent }),
    )
  }
}

const STATUS_KEY = { running: 'agents.running', done: 'agents.done', failed: 'agents.failed' } as const

const usageLines = (lang: Lang, usage: UsageSnapshot | null, threshold: number): string[] => {
  const limit = tr(lang, 'usage.threshold', { percent: threshold })
  if (usage === null) {
    return [tr(lang, 'usage.empty'), limit]
  }
  const lines = [
    tr(lang, 'usage.context', {
      percent: usage.contextPercent ?? '-',
      tokens: usage.contextTokens === undefined ? '-' : formatTokens(usage.contextTokens),
      window: formatTokens(usage.contextWindow),
    }),
  ]
  for (const rate of usage.rateLimits) {
    const vars = { kind: rate.kind, percent: rate.percentUsed, resetsAt: rate.resetsAt ?? '' }
    lines.push(tr(lang, rate.resetsAt === undefined ? 'usage.rate' : 'usage.rateReset', vars))
  }
  if (usage.costUsd !== undefined) {
    lines.push(tr(lang, 'usage.cost', { usd: usage.costUsd.toFixed(2) }))
  }
  lines.push(limit)
  return lines
}

const agentLine = (lang: Lang, run: AgentRun): string => {
  const seconds = run.endedAt === undefined ? '' : ` ${Math.round((run.endedAt - run.startedAt) / 1000)}s`
  return `${run.status === 'running' ? '●' : '○'} ${run.agentType} · ${tr(lang, STATUS_KEY[run.status])}${seconds}`
}

/**
 * M6 Work Panel: `/panel`로 여는 pane(핀·할 일·에이전트·사용량·인수인계 탭)과 `/pin` 명령.
 *
 * 사용량 임계치는 `session.measure`(턴마다 push)에서 판정하고, 서브에이전트 실행은 `agent.spawn`과 `$.agent.list()`로
 * 세션 범위에만 기록한다. 할 일은 M4와 같은 `tasks` atom·store 키를 공유한다.
 */
export const registerPanel = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await init($)
    return next(e)
  })

  // M7 인수인계가 핀을 읽으므로, /clear 뒤 첫 프롬프트에서 미리 복원해 둔다.
  on('prompt.submit', { origin: { kind: 'composer' } }, async ($, e, next) => {
    await ensureRestored($)
    return next(e)
  }).catch(($, e, next) => next(e))


  on('command.run', { command: 'panel' }, async ($, e) => {
    await ensureRestored($)
    const lang = await langOf($)
    if (!(await isOn($))) {
      return { text: tr(lang, 'panel.off') }
    }
    const action = parsePanelArgs(e.args)
    if (action === 'help') {
      return { text: tr(lang, 'panel.usage') }
    }
    if (action === 'close') {
      await $.ui.close({ id: 'takgon-panel' })
      return { text: tr(lang, 'panel.closed') }
    }
    if (typeof action === 'object') {
      if (action.value !== null) {
        const value = action.value
        await $.store.set(THRESHOLD_KEY, value)
        await update($, usageThresholdAtom, () => value)
      }
      const value = action.value ?? toPercent(await $.store.get(THRESHOLD_KEY), USAGE_THRESHOLD)
      return { text: tr(lang, 'panel.threshold', { value }) }
    }
    if (action !== 'open') {
      await update($, panelTabAtom, () => action)
    }
    // 첫 measure 전이라도 Usage 탭이 비지 않게 한 번 채운다(breakdown 없이 무료 호출).
    if ((await read($, usageAtom)) === null) {
      try {
        await measure($, await $.session.usage())
      } catch {
        // 사용량을 못 읽어도 패널은 연다.
      }
    }
    await refreshAgents($)
    await $.ui.open({ id: 'takgon-panel', title: tr(lang, 'panel.title') })
    return { text: tr(lang, 'panel.opened') }
  })

  on('command.run', { command: 'pin' }, async ($, e) => {
    await ensureRestored($)
    const lang = await langOf($)
    if (!(await isOn($))) {
      return { text: tr(lang, 'panel.off') }
    }
    const action = parsePinArgs(e.args)
    if (action.kind === 'list') {
      const pins = await read($, pinsAtom)
      if (pins.length === 0) {
        return { text: tr(lang, 'pin.empty') }
      }
      const rows = pins.map((pin, i) => `${i + 1}. ${fit(pin.text, 200)}`)
      return { text: [tr(lang, 'pin.listTitle', { count: pins.length }), ...rows].join('\n') }
    }
    let text = action.kind === 'add' ? action.text : undefined
    if (action.kind === 'last') {
      const rows = await $.session.messages()
      text = Array.isArray(rows) ? lastAssistantText(rows) : undefined
    }
    if (text === undefined) {
      return { text: tr(lang, 'pin.noReply') }
    }
    await pinText($, text)
    return { text: tr(lang, 'pin.added', { text: fit(text, 80) }) }
  })

  // classic.SubagentStart/Stop은 내장 보안 플러그인이 user 플러그인을 건너뛰게 해 전달되지 않는다.
  // 시작은 agent.spawn에서, 완료·실패는 $.agent.list()로 갱신한다.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.agentId !== undefined && (await isOn($))) {
      const now = await $.clock.now()
      await update($, agentsAtom, list => startAgent(list, result.agentId ?? '', e.subagentType, now))
    }
    return result
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    if (await isOn($)) {
      await ensureRestored($)
      await measure($, e)
      await refreshAgents($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: 'takgon-panel' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const lang = await langOf($)
    if (!(await isOn($))) {
      return <Text dimColor>{tr(lang, 'panel.off')}</Text>
    }
    const tab: PanelTab = await read($, panelTabAtom)
    const columns = Math.max(10, e.props.bodyColumns)
    // 탭 줄과 여백 2줄을 뺀 나머지가 목록 높이다.
    const rows = Math.max(1, (e.viewport?.rows ?? e.props.scroll.bodyRows) - 2)
    const more = (hidden: number) =>
      hidden > 0 ? <Text dimColor>{tr(lang, 'more', { count: hidden })}</Text> : null

    const tabs = (
      <Box flexDirection="row">
        {TABS.map((one, i) => (
          <Button
            key={`tab-${one}`}
            hotkey={String(i + 1)}
            variant={one === tab ? 'primary' : 'secondary'}
            onPress={() => update($, panelTabAtom, () => one)}
          >
            {tr(lang, `tab.${one}`)}
          </Button>
        ))}
      </Box>
    )

    let body
    if (tab === 'pinboard') {
      const pins = [...(await read($, pinsAtom))].reverse()
      const { shown, hidden } = visible(pins, rows)
      body =
        pins.length === 0 ? (
          <Text dimColor>{fit(tr(lang, 'pin.empty'), columns)}</Text>
        ) : (
          <Box flexDirection="column">
            {shown.map(pin => (
              <Box flexDirection="row">
                <Button key={`unpin-${pin.id}`} onPress={() => unpin($, pin.id)}>
                  {tr(lang, 'pin.remove')}
                </Button>
                <Text>{fit(pin.text, columns - 8)}</Text>
              </Box>
            ))}
            {more(hidden)}
          </Box>
        )
    } else if (tab === 'tasks') {
      const tasks: TaskItem[] = await read($, tasksAtom)
      const { shown, hidden } = visible(tasks, rows)
      body =
        tasks.length === 0 ? (
          <Text dimColor>{tr(lang, 'tasks.empty')}</Text>
        ) : (
          <Box flexDirection="column">
            {shown.map(task => (
              <Button key={`task-${task.id}`} plain onPress={() => toggle($, task.id)}>
                {fit(`${task.isDone ? '[x]' : '[ ]'} ${task.text}`, columns)}
              </Button>
            ))}
            {more(hidden)}
          </Box>
        )
    } else if (tab === 'agents') {
      const agents = [...(await read($, agentsAtom))].reverse()
      const { shown, hidden } = visible(agents, rows)
      body =
        agents.length === 0 ? (
          <Text dimColor>{fit(tr(lang, 'agents.empty'), columns)}</Text>
        ) : (
          <Box flexDirection="column">
            {shown.map(run => (
              <Text dimColor={run.status !== 'running'}>{fit(agentLine(lang, run), columns)}</Text>
            ))}
            {more(hidden)}
          </Box>
        )
    } else if (tab === 'usage') {
      const { shown, hidden } = visible(usageLines(lang, await read($, usageAtom), await read($, usageThresholdAtom)), rows)
      body = (
        <Box flexDirection="column">
          {shown.map(line => (
            <Text>{fit(line, columns)}</Text>
          ))}
          {more(hidden)}
        </Box>
      )
    } else {
      const handoff = await read($, handoffAtom)
      const lines = handoff === null ? [] : handoff.summary.split('\n').filter(line => line.trim() !== '')
      const { shown, hidden } = visible(lines, rows - 1)
      body =
        handoff === null ? (
          <Text dimColor>{fit(tr(lang, 'handoff.empty'), columns)}</Text>
        ) : (
          <Box flexDirection="column">
            <Text dimColor>{fit(tr(lang, 'handoff.path', { path: handoff.path }), columns)}</Text>
            {shown.map(line => (
              <Text>{fit(line, columns)}</Text>
            ))}
            {more(hidden)}
          </Box>
        )
    }

    return (
      <Box flexDirection="column">
        {tabs}
        {body}
      </Box>
    )
  })
}
