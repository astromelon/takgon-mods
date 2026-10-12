import { createTranslator } from '../shared/i18n'

/** M3 사전(ko가 키의 단일 출처). */
const ko = {
  'edit.description': '수정 대상(파일 행 범위·선택 영역·DOM 요소)을 지정',
  'edit.usage':
    '사용법: /edit <경로>:<시작>-<끝> | /edit sel | /edit dom <selector> [url] | /edit clear | /edit',
  'edit.off': 'edit 모듈이 꺼져 있습니다. /mods edit on 으로 켜세요.',
  'edit.none': '지정된 수정 대상이 없습니다.',
  'edit.cleared': '수정 대상을 해제했습니다.',
  'edit.current': '현재 수정 대상: {target}',
  'edit.set': '수정 대상을 지정했습니다: {target}\n해제하려면 /edit clear',
  'edit.target.text': '{path} {start}~{end}행',
  'edit.target.sel': '선택한 문단({chars}자)',
  'edit.target.dom': '{url} 의 {selector}',
  'edit.readFailed': '파일을 읽을 수 없습니다: {path}',
  'edit.outOfRange': '범위가 파일 길이({lines}행)를 벗어납니다: {start}-{end}',
  'edit.noSelection': '선택된 텍스트가 없습니다. fullscreen 터미널에서 마우스로 선택한 뒤 다시 실행하세요.',
  'edit.noUrl': 'URL이 없습니다. /edit dom <selector> <url> 로 지정하거나 /browse 를 먼저 실행하세요.',
  'edit.headlessMissing': 'headless 스크립트(tools/headless.mjs)가 없어 DOM 대상을 수집할 수 없습니다.',
  'edit.playwrightMissing':
    'Playwright가 없어 DOM 대상을 수집할 수 없습니다. npm i -g playwright 후 npx playwright install chromium',
  'edit.headlessFailed': 'DOM 요소 수집에 실패했습니다: {reason}',
  'edit.ctx.text':
    '[선택 영역 수정] 파일 {path} 의 {start}~{end}행만 수정하고, 그 밖의 행은 절대 변경하지 마세요. ' +
    '범위 밖 Edit/Write는 거부됩니다.\n현재 내용:\n{fence}\n{excerpt}\n{fence}',
  'edit.ctx.sel':
    '[선택 영역 수정] 사용자가 화면에서 선택한 아래 문단만 수정하고, 나머지는 변경하지 마세요.\n' +
    '{fence}\n{excerpt}\n{fence}',
  'edit.ctx.dom':
    '[DOM 요소 수정] 페이지 {url} 의 요소 `{selector}` 만 대상으로 수정하세요. 다른 요소의 스타일·구조는 바꾸지 마세요.\n' +
    'computed style:\n{style}',
  'edit.ctx.screenshot': '요소 스크린샷: {path}',
  'edit.deny.write': '선택 영역 수정 중: {path} 전체 덮어쓰기(Write)는 금지됩니다. {start}~{end}행만 Edit로 수정하세요.',
  'edit.deny.outside':
    '선택 영역 수정 중: 변경 위치({from}~{to}행)가 대상 범위 {start}~{end}행 밖입니다. 범위 안만 수정하세요.',
  'edit.deny.notFound':
    '선택 영역 수정 중: old_string을 {path} 에서 찾을 수 없어 범위를 확인할 수 없습니다. 대상 범위 {start}~{end}행 안의 텍스트를 쓰세요.',
  'edit.deny.unreadable': '선택 영역 수정 중: {path} 을(를) 읽을 수 없어 범위를 확인할 수 없습니다.',
  'edit.deny.guardFailed': '선택 영역 수정 가드가 실패해 변경을 거부합니다. /edit clear 후 다시 시도하세요.',
} as const

/** M3 메시지 키. */
export type EditMessageKey = keyof typeof ko

const en: Record<EditMessageKey, string> = {
  'edit.description': 'Set an edit target (file line range, selection, DOM element)',
  'edit.usage':
    'Usage: /edit <path>:<start>-<end> | /edit sel | /edit dom <selector> [url] | /edit clear | /edit',
  'edit.off': 'The edit module is off. Turn it on with /mods edit on.',
  'edit.none': 'No edit target is set.',
  'edit.cleared': 'Edit target cleared.',
  'edit.current': 'Current edit target: {target}',
  'edit.set': 'Edit target set: {target}\nClear it with /edit clear',
  'edit.target.text': '{path} lines {start}-{end}',
  'edit.target.sel': 'selected passage ({chars} chars)',
  'edit.target.dom': '{selector} on {url}',
  'edit.readFailed': 'Cannot read file: {path}',
  'edit.outOfRange': 'Range is outside the file ({lines} lines): {start}-{end}',
  'edit.noSelection': 'Nothing is selected. Select text with the mouse in fullscreen terminal, then retry.',
  'edit.noUrl': 'No URL. Use /edit dom <selector> <url> or run /browse first.',
  'edit.headlessMissing': 'The headless script (tools/headless.mjs) is missing; cannot collect the DOM target.',
  'edit.playwrightMissing':
    'Playwright is not installed; cannot collect the DOM target. npm i -g playwright, then npx playwright install chromium',
  'edit.headlessFailed': 'Collecting the DOM element failed: {reason}',
  'edit.ctx.text':
    '[Select-to-edit] Change only lines {start}-{end} of {path}; do not change any other line. ' +
    'Edit/Write outside the range is denied.\nCurrent content:\n{fence}\n{excerpt}\n{fence}',
  'edit.ctx.sel':
    '[Select-to-edit] Change only the passage below that the user selected on screen; leave the rest unchanged.\n' +
    '{fence}\n{excerpt}\n{fence}',
  'edit.ctx.dom':
    '[DOM edit] Change only the element `{selector}` on {url}. Do not change other elements’ styles or structure.\n' +
    'computed style:\n{style}',
  'edit.ctx.screenshot': 'Element screenshot: {path}',
  'edit.deny.write': 'Select-to-edit active: overwriting {path} with Write is denied. Use Edit within lines {start}-{end}.',
  'edit.deny.outside':
    'Select-to-edit active: the change (lines {from}-{to}) is outside the target lines {start}-{end}. Edit only inside the range.',
  'edit.deny.notFound':
    'Select-to-edit active: old_string was not found in {path}, so the range cannot be checked. Use text within lines {start}-{end}.',
  'edit.deny.unreadable': 'Select-to-edit active: cannot read {path} to check the range.',
  'edit.deny.guardFailed': 'The select-to-edit guard failed, so the change is denied. Run /edit clear and retry.',
}

/** M3 번역기. */
export const tr = createTranslator(ko, en)
