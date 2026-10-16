/**
 * 门禁：theme-tokens —— 插件不写死颜色、不定义第二套主题。
 *
 * 官方铁律：颜色只消费 `--dsw-*` 令牌（跟随深浅主题与皮肤中心），插件**不得**出现
 * 颜色字面量、不得自带深色分支。这条靠人眼盯不住（`#fff` 混在 260 行 CSS 里谁也看不见），
 * 而它正是"深色主题下会不会露馅"的根因——所以把根因机械化。
 *
 * 扫描范围：`src/client/**\/*.ts` 里注入的样式表（本仓库的样式都在 styles.ts 的模板串里）。
 * 允许：`var(--…)`、`transparent`、`none`、`currentColor`、`inherit`、纯数值。
 */
import { REPO_ROOT, readTracked, trackedFiles } from './lib/repo.mjs'

const STYLE_SOURCES = /^src\/client\/.*\.(ts|tsx)$/
/** 声明里出现这些值就算写死颜色。 */
const LITERAL_COLOR = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:white|black|red|green|blue|gray|grey|silver|maroon|navy|olive|purple|teal|aqua|fuchsia|lime|yellow)\b)/
const COLOR_DECL = /(?:^|[\s;{])(?:color|background|background-color|border|border-[a-z]+|outline|outline-color|box-shadow|fill|stroke|text-decoration-color)\s*:\s*([^;}]+)/gi
/** 自带主题分支：插件不许有。 */
const THEME_BRANCH = /@media[^{]*prefers-color-scheme|\[data-theme=|\.dark\s*\{|:root\s*\{/

/**
 * @param {{ files: { name: string, text: string }[] }} input
 * @returns {string[]} 问题清单（空 = 通过）
 */
export function checkThemeTokens(input) {
  const out = []
  for (const file of input.files) {
    file.text.split('\n').forEach((line, index) => {
      if (line.trim().startsWith('*') || line.trim().startsWith('//') || line.trim().startsWith('/*')) return
      COLOR_DECL.lastIndex = 0
      let match = COLOR_DECL.exec(line)
      while (match !== null) {
        const value = match[1]
        // 值里带 var(--dsw-…) / var(--ds-…) 的一律放行（令牌可能带 fallback）。
        if (!/var\(--ds[a-z0-9-]*\)/i.test(value) && LITERAL_COLOR.test(value)) {
          out.push(`${file.name}:${index + 1} 颜色字面量（应改用 --dsw-alias-* 令牌）：${line.trim().slice(0, 80)}`)
        }
        match = COLOR_DECL.exec(line)
      }
      if (THEME_BRANCH.test(line)) {
        out.push(`${file.name}:${index + 1} 出现自带主题分支（插件跟随宿主主题，不定义第二套）：${line.trim().slice(0, 80)}`)
      }
    })
  }
  return out
}

export function runThemeTokens(root = REPO_ROOT) {
  const names = trackedFiles(root).filter(name => STYLE_SOURCES.test(name))
  const files = names.map(name => ({ name, text: readTracked(root, name) ?? '' }))
  return checkThemeTokens({ files })
}

export function main() {
  const list = runThemeTokens()
  if (list.length === 0) return 0
  for (const item of list) console.error(`  ✗ ${item}`)
  return 1
}

if (process.argv[1]?.endsWith('theme-tokens.mjs')) process.exit(main())