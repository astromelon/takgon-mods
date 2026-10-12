/**
 * Linear GraphQL 요청 본문과 응답의 순수 해석.
 *
 * 쿼리는 변수(`variables`)로만 값을 넘겨 사용자 입력이 쿼리 문자열에 섞이지 않게 한다.
 * API 키는 여기서 다루지 않는다(`index.tsx`가 헤더에만 넣는다).
 */
import type { IssueItem } from '../../types'

/** Linear GraphQL 엔드포인트. */
export const LINEAR_URL = 'https://api.linear.app/graphql'

/** 검색 결과 상한. */
export const SEARCH_LIMIT = 10

/** 프로젝트당 연결 이슈 상한. */
export const LINK_LIMIT = 20

const ISSUE_FIELDS = 'id identifier title url state { name }'

const SEARCH_QUERY = `query Search($term: String!, $first: Int!) {
  searchIssues(term: $term, first: $first) { nodes { ${ISSUE_FIELDS} } }
}`

const ISSUE_QUERY = `query Issue($id: String!) {
  issue(id: $id) { ${ISSUE_FIELDS} team { states { nodes { id name } } } }
}`

const UPDATE_MUTATION = `mutation SetState($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { ${ISSUE_FIELDS} } }
}`

/** 이슈 검색 요청 본문. */
export const searchBody = (term: string): string =>
  JSON.stringify({ query: SEARCH_QUERY, variables: { term, first: SEARCH_LIMIT } })

/** 이슈 한 건(+팀 workflow states) 조회 요청 본문. `id`는 UUID 또는 `ENG-123` 같은 identifier. */
export const issueBody = (id: string): string =>
  JSON.stringify({ query: ISSUE_QUERY, variables: { id } })

/** 상태 변경 요청 본문. */
export const updateBody = (id: string, stateId: string): string =>
  JSON.stringify({ query: UPDATE_MUTATION, variables: { id, stateId } })

/** 팀 workflow state 한 건. */
export type WorkflowState = { id: string; name: string }

type Json = Record<string, unknown>

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null

/** GraphQL 응답의 `data`. JSON이 아니거나 `errors`가 있으면 null. */
const dataOf = (text: string): Json | null => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const body = asObject(raw)
  if (body === null || (Array.isArray(body.errors) && body.errors.length > 0)) {
    return null
  }
  return asObject(body.data)
}

/** 노드 → IssueItem. 필수 필드가 없으면 null. */
export const toIssue = (node: unknown): IssueItem | null => {
  const n = asObject(node)
  if (n === null) {
    return null
  }
  const { id, identifier, title, url } = n
  if (typeof id !== 'string' || typeof identifier !== 'string' || typeof title !== 'string') {
    return null
  }
  const state = asObject(n.state)?.name
  return {
    id,
    identifier,
    title,
    url: typeof url === 'string' ? url : '',
    state: typeof state === 'string' ? state : '',
  }
}

/** 검색 응답 → 이슈 목록(최대 SEARCH_LIMIT). 형식 오류면 null. */
export const parseSearch = (text: string): IssueItem[] | null => {
  const nodes = asObject(dataOf(text)?.searchIssues)?.nodes
  if (!Array.isArray(nodes)) {
    return null
  }
  return nodes
    .map(toIssue)
    .filter((item): item is IssueItem => item !== null)
    .slice(0, SEARCH_LIMIT)
}

/** 이슈 조회 결과. 응답 형식 오류는 `error`, 이슈 없음은 `missing`. */
export type IssueLookup =
  | { kind: 'found'; issue: IssueItem; states: WorkflowState[] }
  | { kind: 'missing' }
  | { kind: 'error' }

/** 이슈 조회 응답 해석. Linear는 없는 이슈를 `errors`로 답하므로 data가 비면 missing으로 본다. */
export const parseIssue = (text: string): IssueLookup => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { kind: 'error' }
  }
  const node = asObject(asObject(asObject(raw)?.data)?.issue)
  const issue = toIssue(node)
  if (issue === null) {
    return { kind: 'missing' }
  }
  const nodes = asObject(asObject(node?.team)?.states)?.nodes
  const states = (Array.isArray(nodes) ? nodes : [])
    .map(asObject)
    .filter((s): s is Json => s !== null && typeof s.id === 'string' && typeof s.name === 'string')
    .map(s => ({ id: s.id as string, name: s.name as string }))
  return { kind: 'found', issue, states }
}

/** 상태 변경 응답 → 변경된 이슈. 실패면 null. */
export const parseUpdate = (text: string): IssueItem | null => {
  const result = asObject(dataOf(text)?.issueUpdate)
  return result?.success === true ? toIssue(result.issue) : null
}

/** 상태 이름으로 workflow state를 찾는다(대소문자·앞뒤 공백 무시). */
export const findState = (
  states: readonly WorkflowState[],
  name: string,
): WorkflowState | undefined => {
  const wanted = name.trim().toLowerCase()
  return states.find(s => s.name.trim().toLowerCase() === wanted)
}

/** HTTP 실패 원인. 401·403은 인증, 나머지는 일반 실패. */
export const httpFailure = (status: number): 'linear-auth' | 'linear-http' =>
  status === 401 || status === 403 ? 'linear-auth' : 'linear-http'
