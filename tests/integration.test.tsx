import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const

/**
 * 엔진 자리: 세션 시작·루트·프로세스 실행에 답하고, 명령 등록을 기록한다.
 * `refused`에 든 이름은 사용자 스킬·명령과 겹친 것처럼 등록을 거부한다(실제 세션: `"/handoff" refused: it is the user's /handoff`).
 */
const engine = (on: On, refused: readonly string[]): { attempts: string[]; listed: string[] } => {
  const attempts: string[] = []
  const listed: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: 'C:/proj' }))
  on('command.register', ($, e) => {
    attempts.push(e.name)
    if (refused.includes(e.name)) {
      throw new Error(`$.command.register: "/${e.name}" refused: it is the user's /${e.name}`)
    }
    listed.push(e.name)
    return { value: { command: e.name } }
  })
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.exists', () => ({ value: false }))
  on('ui.toast', () => ({ value: undefined }))
  return { attempts, listed }
}

describe('모듈 초기화 격리', () => {
  test('한 모듈의 명령 이름이 사용자 명령과 겹쳐 거부돼도 나머지 모듈 명령은 모두 등록된다', async ($, on) => {
    const world = engine(on, ['handoff', 'tk-handoff'])
    const clock = mock.clock(on)
    mock.store(on)
    mock.env(on, {})

    await $.session.start(START)
    await clock.settle()

    expect(world.attempts).toContain('tk-handoff')
    for (const name of ['mods', 'coach', 'panel', 'pin', 'issue', 'browse', 'edit']) {
      expect(world.listed).toContain(name)
    }
  })

  test('M7 명령은 사용자 /handoff 스킬과 겹치지 않게 tk-handoff로 등록한다', async ($, on) => {
    const world = engine(on, [])
    const clock = mock.clock(on)
    mock.store(on)
    mock.env(on, {})

    await $.session.start(START)
    await clock.settle()

    expect(world.listed).toContain('tk-handoff')
    expect(world.listed).not.toContain('handoff')
  })
})
