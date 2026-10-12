import { createTranslator } from '../shared/i18n'

/** M7 기본(ko) 사전. 키 목록의 단일 출처다. */
const ko = {
  'cmd.description': '인수인계 문서 생성·보기·다음 프롬프트에 첨부, 자동 생성 임계치 설정',
  'cmd.usage': '사용법: /tk-handoff (지금 생성) | /tk-handoff show | /tk-handoff load | /tk-handoff threshold [1-99]',
  'cmd.threshold': '자동 인수인계 임계치: 컨텍스트 {value}%',
  'cmd.off': 'handoff 모듈이 꺼져 있습니다. /mods handoff on 으로 켤 수 있습니다.',
  'cmd.saved': '인수인계 문서를 저장했습니다: {path}',
  'cmd.failed': '인수인계 문서를 만들지 못했습니다({reason}).',
  'cmd.none': '아직 인수인계 문서가 없습니다. /tk-handoff 로 만들 수 있습니다.',
  'cmd.missing': '인수인계 파일을 찾을 수 없습니다: {path}',
  'cmd.pending': '다음 프롬프트에 인수인계 문서를 첨부합니다: {path}',
  'cmd.show': '최신 인수인계 ({time})\n{path}\n\n{summary}',
  'toast.saved': '컨텍스트 사용량이 높아 인수인계 문서를 저장했습니다: {path}',
  'toast.available': '이전 인수인계 문서가 있습니다({time}). /tk-handoff load 로 다음 프롬프트에 첨부하세요.',
  'prompt.intro':
    '지금까지의 대화를 새 세션이 이어받을 수 있도록 인수인계 문서를 Markdown으로 작성하라. ' +
    '도구는 쓰지 말고 문서 본문만 출력한다. 아래 섹션을 이 제목과 순서 그대로 쓰고, 내용이 없으면 "없음"이라고 쓴다.',
  'prompt.goal': '목표',
  'prompt.done': '완료',
  'prompt.doing': '진행중',
  'prompt.decisions': '결정사항',
  'prompt.open': '열린 이슈/PR',
  'prompt.next': '다음 단계',
  'prompt.refs': '참고 자료(대화와 함께 반영한다):',
  'prompt.pins': '[결정사항: 고정한 핀]',
  'prompt.pr': '[현재 브랜치 PR]',
  'prompt.issues': '[연결된 이슈]',
  'prompt.tasks': '[미완료 작업: 다음 단계 참고]',
  'prompt.empty': '- 없음',
} as const

/** M7 메시지 키. */
export type HandoffMessageKey = keyof typeof ko

const en: Record<HandoffMessageKey, string> = {
  'cmd.description': 'Create, show, or attach a handoff note to the next prompt',
  'cmd.usage': 'Usage: /tk-handoff (create now) | /tk-handoff show | /tk-handoff load | /tk-handoff threshold [1-99]',
  'cmd.threshold': 'Auto handoff threshold: {value}% of context',
  'cmd.off': 'The handoff module is off. Turn it on with /mods handoff on.',
  'cmd.saved': 'Saved the handoff note: {path}',
  'cmd.failed': 'Could not create the handoff note ({reason}).',
  'cmd.none': 'No handoff note yet. Create one with /tk-handoff.',
  'cmd.missing': 'Handoff file not found: {path}',
  'cmd.pending': 'The handoff note will be attached to your next prompt: {path}',
  'cmd.show': 'Latest handoff ({time})\n{path}\n\n{summary}',
  'toast.saved': 'Context usage is high; saved a handoff note: {path}',
  'toast.available': 'A previous handoff note exists ({time}). Run /tk-handoff load to attach it.',
  'prompt.intro':
    'Write a handoff note in Markdown so a new session can continue this conversation. ' +
    'Use no tools and output only the note. Use the sections below with these exact titles in order; ' +
    'write "None" for an empty one.',
  'prompt.goal': 'Goal',
  'prompt.done': 'Done',
  'prompt.doing': 'In progress',
  'prompt.decisions': 'Decisions',
  'prompt.open': 'Open issues/PRs',
  'prompt.next': 'Next steps',
  'prompt.refs': 'References (combine with the conversation):',
  'prompt.pins': '[Decisions: pinned notes]',
  'prompt.pr': '[PR for the current branch]',
  'prompt.issues': '[Linked issues]',
  'prompt.tasks': '[Unfinished tasks: for next steps]',
  'prompt.empty': '- None',
}

export const tr = createTranslator(ko, en)
