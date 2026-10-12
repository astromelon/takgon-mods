/**
 * M7 순수 로직: 트리거 판정, 파일명·시각 포맷, fork 프롬프트 조립. `$`를 쓰지 않는다.
 */
import type { HandoffInfo, IssueItem, Lang, Pin, PrStatus, TaskItem } from '../../types'
import { tr } from './messages'

/** 자동 생성 임계치(컨텍스트 사용률 %). M6 경고(80%)보다 먼저 발동한다. */
export const HANDOFF_THRESHOLD = 75

/** store·atom에 남기는 요약 길이. */
export const SUMMARY_LENGTH = 300

/** 같은 분에 만든 파일을 구분하는 접미 번호 상한. */
export const MAX_SUFFIX = 99

/** 프롬프트에 넣는 참고 항목 수 상한(분류별). */
const MAX_REFS = 30

/** 사용률이 임계치 이상이고 이번 세션에 아직 만들지 않았으면 true. */
export const shouldTrigger = (
  percent: number | undefined,
  isFired: boolean,
  threshold: number = HANDOFF_THRESHOLD,
): boolean => !isFired && percent !== undefined && percent >= threshold

/** 유효한 임계치인지: 1~99 정수. */
const isThreshold = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 99

/** 저장된 임계치. 없거나 범위 밖이면 기본 75. */
export const toThreshold = (value: unknown): number => (isThreshold(value) ? value : HANDOFF_THRESHOLD)

const pad = (value: number): string => String(value).padStart(2, '0')

/** 시각(ms)을 로컬 시간 `yyyyMMdd-HHmm`으로. */
export const formatStamp = (ms: number): string => {
  const d = new Date(ms)
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  return `${date}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** 시각(ms)을 로컬 시간 `yyyy-MM-dd HH:mm`으로(표시용). */
export const formatTime = (ms: number): string => {
  const d = new Date(ms)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `n`번째 후보 파일명. 1은 접미 없음, 2부터 `-n`. */
export const handoffFileName = (stamp: string, n: number): string =>
  n <= 1 ? `${stamp}.md` : `${stamp}-${n}.md`

/** 문서 앞부분 요약. */
export const summarize = (text: string): string => text.trim().slice(0, SUMMARY_LENGTH)

/** store에서 읽은 값이 최신본 정보 모양이면 그대로, 아니면 null. */
export const toHandoffInfo = (value: unknown): HandoffInfo | null => {
  const v = value as Partial<HandoffInfo> | null | undefined
  return v && typeof v.path === 'string' && typeof v.summary === 'string' && typeof v.createdAt === 'number'
    ? { path: v.path, summary: v.summary, createdAt: v.createdAt }
    : null
}

/** fork 프롬프트에 함께 넣는 다른 모듈 상태. */
export type HandoffRefs = {
  pins: readonly Pin[]
  pr: PrStatus | null
  linkedIssues: readonly IssueItem[]
  tasks: readonly TaskItem[]
}

const lines = (items: readonly string[], empty: string): string[] =>
  items.length === 0 ? [empty] : items.slice(0, MAX_REFS).map(item => `- ${item}`)

/** 섹션과 참고 자료(핀·PR·이슈·미완료 작업)를 담은 fork 프롬프트. */
export const buildForkPrompt = (lang: Lang, refs: HandoffRefs): string => {
  const empty = tr(lang, 'prompt.empty')
  const sections = (['goal', 'done', 'doing', 'decisions', 'open', 'next'] as const).map(
    key => `## ${tr(lang, `prompt.${key}`)}`,
  )
  const { pr: status } = refs
  const pr = status
    ? [`#${status.number} ${status.url} (review: ${status.reviewDecision || '-'}, checks: ${status.checks})`]
    : []
  return [
    tr(lang, 'prompt.intro'),
    '',
    ...sections,
    '',
    tr(lang, 'prompt.refs'),
    tr(lang, 'prompt.pins'),
    ...lines(refs.pins.map(pin => pin.text), empty),
    tr(lang, 'prompt.pr'),
    ...lines(pr, empty),
    tr(lang, 'prompt.issues'),
    ...lines(refs.linkedIssues.map(i => `${i.identifier} ${i.title} (${i.state}) ${i.url}`), empty),
    tr(lang, 'prompt.tasks'),
    ...lines(refs.tasks.filter(task => !task.isDone).map(task => task.text), empty),
  ].join('\n')
}

/** `/handoff` 인자 해석. `threshold`의 value가 null이면 현재 값 보기. */
export type HandoffAction =
  | 'create'
  | 'show'
  | 'load'
  | 'usage'
  | { kind: 'threshold'; value: number | null }

export const parseHandoffArgs = (args: string): HandoffAction => {
  const [word = '', value, ...rest] = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (word === '') {
    return 'create'
  }
  if (word === 'threshold' && rest.length === 0) {
    if (value === undefined) {
      return { kind: 'threshold', value: null }
    }
    const number = /^\d+$/.test(value) ? Number(value) : Number.NaN
    return isThreshold(number) ? { kind: 'threshold', value: number } : 'usage'
  }
  return (word === 'show' || word === 'load') && value === undefined ? word : 'usage'
}
