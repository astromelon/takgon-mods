import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import {
  consoleContext,
  extractLocalUrl,
  headlessCause,
  openExternalArgv,
  parseHeadlessOutput,
  platformOf,
  toBrowserInfo,
} from '../src/m2-browser/logic'

describe('M2 순수 로직', () => {
  test('출력에서 첫 로컬 URL만 뽑는다', () => {
    expect(extractLocalUrl('  ➜  Local:   http://localhost:5173/\n  ➜  Network: http://192.168.0.2:5173/'))
      .toBe('http://localhost:5173/')
    expect(extractLocalUrl("Started on 'http://127.0.0.1:8080/app?x=1' ok")).toBe('http://127.0.0.1:8080/app?x=1')
    expect(extractLocalUrl('listening https://0.0.0.0:3000')).toBe('https://0.0.0.0:3000')
    expect(extractLocalUrl('see https://example.com:443/ and http://localhost/')).toBeUndefined()
  })

  test('headless 출력의 마지막 JSON 줄을 읽는다', () => {
    const json = JSON.stringify({ ok: true, status: 200, title: 'App', consoleErrors: ['boom'] })
    expect(parseHeadlessOutput(`log line\n${json}\n`)?.title).toBe('App')
    expect(parseHeadlessOutput('not json')).toBeUndefined()
    expect(parseHeadlessOutput('{"ok":true}')).toBeUndefined()
  })

  test('headless 실패 원인 판정', () => {
    const missing = { ok: false, status: 0, consoleErrors: [], error: 'playwright-missing' }
    expect(headlessCause(2, missing)).toBe('playwright-missing')
    expect(headlessCause(2, undefined)).toBe('playwright-missing')
    expect(headlessCause(1, undefined)).toBe('headless-failed')
    expect(headlessCause(0, { ok: true, status: 200, consoleErrors: [] })).toBeUndefined()
  })

  test('외부 브라우저 명령은 플랫폼별로 다르다', () => {
    expect(platformOf('C:\\Users\\me\\.claude\\plugins\\x')).toBe('windows')
    expect(platformOf('/Users/me/.claude/plugins/x')).toBe('mac')
    expect(platformOf('/home/me/.claude/plugins/x')).toBe('linux')
    expect(openExternalArgv('windows', 'http://localhost:3000')).toEqual(['cmd', '/c', 'start', '', 'http://localhost:3000'])
    expect(openExternalArgv('mac', 'http://localhost:3000')).toEqual(['open', 'http://localhost:3000'])
    expect(openExternalArgv('linux', 'http://localhost:3000')).toEqual(['xdg-open', 'http://localhost:3000'])
  })

  test('BrowserInfo는 HTTP 상태를 우선하고 에러는 20건으로 자른다', () => {
    const errors = Array.from({ length: 30 }, (_, i) => `e${i}`)
    const info = toBrowserInfo('http://localhost:1', 0, { ok: true, status: 304, consoleErrors: errors }, 5)
    expect(info.status).toBe(304)
    expect(info.consoleErrors).toHaveLength(20)
    expect(toBrowserInfo('http://localhost:1', 200, undefined, 5)).toEqual({
      url: 'http://localhost:1',
      status: 200,
      consoleErrors: [],
      checkedAt: 5,
    })
    expect(consoleContext({ url: 'http://localhost:1', status: 200, consoleErrors: ['a', 'b'], checkedAt: 0 }))
      .toContain('- b')
  })
})

const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const
const URL = 'http://localhost:5173/'
const SHOT = 'C:/proj/.claude/takgon/browse/1.png'
const HEADLESS_OK = JSON.stringify({
  ok: true,
  status: 200,
  title: 'Vite App',
  consoleErrors: ['Uncaught TypeError: x is undefined'],
  screenshot: SHOT,
})

type Fake = { stdout?: string; exitCode?: number; isNodeMissing?: boolean; store?: Record<string, unknown> }

/** 엔진 자리: 세션·루트·store·http·process·ui.open·toast를 답한다. */
const engine = (on: On, fake: Fake = {}): { toasts: string[]; runs: (readonly string[])[] } => {
  const toasts: string[] = []
  const runs: (readonly string[])[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: 'C:/proj' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.exists', () => ({ value: true }))
  on('fs.write', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '' } }))
  on('process.run', ($, e) => {
    runs.push(e.argv)
    if (fake.isNodeMissing === true) {
      throw new Error('spawn node ENOENT')
    }
    const value = {
      exitCode: fake.exitCode ?? 0,
      stdout: fake.stdout ?? HEADLESS_OK,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    }
    return { value }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  mock.store(on, fake.store ?? {})
  mock.clock(on)
  return { toasts, runs }
}

const browse = (args: string) => ({
  command: 'browse',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
}) as const

const pane = { plugin: 'takgon-mods', component: 'Pane', requestId: 'takgon-browser', props: {} } as const

describe('M2 훅', () => {
  test('Bash 결과 출력에서 로컬 URL을 감지해 pane에 보인다', async ($, on) => {
    engine(on)
    on('tool.call', { tool: 'Bash' }, () => ({
      result: { stdout: `  VITE ready\n  Local: ${URL}\n`, stderr: '', interrupted: false },
    }))
    await $.session.start(START)

    await $.tool.call({ tool: 'Bash', command: 'npm run dev' })

    const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
    expect((await ui.find({ type: 'Link' }))?.props.href).toBe(URL)
  })

  test('/browse는 headless JSON을 반영하고 terminal은 Image, desktop은 경로를 그린다', async ($, on) => {
    const { runs } = engine(on)
    await $.session.start(START)

    const out = await $.command.run(browse(URL))

    expect(out.text).toContain('200')
    const argv = runs.at(-1) ?? []
    expect(argv[0]).toBe('node')
    expect(argv[1]).toMatch(/tools\/headless\.mjs$/)
    expect(argv).toContain('--url')
    expect(argv).toContain('C:/proj/.claude/takgon/browse')

    const terminal = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
    expect((await terminal.find({ type: 'Text', text: /Vite App/ }))).toBeDefined()
    expect((await terminal.find({ type: 'Text', text: /Uncaught TypeError/ }))).toBeDefined()
    expect((await terminal.find({ type: 'Image' }))?.props.source).toMatchObject({ file: SHOT, format: 'png' })

    const desktop = await $.ui.mount({ ...pane, surface: 'desktop' } as never)
    expect(await desktop.find({ type: 'Image' })).toBeUndefined()
    expect((await desktop.find({ type: 'Text', text: SHOT }))).toBeDefined()
    expect((await desktop.find({ type: 'Button', key: 'open-external' }))).toBeDefined()
  })

  test('playwright가 없으면 원인별 toast는 1회만, 상태는 http 값을 쓴다', async ($, on) => {
    const missing = JSON.stringify({ ok: false, status: 0, consoleErrors: [], error: 'playwright-missing' })
    const { toasts } = engine(on, { exitCode: 2, stdout: missing })
    await $.session.start(START)

    await $.command.run(browse(URL))
    const second = await $.command.run(browse(URL))

    expect(toasts.filter(text => text.includes('playwright'))).toHaveLength(1)
    expect(second.text).toContain('200')
  })

  test('node가 없어도 toast 1회 후 http 상태만 보인다', async ($, on) => {
    const { toasts } = engine(on, { isNodeMissing: true })
    await $.session.start(START)

    await $.command.run(browse(URL))
    await $.command.run(browse(URL))

    expect(toasts.filter(text => text.includes('node'))).toHaveLength(1)
    const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /200/ })).toBeDefined()
  })

  test('콘솔 첨부를 켜면 다음 직접 입력 프롬프트에 한 번만 첨부한다', async ($, on) => {
    engine(on)
    const contexts: (readonly string[] | undefined)[] = []
    on('prompt.submit', ($, e) => {
      contexts.push(e.context)
      return { text: e.text, context: e.context }
    })
    await $.session.start(START)
    await $.command.run(browse(URL))

    const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
    await ui.press({ key: 'attach-console' })

    const submit = { text: '고쳐줘', wait: false, origin: { kind: 'composer' } } as const
    await $.prompt.submit(submit)
    await $.prompt.submit(submit)

    expect(contexts[0]?.join('\n')).toContain('Uncaught TypeError')
    expect(contexts[1] ?? []).toHaveLength(0)
  })

  test('모듈이 꺼지면 /browse는 안내만 하고 실행하지 않는다', async ($, on) => {
    const { runs } = engine(on, { store: { 'g/core/modules': { browser: false } } })
    await $.session.start(START)

    const out = await $.command.run(browse(URL))

    expect(out.text).toContain('/mods browser on')
    expect(runs).toHaveLength(0)
  })
})
