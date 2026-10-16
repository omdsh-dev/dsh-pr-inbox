/**
 * 门禁：no-machine-paths —— 发布卫生。
 *
 * 入库文本里不得出现**本机绝对路径**与**凭据**。理由很实际：从历史里清凭据比发之前
 * 扫一遍贵得多，而本机路径会让外人 clone 下来直接跑不通（"为什么脚本指向 /Users/vlln"）。
 * 规则来源：make-dsh-plugin `references/dev-conventions.md`「门禁」的 `no-machine-paths`。
 *
 * 扫的是**入库内容**（git ls-files）；`scripts/gates/` 自身排除——它必然含这些模式的
 * 字面量（正则源码），排除范围写死在 SKIP 里，改这里必须同时改自证测试。
 */
import { REPO_ROOT, readTracked, trackedTextFiles } from './lib/repo.mjs'

const SKIP = /^scripts\/gates\//
/** 单行显式放行（门自己的自证样例必须含这些字面量）。 */
export const ALLOW = 'gate-allow'

const RULES = [
  { kind: '本机绝对路径', re: /\/Users\/|\/home\/[a-z]|\/Volumes\/|[A-Za-z]:\\{1,2}Users\\/g },
  { kind: 'GitHub 令牌', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { kind: '模型/云密钥', re: /\b(?:sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g },
  { kind: '私钥块', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  // URL 里的口令位：只报「像密钥的长度」（≥16 字符）——文档与单测里 `user:token@host`
  // 这类**形态示例**要能留下，真 PAT（40 字符）逃不掉。
  { kind: 'URL 里的凭据', re: /:\/\/[^\s/:@]{1,64}:([^\s/:@]{16,})@/g },
  { kind: '会话 token', re: /[?&]token=[A-Za-z0-9._-]{20,}/g },
]

/**
 * 纯函数：扫一段文本。
 * @param {string} text
 * @returns {{ kind: string, line: number, sample: string }[]}
 */
export function scanText(text) {
  const hits = []
  text.split('\n').forEach((line, index) => {
    if (line.includes(ALLOW)) return
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      const match = rule.re.exec(line)
      if (match === null) continue
      // 只报类型与位置，不回显命中内容（免得把凭据再写进日志）。
      hits.push({ kind: rule.kind, line: index + 1, sample: `${redact(match[0]).slice(0, 24)}…` })
    }
  })
  return hits
}

/** 命中内容在日志里打码：只留头尾，中间一律省略。 */
function redact(value) {
  if (value.length <= 8) return value
  return `${value.slice(0, 4)}***${value.slice(-2)}`
}

/**
 * @param {{ root?: string, files?: string[] }} input
 * @returns {string[]} 问题清单（空 = 通过）
 */
export function runNoMachinePaths(input = {}) {
  const root = input.root ?? REPO_ROOT
  const files = input.files ?? trackedTextFiles(root).filter(name => !SKIP.test(name))
  const out = []
  for (const name of files) {
    const text = readTracked(root, name)
    if (text === undefined) continue
    for (const hit of scanText(text)) {
      out.push(`${name}:${hit.line} ${hit.kind}（${hit.sample}）`)
    }
  }
  return out
}

export function main() {
  const list = runNoMachinePaths()
  if (list.length === 0) return 0
  for (const item of list) console.error(`  ✗ ${item}`)
  return 1
}

if (process.argv[1]?.endsWith('no-machine-paths.mjs')) process.exit(main())