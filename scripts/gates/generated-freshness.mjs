/**
 * 门禁：generated-freshness —— 入库的构建产物与源码一致。
 *
 * 本仓库的 `lib/` **随提交入库**（`github:` 源安装免构建、真一行装），代价是它可能悄悄
 * 落后于源码——使用者于是装到一个旧产物，症状是"改了没生效"。所以重新构建一遍，
 * 用 `git diff --exit-code -- lib` 钉住"产物必须等于源码的构建结果"。
 *
 * `run` 可注入，自证测试用一个"构建后仍有 diff"的假 runner 证明它会红。
 */
import { execFileSync } from 'node:child_process'
import { REPO_ROOT, trackedFiles } from './lib/repo.mjs'

/** 随提交入库的生成物目录（改这里必须同时改 CI 与 README 的说明）。 */
export const GENERATED = ['lib']

export function defaultRun(command, args, root = REPO_ROOT) {
  try {
    const stdout = execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return {
      code: typeof error?.status === 'number' ? error.status : 1,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? error?.message ?? ''),
    }
  }
}

/**
 * @param {{ root?: string, run?: typeof defaultRun, tracked?: string[] }} input
 *   `tracked` 省略 = 不查"生成物是否入库"（纯函数单测用）；真门一定传。
 * @returns {string[]} 问题清单（空 = 通过）
 */
export function checkGeneratedFreshness(input = {}) {
  const root = input.root ?? REPO_ROOT
  const run = input.run ?? ((command, args) => defaultRun(command, args, root))
  const out = []

  const build = run('pnpm', ['build'])
  if (build.code !== 0) {
    out.push(`构建失败（pnpm build 退出 ${build.code}）：${build.stderr.trim().split('\n').slice(-3).join(' | ')}`)
    return out
  }

  const diff = run('git', ['diff', '--exit-code', '--stat', '--', ...GENERATED])
  if (diff.code !== 0) {
    const changed = diff.stdout.trim().split('\n').slice(0, 4).join(' / ')
    out.push(`入库的生成物与源码不一致（${GENERATED.join(', ')}）：${changed}——重新构建并提交`)
  }

  // 生成物必须真的在库里（否则 git 源安装拿到的是空包）。
  if (input.tracked !== undefined) {
    for (const dir of GENERATED) {
      if (!input.tracked.some(name => name.startsWith(`${dir}/`))) {
        out.push(`${dir}/ 没有被 git 跟踪（git 源安装会拿到空包）`)
      }
    }
  }
  return out
}

export function main() {
  const list = checkGeneratedFreshness({ tracked: trackedFiles(REPO_ROOT) })
  if (list.length === 0) return 0
  for (const item of list) console.error(`  ✗ ${item}`)
  return 1
}

if (process.argv[1]?.endsWith('generated-freshness.mjs')) process.exit(main())