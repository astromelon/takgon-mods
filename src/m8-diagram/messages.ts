import { createTranslator } from '../shared/i18n'

/** M8 사전(ko). 키의 단일 출처. */
const ko = {
  'diagram.alt': 'mermaid 다이어그램',
  'diagram.altTerminal': 'mermaid 다이어그램 — 이 터미널은 이미지를 그리지 못합니다. 파일: {path}',
  'diagram.showSource': '원본 보기',
  'diagram.showDiagram': '다이어그램 보기',
  'diagram.copyPath': '경로 복사',
  'diagram.copied': '다이어그램 파일 경로를 복사했습니다: {path}',
  'diagram.copyFailed': '경로를 복사하지 못했습니다: {reason}',
  'diagram.mmdcMissing':
    'mmdc를 실행할 수 없어 mermaid 블록을 원본 코드로 표시합니다. 설치: npm i -g @mermaid-js/mermaid-cli',
  'diagram.renderFailed': 'mermaid 렌더링에 실패해 원본 코드로 표시합니다: {reason}',
} as const

const en: Record<keyof typeof ko, string> = {
  'diagram.alt': 'Mermaid diagram',
  'diagram.altTerminal': 'Mermaid diagram — this terminal cannot draw images. File: {path}',
  'diagram.showSource': 'Show source',
  'diagram.showDiagram': 'Show diagram',
  'diagram.copyPath': 'Copy path',
  'diagram.copied': 'Copied diagram file path: {path}',
  'diagram.copyFailed': 'Could not copy the path: {reason}',
  'diagram.mmdcMissing':
    'mmdc could not run, so mermaid blocks show as source. Install: npm i -g @mermaid-js/mermaid-cli',
  'diagram.renderFailed': 'Mermaid render failed, showing source: {reason}',
}

/** M8 번역기. */
export const tr = createTranslator(ko, en)
