// 새 버전 릴리스 자동화: plugin.json 버전 올림 + CHANGELOG [Unreleased] → 새 버전 절.
//
//   node tools/release.mjs <x.y.z|patch|minor|major> [--commit] [--push]
//   node tools/release.mjs --check   # plugin.json 버전 == CHANGELOG 최상단 버전 절인지 검사(CI용)
//   node tools/release.mjs --check-tags   # 태그 vX.Y.Z마다 그 커밋의 plugin.json·CHANGELOG 버전이 X.Y.Z인지, 현재 버전 태그가 있는지 검사(CI용, 전체 이력 필요)
//
// 기본은 파일만 수정한다. --commit은 커밋하고 주석 태그 v<x.y.z>를 단다. --push는 커밋과 태그를 push한다(--commit을 포함).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginPath = join(root, '.claude-plugin', 'plugin.json');
const changelogPath = join(root, 'CHANGELOG.md');
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const UNRELEASED = '## [Unreleased]';

const fail = (message) => {
  console.error(`오류: ${message}`);
  process.exit(1);
};

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const parse = (version) => version.split('.').map(Number);
const isGreater = (a, b) => {
  const [pa, pb] = [parse(a), parse(b)];
  const i = pa.findIndex((n, idx) => n !== pb[idx]);
  return i !== -1 && pa[i] > pb[i];
};

const pluginText = readFileSync(pluginPath, 'utf8');
const currentVersion = /"version"\s*:\s*"([^"]+)"/.exec(pluginText)?.[1];
if (!currentVersion || !VERSION_RE.test(currentVersion)) {
  fail(`plugin.json의 version을 읽을 수 없다: ${currentVersion}`);
}

const changelog = readFileSync(changelogPath, 'utf8');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const target = args.find((a) => !a.startsWith('--'));

if (flags.has('--check')) {
  const top = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)?.[1];
  if (top !== currentVersion) {
    fail(`plugin.json(${currentVersion})과 CHANGELOG 최상단 버전 절(${top})이 다르다.`);
  }
  console.log(`OK: plugin.json과 CHANGELOG 최상단 버전이 ${currentVersion}로 같다.`);
  process.exit(0);
}

if (flags.has('--check-tags')) {
  if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
    fail('얕은 클론이라 태그를 검사할 수 없다. 전체 이력이 필요하다(CI는 checkout에 fetch-depth: 0).');
  }
  const tags = git('tag', '--list', 'v*').split('\n').filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  // 그 태그에 파일이 없으면 null. git의 오류 출력은 숨긴다(첫 릴리스 태그엔 CHANGELOG가 없다).
  const showFile = (tag, path) => {
    try {
      return execFileSync('git', ['show', `${tag}:${path}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  };

  const problems = [];
  for (const tag of tags) {
    const version = tag.slice(1);
    const pluginAtTag = showFile(tag, '.claude-plugin/plugin.json');
    const pluginVersion = pluginAtTag && /"version"\s*:\s*"([^"]+)"/.exec(pluginAtTag)?.[1];
    if (pluginVersion !== version) {
      problems.push(`${tag}: 그 커밋의 plugin.json 버전이 ${pluginVersion ?? '없음'}이다.`);
    }
    // 첫 릴리스(v0.1.0)처럼 CHANGELOG에 버전 절이 아직 없던 태그는 건너뛴다.
    const top = /^## \[(\d+\.\d+\.\d+)\]/m.exec(showFile(tag, 'CHANGELOG.md') ?? '')?.[1];
    if (top && top !== version) {
      problems.push(`${tag}: 그 커밋의 CHANGELOG 최상단 버전 절이 ${top}이다.`);
    }
  }

  const currentTag = `v${currentVersion}`;
  if (!tags.includes(currentTag)) {
    problems.push(`현재 버전의 태그 ${currentTag}가 없다. git tag -a ${currentTag} <릴리스 커밋> -m ${currentTag} && git push origin ${currentTag}`);
  } else {
    try {
      git('merge-base', '--is-ancestor', currentTag, 'HEAD');
    } catch {
      problems.push(`${currentTag}가 HEAD의 조상이 아니다(다른 브랜치의 태그이거나 이력이 갈라졌다).`);
    }
  }

  if (problems.length) {
    fail(`태그·버전 불일치 ${problems.length}건:\n- ${problems.join('\n- ')}`);
  }
  console.log(`OK: 태그 ${tags.length}개가 각 커밋의 plugin.json·CHANGELOG 버전과 같고, 현재 버전 ${currentTag}가 HEAD의 조상이다.`);
  process.exit(0);
}

if (!target) fail('사용법: node tools/release.mjs <x.y.z|patch|minor|major> [--commit] [--push]');

const [major, minor, patch] = parse(currentVersion);
const bumps = {
  patch: `${major}.${minor}.${patch + 1}`,
  minor: `${major}.${minor + 1}.0`,
  major: `${major + 1}.0.0`,
};
const next = bumps[target] ?? target;
if (!VERSION_RE.test(next)) fail(`버전 형식이 올바르지 않다: ${next}`);
if (!isGreater(next, currentVersion)) fail(`새 버전 ${next}는 현재 ${currentVersion}보다 커야 한다.`);

if (git('status', '--porcelain').trim()) fail('작업 트리가 깨끗하지 않다. 먼저 커밋하거나 stash한다.');

const tag = `v${next}`;
if ((flags.has('--commit') || flags.has('--push')) && git('tag', '--list', tag).trim()) {
  fail(`태그 ${tag}가 이미 있다.`);
}

const start = changelog.indexOf(UNRELEASED);
if (start === -1) fail(`CHANGELOG에 "${UNRELEASED}" 절이 없다.`);
const bodyStart = start + UNRELEASED.length;
const nextSection = changelog.indexOf('\n## [', bodyStart);
const bodyEnd = nextSection === -1 ? changelog.length : nextSection + 1;
const body = changelog.slice(bodyStart, bodyEnd).trim();
if (!body) fail('[Unreleased]가 비어 있다. 릴리스할 변경 사항을 먼저 기록한다.');

const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD(로컬 날짜)
const released = `${changelog.slice(0, start)}${UNRELEASED}\n\n## [${next}] - ${today}\n\n${body}\n\n${changelog.slice(bodyEnd).trimStart()}`;

writeFileSync(changelogPath, released);
writeFileSync(pluginPath, pluginText.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`));
console.log(`${currentVersion} → ${next} (${today})`);

if (flags.has('--commit') || flags.has('--push')) {
  git('add', '.claude-plugin/plugin.json', 'CHANGELOG.md');
  git('commit', '-m', `build: ${next}로 버전을 올리고 CHANGELOG 정리\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`);
  console.log('커밋 완료');
  git('tag', '-a', tag, '-m', tag);
  console.log(`태그 ${tag} 생성`);
  if (flags.has('--push')) {
    git('push', '--follow-tags'); // 커밋과 그 커밋을 가리키는 주석 태그를 함께 올린다
    console.log('push 완료');
  }
} else {
  console.log(git('diff', '--stat'));
}
