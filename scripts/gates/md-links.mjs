/**
 * 门禁：md-links —— 文档里的相对链接必须指到真文件。
 *
 * 公开仓库的 README 是门面：一个 404 的截图/文档链接比少写一段更伤。
 * 只查**仓库内相对路径**（http(s)、mailto、纯锚点、以 `/` 开头的站内绝对路径都不查）。
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { REPO_ROOT, readTracked, trackedTextFiles } from './lib/repo.mjs'

/** 从 markdown 里抽出 `](target)` 形态的链接（含图片）。 */
export function extractLinks(text) {
  const links = []
  text.split('\n').forEach((line, index) => {
    const re = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
    let match = re.exec(line)
    while (match !== null) {
      links.push({ target: match[1], line: index + 1 })
      match = re.exec(line)
    }
  })
  return links
}

/** 需要落到仓库文件上的链接。 */
export function isRepoRelative(target) {
  if (target === '' || target.startsWith('#')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false // http(s):、mailto: 等
  if (target.startsWith('/')) return false // 站内绝对路径（宿主路由等）
  return true
}

/**
 * @param {{ files: { name: string, text: string }[], exists: (rel: string) => boolean }} input
 * @returns {string[]} 问题清单（空 = 通过）
 */
export function checkMarkdownLinks(input) {
  const out = []
  for (const file of input.files) {
    const base = dirname(file.name)
    for (const link of extractLinks(file.text)) {
      if (!isRepoRelative(link.target)) continue
      const bare = link.target.split('#')[0]
      if (bare === '') continue
      const rel = base === '.' ? bare : `${base}/${bare}`
      if (!input.exists(rel)) out.push(`${file.name}:${link.line} 链接指向不存在的文件：${link.target}`)
    }
  }
  return out
}

export function runMarkdownLinks(root = REPO_ROOT) {
  const names = trackedTextFiles(root).filter(name => name.endsWith('.md'))
  const files = names.map(name => ({ name, text: readTracked(root, name) ?? '' }))
  return checkMarkdownLinks({
    files,
    exists: (rel) => {
      try { return statSync(resolve(root, rel)) !== undefined } catch { return existsSync(resolve(root, rel)) }
    },
  })
}

export function main() {
  const list = runMarkdownLinks()
  if (list.length === 0) return 0
  for (const item of list) console.error(`  ✗ ${item}`)
  return 1
}

if (process.argv[1]?.endsWith('md-links.mjs')) process.exit(main())