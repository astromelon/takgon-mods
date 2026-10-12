import { createTranslator } from '../shared/i18n'

/** M2 기본(ko) 사전. 키 목록의 단일 출처다. */
const ko = {
  'cmd.description': '로컬 개발 서버 페이지 확인(상태·콘솔 에러·스크린샷)',
  'cmd.off': 'browser 모듈이 꺼져 있습니다. `/mods browser on`으로 켜세요.',
  'cmd.noUrl': '확인할 URL이 없습니다. `/browse <url>`로 지정하거나 개발 서버를 먼저 실행하세요.',
  'cmd.badUrl': 'http:// 또는 https:// 로 시작하는 URL만 확인할 수 있습니다: {url}',
  'cmd.done': '{url} → 상태 {status}, 콘솔 에러 {count}건',
  'pane.title': '브라우저',
  'pane.empty': '감지된 URL이 없습니다. 개발 서버를 실행하거나 `/browse <url>`을 쓰세요.',
  'pane.status': '상태: {status}',
  'pane.unreachable': '상태: 응답 없음',
  'pane.unchecked': '상태: 확인 전 (`/browse`로 확인)',
  'pane.pageTitle': '제목: {title}',
  'pane.errors': '콘솔 에러 {count}건',
  'pane.noErrors': '콘솔 에러 없음',
  'pane.more': '… 외 {count}건',
  'pane.screenshot': '스크린샷: {path}',
  'pane.screenshotAlt': '페이지 스크린샷 (이 터미널은 이미지를 그리지 못합니다: {path})',
  'button.openExternal': '외부 브라우저로 열기',
  'button.attachOn': '다음 프롬프트에 콘솔 에러 첨부: 켜짐',
  'button.attachOff': '다음 프롬프트에 콘솔 에러 첨부: 꺼짐',
  'button.refresh': '새로고침',
  'toast.nodeMissing': 'browser: node를 찾을 수 없어 HTTP 상태만 표시합니다.',
  'toast.playwrightMissing':
    'browser: playwright가 없어 HTTP 상태만 표시합니다. `npm i -g playwright && npx playwright install chromium`',
  'toast.headlessFailed': 'browser: headless 스크립트 결과를 읽지 못해 HTTP 상태만 표시합니다.',
  'toast.openFailed': 'browser: 외부 브라우저를 열지 못했습니다.',
} as const

/** 메시지 키. */
export type BrowserKey = keyof typeof ko

const en: Record<BrowserKey, string> = {
  'cmd.description': 'Check a local dev server page (status, console errors, screenshot)',
  'cmd.off': 'The browser module is off. Turn it on with `/mods browser on`.',
  'cmd.noUrl': 'No URL to check. Pass `/browse <url>` or start a dev server first.',
  'cmd.badUrl': 'Only URLs starting with http:// or https:// can be checked: {url}',
  'cmd.done': '{url} → status {status}, {count} console errors',
  'pane.title': 'Browser',
  'pane.empty': 'No URL detected. Start a dev server or use `/browse <url>`.',
  'pane.status': 'Status: {status}',
  'pane.unreachable': 'Status: no response',
  'pane.unchecked': 'Status: not checked yet (run `/browse`)',
  'pane.pageTitle': 'Title: {title}',
  'pane.errors': '{count} console errors',
  'pane.noErrors': 'No console errors',
  'pane.more': '… and {count} more',
  'pane.screenshot': 'Screenshot: {path}',
  'pane.screenshotAlt': 'Page screenshot (this terminal cannot draw images: {path})',
  'button.openExternal': 'Open in browser',
  'button.attachOn': 'Attach console errors to next prompt: on',
  'button.attachOff': 'Attach console errors to next prompt: off',
  'button.refresh': 'Refresh',
  'toast.nodeMissing': 'browser: node not found; showing HTTP status only.',
  'toast.playwrightMissing':
    'browser: playwright not found; showing HTTP status only. `npm i -g playwright && npx playwright install chromium`',
  'toast.headlessFailed': 'browser: could not read the headless script output; showing HTTP status only.',
  'toast.openFailed': 'browser: could not open the external browser.',
}

/** M2 번역기. */
export const tr = createTranslator(ko, en)
