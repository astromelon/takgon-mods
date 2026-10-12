import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { AgentRun, Lang, PanelTab, Pin, TaskItem, UsageSnapshot } from '../../types'
import { toLang } from '../shared/i18n'
import { projectId, projectKey } from '../shared/keys'
import { markNotified } from '../shared/settings'
import { ALL_ON } from '../shared/state'
import {
  PANE_ID,
  TABS,
  addPin,
  fit,
  formatTokens,
  lastAssistantText,
  parsePanelArgs,
  parsePinArgs,
  removePin,
  startAgent,
  stopAgent,
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
const panelTabAtom = atom({ plugin: 'takgon-mods', key: 'panelTab' } as const, 'pinboard')
const pinsAtom = atom({ plugin: 'takgon-mods', key: 'pins' } as const, [])
const tasksAtom = atom({ plugin: 'takgon-mods', key: 'tasks' } as const, [])
const agentsAtom = atom({ plugin: 'takgon-mods', key: 'agents' } as const, [])
const usageAtom = atom({ plugin: 'takgon-mods', key: 'usage' } as const, null)
const handoffAtom = atom({ plugin: 'takgon-mods', key: 'handoff' } as const, null)

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

/** 세션 시작·복원: 명령 등록, 핀·할 일을 store에서 다시 읽고 세션 범위 상태(에이전트·사용량)를 비운다. */
const init = async ($: EngineInterface): Promise<void> => {
  const lang = await langOf($)
  await $.command.register({ name: 'panel', description: tr(lang, 'panel.description'), argumentHint: '[close]' })
  await $.command.register({ name: 'pin', description: tr(lang, 'pin.description'), argumentHint: '[<text>|list]' })
  const pid = await pidOf($)
  const pins = toPins(await $.store.get(pinsKey(pid)))
  const tasks = toTasks(await $.store.get(tasksKey(pid)))
  await update($, pinsAtom, () => pins)
  await update($, tasksAtom, () => tasks)
  await update($, agentsAtom, () => [])
  await update($, usageAtom, () => null)
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
  for (const alert of usageAlerts(snapshot)) {
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

const usageLines = (lang: Lang, usage: UsageSnapshot | null): string[] => {
  if (usage === null) {
    return [tr(lang, 'usage.empty')]
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
  return lines
}

const agentLine = (lang: Lang, run: AgentRun): string => {
  const seconds = run.endedAt === undefined ? '' : ` ${Math.round((run.endedAt - run.startedAt) / 1000)}s`
  return `${run.status === 'running' ? '●' : '○'} ${run.agentType} · ${tr(lang, STATUS_KEY[run.status])}${seconds}`
}

/**
 * M6 Work Panel: `/panel`로 여는 pane(핀·할 일·에이전트·사용량·인수인계 탭)과 `/pin` 명령.
 *
 * 사용량 임계치는 `session.measure`(턴마다 push)에서 판정하고, 서브에이전트 실행은 `classic.SubagentStart/Stop`으로
 * 세션 범위에만 기록한다. 할 일은 M4와 같은 `tasks` atom·store 키를 공유한다.
 */
export const registerPanel = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await init($)
    return next(e)
  })

  on('classic.SessionStart', { source: 'clear' }, async ($, e, next) => {
    await init($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SessionStart', { source: 'resume' }, async ($, e, next) => {
    await init($)
    return next(e)
  }).catch(($, e, next) => next(e))


  on('command.run', { command: 'panel' }, async ($, e) => {
    const lang = await langOf($)
    if (!(await isOn($))) {
      return { text: tr(lang, 'panel.off') }
    }
    const action = parsePanelArgs(e.args)
    if (action === 'usage') {
      return { text: tr(lang, 'panel.usage') }
    }
    if (action === 'close') {
      await $.ui.close({ id: 'takgon-panel' })
      return { text: tr(lang, 'panel.closed') }
    }
    // 첫 measure 전이라도 Usage 탭이 비지 않게 한 번 채운다(breakdown 없이 무료 호출).
    if ((await read($, usageAtom)) === null) {
      try {
        await measure($, await $.session.usage())
      } catch {
        // 사용량을 못 읽어도 패널은 연다.
      }
    }
    await $.ui.open({ id: 'takgon-panel', title: tr(lang, 'panel.title') })
    return { text: tr(lang, 'panel.opened') }
  })

  on('command.run', { command: 'pin' }, async ($, e) => {
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

  on('classic.SubagentStart', async ($, e, next) => {
    if (await isOn($)) {
      const now = await $.clock.now()
      await update($, agentsAtom, list => startAgent(list, e.agent_id, e.agent_type, now))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    if (await isOn($)) {
      const now = await $.clock.now()
      await update($, agentsAtom, list => stopAgent(list, e.agent_id, e.agent_type, now))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    if (await isOn($)) {
      await measure($, e)
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
        {TABS.map(one => (
          <Button
            key={`tab-${one}`}
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
      const { shown, hidden } = visible(usageLines(lang, await read($, usageAtom)), rows)
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
