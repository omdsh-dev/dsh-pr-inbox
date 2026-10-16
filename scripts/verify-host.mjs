#!/usr/bin/env node
/**
 * 隔离实例的 **host 路由**自检：证明「插件在真实 DSH 里加载 → 自有路由注册 →
 * 本机 gh 真的跑起来 → 工作区项目识别正确 → 三个 op 都通」这条链路，
 * 而不只是单测里绿。
 *
 * 用法（由 scripts/verify-host.sh 负责起实例，本脚本只管打请求）：
 *   node scripts/verify-host.mjs <launch-url> <cwd>
 *   PR_INBOX_VERBOSE=1 时额外打印每个响应的完整 JSON。
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

const VERBOSE = process.env.PR_INBOX_VERBOSE === '1'
const api = await request.newContext({ maxRedirects: 0 })

const show = (label, body) => {
  if (VERBOSE) console.log(`--- ${label} ---\n${JSON.stringify(body, null, 2)}`)
}

let failed = false
const check = (ok, message) => {
  if (ok) return true
  console.error(`✗ ${message}`)
  failed = true
  return false
}

try {
  const launch = await api.get(launchUrl, { maxRedirects: 0 })
  const jar = await api.storageState()
  const cookieHeader = jar.cookies.map(entry => `${entry.name}=${entry.value}`).join('; ')
  if (cookieHeader === '') {
    console.error(`拿不到会话 cookie（HTTP ${launch.status()}）`)
    process.exit(1)
  }
  const origin = new URL(launchUrl).origin
  const host = new URL(origin).host

  /** 打一次自有路由 op（与客户端同一条路：POST + {op,…}）。 */
  const call = async (op, extra = {}) => {
    const response = await api.post(`${origin}/plugins/dsh-pr-inbox/api`, {
      headers: { 'content-type': 'application/json', cookie: cookieHeader, host, origin },
      data: { op, cwd: resolve(cwd), ...extra },
    })
    let body
    try {
      body = await response.json()
    } catch {
      body = { raw: (await response.text()).slice(0, 300) }
    }
    return { status: response.status(), body }
  }

  // ── ① status：绑定 + 环境自检 ─────────────────────────────────────────────
  const status = await call('status')
  show('status', status.body)
  check(status.status === 200 && status.body?.ok === true, `status 未成功（HTTP ${status.status}）`)
  const statusValue = status.body?.value
  check(typeof statusValue?.repo?.fullName === 'string', '项目识别失败：repo 为空')
  check(statusValue?.gh?.available === true, `gh 不可用：${statusValue?.gh?.error ?? '未知原因'}`)
  if (statusValue?.repo?.fullName !== undefined && statusValue?.gh?.available === true) {
    console.log(`✅ status：绑定 ${statusValue.repo.fullName}（gh ${statusValue.gh.version}，@${statusValue.gh.login ?? '未登录'}）`)
  }

  // ── ② list：三桶（真实搜索 API） ──────────────────────────────────────────
  const list = await call('list')
  show('list', list.body)
  check(list.status === 200 && list.body?.ok === true, `list 未成功（HTTP ${list.status}）`)
  const buckets = list.body?.value?.buckets
  const keys = buckets === undefined ? [] : Object.keys(buckets).sort()
  check(JSON.stringify(keys) === JSON.stringify(['authored', 'merged', 'review']), `三桶键不齐：${JSON.stringify(keys)}`)
  const bucketErrors = keys.filter(key => buckets[key]?.error !== undefined)
  check(bucketErrors.length === 0, `桶内取数失败：${bucketErrors.map(key => `${key}: ${buckets[key].error.message}`).join(' | ')}`)
  const authoredNumbers = (buckets?.authored?.rows ?? []).map(row => row.number)
  const mergedTotal = buckets?.merged?.total ?? 0
  check(mergedTotal > 0, '最近合并桶 total 为 0（真实仓库不该如此）')
  console.log(`✅ list：authored total=${buckets?.authored?.total ?? '?'} 行=${buckets?.authored?.rows?.length ?? 0}` +
    `（含 #969=${authoredNumbers.includes(969)}）· review total=${buckets?.review?.total ?? '?'}` +
    ` · merged total=${mergedTotal} 行=${buckets?.merged?.rows?.length ?? 0}`)

  // ── ③ detail：正文 / 时间线 / 文件 ───────────────────────────────────────
  const target = authoredNumbers.includes(969) ? 969 : authoredNumbers[0]
  if (target === undefined) {
    check(false, '没有任何 authored 行可用于详情自检')
  } else {
    const detail = await call('detail', { number: target })
    show('detail', detail.body)
    check(detail.status === 200 && detail.body?.ok === true, `detail 未成功（HTTP ${detail.status}）`)
    const value = detail.body?.value
    check(typeof value?.title === 'string' && value.title !== '', '详情缺标题')
    check(typeof value?.body === 'string' && value.body.length > 0, '详情正文为空')
    check(Array.isArray(value?.files) && value.files.length > 0, '详情文件清单为空')
    check(Array.isArray(value?.warnings) && value.warnings.length === 0, `详情支线降级：${JSON.stringify(value?.warnings)}`)
    console.log(`✅ detail #${value?.number}：正文 ${value?.body?.length ?? 0} 字符 · ${value?.additions}+ ${value?.deletions}-` +
      ` · ${value?.changedFiles} files（返回 ${value?.files?.length ?? 0}）· timeline=${value?.timeline?.length ?? 0}`)
  }

  // ── ④ 入参围栏：坏编号必须是 400，而不是 500 ─────────────────────────────
  const bad = await call('detail', { number: 0 })
  check(bad.status === 400 && bad.body?.error?.code === 'bad-request', `坏编号没有回 400/bad-request（得到 ${bad.status}）`)
  console.log('✅ 入参围栏：number=0 → 400 bad-request')

  // ── ⑤ 图片代理：host 取字节再同源发（*.githubusercontent.com 在本环境不可达）──
  //    拿本仓自己的 icon.svg 打这条路由：必须 200 + image/* + 字节数 > 0。
  const image = async (params) => {
    const response = await api.get(`${origin}/plugins/dsh-pr-inbox/image?${new URLSearchParams({ cwd: resolve(cwd), ...params })}`, {
      headers: { cookie: cookieHeader, host, origin },
    })
    const bytes = await response.body()
    return { status: response.status(), type: response.headers()['content-type'] ?? '', length: bytes.length, bytes }
  }
  const icon = await image({ ref: 'dev', path: 'icon.svg' })
  check(icon.status === 200, `图片代理未回 200（得到 ${icon.status}：${icon.bytes.subarray(0, 120).toString('utf8')}）`)
  check(icon.type.startsWith('image/'), `图片代理 content-type 不是 image/*（得到 ${icon.type}）`)
  check(icon.length > 0, `图片代理回 0 字节`)
  if (icon.status === 200) console.log(`✅ image：icon.svg@dev → 200 · ${icon.type} · ${icon.length} 字节`)
  // 两条活体围栏（与单测互补：这里走的是真实路由 + 真实 gh）。
  const traversal = await image({ ref: 'dev', path: '../package.json' })
  check(traversal.status === 400, `路径穿越没有回 400（得到 ${traversal.status}）`)
  const nonImage = await image({ ref: 'dev', path: 'README.md' })
  check(nonImage.status === 415, `非图片没有回 415（得到 ${nonImage.status}）`)
  console.log('✅ 图片围栏：`../package.json` → 400 · `README.md` → 415')
} finally {
  await api.dispose()
}

if (failed) {
  console.error('host 路由自检未全通')
  process.exit(1)
}
console.log('✅ host 路由自检全通（status / list / detail / image / 入参围栏）')