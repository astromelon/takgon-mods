import { atom, read, update } from 'claude-code'
import type { CommandSpec, EngineInterface, On } from 'claude-code'

import type { BrowserInfo } from '../../types'
import { OUTPUT_GITIGNORE, markNotified, outputDir, refusalReason, registerCause } from '../shared/settings'
import { t } from '../shared/i18n'
import { ALL_ON } from '../shared/state'
import {
  bashOutputText,
  consoleContext,
  extractLocalUrl,
  HEADLESS_TIMEOUT_MS,
  headlessArgv,
  headlessCause,
  isHttpUrl,
  MAX_ERRORS,
  openExternalArgv,
  PANE_ID,
  parseHeadlessOutput,
  platformOf,
  toBrowserInfo,
} from './logic'
import type { HeadlessCause, HeadlessResult } from './logic'
import { tr } from './messages'
import type { BrowserKey } from './messages'

const langAtom = atom({ plugin: 'takgon-mods', key: 'lang' } as const, 'ko')
const modulesAtom = atom({ plugin: 'takgon-mods', key: 'modules' } as const, ALL_ON)
const notifiedAtom = atom({ plugin: 'takgon-mods', key: 'notified' } as const, [])
const browserAtom = atom({ plugin: 'takgon-mods', key: 'browser' } as const, null)
const attachConsoleAtom = atom({ plugin: 'takgon-mods', key: 'attachConsole' } as const, false)

/**
 * 명령을 등록한다. 같은 이름의 사용자·내장 명령 때문에 거부되면 예외를 삼켜 다른 초기화(이 모듈과 뒤쪽 모듈)를 막지 않고,
 * 명령마다 세션당 1회 toast로 알린다. `$`는 import 경계를 넘을 수 없어 모듈 파일마다 같은 헬퍼를 둔다.
 */
const registerCommand = async ($: EngineInterface, spec: CommandSpec): Promise<void> => {
  try {
    await $.command.register(spec)
  } catch (error) {
    try {
      const marked = markNotified(await read($, notifiedAtom), registerCause(spec.name))
      if (marked !== null) {
        await update($, notifiedAtom, () => marked)
        const vars = { name: spec.name, reason: refusalReason(error) }
        $.ui.toast(t(await read($, langAtom), 'mods.registerRefused', vars))
      }
    } catch {
      // 알림 실패도 초기화를 막지 않는다.
    }
  }
}

const TOAST_KEYS: Readonly<Record<HeadlessCause | 'open-failed', BrowserKey>> = {
  'node-missing': 'toast.nodeMissing',
  'playwright-missing': 'toast.playwrightMissing',
  'headless-failed': 'toast.headlessFailed',
  'open-failed': 'toast.openFailed',
}

const isOn = async ($: EngineInterface): Promise<boolean> => (await read($, modulesAtom)).browser

/** 원인별로 한 번만 toast를 띄운다. */
const notifyOnce = async ($: EngineInterface, cause: HeadlessCause | 'open-failed'): Promise<void> => {
  const marked = markNotified(await read($, notifiedAtom), `m2/${cause}`)
  if (marked === null) {
    return
  }
  await update($, notifiedAtom, () => marked)
  $.ui.toast(tr(await read($, langAtom), TOAST_KEYS[cause]))
}

/** 페이지 HTTP 상태. 연결 실패는 0. */
const httpStatus = async ($: EngineInterface, url: string): Promise<number> => {
  try {
    return (await $.http.fetch(url, { method: 'GET' })).status
  } catch {
    return 0
  }
}

/** 산출물 폴더(`.claude/takgon/browse`)를 정하고, 처음이면 `.gitignore`를 둔다. */
const browseDir = async ($: EngineInterface): Promise<string> => {
  const dir = outputDir(await $.session.root())
  const ignore = `${dir}/.gitignore`
  if (!(await $.fs.exists(ignore))) {
    await $.fs.write(ignore, OUTPUT_GITIGNORE)
  }
  return `${dir}/browse`
}

/** headless 스크립트를 1회 실행한다. 실패는 원인으로 돌려준다. */
const runHeadless = async (
  $: EngineInterface,
  url: string,
): Promise<{ result?: HeadlessResult; cause?: HeadlessCause }> => {
  const script = `${$.plugin.root.replace(/\\/g, '/')}/tools/headless.mjs`
  const out = await browseDir($)
  try {
    const run = await $.process.run(headlessArgv(script, url, out), { timeoutMs: HEADLESS_TIMEOUT_MS })
    const result = parseHeadlessOutput(run.stdout)
    const cause = headlessCause(run.exitCode, result)
    return cause === undefined ? { result } : { cause }
  } catch {
    // 시작 실패(ENOENT)와 시간 초과 모두 여기로 온다. 시간 초과는 드물어 node 없음으로 안내한다.
    return { cause: 'node-missing' }
  }
}

/** URL 하나를 확인해 browser 상태에 반영한다. */
const browse = async ($: EngineInterface, url: string): Promise<BrowserInfo> => {
  const status = await httpStatus($, url)
  const { result, cause } = await runHeadless($, url)
  if (cause !== undefined) {
    await notifyOnce($, cause)
  }
  const info = toBrowserInfo(url, status, result, await $.clock.now())
  await update($, browserAtom, () => info)
  return info
}

/** 외부 브라우저로 연다. */
const openExternal = async ($: EngineInterface): Promise<void> => {
  const info = await read($, browserAtom)
  if (info === null) {
    return
  }
  try {
    const run = await $.process.run(openExternalArgv(platformOf($.plugin.root), info.url), {
      timeoutMs: 10_000,
    })
    if (run.exitCode !== 0) {
      await notifyOnce($, 'open-failed')
    }
  } catch {
    await notifyOnce($, 'open-failed')
  }
}

/** pane의 새로고침 버튼: 지금 상태의 URL로 다시 확인한다. */
const refresh = async ($: EngineInterface): Promise<void> => {
  const info = await read($, browserAtom)
  if (info !== null) {
    await browse($, info.url)
  }
}

/**
 * M2 Inline Browser(범위 축소판).
 *
 * Bash 출력에서 로컬 개발 서버 URL을 감지하고, `/browse`가 HTTP 상태 확인과 headless 스크립트
 * (`tools/headless.mjs`, Playwright) 1회 실행으로 제목·콘솔 에러·스크린샷을 모아 pane에 보인다.
 * 인라인 페이지 표시는 어느 surface에도 불가하므로 Link와 외부 열기 버튼으로 대신한다.
 */
export const registerBrowser = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const lang = await read($, langAtom)
    await registerCommand($, {
      name: 'browse',
      description: tr(lang, 'cmd.description'),
      argumentHint: '[url]',
    })
    return next(e)
  })

  // 결과를 받은 뒤에만 읽는다. 감지 실패가 도구 결과를 바꾸지 않도록 예외는 삼킨다.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      if (ran.deny !== undefined || !(await isOn($))) {
        return ran
      }
      const url = extractLocalUrl(bashOutputText(ran))
      const current = await read($, browserAtom)
      if (url !== undefined && url !== current?.url) {
        // checkedAt 0 = 아직 /browse로 확인하지 않음.
        await update($, browserAtom, () => ({ url, status: 0, consoleErrors: [], checkedAt: 0 }))
      }
    } catch {
      // 감지는 부가 기능이다.
    }
    return ran
  }).catch(($, e, next) => next(e)) // next는 재실행 없이 도구 결과를 돌려준다(replay-safe).

  on('command.run', { command: 'browse' }, async ($, e) => {
    const lang = await read($, langAtom)
    if (!(await isOn($))) {
      return { text: tr(lang, 'cmd.off') }
    }
    const url = e.args.trim() || (await read($, browserAtom))?.url
    if (url === undefined || url === '') {
      return { text: tr(lang, 'cmd.noUrl') }
    }
    if (!isHttpUrl(url)) {
      return { text: tr(lang, 'cmd.badUrl', { url }) }
    }
    const info = await browse($, url)
    await $.ui.open({ id: PANE_ID, title: info.title ?? tr(lang, 'pane.title') })
    return {
      text: tr(lang, 'cmd.done', { url, status: info.status, count: info.consoleErrors.length }),
    }
  })

  // 사용자가 직접 친 프롬프트에만, 켜 둔 경우 한 번 콘솔 에러를 붙인다.
  on('prompt.submit', { origin: { kind: 'composer' } }, async ($, e, next) => {
    if (!(await isOn($)) || !(await read($, attachConsoleAtom))) {
      return next(e)
    }
    const info = await read($, browserAtom)
    if (info === null || info.consoleErrors.length === 0) {
      return next(e)
    }
    await update($, attachConsoleAtom, () => false)
    return next({ ...e, context: [...(e.context ?? []), consoleContext(info)] })
  }).catch(($, e, next) => next(e))

  // matcher는 리터럴이어야 validate가 읽는다(PANE_ID와 같은 값).
  on('ui.render', { component: 'Pane', requestId: 'takgon-browser' }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const lang = await read($, langAtom)
    const info = await read($, browserAtom)
    if (info === null) {
      return <Text dimColor>{tr(lang, 'pane.empty')}</Text>
    }
    const isAttach = await read($, attachConsoleAtom)
    const statusText =
      info.status > 0
        ? tr(lang, 'pane.status', { status: info.status })
        : tr(lang, info.checkedAt === 0 ? 'pane.unchecked' : 'pane.unreachable')
    const errors = info.consoleErrors.slice(0, MAX_ERRORS)
    const hidden = info.consoleErrors.length - errors.length
    const errorsHeader =
      errors.length > 0
        ? tr(lang, 'pane.errors', { count: info.consoleErrors.length })
        : tr(lang, 'pane.noErrors')

    let shot = null
    if (info.screenshot !== undefined) {
      if (e.surface === 'terminal') {
        const { Image } = $.ui.resolve(e)
        shot = (
          <Image
            key="screenshot"
            source={{ file: info.screenshot, format: 'png', generation: info.checkedAt }}
            columns={Math.min(100, Math.max(20, (e.viewport?.columns ?? 80) - 4))}
            rows={Math.min(30, Math.max(6, (e.viewport?.rows ?? 24) - 12))}
            alt={tr(lang, 'pane.screenshotAlt', { path: info.screenshot })}
          />
        )
      } else {
        shot = <Text dimColor>{info.screenshot}</Text>
      }
    }

    return (
      <Box flexDirection="column">
        <Link href={info.url} />
        <Text>{statusText}</Text>
        {info.title !== undefined && <Text>{tr(lang, 'pane.pageTitle', { title: info.title })}</Text>}
        <Text bold>{errorsHeader}</Text>
        {errors.map(error => (
          <Text color="red">- {error}</Text>
        ))}
        {hidden > 0 && <Text dimColor>{tr(lang, 'pane.more', { count: hidden })}</Text>}
        {shot}
        <Box flexDirection="row" gap={1}>
          <Button
            key="open-external"
            label={tr(lang, 'button.openExternal')}
            onPress={() => openExternal($)}
          />
          <Button
            key="attach-console"
            label={tr(lang, isAttach ? 'button.attachOn' : 'button.attachOff')}
            onPress={() => update($, attachConsoleAtom, value => !value)}
          />
          <Button key="refresh" label={tr(lang, 'button.refresh')} onPress={() => refresh($)} />
        </Box>
      </Box>
    )
  })
}
