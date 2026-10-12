import type { On, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import {
  diagramHash,
  extractMermaid,
  imageCells,
  keepRecent,
  slimSvg,
  splitMermaid,
} from '../src/m8-diagram/mermaid'

const FLOW = 'graph TD\n  A-->B'
const ANSWER = ['앞 문단', '', '```mermaid', FLOW, '```', '', '뒤 문단'].join('\n')
const HASH = diagramHash(FLOW)
const DIR = 'C:/proj/.claude/takgon/diagram'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
const UNCUT = { isStdoutTruncated: false, isStderrTruncated: false } as const

/** 엔진은 fs 경로를 OS 표기(`\`)로 바꿔 넘기므로 mock 파일 표는 `/`로 맞춰 둔다. */
const slash = (path: string): string => path.replace(/\\/g, '/')

describe('mermaid 추출(순수)', () => {
  test('mermaid 블록만 꺼내고 앞뒤 markdown을 보존한다', () => {
    expect(splitMermaid(ANSWER)).toEqual([
      { kind: 'markdown', text: '앞 문단\n' },
      { kind: 'mermaid', code: FLOW, hash: HASH },
      { kind: 'markdown', text: '\n뒤 문단' },
    ])
  })

  test('다른 펜스 안의 mermaid, 닫히지 않은 블록, 빈 블록은 무시하고 중복은 하나로 센다', () => {
    const nested = ['````markdown', '```mermaid', FLOW, '```', '````'].join('\n')
    expect(extractMermaid(nested)).toEqual([])
    expect(extractMermaid('```mermaid\ngraph TD')).toEqual([])
    expect(extractMermaid('```mermaid\n\n```')).toEqual([])
    const twice = `${ANSWER}\n\n~~~Mermaid\r\n${FLOW}\r\n~~~`
    expect(extractMermaid(twice)).toEqual([{ code: FLOW, hash: HASH }])
  })

  test('해시는 끝 공백·CRLF와 무관하고 내용이 다르면 바뀐다', () => {
    expect(diagramHash(`${FLOW}\n\n`)).toBe(HASH)
    expect(diagramHash(FLOW.replace(/\n/g, '\r\n'))).toBe(HASH)
    expect(diagramHash('graph LR\n  A-->B')).not.toBe(HASH)
    expect(HASH).toMatch(/^[0-9a-f]{8}$/)
  })

  test('최근 N개 유지와 이미지 셀 크기', () => {
    const many = Object.fromEntries(Array.from({ length: 55 }, (_, i) => [`h${i}`, { hash: `h${i}` }]))
    const kept = keepRecent(many)
    expect(Object.keys(kept)).toHaveLength(50)
    expect(Object.keys(kept)[0]).toBe('h5')
    expect(imageCells(120)).toEqual({ columns: 100, rows: 30 })
    expect(imageCells(undefined)).toEqual({ columns: 76, rows: 25 })
  })

  test('slimSvg는 내장 폰트(@font-face) style 블록만 빼고 나머지 style은 남긴다', () => {
    const font = `<style>/* Copyright */@font-face{font-family:"R";src:url(data:font/woff2;base64,${'A'.repeat(200_000)})}</style>`
    const theme = '<style>#my-svg{font-family:"R",arial,sans-serif;}</style>'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${theme}${font}<g><rect/></g></svg>`

    const slim = slimSvg(svg)

    expect(slim).toBe(`<svg xmlns="http://www.w3.org/2000/svg">${theme}<g><rect/></g></svg>`)
    expect(slim.length).toBeLessThan(131_072)
    expect(slimSvg(SVG)).toBe(SVG)
  })
})

const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const

type World = {
  runs: string[][]
  toasts: string[]
  files: Map<string, string>
  copied: string[]
}

/**
 * 엔진 자리: 세션·루트·파일·프로세스·toast·클립보드를 답한다.
 * `mmdc`는 `mode`에 따라 성공(svg·png 파일 생성) / 실행 불가(reject) / 오류 종료로 답한다.
 */
const engine = (on: On, mode: 'ok' | 'missing' | 'fail'): World => {
  const world: World = { runs: [], toasts: [], files: new Map(), copied: [] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: 'C:/proj' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('fs.exists', ($, e) => ({ value: world.files.has(slash(e.path)) }))
  on('fs.write', ($, e) => {
    world.files.set(slash(e.path), e.text)
    return { value: undefined }
  })
  on('fs.read', ($, e) => ({ value: world.files.get(slash(e.path)) ?? '' }))
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', ($, e) => {
    world.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('process.run', ($, e): { value: ProcessRunResult } => {
    world.runs.push([...e.argv])
    if (mode === 'missing') {
      throw new Error('spawn mmdc ENOENT')
    }
    if (mode === 'fail') {
      return { value: { exitCode: 1, stdout: '', stderr: 'Parse error on line 2', ...UNCUT } }
    }
    const out = e.argv[e.argv.indexOf('-o') + 1]!
    world.files.set(out, out.endsWith('.svg') ? SVG : 'PNG')
    return { value: { exitCode: 0, stdout: '', stderr: '', ...UNCUT } }
  })
  return world
}

const complete = (answer: string) =>
  ({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' }) as const

/** 엔진 쪽 AssistantMessage: 받은 text를 그대로 Text로 그린다(조각 분할 확인용). */
const engineMessage = (on: On): void => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
}

const PROPS = { text: ANSWER, isFirstOfReply: true }

describe('turn.complete 사전 렌더', () => {
  test('mmdc 성공: svg·png를 만들고 같은 코드는 다시 렌더하지 않는다', async ($, on) => {
    const world = engine(on, 'ok')
    mock.store(on)
    await $.session.start(START)

    await $.turn.complete(complete(ANSWER))
    await $.turn.complete(complete(ANSWER))

    expect(world.files.get(`${DIR}/${HASH}.mmd`)).toBe(FLOW)
    expect(world.files.get('C:/proj/.claude/takgon/.gitignore')).toBe('*\n')
    expect(world.runs).toEqual([
      ['mmdc', '-i', `${DIR}/${HASH}.mmd`, '-o', `${DIR}/${HASH}.svg`],
      ['mmdc', '-i', `${DIR}/${HASH}.mmd`, '-o', `${DIR}/${HASH}.png`],
    ])
    expect(world.toasts).toEqual([])
  })

  test('mmdc 실행 불가: cmd /c로 1회 재시도하고 toast는 원인별 1회', async ($, on) => {
    const world = engine(on, 'missing')
    mock.store(on)
    await $.session.start(START)

    await $.turn.complete(complete(ANSWER))
    await $.turn.complete(complete(ANSWER))

    expect(world.runs.slice(0, 2)).toEqual([
      ['mmdc', '-i', `${DIR}/${HASH}.mmd`, '-o', `${DIR}/${HASH}.svg`],
      ['cmd', '/c', 'mmdc', '-i', `${DIR}/${HASH}.mmd`, '-o', `${DIR}/${HASH}.svg`],
    ])
    expect(world.toasts).toHaveLength(1)
    expect(world.toasts[0]).toContain('npm i -g @mermaid-js/mermaid-cli')
  })

  test('모듈이 꺼져 있으면 아무것도 실행하지 않는다', async ($, on) => {
    const world = engine(on, 'ok')
    mock.store(on, { 'g/core/modules': { diagram: false } })
    await $.session.start(START)

    await $.turn.complete(complete(ANSWER))

    expect(world.runs).toEqual([])
  })
})

describe('AssistantMessage 표시', () => {
  test('렌더 결과가 없으면 원본 Code, 앞뒤 본문은 엔진이 그린다', async ($, on) => {
    engineMessage(on)
    engine(on, 'ok')
    mock.store(on)
    await $.session.start(START)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'takgon-mods', surface, component: 'AssistantMessage', props: PROPS })
      expect((await ui.find({ type: 'Code' }))?.props).toMatchObject({ source: FLOW, language: 'mermaid' })
      expect(await ui.find({ type: 'Text', text: /앞 문단/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /뒤 문단/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /mermaid/ })).toBeUndefined()
    }
  })

  test('mmdc 실패 결과도 원본 Code로 보이고 toast 1회', async ($, on) => {
    engineMessage(on)
    const world = engine(on, 'fail')
    mock.store(on)
    await $.session.start(START)
    await $.turn.complete(complete(ANSWER))
    await $.turn.complete(complete(`${ANSWER}\n\n\`\`\`mermaid\ngraph LR\n  X-->Y\n\`\`\``))

    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'desktop', component: 'AssistantMessage', props: PROPS })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe(FLOW)
    expect(world.toasts).toHaveLength(1)
    expect(world.toasts[0]).toContain('Parse error')
  })

  test('desktop은 Svg, terminal은 png Image로 그리고 경로를 복사한다', async ($, on) => {
    engineMessage(on)
    const world = engine(on, 'ok')
    mock.store(on)
    await $.session.start(START)
    await $.turn.complete(complete(ANSWER))

    const desktop = await $.ui.mount({ plugin: 'takgon-mods', surface: 'desktop', component: 'AssistantMessage', props: PROPS })
    expect((await desktop.find({ type: 'Svg' }))?.props).toMatchObject({ source: SVG, alt: 'mermaid 다이어그램' })
    await desktop.press({ key: `copy-${HASH}` })
    expect(world.copied).toEqual([`${DIR}/${HASH}.svg`])

    const terminal = await $.ui.mount({
      plugin: 'takgon-mods',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: PROPS,
      viewport: { columns: 120, rows: 40 },
    })
    expect((await terminal.find({ type: 'Image' }))?.props).toMatchObject({
      source: { file: `${DIR}/${HASH}.png`, format: 'png' },
      columns: 100,
      rows: 30,
    })
    expect(await terminal.find({ type: 'Code' })).toBeUndefined()
  })

  test('원본 보기 토글은 Code와 다이어그램을 오간다', async ($, on) => {
    engineMessage(on)
    engine(on, 'ok')
    mock.store(on)
    await $.session.start(START)
    await $.turn.complete(complete(ANSWER))

    const ui = await $.ui.mount({ plugin: 'takgon-mods', surface: 'desktop', component: 'AssistantMessage', props: PROPS })
    await ui.press({ key: `src-${HASH}` })
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe(FLOW)
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect((await ui.find({ key: `src-${HASH}` }))?.text).toContain('다이어그램 보기')

    await ui.press({ key: `src-${HASH}` })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
  })

  test('mermaid 블록이 없으면 엔진 표시를 그대로 둔다', async ($, on) => {
    engineMessage(on)
    engine(on, 'ok')
    mock.store(on)
    await $.session.start(START)

    const ui = await $.ui.mount({
      plugin: 'takgon-mods',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: '그냥 답변', isFirstOfReply: true },
    })
    expect((await ui.drawn()).type).toBe('Text')
  })
})
