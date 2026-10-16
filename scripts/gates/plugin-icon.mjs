#!/usr/bin/env node
/**
 * 插件图标门（make-dsh-plugin Step 2b 的机械部分）：证明**宿主真的把 icon.svg
 * 变成了 Plugins 页里的图片**，而不是只看文件存在。
 *
 * 用法： node scripts/verify-icon.mjs <launch-url> [包名]
 *
 * 机械断言：Plugins 页里该包行的 `<img>` 的 src 是 data URL、`complete === true`
 * 且 `naturalWidth > 0`（文件存在 / 页面 200 / DOM 里有 img 都不算证明）。
 * 同时落一张截图供**视觉验收**（本 Agent 看不到图像，视觉结论要人看）。
 */
import { loadPlaywright } from './lib/playwright.mjs'

const [launchUrl, pkg = 'dsh-pr-inbox'] = process.argv.slice(2)
if (launchUrl === undefined) {
  console.error('用法：node scripts/verify-icon.mjs <launch-url> [包名]')
  process.exit(2)
}

const { chromium } = loadPlaywright().mod

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(String(error)))
await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
await page.locator('#root > *').first().waitFor({ timeout: 90_000 })
// keyless 引导弹层（版本提示 / provider 配置）会盖住整屏并吞掉点击：先等它出现再关。
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
for (let attempt = 0; attempt < 60; attempt++) {
  const count = await page.getByRole('button', { name: /^(Plugins|插件)$/ }).count()
  if (count > 0) break
  await page.waitForTimeout(500)
}
await page.getByRole('button', { name: /^(Plugins|插件)$/ }).first().click()

// 包行定位：Plugins 页的 DOM 结构不是契约，所以不猜选择器——在页面里扫所有 <img>，
// 取「所在的祖先里含本包名**或**它的 locale 显示名」的那些，再按行内尺寸挑最合理的候选。
//
// 为什么要连显示名一起找：加了 `locale/*.json` 的 `meta.title` 之后，Plugins 页显示的
// 就不是包名而是标题（本仓库是「PR 收件箱」/「PR Inbox」）——只按包名找会"找不到行"。
// 顺带把这件事变成断言：只要 locale 里给了标题，行上就必须显示其中之一（否则说明
// 显示元数据没生效，而不是"没找到"）。
/** 从仓库的 locale/*.json 读显示名（没读到就只按包名找）。 */
const { readdirSync, readFileSync } = await import('node:fs')
const localeDir = new URL('../../locale/', import.meta.url)
let titles = []
try {
  for (const file of readdirSync(localeDir).filter(name => name.endsWith('.json'))) {
    const meta = JSON.parse(readFileSync(new URL(file, localeDir), 'utf8'))?.meta
    if (typeof meta?.title === 'string' && meta.title !== '') titles.push(meta.title)
  }
} catch { titles = [] }
const needles = [pkg, ...titles]

let facts
for (let attempt = 0; attempt < 40; attempt++) {
  facts = await page.evaluate(({ needles }) => {
    const candidates = []
    for (const image of document.querySelectorAll('img')) {
      let node = image.parentElement
      let matched = null
      for (let depth = 0; node !== null && depth < 8; depth++, node = node.parentElement) {
        const text = node.textContent ?? ''
        const hit = needles.find(needle => text.includes(needle))
        if (hit !== undefined) { matched = hit; break }
      }
      if (matched === null) continue
      const rect = image.getBoundingClientRect()
      candidates.push({
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        dataUrl: (image.getAttribute('src') ?? '').startsWith('data:'),
        prefix: (image.getAttribute('src') ?? '').slice(0, 32),
        renderedWidth: Math.round(rect.width),
        visible: rect.width > 0 && rect.height > 0,
        matched,
      })
    }
    return { count: candidates.length, best: candidates.find(c => c.dataUrl) ?? candidates[0] ?? null }
  }, { needles })
  if (facts.best?.complete === true && facts.best.naturalWidth > 0) break
  await page.waitForTimeout(500)
}
console.log(`· Plugins 页里按「${needles.join(' / ')}」找到 ${facts.count} 个 img`)
if (facts.best === null) {
  console.error(`✗ Plugins 页里找不到 ${pkg} 行的任何 img（宿主可能没读 icon 字段）`)
  process.exit(1)
}
facts = facts.best
console.log(`· 命中行的显示名：${facts.matched}`)
if (titles.length > 0 && !titles.includes(facts.matched)) {
  console.error(`✗ 行上显示的既不是包名也不是 locale 标题（locale 显示元数据没生效？命中：${facts.matched}）`)
  process.exit(1)
}
if (!facts.dataUrl) {
  console.error(`✗ 图标 src 不是 data URL（宿主应把包内 icon 转成 data URL）：${facts.prefix}`)
  process.exit(1)
}
if (!facts.complete || facts.naturalWidth === 0) {
  console.error('✗ 图标没有解码成功（complete/naturalWidth）')
  process.exit(1)
}
if (errors.length > 0) {
  console.error(`✗ 页面报错：${errors.join(' | ')}`)
  process.exit(1)
}
const shot = process.env.SCREENSHOT_DIR
if (shot !== undefined) {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(shot, { recursive: true })
  await page.screenshot({ path: `${shot}/plugins-page.png` })
  console.log(`· 截图（供视觉验收）：${shot}/plugins-page.png`)
}
console.log(`✅ Plugins 页里 ${pkg} 的图标已加载（data URL，自然尺寸 ${facts.naturalWidth}×${facts.naturalHeight}，行内 ${facts.renderedWidth}px）`)
await browser.close()