/**
 * 터미널 칸 기준 글자 폭 계산과 자르기(순수 함수).
 */

/** 한글·CJK·전각 문자 판정(대략). 이모지(U+1F300 이상)도 2칸으로 본다. */
export const isWide = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x1f300
  )
}

const cellWidth = (ch: string): number => (isWide(ch) ? 2 : 1)

/** `room` 칸 안에 들어가는 앞부분. */
const sliceToWidth = (text: string, room: number): string => {
  let width = 0
  let out = ''
  for (const ch of text) {
    const cell = cellWidth(ch)
    if (width + cell > room) {
      break
    }
    width += cell
    out += ch
  }
  return out
}

/** 한 줄로 만들고 `columns` 칸에 맞춰 자른다(넘치면 끝에 `…`). 폭이 2칸인 문자를 고려한다. */
export const fit = (text: string, columns: number): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  const room = Math.max(1, columns)
  let width = 0
  let out = ''
  for (const ch of line) {
    const cell = cellWidth(ch)
    if (width + cell > room) {
      return `${sliceToWidth(out, room - 1)}…`
    }
    width += cell
    out += ch
  }
  return out
}

/** 본문 안의 가장 긴 백틱 연속보다 1 긴 코드 펜스(최소 3개). */
export const fenceFor = (text: string): string => {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length))
  return '`'.repeat(longest + 1)
}
