/**
 * FNV-1a 32bit 해시를 8자리 hex로 낸다.
 *
 * 프로젝트 식별자(`projectId`)와 다이어그램 캐시 파일 이름이 이 값에 달려 있어, 알고리즘을 바꾸면
 * store의 프로젝트 데이터가 새 키로 갈라져 사라진 것처럼 보인다. `tests/shared.test.ts`의 고정 값 테스트가 지킨다.
 */
export const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
