/**
 * mermaid 코드블록 추출·분할과 다이어그램 표시 계산(순수 함수).
 *
 * `$`를 쓰지 않으므로 index.tsx(turn.complete 사전 렌더, ui.render 표시)가 import해서 쓴다.
 */
import type { DiagramRender } from '../../types'

/** 응답 본문 조각: 엔진이 그릴 markdown, 또는 다이어그램으로 바꿀 mermaid 블록. */
export type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'mermaid'; code: string; hash: string }

/** mermaid 블록 하나. */
export type MermaidBlock = { code: string; hash: string }

/** desktop `Svg`가 받는 최대 길이. 넘으면 원본 코드로 표시한다. */
export const SVG_MAX_CHARS = 131_072

/**
 * desktop 표시용으로 SVG에서 내장 폰트 `<style>` 블록(`@font-face` + base64 woff2)을 뺀다.
 *
 * mermaid-cli 12는 Recursive 폰트 4종을 SVG에 통째로 넣어, 노드 3개짜리 다이어그램도 약 197,000자가 된다
 * (그중 폰트가 167,000자). 테마 style은 `"Recursive Variable",arial,sans-serif`로 대체 글꼴을 지정하므로
 * 폰트 블록만 빼도 모양이 유지된다. 저장 파일은 원본 그대로 두고 표시에만 쓴다.
 */
export const slimSvg = (svg: string): string =>
  svg.replace(/<style[^>]*>((?:(?!<\/style>)[\s\S])*)<\/style>/g, (block, body: string) =>
    body.includes('@font-face') ? '' : block,
  )

/** `diagrams` atom에 남기는 최대 개수. */
export const MAX_DIAGRAMS = 50

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const MERMAID_INFO = /^[ \t]*mermaid(?:[ \t].*)?$/i

/** FNV-1a 32bit 해시를 8자리 hex로 낸다(코드 내용용 — 경로 정규화를 하지 않는다). */
const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 해시용 정규화: 줄바꿈을 `\n`으로, 끝 공백 제거. 같은 다이어그램이 같은 파일을 쓰게 한다. */
const normalizeCode = (code: string): string => code.replace(/\r\n?/g, '\n').replace(/\s+$/, '')

/** mermaid 코드 → 캐시 파일 이름에 쓰는 해시. */
export const diagramHash = (code: string): string => fnv1a(normalizeCode(code))

/** 닫는 펜스: 여는 펜스와 같은 문자, 길이 이상, 뒤에는 공백만. */
const isClosing = (line: string, fence: string): boolean => {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
  return match !== null && match[1]![0] === fence[0] && match[1]!.length >= fence.length
}

/**
 * 본문을 markdown 조각과 mermaid 블록으로 나눈다. 다른 언어 펜스 안의 ```mermaid는 건드리지 않고,
 * 닫히지 않은 블록(스트리밍 중 등)과 빈 블록은 markdown으로 남긴다. 공백뿐인 markdown 조각은 버린다.
 */
export const splitMermaid = (text: string): Segment[] => {
  const lines = text.split('\n')
  const segments: Segment[] = []
  let pending: string[] = []
  const flush = (): void => {
    const joined = pending.join('\n')
    if (joined.trim() !== '') {
      segments.push({ kind: 'markdown', text: joined })
    }
    pending = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const open = FENCE_OPEN.exec(line.replace(/\r$/, ''))
    if (open === null) {
      pending.push(line)
      i += 1
      continue
    }
    const fence = open[1]!
    let close = i + 1
    while (close < lines.length && !isClosing(lines[close]!.replace(/\r$/, ''), fence)) {
      close += 1
    }
    const isClosed = close < lines.length
    const body = lines.slice(i + 1, close).map(row => row.replace(/\r$/, '')).join('\n')
    if (isClosed && MERMAID_INFO.test(open[2]!) && body.trim() !== '') {
      flush()
      segments.push({ kind: 'mermaid', code: body, hash: diagramHash(body) })
    } else {
      pending.push(...lines.slice(i, isClosed ? close + 1 : lines.length))
    }
    i = isClosed ? close + 1 : lines.length
  }
  flush()
  return segments
}

/** 본문의 mermaid 블록(해시 기준 중복 제거, 등장 순서). */
export const extractMermaid = (text: string): MermaidBlock[] => {
  const seen = new Set<string>()
  const blocks: MermaidBlock[] = []
  for (const segment of splitMermaid(text)) {
    if (segment.kind === 'mermaid' && !seen.has(segment.hash)) {
      seen.add(segment.hash)
      blocks.push({ code: segment.code, hash: segment.hash })
    }
  }
  return blocks
}

/** 최근 `max`개만 남긴다(삽입 순서 기준, 오래된 것부터 버림). */
export const keepRecent = (
  record: Readonly<Record<string, DiagramRender>>,
  max: number = MAX_DIAGRAMS,
): Record<string, DiagramRender> => Object.fromEntries(Object.entries(record).slice(-max))

/** terminal `Image` 크기(셀). 화면 폭에서 여백을 빼고 1~255 범위로 맞춘다. */
export const imageCells = (viewportColumns: number | undefined): { columns: number; rows: number } => {
  const columns = Math.max(10, Math.min(100, (viewportColumns ?? 80) - 4, 255))
  const rows = Math.max(6, Math.min(30, Math.round(columns / 3)))
  return { columns, rows }
}

/** 실행 실패 사유: stderr의 첫 의미 있는 줄(최대 200자). 경로·토큰이 아닌 mmdc 오류 문구만 남는다. */
export const failureReason = (stderr: string, exitCode: number): string => {
  const line = stderr.split(/\r?\n/).map(row => row.trim()).find(row => row !== '')
  return (line ?? `exit ${exitCode}`).slice(0, 200)
}

/** `cmd /c mmdc` 결과가 "명령을 찾을 수 없음"인지. */
export const isCommandMissing = (exitCode: number, stderr: string): boolean =>
  exitCode !== 0 && /not recognized|인식되지 않|not found|찾을 수 없/i.test(stderr)
