/**
 * GitHub PR 상태(`gh pr view --json ...`)의 순수 해석.
 *
 * `$`를 받지 않는다. 실행은 `index.tsx`가 하고 여기서는 출력·종료 코드만 해석한다.
 */
import type { PrStatus } from '../../types'

/** `gh pr view`에 넘기는 인자. */
export const GH_PR_VIEW = [
  'gh',
  'pr',
  'view',
  '--json',
  'number,url,reviewDecision,statusCheckRollup',
] as const

/** gh 실행 타임아웃. */
export const GH_TIMEOUT_MS = 15_000

/** 실패 원인. `no-pr`은 조용히 숨기고 나머지는 원인별 toast 1회. */
export type GhFailure = 'gh-missing' | 'gh-auth' | 'no-pr'

type RollupItem = { status?: unknown; conclusion?: unknown; state?: unknown }

const FAILED = new Set([
  'FAILURE',
  'ERROR',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
])
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED', 'STALE'])

/** 체크 한 건 → 'success' | 'failure' | 'pending'. CheckRun(status·conclusion)과 StatusContext(state) 둘 다 받는다. */
const checkOf = (item: RollupItem): 'success' | 'failure' | 'pending' => {
  const conclusion = typeof item.conclusion === 'string' ? item.conclusion.toUpperCase() : ''
  const state = typeof item.state === 'string' ? item.state.toUpperCase() : ''
  const status = typeof item.status === 'string' ? item.status.toUpperCase() : ''
  const verdict = conclusion || state
  if (FAILED.has(verdict)) {
    return 'failure'
  }
  if (status !== '' && status !== 'COMPLETED') {
    return 'pending'
  }
  return PASSED.has(verdict) ? 'success' : 'pending'
}

/** statusCheckRollup 집계: 비었으면 none, 하나라도 실패면 failure, 진행 중이 있으면 pending, 아니면 success. */
export const aggregateChecks = (rollup: unknown): PrStatus['checks'] => {
  if (!Array.isArray(rollup) || rollup.length === 0) {
    return 'none'
  }
  const checks = rollup.map(item => checkOf((item ?? {}) as RollupItem))
  if (checks.includes('failure')) {
    return 'failure'
  }
  return checks.includes('pending') ? 'pending' : 'success'
}

/** `gh pr view` 표준 출력 → PrStatus. 형식이 맞지 않으면 null. */
export const parsePrView = (stdout: string): PrStatus | null => {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  const view = (raw ?? {}) as Record<string, unknown>
  if (typeof view.number !== 'number' || typeof view.url !== 'string') {
    return null
  }
  return {
    number: view.number,
    url: view.url,
    reviewDecision: typeof view.reviewDecision === 'string' ? view.reviewDecision : '',
    checks: aggregateChecks(view.statusCheckRollup),
  }
}

/** 0이 아닌 종료를 원인으로 나눈다. 인증 실패(exit 4 또는 안내 문구)만 따로, 나머지는 PR 없음으로 본다. */
export const classifyGhExit = (exitCode: number, stderr: string): GhFailure =>
  exitCode === 4 || /gh auth login|not logged in|authentication/i.test(stderr) ? 'gh-auth' : 'no-pr'

/** 직전 갱신 후 `minGapMs` 이내면 갱신을 건너뛴다. */
export const shouldRefresh = (now: number, lastAt: number | null, minGapMs: number): boolean =>
  lastAt === null || now - lastAt >= minGapMs
