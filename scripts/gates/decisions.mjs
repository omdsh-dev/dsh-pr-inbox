/**
 * 门禁：decisions —— 决策记录的形状。
 *
 * 每个非平凡改动都要有一条 `decisions/implemented/<category>-<slug>.md`，四段固定
 * （Problem / Decision / Alternatives considered / Consequences），分类取封闭集合——
 * 形状一致才可能在半年后被人（或 agent）一眼读完。规则来源：make-dsh-plugin
 * `references/dev-conventions.md`「决策记录」。
 */
import { REPO_ROOT, readTracked, trackedFiles } from './lib/repo.mjs'

/** 分类封闭集合：写在这里，别处不许发明。 */
export const CATEGORIES = ['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing']
export const DECISIONS_DIR = 'decisions/implemented'
const SECTIONS = ['## Problem', '## Decision', '## Alternatives considered', '## Consequences']

/**
 * @param {{ name: string, text: string }} input
 * @returns {string[]} 问题清单（空 = 通过）
 */
export function checkDecision(input) {
  const out = []
  const text = input.text
  const base = input.name.split('/').pop() ?? ''

  if (!base.endsWith('.md')) out.push(`${input.name}: 决策记录必须是 .md`)
  const category = CATEGORIES.find(item => base.startsWith(`${item}-`))
  if (category === undefined) {
    out.push(`${input.name}: 文件名必须以分类开头（${CATEGORIES.join(' / ')}-<slug>.md）`)
  }
  const declared = /^category:\s*(\S+)\s*$/m.exec(text)?.[1]
  if (declared === undefined) out.push(`${input.name}: 缺 frontmatter 字段 category:`)
  else if (!CATEGORIES.includes(declared)) {
    out.push(`${input.name}: category "${declared}" 不在封闭集合（${CATEGORIES.join(' / ')}）`)
  } else if (category !== undefined && declared !== category) {
    out.push(`${input.name}: 文件名分类（${category}）与 category 字段（${declared}）不一致`)
  }
  for (const section of SECTIONS) {
    if (!text.includes(section)) out.push(`${input.name}: 缺段 ${section}`)
  }
  const order = SECTIONS.map(section => text.indexOf(section))
  if (order.every(index => index >= 0) && order.some((index, i) => i > 0 && index < order[i - 1])) {
    out.push(`${input.name}: 四段的顺序被改动（应为 ${SECTIONS.join(' → ')}）`)
  }
  // 每条记录都要有日期，便于判断"这条现在还成立吗"。
  if (!/^date:\s*\d{4}-\d{2}-\d{2}\s*$/m.test(text)) out.push(`${input.name}: 缺 frontmatter 字段 date: YYYY-MM-DD`)
  return out
}

export function runDecisions(root = REPO_ROOT) {
  const files = trackedFiles(root).filter(name => name.startsWith(`${DECISIONS_DIR}/`))
  if (files.length === 0) return [`${DECISIONS_DIR}/ 下一条决策记录都没有`]
  const out = []
  for (const name of files) {
    const text = readTracked(root, name)
    if (text === undefined) { out.push(`${name}: 读不到`); continue }
    out.push(...checkDecision({ name, text }))
  }
  return out
}

export function main() {
  const list = runDecisions()
  if (list.length === 0) return 0
  for (const item of list) console.error(`  ✗ ${item}`)
  return 1
}

if (process.argv[1]?.endsWith('decisions.mjs')) process.exit(main())