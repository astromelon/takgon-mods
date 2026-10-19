/**
 * M4 Next-steps와 M6 Tasks 탭이 같은 store 키(`p/{pid}/m4/tasks`)로 공유하는 할 일 목록의 순수 로직.
 */
import type { TaskItem } from '../../types'

const KINDS: readonly TaskItem['kind'][] = ['checkbox', 'issue', 'pr']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * store의 할 일 목록을 검증한다. id·text가 문자열이 아닌 항목만 버리고, 나머지 필드는 기본값으로 채워
 * 기존 데이터를 잃지 않는다(kind 불명은 checkbox, isDone은 `true`일 때만 완료, createdAt이 숫자가 아니면 0).
 */
export const toTasks = (value: unknown): TaskItem[] =>
  Array.isArray(value)
    ? value
        .filter(isRecord)
        .filter(one => typeof one.id === 'string' && typeof one.text === 'string')
        .map(one => ({
          id: String(one.id),
          text: String(one.text),
          kind: KINDS.includes(one.kind as TaskItem['kind']) ? (one.kind as TaskItem['kind']) : 'checkbox',
          isDone: one.isDone === true,
          createdAt: typeof one.createdAt === 'number' ? one.createdAt : 0,
        }))
    : []

/** `id`의 완료 상태를 뒤집는다. */
export const toggleTask = (tasks: readonly TaskItem[], id: string): TaskItem[] =>
  tasks.map(one => (one.id === id ? { ...one, isDone: !one.isDone } : one))
