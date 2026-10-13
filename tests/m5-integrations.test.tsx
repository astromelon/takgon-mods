import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { projectId } from '../src/shared/keys'
import { addLinked, parseIssueArgs, removeLinked } from '../src/m5-integrations/command'
import {
  aggregateChecks,
  classifyGhExit,
  parsePrView,
  shouldRefresh,
} from '../src/m5-integrations/github'
import {
  approvalDecision,
  classifyGlabExit,
  detectForge,
  parseMrView,
} from '../src/m5-integrations/gitlab'
import { findState, parseIssue, parseSearch, searchBody } from '../src/m5-integrations/linear'
import { tr } from '../src/m5-integrations/messages'

const ISSUE_A = {
  id: 'u1',
  identifier: 'ENG-1',
  title: '로그인 버그',
  url: 'https://linear.app/x/ENG-1',
  state: 'Todo',
}
const ISSUE_B = {
  id: 'u2',
  identifier: 'ENG-2',
  title: '검색 개선',
  url: 'https://linear.app/x/ENG-2',
  state: 'In Progress',
}

describe('GitHub 해석(순수)', () => {
  test('statusCheckRollup 집계', () => {
    expect(aggregateChecks([])).toBe('none')
    expect(aggregateChecks(undefined)).toBe('none')
    expect(
      aggregateChecks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }]),
    ).toBe('success')
    expect(aggregateChecks([{ status: 'IN_PROGRESS', conclusion: '' }, { state: 'SUCCESS' }])).toBe(
      'pending',
    )
    expect(aggregateChecks([{ state: 'PENDING' }])).toBe('pending')
    expect(
      aggregateChecks([{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }]),
    ).toBe('failure')
    expect(aggregateChecks([{ state: 'ERROR' }])).toBe('failure')
    expect(aggregateChecks([{ status: 'COMPLETED', conclusion: 'SKIPPED' }])).toBe('success')
  })

  test('gh pr view 출력 해석과 실패 분류', () => {
    const pr = parsePrView(
      JSON.stringify({
        number: 7,
        url: 'https://github.com/o/r/pull/7',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [],
      }),
    )
    expect(pr).toEqual({
      number: 7,
      url: 'https://github.com/o/r/pull/7',
      reviewDecision: 'APPROVED',
      checks: 'none',
    })
    expect(parsePrView('not json')).toBeNull()
    expect(classifyGhExit(1, 'no pull requests found for branch "main"')).toBe('no-pr')
    expect(classifyGhExit(4, 'To get started with GitHub CLI, please run:  gh auth login')).toBe(
      'gh-auth',
    )
  })

  test('갱신 간격 판정', () => {
    expect(shouldRefresh(5_000, null, 10_000)).toBe(true)
    expect(shouldRefresh(15_000, 10_000, 10_000)).toBe(false)
    expect(shouldRefresh(20_000, 10_000, 10_000)).toBe(true)
  })
})

describe('GitLab 해석(순수)', () => {
  test('원격 주소로 forge를 고른다', () => {
    expect(detectForge('https://github.com/o/r.git')).toBe('github')
    expect(detectForge('git@github.com:o/r.git')).toBe('github')
    expect(detectForge('http://192.168.0.135:8030/nred/aichatbot.git')).toBe('gitlab')
    expect(detectForge('git@gitlab.com:g/p.git')).toBe('gitlab')
    expect(detectForge('')).toBeNull()
  })

  test('glab mr view JSON → MR 상태(파이프라인·변경 요청)', () => {
    const mr = (extra: Record<string, unknown>) =>
      parseMrView(JSON.stringify({ iid: 12, web_url: 'http://gl/g/p/-/merge_requests/12', ...extra }))
    expect(mr({ head_pipeline: { status: 'success' } })).toEqual({
      number: 12,
      url: 'http://gl/g/p/-/merge_requests/12',
      reviewDecision: '',
      checks: 'success',
      provider: 'gitlab',
    })
    expect(mr({ head_pipeline: { status: 'running' } })?.checks).toBe('pending')
    expect(mr({ pipeline: { status: 'failed' } })?.checks).toBe('failure')
    expect(mr({ head_pipeline: null })?.checks).toBe('none')
    expect(mr({ detailed_merge_status: 'requested_changes' })?.reviewDecision).toBe('CHANGES_REQUESTED')
    expect(mr({ detailed_merge_status: 'not_approved' })?.reviewDecision).toBe('REVIEW_REQUIRED')
    expect(parseMrView('{}')).toBeNull()
    expect(parseMrView('oops')).toBeNull()
  })

  test('승인 API 결과로 리뷰 상태를 정하고, 변경 요청이 우선한다', () => {
    expect(approvalDecision('', JSON.stringify({ approved: true, approved_by: [{ user: {} }] }))).toBe('APPROVED')
    expect(approvalDecision('', JSON.stringify({ approved: false, approvals_left: 1 }))).toBe('REVIEW_REQUIRED')
    expect(approvalDecision('', JSON.stringify({ approved: true, approved_by: [] }))).toBe('')
    expect(approvalDecision('CHANGES_REQUESTED', JSON.stringify({ approved: true, approved_by: [{}] }))).toBe(
      'CHANGES_REQUESTED',
    )
    expect(approvalDecision('REVIEW_REQUIRED', 'not json')).toBe('REVIEW_REQUIRED')
  })

  test('glab 실패 분류', () => {
    expect(classifyGlabExit(1, 'ERROR: 401 Unauthorized. To authenticate, run glab auth login')).toBe('glab-auth')
    expect(classifyGlabExit(1, 'no open merge request available for "main"')).toBe('no-pr')
  })
})

describe('GitLab MR 폴링', () => {
  test('GitLab 원격이면 glab으로 MR·승인을 읽어 band에 MR 배지를 띄운다', async ($, on) => {
    const calls: string[] = []
    engine(
      on,
      argv => {
        calls.push(argv.slice(0, 3).join(' '))
        if (argv[1] === 'api') {
          return { exitCode: 0, stdout: JSON.stringify({ approved: true, approved_by: [{ user: { username: 'a' } }] }), stderr: '' }
        }
        const view = { iid: 12, web_url: 'http://gl/nred/aichatbot/-/merge_requests/12', head_pipeline: { status: 'success' } }
        return { exitCode: 0, stdout: JSON.stringify(view), stderr: '' }
      },
      [],
      'http://192.168.0.135:8030/nred/aichatbot.git',
    )
    const clock = mock.clock(on)
    mock.store(on)
    mock.env(on, {})

    await $.session.start(START)
    await clock.settle()

    expect(calls).toEqual(['glab mr view', 'glab api projects/:id/merge_requests/12/approvals'])
    const band = await $.ui.mount({
      plugin: 'takgon-mods',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 9 },
        view: {},
      },
    })
    const badge = (await band.find({ key: 'pr-badge' }))?.text ?? ''
    expect(badge).toContain('MR !12')
    expect(badge).toContain('승인됨')
    expect(badge).toContain('체크 통과')
  })

  test('glab 미설치·미인증은 원인별 toast 1회', async ($, on) => {
    const toasts: string[] = []
    let mode: 'missing' | 'auth' = 'missing'
    engine(
      on,
      () => (mode === 'missing' ? undefined : { exitCode: 1, stdout: '', stderr: '401 Unauthorized. glab auth login' }),
      toasts,
      'http://192.168.0.135:8030/nred/aichatbot.git',
    )
    const clock = mock.clock(on)
    mock.store(on)
    mock.env(on, {})

    await $.session.start(START)
    await clock.settle()
    await clock.advance(60_000)
    mode = 'auth'
    await clock.advance(60_000)
    await clock.advance(60_000)

    expect(toasts).toEqual([tr('ko', 'toast.glabMissing'), tr('ko', 'toast.glabAuth')])
  })
})

describe('Linear·명령 해석(순수)', () => {
  test('/issue 인자 해석', () => {
    expect(parseIssueArgs('')).toEqual({ kind: 'list' })
    expect(parseIssueArgs('로그인 버그')).toEqual({ kind: 'search', q: '로그인 버그' })
    expect(parseIssueArgs('link eng-1')).toEqual({ kind: 'link', id: 'ENG-1' })
    expect(parseIssueArgs('unlink ENG-1')).toEqual({ kind: 'unlink', id: 'ENG-1' })
    expect(parseIssueArgs('status ENG-1 In Progress')).toEqual({
      kind: 'status',
      id: 'ENG-1',
      state: 'In Progress',
    })
    expect(parseIssueArgs('status ENG-1')).toEqual({ kind: 'usage' })
    expect(parseIssueArgs('link')).toEqual({ kind: 'usage' })
  })

  test('연결 목록: 중복 무시, 상한, 해제', () => {
    expect(addLinked([ISSUE_A], ISSUE_A)).toEqual({ kind: 'duplicate' })
    expect(addLinked([ISSUE_A], ISSUE_B, 1)).toEqual({ kind: 'full' })
    expect(addLinked([ISSUE_A], ISSUE_B)).toEqual({ kind: 'added', list: [ISSUE_A, ISSUE_B] })
    expect(removeLinked([ISSUE_A, ISSUE_B], 'eng-1')).toEqual([ISSUE_B])
    expect(removeLinked([ISSUE_A], 'ENG-9')).toBeNull()
  })

  test('GraphQL 본문은 입력을 변수로만 넘기고 응답을 해석한다', () => {
    const body = JSON.parse(searchBody('"; drop')) as {
      query: string
      variables: { term: string; first: number }
    }
    expect(body.query).not.toContain('drop')
    expect(body.variables).toEqual({ term: '"; drop', first: 10 })
    expect(parseSearch(JSON.stringify({ errors: [{ message: 'x' }] }))).toBeNull()
    expect(parseIssue(JSON.stringify({ data: { issue: null } }))).toEqual({ kind: 'missing' })
    expect(findState([{ id: 's1', name: 'In Progress' }], ' in progress ')?.id).toBe('s1')
  })
})

// ── 훅·명령 ────────────────────────────────────────────────────────

const ROOT = 'C:/proj'
const PID = projectId(ROOT)
const LINKED_KEY = `p/${PID}/m5/linkedIssues`
const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const

type Run = { exitCode: number; stdout: string; stderr: string }

/** 엔진 자리: 세션 시작, 프로젝트 루트, toast 기록, gh 실행 결과. `gh`가 undefined면 실행 실패(미설치). */
const engine = (
  on: On,
  gh: (argv: readonly string[]) => Run | undefined,
  toasts: string[] = [],
  remote = 'https://github.com/o/r.git',
): { ghCalls: () => number } => {
  let calls = 0
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    // forge 판별용 `git remote get-url origin`은 원격 주소로 답하고 호출 수에서 뺀다.
    if (e.argv[0] === 'git') {
      return { value: { exitCode: 0, stdout: `${remote}
`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    calls += 1
    const result = gh(e.argv)
    if (result === undefined) {
      throw new Error('spawn gh ENOENT')
    }
    return { value: { ...result, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  return { ghCalls: () => calls }
}

/** 메모리 store. 쓰기를 기록해 영속화를 검증한다(mock.store는 store.set 훅을 이미 쓰므로 대신 쓴다). */
const memStore = (on: On, sets: Array<{ key: string; value: unknown }>): void => {
  const data = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: data.get(e.key) }))
  on('store.set', ($, e) => {
    sets.push({ key: e.key, value: e.value })
    data.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    data.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...data.keys()] }))
}

const NO_PR: Run = { exitCode: 1, stdout: '', stderr: 'no pull requests found for branch "main"' }

type Gql = { query: string; variables: Record<string, string> }

/** Linear API 자리. 요청 본문(쿼리 종류)으로 응답을 고른다. */
const linear = (on: On, requests: Gql[] = []): void => {
  on('http.fetch', ($, e) => {
    const body = JSON.parse(e.init?.body ?? '{}') as Gql
    requests.push(body)
    const reply = (data: unknown) => ({
      value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ data }) },
    })
    if (body.query.includes('searchIssues')) {
      return reply({
        searchIssues: { nodes: [ISSUE_A, ISSUE_B].map(i => ({ ...i, state: { name: i.state } })) },
      })
    }
    if (body.query.includes('issueUpdate')) {
      return reply({
        issueUpdate: { success: true, issue: { ...ISSUE_A, state: { name: 'Done' } } },
      })
    }
    const states = {
      nodes: [
        { id: 's-todo', name: 'Todo' },
        { id: 's-done', name: 'Done' },
      ],
    }
    return body.variables.id === 'ENG-1'
      ? reply({ issue: { ...ISSUE_A, state: { name: ISSUE_A.state }, team: { states } } })
      : reply({ issue: null })
  })
}

const issue = ($: Engine, args: string) =>
  $.command.run({
    command: 'issue',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })

describe('GitHub PR 폴링', () => {
  test('gh 미설치는 원인별 toast 1회, PR 없음은 toast 없이 넘어간다', async ($, on) => {
    const toasts: string[] = []
    let mode: 'missing' | 'nopr' = 'missing'
    const gh = engine(on, () => (mode === 'missing' ? undefined : NO_PR), toasts)
    const clock = mock.clock(on)
    mock.store(on)
    mock.env(on, {})

    await $.session.start(START)
    await clock.settle()
    await clock.advance(60_000)
    await clock.advance(60_000)

    expect(gh.ghCalls()).toBe(3)
    expect(toasts.filter(text => text === tr('ko', 'toast.ghMissing'))).toHaveLength(1)

    mode = 'nopr'
    await clock.advance(60_000)
    expect(toasts).toHaveLength(1)
  })

  test('turn.complete는 직전 갱신 후 10초 이내면 생략한다', async ($, on) => {
    const gh = engine(on, () => NO_PR)
    on('turn.complete', ($, e) => ({ text: e.answer }))
    const clock = mock.clock(on)
    mock.store(on)
    mock.env(on, {})

    await $.session.start(START)
    await clock.settle()
    const turn = {
      answer: 'ok',
      durationMs: 1,
      isAborted: false,
      turnId: 't1',
      reason: 'answer',
    } as const
    await $.turn.complete(turn)
    await clock.settle()
    expect(gh.ghCalls()).toBe(1)

    await clock.advance(11_000)
    await $.turn.complete(turn)
    await clock.settle()
    expect(gh.ghCalls()).toBe(2)
  })

  test('모듈이 꺼져 있으면 gh를 실행하지 않는다', async ($, on) => {
    const gh = engine(on, () => NO_PR)
    const clock = mock.clock(on)
    mock.store(on, { 'g/core/modules': { integrations: false } })
    mock.env(on, {})

    await $.session.start(START)
    await clock.settle()
    await clock.advance(60_000)

    expect(gh.ghCalls()).toBe(0)
  })
})

describe('/issue 명령', () => {
  test('LINEAR_API_KEY가 없으면 안내한다', async ($, on) => {
    engine(on, () => NO_PR)
    mock.store(on)
    mock.env(on, {})

    const out = await issue($, '버그')

    expect(out.text).toBe(tr('ko', 'issue.noKey'))
  })

  test('검색은 결과 목록을 돌려주고 키를 응답에 남기지 않는다', async ($, on) => {
    const requests: Gql[] = []
    engine(on, () => NO_PR)
    linear(on, requests)
    mock.store(on)
    mock.env(on, { LINEAR_API_KEY: 'lin_api_FAKE_TEST_KEY_NOT_REAL' })

    const out = await issue($, '버그')

    expect(requests[0]?.variables).toEqual({ term: '버그', first: 10 })
    expect(out.text).toContain(tr('ko', 'issue.searchTitle', { q: '버그', count: 2 }))
    expect(out.text).toContain('ENG-2 [In Progress] 검색 개선')
    expect(out.text).not.toContain('FAKE_TEST_KEY')
  })

  test('link는 store에 영속화되고 복원 후 목록에 나온다', async ($, on) => {
    const sets: Array<{ key: string; value: unknown }> = []
    const clock = mock.clock(on)
    engine(on, () => NO_PR)
    linear(on)
    memStore(on, sets)
    mock.env(on, { LINEAR_API_KEY: 'lin_api_FAKE_TEST_KEY_NOT_REAL' })
    await $.session.start(START)
    await clock.settle()

    expect((await issue($, 'link eng-1')).text).toBe(
      tr('ko', 'issue.linked', { identifier: 'ENG-1' }),
    )
    expect((await issue($, 'link ENG-1')).text).toBe(
      tr('ko', 'issue.alreadyLinked', { identifier: 'ENG-1' }),
    )
    expect((await issue($, 'link ENG-404')).text).toBe(
      tr('ko', 'issue.notFound', { id: 'ENG-404' }),
    )

    const saved = sets.filter(one => one.key === LINKED_KEY)
    expect(saved).toHaveLength(1)
    expect(JSON.stringify(saved)).not.toContain('FAKE_TEST_KEY')

    const listed = await issue($, '')
    expect(listed.text).toContain('ENG-1 [Todo] 로그인 버그')

    expect((await issue($, 'unlink ENG-1')).text).toBe(
      tr('ko', 'issue.unlinked', { identifier: 'ENG-1' }),
    )
    expect((await issue($, '')).text).toBe(tr('ko', 'issue.linkedEmpty'))
  })

  test('store가 비어 있으면 목록은 빈 안내만 하고 키를 쓰지 않는다', async ($, on) => {
    const sets: Array<{ key: string; value: unknown }> = []
    const clock = mock.clock(on)
    engine(on, () => NO_PR)
    memStore(on, sets)
    mock.env(on, { LINEAR_API_KEY: 'k' })
    await $.session.start(START)
    await clock.settle()

    expect((await issue($, '')).text).toBe(tr('ko', 'issue.linkedEmpty'))
    expect(sets.filter(one => one.key === LINKED_KEY)).toHaveLength(0)
  })

  test('저장된 연결 이슈를 세션 시작 때 불러온다', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => NO_PR)
    mock.store(on, { [LINKED_KEY]: [ISSUE_B] })
    mock.env(on, { LINEAR_API_KEY: 'k' })
    await $.session.start(START)
    await clock.settle()

    expect((await issue($, '')).text).toContain('ENG-2 [In Progress] 검색 개선')
  })

  test('/clear 뒤처럼 state가 비어 있으면(session.start 없음) 첫 명령에서 연결 이슈를 복원한다', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, () => NO_PR)
    mock.store(on, { [LINKED_KEY]: [ISSUE_B] })
    mock.env(on, { LINEAR_API_KEY: 'k' })

    const listed = await issue($, '')
    await clock.settle()

    expect(listed.text).toContain('ENG-2 [In Progress] 검색 개선')
  })

  test('status는 확인을 거절하면 변경하지 않고, 수락하면 변경한다', async ($, on) => {
    const requests: Gql[] = []
    let answer: 'reject' | 'yes' = 'reject'
    engine(on, () => NO_PR)
    linear(on, requests)
    on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
      if (answer === 'reject') {
        return { deny: 'dismissed' }
      }
      const [q] = e.questions
      return {
        result: {
          questions: e.questions,
          answers: { [q?.question ?? '']: tr('ko', 'issue.confirmYes') },
        },
      }
    })
    mock.store(on)
    mock.env(on, { LINEAR_API_KEY: 'k' })

    expect((await issue($, 'status ENG-1 done')).text).toBe(tr('ko', 'issue.cancelled'))
    expect(requests.some(r => r.query.includes('issueUpdate'))).toBe(false)

    expect((await issue($, 'status ENG-1 Archived')).text).toContain('Todo, Done')

    answer = 'yes'
    expect((await issue($, 'status ENG-1 done')).text).toBe(
      tr('ko', 'issue.statusChanged', { identifier: 'ENG-1', state: 'Done' }),
    )
    expect(requests.find(r => r.query.includes('issueUpdate'))?.variables).toEqual({
      id: 'u1',
      stateId: 's-done',
    })
  })
})
