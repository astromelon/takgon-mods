/**
 * M4 Composer Bar의 순수 로직: PR 배지 문구, Next-steps 파싱·병합, 코치 휴리스틱·응답 파싱.
 *
 * `$`를 받지 않는다(엔진은 `$`를 import 경계 너머로 넘기는 것을 거부한다). store·state·ui 호출은 index.tsx에 둔다.
 */
import type { Lang, PrStatus, TaskItem } from '../../types'
import { tr } from './messages'
import type { ComposerKey } from './messages'

/** band에 그리는 미완료 task 최대 개수. */
export const BAND_TASKS = 3

/** 유지하는 task 최대 개수. */
export const MAX_TASKS = 20

/** Next-steps fork 최소 간격(ms). */
export const FORK_INTERVAL_MS = 120_000

/** 한 task 문장의 최대 길이. */
const MAX_TASK_TEXT = 200

/** 코치가 모델에 묻는 입력 최대 길이. 이보다 길면 충분히 구체적이라고 본다. */
const COACH_MAX_LENGTH = 80

const REVIEWS = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'] as const
const KINDS: readonly TaskItem['kind'][] = ['checkbox', 'issue', 'pr']

/** `PR #12 · 승인됨 · 체크 실패`(GitLab은 `MR !12 …`). 비어 있거나 모르는 상태는 생략한다. */
export const formatPrBadge = (lang: Lang, pr: PrStatus): string => {
  const parts = [tr(lang, pr.provider === 'gitlab' ? 'mr.badge' : 'pr.badge', { number: pr.number })]
  const review = REVIEWS.find(one => one === pr.reviewDecision)
  if (review !== undefined) {
    parts.push(tr(lang, `pr.review.${review}`))
  }
  if (pr.checks !== 'none') {
    parts.push(tr(lang, `pr.checks.${pr.checks}` as ComposerKey))
  }
  return parts.join(' · ')
}

/** 터미널 칸 기준 글자 폭(한글·CJK·전각은 2칸). */
const cellWidth = (char: string): number => {
  const code = char.codePointAt(0) ?? 0
  const isWide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  return isWide ? 2 : 1
}

/** `width` 칸에 맞게 자르고 끝에 `…`를 붙인다. */
export const fit = (text: string, width: number): string => {
  const chars = [...text]
  const total = chars.reduce((sum, char) => sum + cellWidth(char), 0)
  if (total <= width) {
    return text
  }
  let used = 0
  let out = ''
  for (const char of chars) {
    const next = used + cellWidth(char)
    if (next > width - 1) {
      break
    }
    used = next
    out += char
  }
  return `${out}…`
}

/** 모델 응답에서 첫 `open`…마지막 `close` 구간을 JSON으로 읽는다. 실패하면 undefined. */
const extractJson = (text: string, open: string, close: string): unknown => {
  const start = text.indexOf(open)
  const end = text.lastIndexOf(close)
  if (start < 0 || end <= start) {
    return undefined
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown
  } catch {
    return undefined
  }
}

/** Next-steps 후보 한 건. */
export type NextStep = { text: string; kind: TaskItem['kind'] }

/** fork 응답(JSON 배열: 문자열 또는 `{text, kind}`)을 최대 3개로 파싱한다. 실패는 빈 목록. */
export const parseNextSteps = (text: string): NextStep[] => {
  const parsed = extractJson(text, '[', ']')
  if (!Array.isArray(parsed)) {
    return []
  }
  const steps: NextStep[] = []
  for (const item of parsed) {
    const raw = typeof item === 'string' ? { text: item } : (item as Partial<Record<string, unknown>>)
    if (raw === null || typeof raw !== 'object' || typeof raw.text !== 'string') {
      continue
    }
    const one = raw.text.trim().slice(0, MAX_TASK_TEXT)
    if (one === '') {
      continue
    }
    const kind = KINDS.find(k => k === raw.kind) ?? 'checkbox'
    steps.push({ text: one, kind })
    if (steps.length === BAND_TASKS) {
      break
    }
  }
  return steps
}

/** 중복 판정용 정규화: 공백 압축·소문자. */
const normalize = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase()

/** 미완료 우선, 각 그룹은 최근 순. */
const byPriority = (a: TaskItem, b: TaskItem): number =>
  Number(a.isDone) - Number(b.isDone) || b.createdAt - a.createdAt

/** 새 후보를 기존 목록에 더한다. 같은 text는 빼고, 미완료 우선 최근 20개만 남긴다. */
export const mergeTasks = (
  existing: readonly TaskItem[],
  steps: readonly NextStep[],
  now: number,
): TaskItem[] => {
  const seen = new Set(existing.map(one => normalize(one.text)))
  const added: TaskItem[] = []
  steps.forEach((step, index) => {
    const key = normalize(step.text)
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    const id = `${now.toString(36)}-${index}`
    added.push({ id, text: step.text, kind: step.kind, isDone: false, createdAt: now })
  })
  return [...added, ...existing].sort(byPriority).slice(0, MAX_TASKS)
}

/** store 값을 TaskItem 목록으로 검증한다. 형식이 틀린 항목은 버린다. */
export const toTasks = (value: unknown): TaskItem[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is TaskItem => {
    const one = item as Partial<TaskItem> | null
    return (
      one !== null &&
      typeof one === 'object' &&
      typeof one.id === 'string' &&
      typeof one.text === 'string' &&
      KINDS.includes(one.kind as TaskItem['kind']) &&
      typeof one.isDone === 'boolean' &&
      typeof one.createdAt === 'number'
    )
  })
}

/** `id`의 완료 상태를 뒤집는다. */
export const toggleTask = (tasks: readonly TaskItem[], id: string): TaskItem[] =>
  tasks.map(one => (one.id === id ? { ...one, isDone: !one.isDone } : one))

/** band에 그릴 미완료 task(최근 순 최대 3개). */
export const openTasks = (tasks: readonly TaskItem[]): TaskItem[] =>
  tasks.filter(one => !one.isDone).sort(byPriority).slice(0, BAND_TASKS)

/** `$.session.messages()` 한 줄 중 판정에 쓰는 부분. */
type MessageLike = {
  role: 'user' | 'assistant'
  toolUses: readonly unknown[]
  toolResults?: readonly unknown[]
}

/** 마지막 사용자 프롬프트(도구 결과가 아닌 user 메시지) 이후 assistant가 도구를 썼는지. */
export const hadToolUseThisTurn = (messages: readonly MessageLike[]): boolean => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const one = messages[i]
    if (one === undefined) {
      break
    }
    if (one.role === 'assistant' && one.toolUses.length > 0) {
      return true
    }
    if (one.role === 'user' && (one.toolResults?.length ?? 0) === 0) {
      return false
    }
  }
  return false
}

/** 도구를 쓴 턴이고 직전 생성 후 2분이 지났을 때만 fork한다. */
export const shouldFork = (hadTools: boolean, lastAt: number | undefined, now: number): boolean =>
  hadTools && (lastAt === undefined || now - lastAt >= FORK_INTERVAL_MS)

/** 그대로 진행해도 되는 짧은 확정 응답. */
const CONFIRMATIONS = new Set([
  'y', 'n', 'yes', 'no', 'ok', 'okay', 'go', 'continue', 'proceed', 'thanks', 'thank you', 'lgtm',
  '네', '예', '응', '어', '아니', '아니요', '좋아', '좋아요', '계속', '계속해', '계속해줘', '진행', '진행해',
  '진행해줘', '고마워', '감사합니다', 'ㅇㅇ', 'ㄱㄱ',
])

/** 구체성 신호: 파일 경로·확장자, 코드, URL, camelCase/snake_case·호출 식별자, 줄 번호. */
const SPECIFIC = [
  /`/,
  /https?:\/\//,
  /[\w-]+\.[a-z0-9]{1,6}\b/i,
  /[\w.-]*[/\\][\w.-]+/,
  /\b[a-z]+[A-Z]\w*/,
  /\b[A-Z][a-z]+[A-Z]\w*/,
  /\b\w+_\w+/,
  /\w+\(\)/,
  /#\d+|:\d+/,
]

/** 모델에 물어볼 만큼 짧고 모호한 요청인지. 슬래시 명령·확정 응답·구체적인 요청은 건너뛴다. */
export const needsCoach = (text: string): boolean => {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.startsWith('/') || trimmed.length > COACH_MAX_LENGTH) {
    return false
  }
  if (CONFIRMATIONS.has(normalize(trimmed).replace(/[.!?~]+$/, ''))) {
    return false
  }
  return !SPECIFIC.some(pattern => pattern.test(trimmed))
}

/** 코치 응답. */
export type CoachReply = { ambiguous: boolean; refined: string }

/** 코치 모델 응답(JSON `{ambiguous, refined}`)을 파싱한다. 형식이 틀리면 null. */
export const parseCoachReply = (text: string): CoachReply | null => {
  const parsed = extractJson(text, '{', '}') as Partial<Record<string, unknown>> | undefined
  if (parsed === undefined || parsed === null || typeof parsed !== 'object') {
    return null
  }
  if (typeof parsed.ambiguous !== 'boolean') {
    return null
  }
  const refined = typeof parsed.refined === 'string' ? parsed.refined.trim() : ''
  return { ambiguous: parsed.ambiguous, refined }
}

/** `/coach` 인자 해석 결과. */
export type CoachAction = { kind: 'show' } | { kind: 'set'; isOn: boolean } | { kind: 'usage' }

/** `/coach` 인자를 해석한다. */
export const parseCoachArgs = (args: string): CoachAction => {
  const value = args.trim().toLowerCase()
  if (value === '') {
    return { kind: 'show' }
  }
  if (value === 'on' || value === 'off') {
    return { kind: 'set', isOn: value === 'on' }
  }
  return { kind: 'usage' }
}

/** Next-steps fork 프롬프트. 이미 있는 미완료 항목은 다시 제안하지 않게 알려준다. */
export const buildForkPrompt = (lang: Lang, existing: readonly TaskItem[]): string => {
  const open = existing.filter(one => !one.isDone).map(one => `- ${one.text}`)
  const head = tr(lang, 'fork.prompt')
  return open.length === 0 ? head : `${head}\n\n${tr(lang, 'fork.existing', { items: open.join('\n') })}`
}
