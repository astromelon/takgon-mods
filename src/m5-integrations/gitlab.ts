/**
 * forge 판별과 GitLab MR 상태(`glab mr view -F json`, 승인 API)의 순수 해석.
 *
 * `$`를 받지 않는다. 실행은 `index.tsx`가 하고 여기서는 출력·종료 코드만 해석한다.
 */
import type { PrStatus } from '../../types'

/** 원격 주소를 읽는 명령. */
export const GIT_REMOTE_URL = ['git', 'remote', 'get-url', 'origin'] as const

/** 현재 브랜치 MR 조회. 인자 없이 부르면 glab이 현재 브랜치의 MR을 고른다. */
export const GLAB_MR_VIEW = ['glab', 'mr', 'view', '-F', 'json'] as const

/** 승인 상태 조회. `:id`는 glab이 현재 저장소의 프로젝트로 바꿔 준다. */
export const glabApprovals = (iid: number): readonly string[] => [
  'glab',
  'api',
  `projects/:id/merge_requests/${iid}/approvals`,
]

/** 실패 원인. `no-pr`은 조용히 숨기고 나머지는 원인별 toast 1회. */
export type GlabFailure = 'glab-missing' | 'glab-auth' | 'no-pr'

/** 어느 CLI로 조회할지. */
export type Forge = 'github' | 'gitlab'

/**
 * 원격 주소 → forge. github.com이면 GitHub, 그 밖의 호스트(gitlab.com, 사내 셀프호스팅)는 GitLab으로 본다.
 * 원격이 없으면 null(배지를 조용히 숨긴다).
 */
export const detectForge = (remoteUrl: string): Forge | null => {
  const url = remoteUrl.trim()
  if (url === '') {
    return null
  }
  return /(^|[@/.])github\.com[:/]/i.test(url) ? 'github' : 'gitlab'
}

/** GitLab 파이프라인 상태 → 체크 집계. */
const checksOf = (pipeline: unknown): PrStatus['checks'] => {
  const status =
    pipeline !== null && typeof pipeline === 'object'
      ? String((pipeline as Record<string, unknown>).status ?? '')
      : ''
  if (status === '') {
    return 'none'
  }
  if (status === 'success') {
    return 'success'
  }
  if (status === 'failed' || status === 'canceled') {
    return 'failure'
  }
  return status === 'skipped' ? 'none' : 'pending'
}

/** `detailed_merge_status` → 리뷰 상태(승인 API로 더 정확히 덮어쓴다). */
const reviewOf = (detailed: unknown): string => {
  if (detailed === 'requested_changes') {
    return 'CHANGES_REQUESTED'
  }
  return detailed === 'not_approved' ? 'REVIEW_REQUIRED' : ''
}

/** `glab mr view -F json` 표준 출력 → PrStatus. 형식이 맞지 않으면 null. */
export const parseMrView = (stdout: string): PrStatus | null => {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  const view = (raw ?? {}) as Record<string, unknown>
  if (typeof view.iid !== 'number' || typeof view.web_url !== 'string') {
    return null
  }
  return {
    number: view.iid,
    url: view.web_url,
    reviewDecision: reviewOf(view.detailed_merge_status),
    checks: checksOf(view.head_pipeline ?? view.pipeline),
    provider: 'gitlab',
  }
}

/**
 * 승인 API 응답으로 리뷰 상태를 정한다. 변경 요청은 승인보다 우선하고, 응답을 읽지 못하면 기존 값을 둔다.
 * 승인자가 실제로 있을 때만 APPROVED(승인 규칙이 없는 프로젝트는 `approved: true`만 오므로 빈 값).
 */
export const approvalDecision = (current: string, stdout: string): string => {
  if (current === 'CHANGES_REQUESTED') {
    return current
  }
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return current
  }
  const body = (raw ?? {}) as Record<string, unknown>
  const approvers = Array.isArray(body.approved_by) ? body.approved_by.length : 0
  if (body.approved === true && approvers > 0) {
    return 'APPROVED'
  }
  if (typeof body.approvals_left === 'number' && body.approvals_left > 0) {
    return 'REVIEW_REQUIRED'
  }
  return body.approved === true ? '' : current
}

/** 0이 아닌 종료를 원인으로 나눈다. 인증 실패만 따로, 나머지(MR 없음 등)는 조용히 숨긴다. */
export const classifyGlabExit = (exitCode: number, stderr: string): GlabFailure =>
  exitCode !== 0 && /401|unauthorized|glab auth login|no token|authenticat/i.test(stderr)
    ? 'glab-auth'
    : 'no-pr'
