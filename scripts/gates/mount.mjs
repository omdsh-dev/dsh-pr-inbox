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
import { loadPlaywright } from './lib/playwright.mjs'
import { dismissOnboarding } from './lib/onboarding.mjs'

const [launchUrl, workspacePath, expectRepo] = process.argv.slice(2)
if (launchUrl === undefined || workspacePath === undefined) {
  console.error('用法：node scripts/mount-check.mjs <launch-url> <workspace-path> [owner/repo]')
  process.exit(2)
}

const { chromium, request } = loadPlaywright().mod

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
// 主题：宿主按 `prefers-color-scheme` 决定（`<html data-ds-theme-source="system">`），
// 所以 `THEME=dark` 用 chromium 的 colorScheme 就能拿到**真的**深色（不是滤镜）。
const THEME = process.env.THEME === 'dark' ? 'dark' : 'light'
const browser = await chromium.launch()
const page = await browser.newPage(THEME === 'dark' ? { colorScheme: 'dark' } : {})
const pageErrors = []
page.on('pageerror', error => pageErrors.push(String(error)))
await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
await page.locator('#root > *').first().waitFor({ timeout: 90_000 })
// 引导弹层在设置加入解析之后才挂载（可能晚好几秒），所以**先等它出现**再关。
await dismissOnboarding(page)
step('已关掉首次启动引导弹层（如果有）')

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

// 主题自证：说"深色验收过了"之前，先证明**确实是深色**——否则深色截图什么也没证明。
const themeFact = await page.evaluate(() => {
  let node = document.querySelector('[data-dsh-pr-inbox-panel]')
  let fill = 'rgba(0, 0, 0, 0)'
  while (node !== null) {
    const value = getComputedStyle(node).backgroundColor
    if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { fill = value; break }
    node = node.parentElement
  }
  const match = /rgba?\((\d+), (\d+), (\d+)/.exec(fill)
  const luminance = match === null ? -1 : Math.round((Number(match[1]) + Number(match[2]) + Number(match[3])) / 3)
  return { colorScheme: getComputedStyle(document.documentElement).colorScheme, fill, luminance }
})
console.log(`· 主题：THEME=${THEME} · color-scheme=${themeFact.colorScheme} · 面板底 ${themeFact.fill}（亮度 ${themeFact.luminance}）`)
if (THEME === 'dark' && !(themeFact.luminance >= 0 && themeFact.luminance < 110)) {
  fail(`THEME=dark 但面板底不是深色（${themeFact.fill}）：深色验收没成立`)
}
if (THEME === 'light' && themeFact.luminance >= 0 && themeFact.luminance < 110) {
  fail(`THEME=light 但面板底是深色（${themeFact.fill}）：主题没跟随系统偏好`)
}

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

// i18n 回归门：英文宿主下，面板 chrome（顶栏 / 分区头 / 状态行）不得出现中文
// 时间或中文提示。PR 标题/标签可以是中文，所以只取 chrome，不扫整块面板。
const chromeText = (await page.evaluate(() => {
  const pick = (selector) => [...document.querySelectorAll(selector)].map(node => node.textContent ?? '').join(' ')
  return [pick('.pi-head'), pick('.pi-sectionHeader'), pick('.pi-foot')].join(' ')
})).replace(/\s+/g, ' ').trim()
const englishChrome = /Authored by me|Needs my review|Merged by me/.test(chromeText)
if (englishChrome && /分钟前|小时前|天前|个月前|年前|刚刚|更新于/.test(chromeText)) {
  fail(`英文宿主下 chrome 里出现了中文文案：${chromeText.slice(0, 240)}`)
}
console.log(`· 语言：${englishChrome ? '英文 chrome 无中文时间/提示' : '非英文宿主，跳过 chrome 断言'}`)

// 头像渲染（图片渲染的第一条证据）：这个环境的 *.githubusercontent.com 不可达，
// 所以设计语义是「能加载就显示图片，失败就用首字母圆底」——断言的是**不出现破图**
// 且头像位一定存在，而不是「必须有网络图片」。
let avatarState = { slots: 0, loaded: 0, initials: 0, broken: 0, pending: 0 }
for (let attempt = 0; attempt < 40; attempt++) {
  avatarState = await page.evaluate(() => {
    const slots = document.querySelectorAll('.pi-avatar, .pi-avatarInitials').length
    const images = [...document.querySelectorAll('img.pi-avatar')]
    const initials = document.querySelectorAll('.pi-avatarInitials').length
    return {
      slots,
      loaded: images.filter(i => i.complete && i.naturalWidth > 0).length,
      initials,
      broken: images.filter(i => i.complete && i.naturalWidth === 0).length,
      pending: images.filter(i => !i.complete).length,
    }
  })
  if (avatarState.broken === 0 && avatarState.pending === 0) break
  await page.waitForTimeout(500)
}
const shotDir = process.env.SCREENSHOT_DIR
const shoot = async (name) => {
  if (shotDir === undefined) return
  const { mkdirSync } = await import('node:fs')
  mkdirSync(shotDir, { recursive: true })
  const file = `${name}${THEME === 'dark' ? '-dark' : ''}`
  await page.screenshot({ path: `${shotDir}/${file}.png` })
  console.log(`· 截图：${shotDir}/${file}.png`)
}
/** 只截插件面板本身（README 预览用）：不带左侧聊天、失败消息或宿主外壳。 */
const shootPanel = async (name) => {
  if (shotDir === undefined) return
  const { mkdirSync } = await import('node:fs')
  mkdirSync(shotDir, { recursive: true })
  const file = `${name}-panel${THEME === 'dark' ? '-dark' : ''}`
  await page.locator('[data-dsh-pr-inbox-panel]').first().screenshot({ path: `${shotDir}/${file}.png` })
  console.log(`· 面板截图：${shotDir}/${file}.png`)
}
console.log(`· 头像位：${avatarState.slots} 个（网络图 ${avatarState.loaded} / 首字母 ${avatarState.initials} / 破图 ${avatarState.broken} / 悬挂 ${avatarState.pending}）`)
if (avatarState.slots === 0) fail('列表里没有任何头像位（host 的 authorAvatar 没传到 UI？）')
if (avatarState.broken > 0) fail(`仍有 ${avatarState.broken} 个加载失败的破图（回退没生效）`)
if (avatarState.pending > 0) fail(`仍有 ${avatarState.pending} 个头像位停在未加载状态（要么加载要么回退，不许悬挂）`)

await shoot('pr-inbox-compact')
await shootPanel('pr-inbox-compact')

// ── 行几何（不靠肉眼）───────────────────────────────────────────────────────
// 「头像固定在行首」+「切密度不跳位」是这一轮的验收点，所以量的是元素坐标：
// 1) 头像必须落在行首留白处，且在编号/标题之前（行内最左）；
// 2) 行与行之间必须有非透明的 0.5px 发丝线（浅色主题下宿主各层填充同为 #fff，
//    静止行没有填充差，边界只能靠线——没有线就等于没有行边界）；
// 3) 行内「在 GitHub 打开」静止不得露面（悬停/聚焦才现形，触屏常显）；
// 4) 简洁↔详细**逐项同 x**：切密度只增删事实行，身份行一个字都不许挪位。
const measureRow = () => page.evaluate(() => {
  const row = document.querySelector('[data-pr-row]')
  if (row === null) return null
  const at = (selector) => {
    const node = row.querySelector(selector)
    if (node === null) return null
    const rect = node.getBoundingClientRect()
    return { x: Math.round(rect.left * 10) / 10, y: Math.round(rect.top * 10) / 10, w: Math.round(rect.width * 10) / 10 }
  }
  // 行线是 `.pi-row + .pi-row`（相邻兄弟），所以要取**同一个 .pi-rows 容器里**的第二行：
  // 跨分区取样拿到的是"上一区块的最后一行 + 下一区块的第一行"，它们不是兄弟，
  // 看不到行线（分区边界另有其线）——这个坑在 authored 只剩 1 行时暴露过一次。
  const second = (() => {
    for (const container of document.querySelectorAll('.pi-rows')) {
      const rows = container.querySelectorAll('[data-pr-row]')
      if (rows.length >= 2) return rows[1]
    }
    return undefined
  })()
  const external = row.querySelector('.pi-external')
  const heightOf = (selector) => {
    const node = document.querySelector(selector)
    return node === null ? 0 : Math.round(node.getBoundingClientRect().height)
  }
  return {
    number: row.dataset.prRow,
    rowLeft: Math.round(row.getBoundingClientRect().left * 10) / 10,
    rowHeight: Math.round(row.getBoundingClientRect().height),
    headHeight: heightOf('.pi-head'),
    sectionHeight: heightOf('.pi-sectionHeader'),
    avatar: at('.pi-avatarCell'),
    num: at('.pi-num'),
    subject: at('.pi-subject'),
    age: at('.pi-age'),
    external: at('.pi-external'),
    lines: row.querySelectorAll('.pi-line1').length + row.querySelectorAll('.pi-line2').length,
    separator: second === undefined ? 0 : Number.parseFloat(getComputedStyle(second).borderTopWidth),
    separatorColor: second === undefined ? '' : getComputedStyle(second).borderTopColor,
    restOpacity: external === null ? -1 : Number.parseFloat(getComputedStyle(external).opacity),
    restPointer: external === null ? '' : getComputedStyle(external).pointerEvents,
  }
})
const near = (a, b, tol) => Math.abs(a - b) <= tol
const compactRow = await measureRow()
if (compactRow === null) fail('列表里找不到 PR 行，无法验证行几何')
const indent = compactRow.avatar === null ? -1 : compactRow.avatar.x - compactRow.rowLeft
console.log(`· 行几何（简洁 #${compactRow.number}）：行高 ${compactRow.rowHeight}px · 头带 ${compactRow.headHeight}px · 分区头 ${compactRow.sectionHeight}px · 行首留白 ${indent}px · 头像 x=${compactRow.avatar?.x} · 编号 x=${compactRow.num?.x} · 标题 x=${compactRow.subject?.x} · 行线 ${compactRow.separator}px/${compactRow.separatorColor}`)
if (compactRow.avatar === null) fail('行首没有头像列（头像没固定在左侧）')
if (!(indent >= 8 && indent <= 16)) fail(`头像没有落在行首留白处（距行左 ${indent}px，期望 8–16px）`)
if (compactRow.num !== null && !(compactRow.avatar.x + compactRow.avatar.w <= compactRow.num.x + 0.5)) {
  fail('头像不在行内最左（编号跑到了头像左边）')
}
if (!(compactRow.separator >= 0.5) || compactRow.separatorColor.startsWith('rgba(0, 0, 0, 0)')) {
  fail(`行与行之间没有可见发丝边界（${compactRow.separator}px/${compactRow.separatorColor}）`)
}
if (compactRow.restOpacity > 0.05) fail('行内「在 GitHub 打开」静止就露面了（应悬停/聚焦才现形）')
if (compactRow.restPointer !== 'none') fail('静止的外链按钮没有让出点击（会抢行的点击）')

await page.locator('[data-pr-row]').first().hover()
await page.waitForTimeout(220)
const hoverOpacity = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector('[data-pr-row] .pi-external')).opacity))
await page.mouse.move(2, 2)
await page.waitForTimeout(160)
console.log(`· 外链按钮：静止 opacity ${compactRow.restOpacity} → 悬停 ${hoverOpacity}`)
if (!(hoverOpacity > 0.9)) fail('悬停后行内「在 GitHub 打开」没有现形')
step('行几何：头像钉在行首 · 行间发丝线 · 外链静止隐藏/悬停现形')

await page.getByRole('button', { name: /^(Detailed|详细)$/ }).first().click()
await page.locator('[data-pr-row][data-density="detailed"]').first().waitFor({ timeout: 10_000 })
step('密度切换生效（详细）')
await shoot('pr-inbox-detailed')
await shootPanel('pr-inbox-detailed')
const detailedRow = await measureRow()
if (detailedRow === null || detailedRow.number !== compactRow.number) fail('两档量到的不是同一行，无法比较几何')
console.log(`· 行几何（详细 #${detailedRow.number}）：行高 ${detailedRow.rowHeight}px · 头像 x=${detailedRow.avatar?.x}/y=${detailedRow.avatar?.y} · 编号 x=${detailedRow.num?.x} · 标题 x=${detailedRow.subject?.x} · 行数 ${detailedRow.lines}`)
if (detailedRow.lines < 2) fail('详细档没有多出事实行')
// 逐项同 x（容差 1px，0.5px 发丝线在设备像素上的取整差不算跳位）。
const sameX = ['avatar', 'num', 'subject', 'age', 'external'].filter(key => {
  const a = compactRow[key]
  const b = detailedRow[key]
  if (a === null || b === null) return a !== b // 一边有一边没有 → 也算不一致
  return !near(a.x, b.x, 1) || !near(a.y, b.y, 1.5) || !near(a.w, b.w, 1)
})
if (sameX.length > 0) {
  fail(`切换密度后身份行跳位：${sameX.map(key => `${key} ${JSON.stringify(compactRow[key])} → ${JSON.stringify(detailedRow[key])}`).join(' · ')}`)
}
step('切密度只增删事实行：头像/编号/标题/时间/外链逐项同 x 同宽')

await page.getByRole('button', { name: /^(Compact|简洁)$/ }).first().click()
await page.locator('[data-pr-row][data-density="compact"]').first().waitFor({ timeout: 10_000 })

// 分区头贴顶：长列表里滚动时，当前分区的头必须钉在滚动口上沿。
// 这份数据只有 ~1.2 屏高，天然滚不到「头带本该被顶住」的位置，所以把滚动口临时
// 压矮到 80px——**只改这一个内联样式、测完立刻还原**，让这个几何事实真的可测。
// （若 sticky 没生效，头会随内容一起被滚出视野，必然与上沿差出几十像素。）
const sticky = await page.evaluate(async () => {
  const scroller = document.querySelector('.pi-body')
  const header = document.querySelector('[data-bucket="merged"] .pi-sectionHeader')
  if (scroller === null || header === null) return null
  const raf = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const naturalOverflow = scroller.scrollHeight > scroller.clientHeight + 40
  const restore = { height: scroller.style.height, flex: scroller.style.flex }
  scroller.style.flex = 'none'
  scroller.style.height = '80px'
  await raf()
  const top = () => scroller.getBoundingClientRect().top
  const read = () => ({ scrollTop: Math.round(scroller.scrollTop), scrollerTop: Math.round(top()), headerTop: Math.round(header.getBoundingClientRect().top) })
  scroller.scrollTop = 400
  await raf()
  const mid = read()
  scroller.scrollTop = scroller.scrollHeight
  await raf()
  const end = read()
  scroller.style.height = restore.height
  scroller.style.flex = restore.flex
  scroller.scrollTop = 0
  await raf()
  return { naturalOverflow, mid, end }
})
if (sticky === null) fail('找不到滚动体或分区头，无法验证贴顶')
console.log(`· 分区头贴顶：滚动口压到 80px 后，滚 ${sticky.mid.scrollTop}px 头 y=${sticky.mid.headerTop}（口 ${sticky.mid.scrollerTop}）· 滚到底 头 y=${sticky.end.headerTop}（口 ${sticky.end.scrollerTop}）`)
if (!near(sticky.mid.headerTop, sticky.mid.scrollerTop, 1.5)) fail(`分区头没有贴住滚动口上沿（差 ${sticky.mid.headerTop - sticky.mid.scrollerTop}px）`)
if (!near(sticky.end.headerTop, sticky.end.scrollerTop, 1.5)) fail(`滚到本分区末尾时分区头掉了（差 ${sticky.end.headerTop - sticky.end.scrollerTop}px）`)
step('长列表滚动时分区头贴顶（中途与末尾都在上沿）')

// 搜索：必然无命中的词让所有行消失，清空后复原（客户端过滤）。
const search = page.getByRole('textbox', { name: /^(Search title|搜索标题)/ })
await search.fill('zzz-no-such-pr')
await page.waitForTimeout(300)
if (await page.locator('[data-pr-row]').count() !== 0) fail('搜索没有过滤掉不匹配的行')
await search.fill('')
await page.waitForTimeout(300)
if (await page.locator('[data-pr-row]').count() === 0) fail('清空搜索后行没有复原')
step('搜索过滤 + 清空复原生效')

// 详情：点开一行 → 面板自己渲染（正文 + 文件清单），返回回到列表原位。
await page.locator('[data-pr-row="969"]').click()
await page.locator('[data-dsh-pr-inbox-detail="969"]').waitFor({ timeout: 60_000 })
let detailFiles = 0
for (let attempt = 0; attempt < 120; attempt++) {
  detailFiles = await page.locator('[data-pi-file]').count()
  if (detailFiles > 0) break
  await page.waitForTimeout(500)
}
// 边界关系（可验证的几何证据）：正文必须是一个**独立的填充块**——
// 它的背景色与面板底的背景色不同，且圆角非 0（官方：流内内容靠填充差 + 圆角分块，
// 不靠描边/阴影）。只看「有没有这个节点」证明不了分层。
const boundary = await page.evaluate(() => {
  const card = document.querySelector('[data-pi-body]')
  const root = document.querySelector('[data-dsh-pr-inbox-panel]')
  if (card === null || root === null) return null
  const cardStyle = getComputedStyle(card)
  // 真正的对照面是**宿主面板底**，不是我自己的 root（它可以是透明的）：
  // 往上找第一个不透明背景的祖先，卡片的填充必须与它不同，否则分块根本看不见。
  let pane = root.parentElement
  let paneFill = 'rgba(0, 0, 0, 0)'
  while (pane !== null) {
    const fill = getComputedStyle(pane).backgroundColor
    if (fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent') { paneFill = fill; break }
    pane = pane.parentElement
  }
  const rootStyle = { backgroundColor: paneFill }
  const cards = [...document.querySelectorAll('.pi-card')]
  return {
    cardFill: cardStyle.backgroundColor,
    panelFill: rootStyle.backgroundColor,
    cardRadius: Number.parseFloat(cardStyle.borderTopLeftRadius),
    cardBorderWidth: Number.parseFloat(cardStyle.borderTopWidth),
    cardBorderColor: cardStyle.borderTopColor,
    cardCount: cards.length,
    distinctFills: new Set(cards.map(node => getComputedStyle(node).backgroundColor)).size,
  }
})
const fillDiffers = boundary !== null && boundary.cardFill !== boundary.panelFill
const hairline = boundary !== null && boundary.cardBorderWidth > 0
  && !boundary.cardBorderColor.startsWith('rgba(0, 0, 0, 0)')
console.log(`· 分层：卡片 ${boundary?.cardCount} 个 · 圆角 ${boundary?.cardRadius}px · 填充 ${boundary?.cardFill} vs 面板底 ${boundary?.panelFill} · 发丝线 ${boundary?.cardBorderWidth}px/${boundary?.cardBorderColor}`)
if (boundary === null) fail('找不到正文卡片或面板根，无法验证分层')
// 边界判据必须主题无关：浅色主题下宿主各层都是 #fff，填充差恒为 0；
// 那种情况下唯一可见的边界是 0.5px 中性发丝线。
if (!fillDiffers && !hairline) fail('正文块与面板底既无填充差也无发丝边界：分块不可见')
if (!(boundary.cardRadius > 0)) fail('正文卡片没有圆角：分块几何没生效')
if (boundary.cardCount < 2) fail('详情里只看到 1 张卡（正文/评论/文件清单应各自成块）')
// ── 正文图片（用户报过的问题）─────────────────────────────────────────────────
// GitHub 编辑器插入的图片是**原始 `<img>` 标签**，而官方 `MarkdownText` 是"不可信
// assistant markdown"渲染器：原始 HTML 一律不渲染。所以插件先把它改写成 markdown 图片
// （src/client/markdown-images.ts）。这里断言的是端到端结果：正文里真的有 `<img>`、
// 地址是官方白名单能接受的绝对协议、并且至少一张把字节取回来了——只看"函数返回了字符串"
// 证明不了浏览器里能看见图。
const imagesOf = () => page.evaluate(async () => {
  const body = document.querySelector('[data-pi-body]')
  if (body === null) return null
  const images = [...body.querySelectorAll('img')]
  const accepted = (node) => {
    const src = node.getAttribute('src') ?? ''
    try { return ['http:', 'https:', 'blob:', 'data:'].includes(new URL(src, document.baseURI).protocol) } catch { return false }
  }
  // 官方 <img> 带 `loading="lazy"`：不滚到可见处会永远停在 pending（头像那一轮踩过）。
  for (const node of images) {
    node.scrollIntoView({ block: 'center' })
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  return {
    count: images.length,
    literal: /<img\b/i.test(body.textContent ?? ''),
    items: images.map(node => ({
      src: (node.getAttribute('src') ?? '').slice(0, 110),
      accepted: accepted(node),
      loaded: node.complete && node.naturalWidth > 0,
      pending: !node.complete,
    })),
  }
})
let bodyImages = await imagesOf()
if (bodyImages === null) fail('找不到正文卡片，无法验证正文图片')
// 等到没有"悬挂"为止（要么解码成功、要么浏览器判定失败）——只等"至少一张成功"会让
// 第二张的悬挂状态被当成通过，这一条与头像那轮的口径保持一致。
for (let attempt = 0; attempt < 40; attempt++) {
  if (!bodyImages.items.some(item => item.pending)) break
  await page.waitForTimeout(500)
  bodyImages = await imagesOf()
}
console.log(`· 正文图片：${bodyImages.count} 个 <img>（已解码 ${bodyImages.items.filter(i => i.loaded).length} / 悬挂 ${bodyImages.items.filter(i => i.pending).length}）· 标签字面残留 ${bodyImages.literal}`)
for (const item of bodyImages.items.slice(0, 3)) {
  console.log(`    ${item.loaded ? '✓' : item.pending ? '…' : '✗'} ${item.accepted ? '' : '(协议不被官方接受) '}${item.src}`)
}
if (bodyImages.literal) fail('正文里 <img> 标签变成了字面文本（改写没生效）')
if (bodyImages.count === 0) fail('#969 的正文有 HTML <img>，但正文里一个 <img> 都没有（原始 HTML 被丢弃、改写没生效）')
const rejected = bodyImages.items.filter(item => !item.accepted)
if (rejected.length > 0) fail(`正文图片地址不是官方接受的绝对协议：${rejected.map(item => item.src).join(' · ')}`)
if (!bodyImages.items.some(item => item.loaded)) {
  fail(`正文图片一个都没解码成功（网络或被拦）：${bodyImages.items.map(item => item.src).join(' · ')}`)
}
step(`正文图片渲染：${bodyImages.count} 个 <img> 且已解码`)

const bodyLength = ((await page.locator('[data-pi-body]').first().innerText()) ?? '').length
const commentCount = await page.locator('[data-pi-comment]').count()
console.log(`· 详情 #969：正文 ${bodyLength} 字符、文件行 ${detailFiles}、时间线 ${commentCount}`)
if (detailFiles === 0) fail('详情没有渲染出文件清单')
if (bodyLength === 0) fail('详情没有渲染出正文')
// 截图给 README 做预览：把详情滚回顶部（图片断言把它滚走了），不然截图只有正文中段。
await page.evaluate(() => {
  const body = document.querySelector('.pi-detailBody')
  if (body !== null) body.scrollTop = 0
})
await page.waitForTimeout(200)
await shoot('pr-inbox-detail')
await page.getByRole('button', { name: /^(Back to list|返回列表)$/ }).first().click()
await page.locator('[data-bucket="authored"]').waitFor({ timeout: 15_000 })
// 等返回后的布局/滚动恢复落定（行不再有入场动画，但仍给一帧余量）。
await page.waitForTimeout(250)
// 当前项标记：官方那根 2px 内嵌强调条（伪元素，不能靠节点数证明）。
const selected = await page.evaluate(() => {
  const row = document.querySelector('[data-pr-row][data-selected="true"]')
  if (row === null) return null
  const mark = getComputedStyle(row, '::before')
  return { width: mark.width, fill: mark.backgroundColor, rowFill: getComputedStyle(row).backgroundColor }
})
if (selected === null) fail('返回列表后没有标记当前项（data-selected 丢了）')
console.log(`· 当前项：底 ${selected.rowFill} · 强调条 ${selected.width}/${selected.fill}`)
if (Number.parseFloat(selected.width) < 2) fail(`当前项的强调条没画出来（${selected.width}）`)
if (selected.fill.startsWith('rgba(0, 0, 0, 0)')) fail('当前项的强调条是透明的')
await shoot('pr-inbox-selected')
step('详情打开 + 返回列表生效（当前项带强调条）')

// README 预览：用 #968（正文是文字）而不是 #969（正文里有 Git Graph 大图）。
// 只截面板本身，避免把左侧聊天的失败消息带进 README。
const textDetailRow = page.locator('[data-pr-row="968"]').first()
if (await textDetailRow.count() === 0) {
  console.log('· 列表里没有 #968，跳过 README 详情预览')
} else {
  await textDetailRow.click()
  await page.locator('[data-dsh-pr-inbox-detail="968"]').waitFor({ timeout: 60_000 })
  await page.evaluate(() => {
    const body = document.querySelector('.pi-detailBody')
    if (body !== null) body.scrollTop = 0
  })
  await page.waitForTimeout(250)
  await shootPanel('pr-inbox-detail')
  await page.getByRole('button', { name: /^(Back to list|返回列表)$/ }).first().click()
  await page.locator('[data-bucket="authored"]').waitFor({ timeout: 15_000 })
}

if (pageErrors.length > 0) fail(`页面报错：${pageErrors.join(' | ')}`)
console.log(`✅ PR 面板已在真实实例里渲染并绑定项目：${expectRepo ?? text.slice(0, 80)}`)
await browser.close()
await api.dispose()