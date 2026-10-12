/**
 * 내장 UI 요소의 한국어 번역(순수 함수).
 *
 * 각 함수는 바꿀 것이 없으면 `undefined`를 돌려주고, 호출하는 훅은 그때 `next(e)`로 엔진 표시를 그대로 둔다.
 * 엔진 문구는 빌드마다 바뀔 수 있으므로 정확히 아는 문구만 바꾼다.
 */
import type { RenderSurface } from 'claude-code'

/** Spinner `mode` → 한국어 동사구. terminal의 단어는 무작위 동명사(`Sauteing`)라 의미가 없어 모드로 대체한다. */
const SPINNER_BY_MODE: Readonly<Record<string, string>> = {
  thinking: '생각하는 중',
  requesting: '요청하는 중',
  responding: '답변 작성 중',
  'tool-input': '도구 입력 준비 중',
  'tool-use': '도구 실행 중',
}

/**
 * Spinner 단어. desktop의 단어는 실제 단계 설명(`Creating notes.md`)이라 기본값 `Working`만 바꾼다.
 */
export const translateSpinnerWord = (
  word: string,
  mode: string,
  surface: RenderSurface,
): string | undefined => {
  if (surface === 'desktop') {
    return word === 'Working' ? '작업 중' : undefined
  }
  return SPINNER_BY_MODE[mode]
}

/** 경과 시간: `3초`, `1분 4초`, `1시간 2분`. */
export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}분 ${seconds}초` : `${minutes}분`
  }
  return `${seconds}초`
}

/** `(ctrl+b to run in background)` → `(ctrl+b: 백그라운드로 실행)`. 사용자 키 바인딩은 그대로 둔다. */
export const translateBackgroundHint = (hint: string): string | undefined => {
  const match = /^\((.+) to run in background\)$/.exec(hint.trim())
  return match ? `(${match[1]}: 백그라운드로 실행)` : undefined
}

/**
 * 프롬프트 아래 힌트. 줄 전체를 바꾸면 엔진의 pill이 사라지므로, 알려진 문구와 **정확히** 같을 때만 바꾼다.
 */
const PROMPT_HINTS: Readonly<Record<string, string>> = {
  '? for shortcuts': '? 단축키',
  'esc to interrupt': 'esc 중단',
}

export const translatePromptHint = (hint: string): string | undefined => PROMPT_HINTS[hint.trim()]

/** 프롬프트 footer 모드 라벨. 모르는 라벨은 그대로 둔다. */
const MODES: Readonly<Record<string, string>> = {
  focus: '집중',
  'memory paused': '메모리 일시정지',
}

export const translateModes = (modes: readonly string[]): string[] | undefined => {
  const translated = modes.map(mode => MODES[mode] ?? mode)
  return translated.some((mode, i) => mode !== modes[i]) ? translated : undefined
}
