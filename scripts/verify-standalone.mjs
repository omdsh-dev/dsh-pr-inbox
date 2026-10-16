#!/usr/bin/env node
/**
 * 「better-sidebar 缺席」时的行为门（optional peer 的预期形态，写在设计文档 §5）：
 *   - host 半照常加载：自有路由必须仍然应答（它只依赖 DSH 的 webServer + 本机 gh）
 *   - client 半因 `inject: ['betterSidebar']` **保持未激活**：不注册 tab、不崩、
 *     页面上不出现 `[data-dsh-better-sidebar]`
 *
 * 用法：node scripts/verify-standalone.mjs <launch-url> <cwd>
 * 前置：实例所在 profile **只装** dsh-pr-inbox（没有 dsh-better-sidebar）。
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const [launchUrl, cwd] = process.argv.slice(2)
if (launchUrl === undefined || cwd === undefined) {
  console.error('用法：node scripts/verify-standalone.mjs <launch-url> <cwd>')
  process.exit(2)
}

const require = createRequire(import.meta.url)
const playwrightPath = process.env.PLAYWRIGHT_MODULE
  ?? '/Users/vlln/Project/dsh-plugins/DSH-better-sidebar/.worktrees/git-graph/node_modules/@playwright/test'
const { chromium, request } = require(playwrightPath)

const ORIGIN = new URL(launchUrl).origin
const HOST_HEADER = new URL(ORIGIN).host
let failed = false
const check = (ok, message) => {
  if (ok) { console.log(`✅ ${message}`); return }
  console.error(`✗ ${message}`)
  failed = true
}

const api = await request.newContext({ maxRedirects: 0 })
await api.get(launchUrl, { maxRedirects: 0 })
const jar = await api.storageState()
const cookie = jar.cookies.map(entry => `${entry.name}=${entry.value}`).join('; ')

// ① host 半：路由仍然应答（未被 better-sidebar 的缺席影响）
const response = await api.post(`${ORIGIN}/plugins/dsh-pr-inbox/api`, {
  headers: { 'content-type': 'application/json', cookie, host: HOST_HEADER, origin: ORIGIN },
  data: { op: 'status', cwd: resolve(cwd) },
})
const body = await response.json().catch(() => undefined)
check(response.status() === 200 && body?.ok === true, `host 路由仍应答（HTTP ${response.status()}）`)
check(typeof body?.value?.repo?.fullName === 'string', `绑定仍然可用：${body?.value?.repo?.fullName}`)

// ② client 半：未激活、不崩、不出现宿主标记
const browser = await chromium.launch()
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', error => pageErrors.push(String(error)))
await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
await page.locator('#root > *').first().waitFor({ timeout: 90_000 })
await page.waitForTimeout(4_000)
const hostNodes = await page.locator('[data-dsh-better-sidebar]').count()
check(hostNodes === 0, 'better-sidebar 缺席时页面上没有它的宿主节点')
check(pageErrors.length === 0, `页面零报错${pageErrors.length === 0 ? '' : `：${pageErrors.join(' | ')}`}`)
await browser.close()
await api.dispose()

if (failed) process.exit(1)
console.log('✅ 独立形态自检通过（host 可用、client 安全未激活）')