/**
 * 侧边栏条目的存在性探针（负控用）：只回答一件事——
 * **原生右栏里到底有没有本插件的条目，以及浏览器控制台有没有报错**。
 *
 * 用法： node scripts/gates/lib/panel-entry-probe.mjs <launch-url> <workspace-path>
 * 输出： 一行 JSON `{ "entry": true|false, "consoleErrors": [...] }`
 *
 * 为什么要单独一个探针而不是复用挂载门：挂载门等条目出现要 60s（正常路径），
 * 负控要的是"**没**出现"这个结论，所以这里给一个短预算（默认 12s）并接受"没出现"。
 * 种会话的前置与 mount.mjs 同源（同一套宿主 RPC 信封），此处刻意保持简短。
 */
import { loadPlaywright } from './playwright.mjs'
import { dismissOnboarding } from './onboarding.mjs'

const [launchUrl, workspacePath] = process.argv.slice(2)
if (launchUrl === undefined || workspacePath === undefined) {
  console.error('用法：node scripts/gates/lib/panel-entry-probe.mjs <launch-url> <workspace-path>')
  process.exit(2)
}
const budget = Number(process.env.ENTRY_PROBE_MS ?? 12_000)
const TAB_ID = 'dsh-pr-inbox:prs'

const { chromium, request } = loadPlaywright().mod
const ORIGIN = new URL(launchUrl).origin
const HOST_HEADER = new URL(ORIGIN).host
const die = (message) => { console.error(`✗ ${message}`); process.exit(2) }

const api = await request.newContext({ maxRedirects: 0 })
await api.get(launchUrl, { maxRedirects: 0 })
const jar = await api.storageState()
const cookie = jar.cookies.map(entry => `${entry.name}=${entry.value}`).join('; ')
if (cookie === '') die('拿不到会话 cookie')

let rpcCounter = 0
async function rpc(method, args) {
  const endpoint = method.split('.').join('/')
  rpcCounter += 1
  const response = await api.post(`${ORIGIN}/api/${endpoint}`, {
    headers: { 'content-type': 'application/json', host: HOST_HEADER, origin: ORIGIN, cookie },
    data: { type: 'client-request', rpcId: `entry-probe-${rpcCounter}`, method: endpoint, payload: { args: { request: args } } },
    maxRedirects: 0,
  })
  const body = await response.json().catch(() => undefined)
  if (body?.result?.ok !== true) die(`${method} 失败（HTTP ${response.status()}）`)
  return body.result.value
}

const workspace = await rpc('workspace.create', { path: workspacePath })
await rpc('session.create', { workspaceId: workspace.workspace.workspaceId })

const browser = await chromium.launch()
const page = await browser.newPage()
const consoleErrors = []
page.on('pageerror', error => consoleErrors.push(String(error)))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
await page.locator('#root > *').first().waitFor({ timeout: 90_000 })

// 关掉首次启动引导 / 登录弹层（与挂载门同一手法；0.2.1 的登录弹层只有 X 可关）。
await dismissOnboarding(page)

// 让会话有内容（原生右栏的入口只在有内容的会话头里出现），再展开右栏。
// 坏副本可能**把整页拖垮**（client 行抛错会带走同批渲染），所以这一段允许失败：
// 那样结论是「页面根本渲染不出来」——同样是响亮的失败，由调用方判定。
let pageBroken = false
let entry = false
try {
  const composer = page.getByRole('textbox', { name: /Describe what you want to build|描述你想要构建/ })
  await composer.first().waitFor({ timeout: 45_000 })
  await composer.first().click()
  await page.keyboard.type('entry probe seed')
  await page.getByRole('button', { name: /^(Send message|发送消息)$/ }).first().click({ timeout: 30_000 })
  await page.locator('[data-sidebar-right-expand]').first().click({ timeout: 60_000 })
  const guide = page.locator('[data-sidebar-right-guide]')
  if (await guide.count() === 0) await page.locator('[data-dockkit-add-tab]').first().click({ timeout: 30_000 })

  const entryLocator = page.locator(`[data-sidebar-right-guide-entry="${TAB_ID}"]`)
  for (let waited = 0; waited < budget; waited += 500) {
    if (await entryLocator.count() > 0) { entry = true; break }
    await page.waitForTimeout(500)
  }
} catch (error) {
  pageBroken = true
  consoleErrors.push(`probe: ${String(error).split('\n')[0]}`)
}

console.log(JSON.stringify({ entry, pageBroken, consoleErrors: consoleErrors.slice(0, 6) }))
await browser.close()
await api.dispose()