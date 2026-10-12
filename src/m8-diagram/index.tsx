import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, ProcessRunResult } from 'claude-code'

import type { DiagramRender } from '../../types'
import { OUTPUT_GITIGNORE, markNotified, outputDir } from '../shared/settings'
import { ALL_ON } from '../shared/state'
import {
  SVG_MAX_CHARS,
  extractMermaid,
  failureReason,
  imageCells,
  isCommandMissing,
  keepRecent,
  splitMermaid,
} from './mermaid'
import type { MermaidBlock } from './mermaid'
import { tr } from './messages'

const langAtom = atom({ plugin: 'takgon-mods', key: 'lang' } as const, 'ko')
const modulesAtom = atom({ plugin: 'takgon-mods', key: 'modules' } as const, ALL_ON)
const notifiedAtom = atom({ plugin: 'takgon-mods', key: 'notified' } as const, [])
const diagramsAtom = atom({ plugin: 'takgon-mods', key: 'diagrams' } as const, {})
const diagramSourceAtom = atom({ plugin: 'takgon-mods', key: 'diagramSource' } as const, [])

/** mmdc 한 번의 실행 시간 상한. */
const MMDC_TIMEOUT_MS = 60_000

/** toast 원인 키. */
const CAUSE_MISSING = 'm8:mmdc-missing'
const CAUSE_FAILED = 'm8:mmdc-failed'

/** mmdc 실행 결과: 끝까지 돌았음(종료 코드 무관) 또는 실행 자체 불가. */
type MmdcOutcome = { kind: 'ran'; result: ProcessRunResult } | { kind: 'missing' }

/**
 * `mmdc`를 argv로 실행한다. Windows의 npm 전역 설치는 `mmdc.cmd`라 shell 없이 시작되지 않으므로,
 * 시작에 실패하면 `cmd /c mmdc ...`로 1회 재시도한다. 그것도 실패하거나 "명령 없음"이면 missing.
 */
const runMmdc = async ($: EngineInterface, args: readonly string[]): Promise<MmdcOutcome> => {
  try {
    return { kind: 'ran', result: await $.process.run(['mmdc', ...args], { timeoutMs: MMDC_TIMEOUT_MS }) }
  } catch {
    // 아래 cmd 재시도로 넘어간다.
  }
  try {
    const result = await $.process.run(['cmd', '/c', 'mmdc', ...args], { timeoutMs: MMDC_TIMEOUT_MS })
    return isCommandMissing(result.exitCode, result.stderr) ? { kind: 'missing' } : { kind: 'ran', result }
  } catch {
    return { kind: 'missing' }
  }
}

/** 원인별 1회 toast. */
const notifyOnce = async ($: EngineInterface, cause: string, text: string): Promise<void> => {
  const marked = markNotified(await read($, notifiedAtom), cause)
  if (marked !== null) {
    await update($, notifiedAtom, () => marked)
    $.ui.toast(text)
  }
}

/** 산출물 폴더에 `.gitignore`가 없으면 만든다. */
const ensureGitignore = async ($: EngineInterface, base: string): Promise<void> => {
  const path = `${base}/.gitignore`
  if (!(await $.fs.exists(path))) {
    await $.fs.write(path, OUTPUT_GITIGNORE)
  }
}

/** svg 원문을 읽어 desktop 표시 한도 이하일 때만 돌려준다. */
const readSvg = async ($: EngineInterface, path: string): Promise<string | undefined> => {
  try {
    const text = await $.fs.read(path)
    return text.length <= SVG_MAX_CHARS ? text : undefined
  } catch {
    return undefined
  }
}

/**
 * 블록 하나를 `{dir}/{hash}.svg|png`로 렌더한다. 이미 파일이 있으면(이전 세션 캐시) 다시 돌리지 않는다.
 * mmdc를 실행할 수 없으면 `null`(결과를 남기지 않아 설치 후 다음 턴에 다시 시도된다).
 */
const renderBlock = async (
  $: EngineInterface,
  dir: string,
  block: MermaidBlock,
): Promise<DiagramRender | null> => {
  const mmdPath = `${dir}/${block.hash}.mmd`
  const svgPath = `${dir}/${block.hash}.svg`
  const pngPath = `${dir}/${block.hash}.png`
  const hasSvg = await $.fs.exists(svgPath)
  const hasPng = await $.fs.exists(pngPath)
  if (!hasSvg || !hasPng) {
    await $.fs.write(mmdPath, block.code)
  }
  if (!hasSvg) {
    const outcome = await runMmdc($, ['-i', mmdPath, '-o', svgPath])
    if (outcome.kind === 'missing') {
      return null
    }
    if (outcome.result.exitCode !== 0) {
      const error = failureReason(outcome.result.stderr, outcome.result.exitCode)
      await notifyOnce($, CAUSE_FAILED, tr(await read($, langAtom), 'diagram.renderFailed', { reason: error }))
      return { hash: block.hash, error }
    }
  }
  let isPngReady = hasPng
  if (!hasPng) {
    const outcome = await runMmdc($, ['-i', mmdPath, '-o', pngPath])
    isPngReady = outcome.kind === 'ran' && outcome.result.exitCode === 0
  }
  return {
    hash: block.hash,
    svgPath,
    pngPath: isPngReady ? pngPath : undefined,
    svg: await readSvg($, svgPath),
  }
}

/** 응답 텍스트: 이벤트의 answer, 비었으면 대화의 마지막 assistant 메시지. */
const answerText = async ($: EngineInterface, answer: string): Promise<string> => {
  if (answer !== '') {
    return answer
  }
  const messages = await $.session.messages()
  return messages.filter(message => message.role === 'assistant').at(-1)?.text ?? ''
}

/** 응답의 새 mermaid 블록을 미리 렌더해 `diagrams` atom에 넣는다. */
const prerender = async ($: EngineInterface, answer: string): Promise<void> => {
  const known = await read($, diagramsAtom)
  const blocks = extractMermaid(await answerText($, answer)).filter(block => known[block.hash] === undefined)
  if (blocks.length === 0) {
    return
  }
  const base = outputDir(await $.session.root())
  await ensureGitignore($, base)
  const rendered: DiagramRender[] = []
  for (const block of blocks) {
    const result = await renderBlock($, `${base}/diagram`, block)
    if (result === null) {
      await notifyOnce($, CAUSE_MISSING, tr(await read($, langAtom), 'diagram.mmdcMissing'))
      break
    }
    rendered.push(result)
  }
  if (rendered.length > 0) {
    await update($, diagramsAtom, current => {
      const next: Record<string, DiagramRender> = { ...current }
      for (const one of rendered) {
        next[one.hash] = one
      }
      return keepRecent(next)
    })
  }
}

/**
 * M8 Diagram Render.
 *
 * - `turn.complete {reason:'answer'}`: 응답의 mermaid 블록을 `mmdc`로 `.claude/takgon/diagram/{hash}.svg|png`에
 *   미리 렌더해 `diagrams` atom에 둔다. 무거운 일은 여기서만 한다.
 * - `ui.render AssistantMessage`: 본문을 mermaid 블록 기준으로 나눠 나머지 조각은 엔진 그림(`next`)을
 *   그대로 쓰고, 블록 자리에만 Svg(desktop·vscode·mobile) / Image(terminal) / 원본 Code를 넣는다. 읽기만 한다.
 */
export const registerDiagram = (on: On): void => {
  on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
    const result = await next(e)
    if ((await read($, modulesAtom)).diagram) {
      await prerender($, e.answer)
    }
    return result
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary === true || !(await read($, modulesAtom)).diagram) {
      return next(e)
    }
    const segments = splitMermaid(e.props.text)
    if (!segments.some(segment => segment.kind === 'mermaid')) {
      return next(e)
    }
    const lang = await read($, langAtom)
    const diagrams = await read($, diagramsAtom)
    const sources = await read($, diagramSourceAtom)
    const { Box, Button, Code } = $.ui.resolve(e)
    const cells = imageCells(e.viewport?.columns)
    const seen = new Map<string, number>()
    let isFirst = e.props.isFirstOfReply

    const parts = []
    for (const [index, segment] of segments.entries()) {
      if (segment.kind === 'markdown') {
        parts.push(await next({ ...e, props: { ...e.props, text: segment.text, isFirstOfReply: isFirst } }))
        isFirst = false
        continue
      }
      // 같은 블록이 한 메시지에 두 번 나오면 key가 겹치지 않게 순번을 붙인다.
      const count = seen.get(segment.hash) ?? 0
      seen.set(segment.hash, count + 1)
      const suffix = count === 0 ? segment.hash : `${segment.hash}-${count}`
      const code = <Code key={`code-${suffix}`} source={segment.code} language="mermaid" />
      const render = diagrams[segment.hash]
      const filePath = e.surface === 'terminal' ? render?.pngPath : (render?.svg ? render.svgPath : undefined)
      if (render === undefined || render.error !== undefined || filePath === undefined) {
        parts.push(code)
        continue
      }
      const isSource = sources.includes(segment.hash)
      let picture
      if (e.surface === 'terminal') {
        // kitty 계열만 그림을 그리고, 그 외 터미널은 엔진이 alt를 그린다.
        const { Image } = $.ui.resolve(e)
        picture = (
          <Image
            key={`img-${suffix}`}
            source={{ file: filePath, format: 'png' }}
            columns={cells.columns}
            rows={cells.rows}
            alt={tr(lang, 'diagram.altTerminal', { path: filePath })}
          />
        )
      } else {
        const { Svg } = $.ui.resolve(e)
        picture = <Svg source={render.svg ?? ''} alt={tr(lang, 'diagram.alt')} />
      }
      parts.push(
        <Box key={`diagram-${index}`} flexDirection="column">
          {isSource ? code : picture}
          <Box flexDirection="row" gap={1}>
            <Button
              key={`src-${suffix}`}
              onPress={() => update($, diagramSourceAtom, list =>
                list.includes(segment.hash) ? list.filter(h => h !== segment.hash) : [...list, segment.hash])}
            >
              {tr(lang, isSource ? 'diagram.showDiagram' : 'diagram.showSource')}
            </Button>
            <Button
              key={`copy-${suffix}`}
              onPress={async press => {
                const copied = await $.ui.copy({ text: filePath, surface: press.surface })
                $.ui.toast(copied.isCopied
                  ? tr(lang, 'diagram.copied', { path: filePath })
                  : tr(lang, 'diagram.copyFailed', { reason: copied.reason }))
              }}
            >
              {tr(lang, 'diagram.copyPath')}
            </Button>
          </Box>
        </Box>,
      )
    }
    return <Box flexDirection="column">{parts}</Box>
  })
}
