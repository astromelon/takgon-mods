// 로컬에서 CI(.github/workflows/ci.yml)와 같은 검사를 한 번에 돌린다.
//
//   node tools/ci-local.mjs [--keep-going] [--install-deps] [--tsc]
//
// 순서는 CI와 같다: 릴리스 버전 검사 → validate → test → e2e 하네스 단위 테스트 → e2e probe.
// 기본은 첫 실패에서 멈춘다. --keep-going은 끝까지 돌려 요약만 낸다.
// --install-deps는 e2e 의존성(pip install)을 먼저 설치한다(CI의 해당 단계). --tsc는 CI에 없는 타입 체크를 덧붙인다.
// CI는 Claude Code 2.1.296 고정이다. 로컬 버전이 다르면 아래에서 경고한다.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CI_CLAUDE_VERSION = '2.1.296';

const flags = new Set(process.argv.slice(2));
const isKeepGoing = flags.has('--keep-going');

// shell을 쓰는 이유: Windows에서 claude·npx가 .cmd 셈이라 직접 실행이 안 된다. 인자는 모두 고정 문자열이다.
const run = (command) => spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });

const steps = [
  ...(flags.has('--install-deps')
    ? [{ name: 'e2e 의존성 설치', command: 'pip install -r tools/e2e/requirements.txt' }]
    : []),
  { name: 'Check release version', command: 'node tools/release.mjs --check' },
  { name: 'Validate plugin', command: 'claude plugin validate .' },
  { name: 'Test plugin', command: 'claude plugin test .' },
  { name: 'Test e2e harness', command: 'python -m unittest discover -s tools/e2e -p "test_*.py"' },
  { name: 'Run e2e probes', command: 'python tools/e2e/run.py probe_catch probe_clear_state' },
  ...(flags.has('--tsc') ? [{ name: 'Type check (CI 외)', command: 'npx -p typescript tsc -p .' }] : []),
];

const version = spawnSync('claude --version', { cwd: root, shell: true, encoding: 'utf8' });
const local = /\d+\.\d+\.\d+/.exec(version.stdout ?? '')?.[0];
console.log(`Claude Code ${local ?? '(확인 실패)'} (CI 고정: ${CI_CLAUDE_VERSION})`);
if (local !== CI_CLAUDE_VERSION) {
  console.warn('경고: 버전이 CI와 달라 결과가 다를 수 있다.');
}

const results = [];
for (const step of steps) {
  console.log(`\n=== ${step.name} ===\n$ ${step.command}`);
  const startedAt = Date.now();
  const isOk = run(step.command).status === 0;
  results.push({ name: step.name, isOk, seconds: Math.round((Date.now() - startedAt) / 1000) });
  if (!isOk && !isKeepGoing) {
    break;
  }
}

console.log('\n=== 요약 ===');
for (const { name, isOk, seconds } of results) {
  console.log(`${isOk ? '✓' : '✗'} ${name} (${seconds}s)`);
}
const skipped = steps.length - results.length;
if (skipped > 0) {
  console.log(`- 건너뜀 ${skipped}개(첫 실패에서 중단, 끝까지 보려면 --keep-going)`);
}
process.exit(results.every((r) => r.isOk) && skipped === 0 ? 0 : 1);
