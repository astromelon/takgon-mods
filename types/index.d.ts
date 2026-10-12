/** UI 언어. */
export type Lang = 'ko' | 'en'

/** `/mods`로 켜고 끄는 모듈 식별자. */
export type ModuleId =
  | 'i18n'
  | 'integrations'
  | 'composer'
  | 'panel'
  | 'handoff'
  | 'browser'
  | 'edit'
  | 'diagram'

/** 모듈별 on/off. 저장된 값이 없는 모듈은 on으로 본다. */
export type ModuleFlags = Record<ModuleId, boolean>

// ── M5 integrations ────────────────────────────────────────────────

/** 현재 브랜치 PR(GitHub, gh pr view) 또는 MR(GitLab, glab mr view) 요약. */
export type PrStatus = {
  number: number
  url: string
  /** `APPROVED` | `CHANGES_REQUESTED` | `REVIEW_REQUIRED` | '' */
  reviewDecision: string
  /** 체크 집계(GitLab은 파이프라인 상태). */
  checks: 'success' | 'failure' | 'pending' | 'none'
  /** 어느 forge의 것인지. 없으면 github(GitHub PR). gitlab이면 배지를 `MR !n`으로 그린다. */
  provider?: 'github' | 'gitlab'
}

/** Linear 이슈 한 건. */
export type IssueItem = { id: string; identifier: string; title: string; url: string; state: string }

// ── M4 composer / M6 tasks ─────────────────────────────────────────

/** Next-steps 후보 한 건. M6 Tasks 탭과 같은 목록을 공유한다. */
export type TaskItem = {
  id: string
  text: string
  /** 렌더러 종류. */
  kind: 'checkbox' | 'issue' | 'pr'
  isDone: boolean
  createdAt: number
}

// ── M6 panel ───────────────────────────────────────────────────────

export type PanelTab = 'pinboard' | 'tasks' | 'agents' | 'usage' | 'handoff'

export type Pin = { id: string; text: string; createdAt: number }

export type AgentRun = {
  agentId: string
  agentType: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
}

export type UsageSnapshot = {
  contextPercent?: number
  contextTokens?: number
  contextWindow: number
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  costUsd?: number
  at: number
}

// ── M7 handoff ─────────────────────────────────────────────────────

export type HandoffInfo = { path: string; summary: string; createdAt: number }

// ── M2 browser ─────────────────────────────────────────────────────

export type BrowserInfo = {
  url: string
  /** HTTP 상태. 확인 전 또는 실패 시 0. */
  status: number
  title?: string
  consoleErrors: string[]
  /** 마지막 스크린샷 PNG 절대 경로. */
  screenshot?: string
  checkedAt: number
}

// ── M3 edit ────────────────────────────────────────────────────────

export type EditTarget =
  | { kind: 'text'; path: string; startLine: number; endLine: number; excerpt: string }
  | { kind: 'dom'; url: string; selector: string; computedStyle: Record<string, string>; screenshot?: string }

// ── M8 diagram ─────────────────────────────────────────────────────

export type DiagramRender = {
  /** 코드 해시. */
  hash: string
  svgPath?: string
  pngPath?: string
  /** SVG 원문(desktop 표시용, 131072자 이하일 때만). */
  svg?: string
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'takgon-mods': {
      // core
      lang: Lang
      modules: ModuleFlags
      projectId: string
      notified: string[]
      /**
       * 이번 세션에 store에서 복원을 마친 모듈 표시('core', 'm4' …). `/clear`·`/resume`은 state를 비우고
       * `session.start`도 다시 오지 않으므로(classic.SessionStart는 user 플러그인에 전달되지 않음), 비어 있으면
       * 다음 프롬프트·명령에서 각 모듈이 다시 복원한다.
       */
      restored: string[]

      // M5 integrations
      pr: PrStatus | null
      issueResults: IssueItem[]
      linkedIssues: IssueItem[]

      // M4 composer (tasks는 M6와 공유)
      tasks: TaskItem[]
      coachOn: boolean

      // M6 panel
      panelTab: PanelTab
      pins: Pin[]
      agents: AgentRun[]
      usage: UsageSnapshot | null

      // M7 handoff
      handoff: HandoffInfo | null
      handoffPending: boolean
      handoffFired: boolean

      // M2 browser
      browser: BrowserInfo | null
      attachConsole: boolean

      // M3 edit
      editTarget: EditTarget | null

      // M8 diagram
      diagrams: Record<string, DiagramRender>
      diagramSource: string[]
    }
  }
}
