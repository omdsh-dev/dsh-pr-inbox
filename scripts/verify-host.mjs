#!/usr/bin/env node
/**
 * 隔离实例的 host 路由自检：证明「插件在真实 DSH 里加载 → 自有路由注册 → 本机 gh
 * 真的跑起来 → 工作区项目识别正确」这条链路，而不只是单测里绿。
 *
 * 用法（由 scripts/verify-host.sh 负责起实例，本脚本只管打请求）：
 *   node scripts/verify-host.mjs <launch-url> <cwd>
 *
 * token 换 cookie 走 Playwright 的 APIRequestContext：宿主静态兜底对纯 Node 的 GET
 * 会回空体 405 且不带 Set-Cookie（better-sidebar AGENTS §3.3 第 13 条实测），
 * 所以不能用全局 fetch。
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const [launchUrl, cwd] = process.argv.slice(2)
if (launchUrl === undefined || cwd === undefined) {
  console.error('用法：node scripts/verify-host.mjs <launch-url> <cwd>')
  process.exit(2)
}

/** better-sidebar 的 worktree 里装着 Playwright（本机唯一一份 chromium）。 */
const require = createRequire(import.meta.url)
const playwrightPath = process.env.PLAYWRIGHT_MODULE ?? '/Users/vlln/Project/dsh-plugins/DSH-better-sidebar/.worktrees/git-graph/node_modules/@playwright/test'
const { request } = require(playwrightPath)

const api = await request.newContext({ maxRedirects: 0 })
try {
  const launch = await api.get(launchUrl, { maxRedirects: 0 })
  const cookies = await api.storageState()
  const cookieHeader = cookies.cookies.map(entry => `${entry.name}=${entry.value}`).join('; ')
  if (cookieHeader === '') {
    console.error(`拿不到会话 cookie（HTTP ${launch.status()}）`)
    process.exit(1)
  }
  const origin = new URL(launchUrl).origin
  const response = await api.post(`${origin}/plugins/dsh-pr-inbox/api`, {
    headers: { 'content-type': 'application/json', cookie: cookieHeader, host: new URL(origin).host, origin },
    data: { op: 'status', cwd: resolve(cwd) },
  })
  const body = await response.json().catch(async () => ({ raw: await response.text() }))
  console.log(`HTTP ${response.status()}`)
  console.log(JSON.stringify(body, null, 2))
  const value = body?.value
  if (body?.ok !== true) process.exit(1)
  if (value.repo?.fullName === undefined) {
    console.error('项目识别失败：repo 为空')
    process.exit(1)
  }
  if (value.gh?.available !== true) {
    console.error(`gh 不可用：${value.gh?.error ?? '未知原因'}`)
    process.exit(1)
  }
  console.log(`✅ 绑定 ${value.repo.fullName}（gh ${value.gh.version}, @${value.gh.login ?? '未登录'}）`)
} finally {
  await api.dispose()
}