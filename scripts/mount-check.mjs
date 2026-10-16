#!/usr/bin/env node
/**
 * 浏览器级真实挂载门：证明 dsh-pr-inbox 在真实 DSH 里
 *   插件加载 → 种子会话（cwd = 指定仓库）→ 原生右栏出现 PR 条目
 *   → 点开后 **面板真的渲染出绑定的项目**
 * 而不只是 host 路由能应答。
 *
 * 用法：
 *   node scripts/mount-check.mjs <launch-url> <workspace-path> [期望的 owner/repo]
 *
 * 依赖：Playwright（默认取 better-sidebar worktree 里那份，可用 PLAYWRIGHT_MODULE 覆盖）；
 * 实例需已装 dsh-better-sidebar + dsh-pr-inbox（见 scripts/verify-host.sh）。
 *
 * 无头、无 key：消息发送后模型必然失败，但用户消息已入会话 —— 宿主的会话头
 * 因此渲染，原生右栏的入口才存在（与 better-sidebar 挂载 lane 同一手法）。
 */
import { createRequire } from 'node:module'

const [launchUrl, workspacePath, expectRepo] = process.argv.slice(2)
if (launchUrl === undefined || workspacePath === undefined) {
  console.error('用法：node scripts/mount-check.mjs <launch-url> <workspace-path> [owner/repo]')
  process.exit(2)
}

const require = createRequire(import.meta.url)
const playwrightPath = process.env.PLAYWRIGHT_MODULE
  ?? '/Users/vlln/Project/dsh-plugins/DSH-better-sidebar/.worktrees/git-graph/node_modules/@playwright/test'
const { chromium, request } = require(playwrightPath)

const ORIGIN = new URL(launchUrl).origin
const HOST_HEADER = new URL(ORIGIN).host
const TAB_ID = 'dsh-pr-inbox:prs'
const fail = (message) => { console.error(`✗ ${message}`); process.exit(1) }
const step = (message) => console.log(`· ${message}`)

// ── 1) token → cookie ────────────────────────────────────────────────────────
const api = await request.newContext({ maxRedirects: 0 })
await api.get(launchUrl, { maxRedirects: 0 })
const jar = await api.storageState()
const cookie = jar.cookies.map(entry => `${entry.name}=${entry.value}`).join('; ')
if (cookie === '') fail('拿不到会话 cookie')

/** 宿主 RPC：斜杠端点 + client-request 信封（args 按 TS 参数名包在 `request` 下）。 */
let rpcCounter = 0
async function rpc(method, args) {
  const endpoint = method.split('.').join('/')
  rpcCounter += 1
  const response = await api.post(`${ORIGIN}/api/${endpoint}`, {
    headers: { 'content-type': 'application/json', host: HOST_HEADER, origin: ORIGIN, cookie },
    data: { type: 'client-request', rpcId: `mount-check-${rpcCounter}`, method: endpoint, payload: { args: { request: args } } },
    maxRedirects: 0,
  })
  const body = await response.json().catch(() => undefined)
  const result = body?.result
  if (result?.ok !== true) fail(`${method} 失败（HTTP ${response.status()}）：${JSON.stringify(body).slice(0, 300)}`)
  return result.value
}

// ── 2) 种子：工作区 + 会话（cwd 就是被绑定的那个仓库）────────────────────────
step(`种子工作区 ${workspacePath}`)
const workspace = await rpc('workspace.create', { path: workspacePath })
const session = await rpc('session.create', { workspaceId: workspace.workspace.workspaceId })
step(`种子会话 ${session.sessionId}`)

// ── 3) 浏览器：加载外壳 → 关掉 keyless 的引导弹层 ────────────────────────────
const browser = await chromium.launch()
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', error => pageErrors.push(String(error)))
await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
await page.locator('#root > *').first().waitFor({ timeout: 90_000 })
// 引导弹层在设置加入解析之后才挂载（可能晚好几秒），所以**先等它出现**再关：
// 只关「稍后 / Continue」这类可跳过的；"Save and continue" 需要 API key，不能点。
const dismissible = page.getByRole('button', { name: /^(Continue|Configure later|继续|稍后配置)$/ })
for (let attempt = 0; attempt < 120 && await dismissible.count() === 0; attempt++) await page.waitForTimeout(500)
for (let round = 0; round < 10; round++) {
  let dismissed = false
  for (const name of ['Continue', 'Configure later', '继续', '稍后配置']) {
    const button = page.getByRole('button', { name, exact: true }).first()
    if (await button.count() === 0) continue
    try { await button.click({ timeout: 3_000 }); dismissed = true; await page.waitForTimeout(600) } catch { /* masked; retry */ }
  }
  if (!dismissed) break
}
step('已关掉 keyless 引导弹层')

// ── 4) 让会话有内容（原生右栏的入口只在有内容的会话头里出现）─────────────────
const composer = page.getByRole('textbox', { name: /Describe what you want to build|描述你想要构建/ })
await composer.first().waitFor({ timeout: 60_000 })
await composer.first().click()
await page.keyboard.type('mount check seed')
const send = page.getByRole('button', { name: /^(Send message|发送消息)$/ })
await send.first().click({ timeout: 30_000 })
step('已发出一条种子消息')

// ── 5) 展开宿主原生右栏 → 点 PR 条目 ─────────────────────────────────────────
await page.locator('[data-sidebar-right-expand]').first().click({ timeout: 60_000 })
const guide = page.locator('[data-sidebar-right-guide]')
if (await guide.count() === 0) await page.locator('[data-dockkit-add-tab]').first().click({ timeout: 30_000 })
const entry = page.locator(`[data-sidebar-right-guide-entry="${TAB_ID}"]`)
await entry.waitFor({ timeout: 60_000 })
step(`原生右栏列出了 PR 条目（${TAB_ID}）`)
await entry.click()
const panel = page.locator('[data-dsh-pr-inbox-panel]')
await panel.first().waitFor({ timeout: 60_000 })

// 等三桶与行数据落下来（gh 三条真实查询要几秒）。
await page.locator('[data-bucket="authored"]').waitFor({ timeout: 60_000 })
let rows = 0
for (let attempt = 0; attempt < 120; attempt++) {
  rows = await page.locator('[data-pr-row]').count()
  if (rows > 0) break
  await page.waitForTimeout(500)
}
const perBucket = {}
for (const key of ['authored', 'review', 'merged']) {
  perBucket[key] = await page.locator(`[data-bucket="${key}"] [data-pr-row]`).count()
}
const text = (await panel.first().innerText()).replace(/\s+/g, ' ').trim()
console.log(`· 三桶行数：${JSON.stringify(perBucket)}`)
console.log(`· 面板文本：${text.slice(0, 360)}`)
if (rows === 0) fail('三桶一行数据都没有（gh 取数或渲染失败）')
if (expectRepo !== undefined && !text.includes(expectRepo)) fail(`面板里没有出现 ${expectRepo}`)

// 密度切换：详细 → 行上出现 data-density=detailed；再切回简洁。
const shotDir = process.env.SCREENSHOT_DIR
const shoot = async (name) => {
  if (shotDir === undefined) return
  const { mkdirSync } = await import('node:fs')
  mkdirSync(shotDir, { recursive: true })
  await page.screenshot({ path: `${shotDir}/${name}.png` })
  console.log(`· 截图：${shotDir}/${name}.png`)
}
await shoot('pr-inbox-compact')
await page.locator('[data-pi-density="detailed"]').click()
await page.locator('[data-pr-row][data-density="detailed"]').first().waitFor({ timeout: 10_000 })
step('密度切换生效（详细）')
await shoot('pr-inbox-detailed')
await page.locator('[data-pi-density="compact"]').click()
await page.locator('[data-pr-row][data-density="compact"]').first().waitFor({ timeout: 10_000 })

// 搜索：必然无命中的词让所有行消失，清空后复原（客户端过滤）。
const search = page.locator('[data-pi-search]')
await search.fill('zzz-no-such-pr')
await page.waitForTimeout(300)
if (await page.locator('[data-pr-row]').count() !== 0) fail('搜索没有过滤掉不匹配的行')
await search.fill('')
await page.waitForTimeout(300)
if (await page.locator('[data-pr-row]').count() === 0) fail('清空搜索后行没有复原')
step('搜索过滤 + 清空复原生效')

if (pageErrors.length > 0) fail(`页面报错：${pageErrors.join(' | ')}`)
console.log(`✅ PR 面板已在真实实例里渲染并绑定项目：${expectRepo ?? text.slice(0, 80)}`)
await browser.close()
await api.dispose()