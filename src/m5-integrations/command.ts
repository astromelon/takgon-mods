/**
 * `/issue` 인자 해석과 연결 목록 조작의 순수 로직.
 */
import type { IssueItem, Lang } from '../../types'
import { LINK_LIMIT } from './linear'
import { tr } from './messages'

/** `/issue` 인자 해석 결과. */
export type IssueAction =
  | { kind: 'list' }
  | { kind: 'search'; q: string }
  | { kind: 'link'; id: string }
  | { kind: 'unlink'; id: string }
  | { kind: 'status'; id: string; state: string }
  | { kind: 'usage' }

/** `/issue` 인자를 해석한다. link/unlink/status는 인자가 모자라면 usage, 그 밖의 입력은 검색어. */
export const parseIssueArgs = (args: string): IssueAction => {
  const trimmed = args.trim()
  if (trimmed === '') {
    return { kind: 'list' }
  }
  const [head = '', ...rest] = trimmed.split(/\s+/)
  const sub = head.toLowerCase()
  if (sub === 'link' || sub === 'unlink') {
    const [id] = rest
    return id === undefined || rest.length > 1
      ? { kind: 'usage' }
      : { kind: sub, id: id.toUpperCase() }
  }
  if (sub === 'status') {
    const [id, ...state] = rest
    return id === undefined || state.length === 0
      ? { kind: 'usage' }
      : { kind: 'status', id: id.toUpperCase(), state: state.join(' ') }
  }
  return { kind: 'search', q: trimmed }
}

/** 연결 추가 결과. */
export type LinkResult =
  | { kind: 'added'; list: IssueItem[] }
  | { kind: 'duplicate' }
  | { kind: 'full' }

/** 연결 목록에 추가한다. 같은 identifier는 무시하고 상한을 넘기지 않는다. */
export const addLinked = (
  list: readonly IssueItem[],
  item: IssueItem,
  max = LINK_LIMIT,
): LinkResult => {
  if (list.some(one => one.identifier === item.identifier)) {
    return { kind: 'duplicate' }
  }
  return list.length >= max ? { kind: 'full' } : { kind: 'added', list: [...list, item] }
}

/** 연결 목록에서 identifier를 뺀다. 없었으면 null. */
export const removeLinked = (
  list: readonly IssueItem[],
  identifier: string,
): IssueItem[] | null => {
  const next = list.filter(one => one.identifier.toUpperCase() !== identifier.toUpperCase())
  return next.length === list.length ? null : next
}

/** 같은 identifier 항목을 새 값으로 바꾼다(상태 변경 반영). */
export const replaceIssue = (list: readonly IssueItem[], item: IssueItem): IssueItem[] =>
  list.map(one => (one.identifier === item.identifier ? item : one))

/** store에 저장된 값을 IssueItem 목록으로 맞춘다. */
export const toIssueList = (value: unknown): IssueItem[] =>
  (Array.isArray(value) ? value : [])
    .filter(
      (one): one is IssueItem =>
        one !== null &&
        typeof one === 'object' &&
        typeof (one as IssueItem).identifier === 'string' &&
        typeof (one as IssueItem).title === 'string',
    )
    .slice(0, LINK_LIMIT)

/** 이슈 목록 텍스트. */
export const formatIssues = (lang: Lang, title: string, items: readonly IssueItem[]): string =>
  [title, ...items.map(item => tr(lang, 'issue.row', { ...item }))].join('\n')
