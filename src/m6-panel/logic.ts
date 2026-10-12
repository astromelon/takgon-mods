/**
 * M6 Work Panel의 순수 로직: 명령 인자 해석, 목록 상한, 저장값 검증, 사용량 임계치 판정, 줄 맞춤.
 *
 * `$`를 받지 않는다(엔진이 import 경계 너머의 `$` 전달을 거부한다). store·state 접근은 `index.tsx`에서 한다.
 */
import type { AgentRun, PanelTab, Pin, TaskItem, UsageSnapshot } from '../../types'
import { parsePercent } from '../shared/settings'

/** pane id. `ui.render`의 `requestId`와 같다. */
export const PANE_ID = 'takgon-panel'

/** 탭 순서. */
export const TABS: readonly PanelTab[] = ['pinboard', 'tasks', 'agents', 'usage', 'handoff']

/** 프로젝트당 핀 상한. */
export const MAX_PINS = 100

/** 세션당 에이전트 기록 상한. */
export const MAX_AGENTS = 50

/** 사용량 경고 임계치(%). */
export const USAGE_THRESHOLD = 80

/** 컨텍스트 경고 toast 원인 키. */
export const CONTEXT_CAUSE = 'm6:context80'

/** rate limit 경고 toast 원인 키. kind별로 1회. */
export const rateCause = (kind: string): string => `m6:rate80:${kind}`

/** `/pin` 인자의 해석 결과. */
export type PinAction = { kind: 'last' } | { kind: 'list' } | { kind: 'add'; text: string }

/** `/pin` 인자: 없음 → 직전 응답, `list` → 목록, 그 외 → 내용 그대로. */
export const parsePinArgs = (args: string): PinAction => {
  const text = args.trim()
  if (text === '') {
    return { kind: 'last' }
  }
  return text.toLowerCase() === 'list' ? { kind: 'list' } : { kind: 'add', text }
}

/** `/panel` 인자의 해석 결과. */
export type PanelAction =
  | 'open'
  | 'close'
  | 'help'
  | PanelTab
  | { kind: 'threshold'; value: number | null }

/** `/panel [close|<탭>|threshold [n]]` 해석. 탭 이름(`agents` 등)이면 그 탭으로 열고, 모르는 인자는 사용법. */
export const parsePanelArgs = (args: string): PanelAction => {
  const text = args.trim().toLowerCase()
  if (text === '') {
    return 'open'
  }
  if (text === 'close') {
    return 'close'
  }
  const [word, value, ...rest] = text.split(/\s+/)
  if (word === 'threshold' && rest.length === 0) {
    if (value === undefined) {
      return { kind: 'threshold', value: null }
    }
    const percent = parsePercent(value)
    return percent === null ? 'help' : { kind: 'threshold', value: percent }
  }
  return TABS.find(tab => tab === text) ?? 'help'
}

/** 대화 행 중 마지막 assistant 행의 텍스트. 비어 있으면 `undefined`. */
export const lastAssistantText = (
  rows: readonly { role: string; text: string }[],
): string | undefined => {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]
    if (row !== undefined && row.role === 'assistant' && row.text.trim() !== '') {
      return row.text.trim()
    }
  }
  return undefined
}

/** 핀을 추가하고 최근 `MAX_PINS`개만 남긴다(오래된 것부터 버림). */
export const addPin = (pins: readonly Pin[], pin: Pin): Pin[] => [...pins, pin].slice(-MAX_PINS)

/** 핀 하나를 지운다. */
export const removePin = (pins: readonly Pin[], id: string): Pin[] => pins.filter(pin => pin.id !== id)

/** 할 일 하나의 완료 여부를 뒤집는다. */
export const toggleTask = (tasks: readonly TaskItem[], id: string): TaskItem[] =>
  tasks.map(task => (task.id === id ? { ...task, isDone: !task.isDone } : task))

/** 서브에이전트 시작을 기록한다. 같은 id가 이미 있으면 새로 시작한 것으로 바꾼다. */
export const startAgent = (
  agents: readonly AgentRun[],
  agentId: string,
  agentType: string,
  now: number,
): AgentRun[] => {
  const run: AgentRun = { agentId, agentType, status: 'running', startedAt: now }
  return [...agents.filter(one => one.agentId !== agentId), run].slice(-MAX_AGENTS)
}

/** `$.agent.list()` 한 건 중 상태 갱신에 쓰는 부분. */
export type AgentListing = { id: string; type: string; status: string }

/** 엔진 AgentStatus → 패널 상태. 대기·실행 중은 running, 정상 종료는 done, 실패·강제 종료는 failed. */
const toRunStatus = (status: string): AgentRun['status'] => {
  if (status === 'completed' || status === 'idle') {
    return 'done'
  }
  return status === 'failed' || status === 'killed' ? 'failed' : 'running'
}

/**
 * `$.agent.list()` 결과로 상태를 갱신한다. 끝난 기록의 종료 시각은 처음 본 때로 고정하고, 목록에만 있는
 * 에이전트(복원 전 시작 등)는 새로 더한다. 목록에서 빠진(엔진이 정리한) 기록은 마지막 상태를 유지한다.
 */
export const applyAgentStatuses = (
  agents: readonly AgentRun[],
  listing: readonly AgentListing[],
  now: number,
): AgentRun[] => {
  const byId = new Map(listing.map(one => [one.id, one]))
  const updated = agents.map(run => {
    const info = byId.get(run.agentId)
    if (info === undefined) {
      return run
    }
    const status = toRunStatus(info.status)
    if (status === 'running') {
      return { ...run, status }
    }
    return { ...run, status, endedAt: run.endedAt ?? now }
  })
  const known = new Set(agents.map(run => run.agentId))
  const added = listing
    .filter(one => !known.has(one.id))
    .map((one): AgentRun => {
      const status = toRunStatus(one.status)
      return status === 'running'
        ? { agentId: one.id, agentType: one.type, status, startedAt: now }
        : { agentId: one.id, agentType: one.type, status, startedAt: now, endedAt: now }
    })
  return [...updated, ...added].slice(-MAX_AGENTS)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** store의 핀 목록을 검증한다. 모양이 틀린 항목은 버린다. */
export const toPins = (value: unknown): Pin[] =>
  Array.isArray(value)
    ? value
        .filter(isRecord)
        .filter(one => typeof one.id === 'string' && typeof one.text === 'string')
        .map(one => ({
          id: String(one.id),
          text: String(one.text),
          createdAt: typeof one.createdAt === 'number' ? one.createdAt : 0,
        }))
        .slice(-MAX_PINS)
    : []

const TASK_KINDS: readonly TaskItem['kind'][] = ['checkbox', 'issue', 'pr']

/** store의 할 일 목록을 검증한다. 모양이 틀린 항목은 버린다. */
export const toTasks = (value: unknown): TaskItem[] =>
  Array.isArray(value)
    ? value
        .filter(isRecord)
        .filter(one => typeof one.id === 'string' && typeof one.text === 'string')
        .map(one => ({
          id: String(one.id),
          text: String(one.text),
          kind: TASK_KINDS.includes(one.kind as TaskItem['kind'])
            ? (one.kind as TaskItem['kind'])
            : 'checkbox',
          isDone: one.isDone === true,
          createdAt: typeof one.createdAt === 'number' ? one.createdAt : 0,
        }))
    : []

/** `session.measure`/`session.usage`가 주는 수치. */
export type UsageReading = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

/** 측정값을 패널 상태로 옮긴다. */
export const toSnapshot = (reading: UsageReading, now: number): UsageSnapshot => ({
  contextPercent: reading.context.percent,
  contextTokens: reading.context.tokens,
  contextWindow: reading.context.window,
  rateLimits: reading.rateLimits.map(({ kind, percentUsed, resetsAt }) =>
    resetsAt === undefined ? { kind, percentUsed } : { kind, percentUsed, resetsAt },
  ),
  costUsd: reading.cost?.usd,
  at: now,
})

/** 임계치를 넘은 경고. `cause`로 세션당 1회만 알린다. */
export type UsageAlert =
  | { cause: string; kind: 'context'; percent: number }
  | { cause: string; kind: 'rate'; limit: string; percent: number }

/** 임계치(80%) 이상인 항목을 경고로 낸다. 이미 알린 원인은 호출 쪽에서 거른다. */
export const usageAlerts = (snapshot: UsageSnapshot, threshold: number = USAGE_THRESHOLD): UsageAlert[] => {
  const alerts: UsageAlert[] = []
  const percent = snapshot.contextPercent
  if (percent !== undefined && percent >= threshold) {
    alerts.push({ cause: CONTEXT_CAUSE, kind: 'context', percent })
  }
  for (const rate of snapshot.rateLimits) {
    if (rate.percentUsed >= threshold) {
      alerts.push({ cause: rateCause(rate.kind), kind: 'rate', limit: rate.kind, percent: rate.percentUsed })
    }
  }
  return alerts
}

/** 토큰 수를 짧게: 1234 → `1.2k`, 200000 → `200k`, 1500000 → `1.5M`. */
export const formatTokens = (count: number): string => {
  if (count >= 1_000_000) {
    return `${trimZero((count / 1_000_000).toFixed(1))}M`
  }
  if (count >= 1_000) {
    return `${trimZero((count / 1_000).toFixed(1))}k`
  }
  return String(count)
}

const trimZero = (text: string): string => text.replace(/\.0$/, '')

/** 한 줄로 만들고 `columns` 칸에 맞춰 자른다(넘치면 끝에 `…`). 폭이 2칸인 문자를 고려한다. */
export const fit = (text: string, columns: number): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  const room = Math.max(1, columns)
  let width = 0
  let out = ''
  for (const ch of line) {
    const cell = isWide(ch) ? 2 : 1
    if (width + cell > room) {
      return `${sliceToWidth(out, room - 1)}…`
    }
    width += cell
    out += ch
  }
  return out
}

const sliceToWidth = (text: string, room: number): string => {
  let width = 0
  let out = ''
  for (const ch of text) {
    const cell = isWide(ch) ? 2 : 1
    if (width + cell > room) {
      break
    }
    width += cell
    out += ch
  }
  return out
}

/** 한글·CJK·전각 문자 판정(대략). */
const isWide = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x1f300
  )
}

/** 목록을 보일 수 있는 줄 수만큼 자른다. 넘치면 마지막 줄을 "외 N개"에 쓰도록 `hidden`을 돌려준다. */
export const visible = <T>(items: readonly T[], rows: number): { shown: T[]; hidden: number } => {
  const room = Math.max(1, rows)
  if (items.length <= room) {
    return { shown: [...items], hidden: 0 }
  }
  const shown = items.slice(0, Math.max(1, room - 1))
  return { shown, hidden: items.length - shown.length }
}
