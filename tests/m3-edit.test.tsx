import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  judgeEdit,
  parseEditArgs,
  parseHeadlessOutput,
  resolvePath,
  sliceLines,
} from '../src/m3-edit/logic'

describe('범위 파싱(순수)', () => {
  test('경로:시작-끝, Windows 드라이브 경로, 단일 행', () => {
    expect(parseEditArgs('src/a.ts:3-5')).toEqual({ kind: 'range', path: 'src/a.ts', start: 3, end: 5 })
    expect(parseEditArgs('C:\\proj\\b.ts:10-12')).toEqual({
      kind: 'range',
      path: 'C:\\proj\\b.ts',
      start: 10,
      end: 12,
    })
    expect(parseEditArgs('a.ts:7')).toEqual({ kind: 'range', path: 'a.ts', start: 7, end: 7 })
  })

  test('잘못된 범위·하위 명령', () => {
    expect(parseEditArgs('a.ts:5-3').kind).toBe('usage')
    expect(parseEditArgs('a.ts:0-3').kind).toBe('usage')
    expect(parseEditArgs('a.ts').kind).toBe('usage')
    expect(parseEditArgs('').kind).toBe('show')
    expect(parseEditArgs(' clear ').kind).toBe('clear')
    expect(parseEditArgs('sel').kind).toBe('sel')
    expect(parseEditArgs('dom .card > h2 http://localhost:3000/x')).toEqual({
      kind: 'dom',
      selector: '.card > h2',
      url: 'http://localhost:3000/x',
    })
    expect(parseEditArgs('dom #app')).toEqual({ kind: 'dom', selector: '#app', url: undefined })
    expect(parseEditArgs('dom').kind).toBe('usage')
  })

  test('상대 경로는 루트 기준 절대·/ 구분으로 바꾼다', () => {
    expect(resolvePath('C:\\proj', 'src\\a.ts')).toBe('C:/proj/src/a.ts')
    expect(resolvePath('C:/proj/', './src/../b.ts')).toBe('C:/proj/b.ts')
    expect(resolvePath('C:/proj', 'D:\\x\\y.ts')).toBe('D:/x/y.ts')
  })

  test('행 범위 발췌와 범위 초과 판정', () => {
    const text = 'a\r\nb\r\nc\r\n'
    expect(sliceLines(text, 2, 3)).toEqual({ lineCount: 3, excerpt: 'b\nc' })
    expect(sliceLines(text, 3, 4)).toEqual({ lineCount: 3, excerpt: undefined })
    expect(sliceLines('x'.repeat(5000), 1, 1).excerpt?.length).toBe(2000)
  })
})

describe('범위 판정(순수)', () => {
  const FILE = ['l1', 'l2 target', 'l3', 'l4 other', 'l5 target'].join('\n')

  test('범위 안의 단일 매치는 허용, 밖은 거부', () => {
    expect(judgeEdit(FILE, 'l2 target\nl3', 2, 3)).toEqual({ isAllowed: true, matches: 1 })
    expect(judgeEdit(FILE, 'l4 other', 2, 3)).toEqual({
      isAllowed: false,
      reason: 'outside',
      lines: [4, 4],
    })
  })

  test('찾을 수 없으면 거부, CRLF 파일도 LF old_string으로 찾는다', () => {
    expect(judgeEdit(FILE, 'nope', 1, 5)).toEqual({ isAllowed: false, reason: 'not-found' })
    expect(judgeEdit(FILE, '', 1, 5)).toEqual({ isAllowed: false, reason: 'not-found' })
    expect(judgeEdit('a\r\nb\r\nc', 'b\nc', 2, 3).isAllowed).toBe(true)
  })

  test('여러 매치는 전부 범위 안이어야 허용', () => {
    expect(judgeEdit(FILE, 'target', 2, 5).isAllowed).toBe(true)
    expect(judgeEdit(FILE, 'target', 2, 3)).toEqual({
      isAllowed: false,
      reason: 'outside',
      lines: [5, 5],
    })
  })

  test('headless 출력은 마지막 JSON 줄을 읽는다', () => {
    expect(parseHeadlessOutput('log\n{"ok":true,"status":200,"consoleErrors":[]}\n')?.ok).toBe(true)
    expect(parseHeadlessOutput('no json')).toBeUndefined()
  })
})

const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const
const SOURCE = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n')

/** 엔진 자리: 세션 시작, 루트, 파일 읽기. */
const engine = (on: On, files: Record<string, string> = { 'C:/proj/src/a.ts': SOURCE }): void => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: 'C:/proj' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.read', ($, e) => {
    const text = files[e.path.replace(/\\/g, '/')]
    if (text === undefined) {
      throw new Error('ENOENT')
    }
    return { value: text }
  })
}

const edit = ($: Engine, args: string) =>
  $.command.run({
    command: 'edit',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

/** 엔진 바닥의 prompt.submit이 받은 context를 모은다. */
const captureContext = (on: On): (readonly string[] | undefined)[] => {
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', ($, e) => {
    seen.push(e.context)
    return { text: e.text, context: e.context }
  })
  return seen
}

const submit = ($: Engine, text: string) =>
  $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })

describe('/edit 텍스트 대상', () => {
  test('지정 후 다음 사용자 프롬프트에 범위 지시와 발췌를 첨부하고, clear로 해제한다', async ($, on) => {
    engine(on)
    mock.store(on)
    const seen = captureContext(on)
    await $.session.start(START)

    const set = await edit($, 'src/a.ts:2-3')
    expect(set.text).toContain('C:/proj/src/a.ts')

    await submit($, '이 부분 고쳐줘')
    const context = seen.at(-1)?.join('\n') ?? ''
    expect(context).toContain('C:/proj/src/a.ts')
    expect(context).toContain('2~3')
    expect(context).toContain('line2\nline3')

    expect((await edit($, '')).text).toContain('2~3')
    await edit($, 'clear')
    await submit($, '다음')
    expect(seen.at(-1) ?? []).toHaveLength(0)
  })

  test('범위가 파일 길이를 넘으면 지정하지 않는다', async ($, on) => {
    engine(on)
    mock.store(on)
    const seen = captureContext(on)
    await $.session.start(START)

    expect((await edit($, 'src/a.ts:4-9')).text).toContain('5')
    await submit($, 'x')
    expect(seen.at(-1) ?? []).toHaveLength(0)
  })

  test('선택 영역이 없으면 안내하고, 있으면 발췌로 첨부한다', async ($, on) => {
    let selection: { text: string } | undefined
    on('ui.selection', () => ({ value: selection }))
    engine(on)
    mock.store(on)
    const seen = captureContext(on)
    await $.session.start(START)

    expect((await edit($, 'sel')).text).toMatch(/선택/)
    await submit($, 'x')
    expect(seen.at(-1) ?? []).toHaveLength(0)

    selection = { text: '고칠 문단입니다' }
    await edit($, 'sel')
    await submit($, 'y')
    expect(seen.at(-1)?.join('\n')).toContain('고칠 문단입니다')
  })
})

describe('Edit/Write 가드', () => {
  test('대상 파일의 범위 밖 Edit·Write는 거부, 범위 안·다른 파일은 통과', async ($, on) => {
    const ran: string[] = []
    on('tool.call', { tool: 'Edit' }, ($, e) => {
      ran.push(e.file_path)
      return { result: { filePath: e.file_path } as never }
    })
    on('tool.call', { tool: 'Write' }, ($, e) => {
      ran.push(`write:${e.file_path}`)
      return { result: { filePath: e.file_path } as never }
    })
    engine(on, { 'C:/proj/src/a.ts': SOURCE, 'C:/proj/src/b.ts': SOURCE })
    mock.store(on)
    await $.session.start(START)
    await edit($, 'src/a.ts:2-3')

    const outside = await $.tool.call({
      tool: 'Edit',
      file_path: 'C:\\proj\\src\\a.ts',
      old_string: 'line5',
      new_string: 'x',
    })
    expect(outside.deny).toContain('5~5')

    const inside = await $.tool.call({
      tool: 'Edit',
      file_path: 'C:\\proj\\src\\a.ts',
      old_string: 'line3',
      new_string: 'x',
    })
    expect(inside.deny).toBeUndefined()

    const other = await $.tool.call({
      tool: 'Edit',
      file_path: 'C:/proj/src/b.ts',
      old_string: 'line5',
      new_string: 'x',
    })
    expect(other.deny).toBeUndefined()

    const write = await $.tool.call({ tool: 'Write', file_path: 'C:/proj/src/a.ts', content: 'all' })
    expect(write.deny).toContain('Write')

    expect(ran).toEqual(['C:\\proj\\src\\a.ts', 'C:/proj/src/b.ts'])
  })

  test('범위 안 Edit가 행을 늘리면 대상 범위 끝도 따라 늘어난다', async ($, on) => {
    on('tool.call', { tool: 'Edit' }, ($, e) => ({ result: { filePath: e.file_path } as never }))
    engine(on)
    mock.store(on)
    await $.session.start(START)
    await edit($, 'src/a.ts:2-3')

    await $.tool.call({ tool: 'Edit', file_path: 'C:/proj/src/a.ts', old_string: 'line3', new_string: 'a\nb' })
    expect((await edit($, '')).text).toContain('2~4')
  })
})

describe('/edit dom', () => {
  test('headless 결과로 DOM 대상을 만들고 프롬프트에 selector·style을 첨부한다', async ($, on) => {
    const argvs: (readonly string[])[] = []
    on('fs.exists', () => ({ value: true }))
    on('fs.write', () => ({ value: undefined }))
    on('process.run', ($, e) => {
      argvs.push(e.argv)
      const out = {
        ok: true,
        status: 200,
        consoleErrors: [],
        element: { selector: '.card', computedStyle: { color: 'rgb(1, 2, 3)' }, screenshot: 'C:/s.png' },
      }
      return {
        value: {
          exitCode: 0,
          stdout: `starting\n${JSON.stringify(out)}\n`,
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    })
    engine(on)
    mock.store(on)
    const seen = captureContext(on)
    await $.session.start(START)

    await edit($, 'dom .card http://localhost:3000')
    expect(argvs[0]).toContain('--selector')
    expect(argvs[0]).toContain('http://localhost:3000')

    await submit($, '색 바꿔줘')
    const context = seen.at(-1)?.join('\n') ?? ''
    expect(context).toContain('.card')
    expect(context).toContain('rgb(1, 2, 3)')
    expect(context).toContain('C:/s.png')
  })

  test('playwright가 없으면 대상을 만들지 않고 toast는 원인별 1회만', async ($, on) => {
    const toasts: string[] = []
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('fs.exists', () => ({ value: true }))
    on('fs.write', () => ({ value: undefined }))
    on('process.run', () => ({
      value: {
        exitCode: 2,
        stdout: '{"ok":false,"status":0,"consoleErrors":[],"error":"playwright-missing"}',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }))
    engine(on)
    mock.store(on)
    const seen = captureContext(on)
    await $.session.start(START)

    await edit($, 'dom #app http://localhost:3000')
    await edit($, 'dom #app http://localhost:3000')
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(/[Pp]laywright/)

    await submit($, 'x')
    expect(seen.at(-1) ?? []).toHaveLength(0)
  })
})
