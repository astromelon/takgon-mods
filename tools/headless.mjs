#!/usr/bin/env node
/**
 * takgon-mods headless 페이지 점검 스크립트(M2 /browse, M3 /edit dom 공용).
 *
 * 플러그인 모듈이 아니라 `$.process.run(['node', <이 파일>, ...])`으로 1회 실행되는 외부 스크립트다.
 * 순수 Node ESM이며 의존성을 추가하지 않는다. playwright는 사용자 환경에 있으면 동적으로 불러온다.
 *
 * 사용법:
 *   node tools/headless.mjs --url <url> --out <dir> [--selector <css>] [--wait <ms>]
 *
 * 출력(계약): stdout 마지막 줄에 JSON 한 줄
 *   { ok, status, title?, consoleErrors, screenshot?, element?: { selector, computedStyle, screenshot? }, error? }
 * playwright를 못 찾으면 exit code 2 + `{ ok:false, status:0, consoleErrors:[], error:'playwright-missing' }`.
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** 수집할 computed style 속성(색·폰트·크기·여백·배치). */
const STYLE_PROPS = [
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'width',
  'height',
  'margin',
  'padding',
  'border',
  'border-radius',
  'display',
  'position',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'opacity',
  'z-index',
  'box-shadow',
]

const MAX_ERRORS = 50
const DEFAULT_WAIT_MS = 3000
const NAV_TIMEOUT_MS = 20000

/** `--key value` 인자를 읽는다. */
const parseArgs = argv => {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const value = argv[i + 1]
      args[token.slice(2)] = value !== undefined && !value.startsWith('--') ? value : ''
      if (args[token.slice(2)] !== '') {
        i += 1
      }
    }
  }
  return args
}

/** 결과 JSON을 마지막 줄로 쓰고 종료한다. */
const finish = (result, code = 0) => {
  process.stdout.write(`\n${JSON.stringify(result)}\n`)
  process.exit(code)
}

const timestamp = () => new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const url = args.url
  if (!url || !/^https?:\/\//i.test(url)) {
    finish({ ok: false, status: 0, consoleErrors: [], error: 'invalid-url' }, 1)
    return
  }
  const outDir = resolve(args.out || '.')
  const waitMs = Number.isFinite(Number(args.wait)) && args.wait !== '' ? Number(args.wait) : DEFAULT_WAIT_MS
  const selector = args.selector || undefined

  let playwright
  try {
    playwright = await import('playwright')
  } catch {
    finish({ ok: false, status: 0, consoleErrors: [], error: 'playwright-missing' }, 2)
    return
  }
  const chromium = playwright.chromium ?? playwright.default?.chromium
  if (!chromium) {
    finish({ ok: false, status: 0, consoleErrors: [], error: 'playwright-missing' }, 2)
    return
  }

  const consoleErrors = []
  const pushError = text => {
    if (consoleErrors.length < MAX_ERRORS) {
      consoleErrors.push(String(text).slice(0, 2000))
    }
  }

  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.on('console', message => {
      if (message.type() === 'error') {
        pushError(message.text())
      }
    })
    page.on('pageerror', error => pushError(error?.message ?? error))

    const response = await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS })
    const status = response ? response.status() : 0
    await page.waitForTimeout(Math.max(0, waitMs))

    mkdirSync(outDir, { recursive: true })
    const stamp = timestamp()
    const screenshot = join(outDir, `${stamp}.png`)
    await page.screenshot({ path: screenshot, fullPage: true })

    const result = {
      ok: status === 0 || (status >= 200 && status < 400),
      status,
      title: await page.title(),
      consoleErrors,
      screenshot,
    }

    if (selector) {
      const locator = page.locator(selector).first()
      if ((await locator.count()) === 0) {
        result.error = 'selector-not-found'
      } else {
        const computedStyle = await locator.evaluate((node, props) => {
          const style = globalThis.getComputedStyle(node)
          const picked = {}
          for (const prop of props) {
            picked[prop] = style.getPropertyValue(prop)
          }
          return picked
        }, STYLE_PROPS)
        const elementShot = join(outDir, `${stamp}-element.png`)
        let elementScreenshot
        try {
          await locator.screenshot({ path: elementShot })
          elementScreenshot = elementShot
        } catch {
          elementScreenshot = undefined
        }
        result.element = { selector, computedStyle, screenshot: elementScreenshot }
      }
    }

    await browser.close()
    finish(result, 0)
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => {})
    }
    const message = String(error?.message ?? error)
    // 브라우저 바이너리 미설치(`npx playwright install` 전)도 playwright 없음으로 본다.
    const isMissing = /Executable doesn't exist|playwright install/i.test(message)
    finish(
      {
        ok: false,
        status: 0,
        consoleErrors,
        error: isMissing ? 'playwright-missing' : message.split('\n')[0].slice(0, 500),
      },
      isMissing ? 2 : 1,
    )
  }
}

main()
