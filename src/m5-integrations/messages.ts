import { createTranslator } from '../shared/i18n'

/** M5 기본(ko) 사전. 키 목록의 단일 출처다. */
const ko = {
  'issue.description': 'Linear 이슈 검색·연결·상태 변경',
  'issue.argumentHint': '[<검색어> | link <id> | unlink <id> | status <id> <상태>]',
  'issue.moduleOff': 'integrations 모듈이 꺼져 있습니다. /mods integrations on 으로 켜세요.',
  'issue.noKey':
    'LINEAR_API_KEY 환경변수가 없어 Linear 기능을 쓸 수 없습니다. 키를 설정한 뒤 다시 시작하세요.',
  'issue.usage':
    '사용법: /issue | /issue <검색어> | /issue link <id> | /issue unlink <id> | /issue status <id> <상태>',
  'issue.searchEmpty': '"{q}" 검색 결과가 없습니다.',
  'issue.searchTitle': '"{q}" 검색 결과 {count}건',
  'issue.row': '- {identifier} [{state}] {title} {url}',
  'issue.linkedEmpty': '이 프로젝트에 연결된 이슈가 없습니다. /issue link <id> 로 연결하세요.',
  'issue.linkedTitle': '연결된 이슈 {count}건',
  'issue.notFound': '이슈 {id}를 찾을 수 없습니다.',
  'issue.linked': '{identifier}를 이 프로젝트에 연결했습니다.',
  'issue.alreadyLinked': '{identifier}는 이미 연결돼 있습니다.',
  'issue.linkLimit': '연결 가능한 이슈는 최대 {max}건입니다. /issue unlink <id> 로 정리하세요.',
  'issue.unlinked': '{identifier} 연결을 해제했습니다.',
  'issue.notLinked': '{identifier}는 연결돼 있지 않습니다.',
  'issue.stateNotFound': '상태 "{state}"가 없습니다. 가능한 상태: {states}',
  'issue.confirmStatus': '{identifier}의 상태를 "{from}"에서 "{to}"(으)로 바꿀까요?',
  'issue.confirmYes': '변경',
  'issue.confirmNo': '취소',
  'issue.cancelled': '상태 변경을 취소했습니다.',
  'issue.statusChanged': '{identifier} 상태를 "{state}"(으)로 바꿨습니다.',
  'issue.failed': 'Linear 요청에 실패했습니다({cause}).',
  'toast.ghMissing': 'gh CLI를 실행할 수 없어 PR 배지를 숨깁니다. gh를 설치하세요.',
  'toast.ghAuth': 'gh 인증이 필요해 PR 배지를 숨깁니다. gh auth login 을 실행하세요.',
  'toast.glabMissing': 'glab CLI를 실행할 수 없어 MR 배지를 숨깁니다. glab을 설치하세요.',
  'toast.glabAuth': 'glab 인증이 필요해 MR 배지를 숨깁니다. glab auth login --hostname <호스트> 를 실행하세요.',
  'toast.linearAuth': 'Linear 인증에 실패했습니다. LINEAR_API_KEY를 확인하세요.',
  'toast.linearHttp': 'Linear 요청에 실패했습니다. 잠시 후 다시 시도하세요.',
} as const

/** M5 메시지 키. */
export type M5Key = keyof typeof ko

const en: Record<M5Key, string> = {
  'issue.description': 'Search, link and update Linear issues',
  'issue.argumentHint': '[<query> | link <id> | unlink <id> | status <id> <state>]',
  'issue.moduleOff': 'The integrations module is off. Turn it on with /mods integrations on.',
  'issue.noKey': 'LINEAR_API_KEY is not set, so Linear is unavailable. Set it and restart.',
  'issue.usage':
    'Usage: /issue | /issue <query> | /issue link <id> | /issue unlink <id> | /issue status <id> <state>',
  'issue.searchEmpty': 'No issues match "{q}".',
  'issue.searchTitle': '{count} issues match "{q}"',
  'issue.row': '- {identifier} [{state}] {title} {url}',
  'issue.linkedEmpty': 'No issues are linked to this project. Link one with /issue link <id>.',
  'issue.linkedTitle': '{count} linked issues',
  'issue.notFound': 'Issue {id} was not found.',
  'issue.linked': 'Linked {identifier} to this project.',
  'issue.alreadyLinked': '{identifier} is already linked.',
  'issue.linkLimit': 'At most {max} issues can be linked. Remove some with /issue unlink <id>.',
  'issue.unlinked': 'Unlinked {identifier}.',
  'issue.notLinked': '{identifier} is not linked.',
  'issue.stateNotFound': 'No state "{state}". Available: {states}',
  'issue.confirmStatus': 'Change {identifier} from "{from}" to "{to}"?',
  'issue.confirmYes': 'Change',
  'issue.confirmNo': 'Cancel',
  'issue.cancelled': 'Status change cancelled.',
  'issue.statusChanged': 'Set {identifier} to "{state}".',
  'issue.failed': 'The Linear request failed ({cause}).',
  'toast.ghMissing': 'Cannot run the gh CLI; hiding the PR badge. Install gh.',
  'toast.ghAuth': 'gh needs authentication; hiding the PR badge. Run gh auth login.',
  'toast.glabMissing': 'Cannot run the glab CLI; hiding the MR badge. Install glab.',
  'toast.glabAuth': 'glab needs authentication; hiding the MR badge. Run glab auth login --hostname <host>.',
  'toast.linearAuth': 'Linear authentication failed. Check LINEAR_API_KEY.',
  'toast.linearHttp': 'The Linear request failed. Try again later.',
}

/** M5 번역기. */
export const tr = createTranslator(ko, en)
