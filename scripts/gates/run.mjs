#!/usr/bin/env node
/**
 * 门禁入口（权威清单就在本文件）。用法：
 *
 *   node scripts/gates/run.mjs                     # 跑全套**静态门**（不需要 gh / 浏览器 / 实例）
 *   node scripts/gates/run.mjs --list              # 列出门与它们的前置
 *   node scripts/gates/run.mjs --only md-links,decisions
 *   node scripts/gates/run.mjs --instance <workspace 路径>   # 另加真实挂载门（需要实例环境）
 *   node scripts/gates/run.mjs --all <workspace 路径>        # 静态 + 实例
 *
 * 纪律（make-dsh-plugin `references/dev-conventions.md`）：
 * - 按改动面跑**最窄**证据，不默认跑全套——静态门便宜，实例门要 gh/浏览器；
 * - 每个门都有自证测试（`tests/gates.spec.ts`）：用非法样例证明它会拒绝。
 */
import { spawnSync } from 'node:child_process'
import { REPO_ROOT } from './lib/repo.mjs'
import { runPackageContract } from './package-contract.mjs'
import { runNoMachinePaths } from './no-machine-paths.mjs'
import { runDecisions } from './decisions.mjs'
import { runMarkdownLinks } from './md-links.mjs'
import { checkGeneratedFreshness } from './generated-freshness.mjs'

const GATES = {
  'package-contract': {
    kind: 'static',
    about: '入口 / bundle patch / 包名 / icon / files 白名单同源；不声明官方包',
    check: () => runPackageContract(),
  },
  'no-machine-paths': {
    kind: 'static',
    about: '入库文本里没有本机绝对路径与凭据',
    check: () => runNoMachinePaths(),
  },
  decisions: {
    kind: 'static',
    about: 'decisions/implemented/ 每条决策记录四段齐全、分类合法',
    check: () => runDecisions(),
  },
  'md-links': {
    kind: 'static',
    about: '文档与 README 里的相对链接都指向真文件',
    check: () => runMarkdownLinks(),
  },
  'generated-freshness': {
    kind: 'static',
    about: '重新构建后 lib/ 无漂移（产物入库的代价必须有人守）',
    check: () => checkGeneratedFreshness(),
  },
  typecheck: {
    kind: 'static',
    about: 'tsc --noEmit',
    command: ['pnpm', ['typecheck']],
  },
  'unit-tests': {
    kind: 'static',
    about: 'vitest 全量单测',
    command: ['pnpm', ['test']],
  },
  'gate-self-tests': {
    kind: 'static',
    about: '每个门禁用非法样例自证会拒绝',
    command: ['pnpm', ['exec', 'vitest', 'run', 'tests/gates.spec.mjs']],
  },
  'git-source': {
    kind: 'instance',
    about: '真实发布通道：clone 已提交 HEAD → git+file 源安装 → 干净 boot + 真调路由',
    script: 'scripts/gates/git-source.sh',
    needs: ['gh 已登录', 'Playwright 驱动', '<workspace 路径>'],
  },
  mounted: {
    kind: 'instance',
    about: '隔离 profile 里真装真跑：host 路由 + 浏览器面板 + 插件图标',
    script: 'scripts/gates/mounted.sh',
    needs: ['gh 已登录', 'Playwright 驱动与浏览器', '<workspace 路径>'],
  },
  'negative-control': {
    kind: 'instance',
    about: '负控：故意弄坏的副本必须响亮报错（否则"干净日志"不算证据）',
    script: 'scripts/gates/negative-control.sh',
    needs: ['gh 已登录', 'Playwright 驱动与浏览器', '<workspace 路径>'],
  },
  standalone: {
    kind: 'instance',
    about: 'better-sidebar 缺席时 host 半照常、client 半安全未激活',
    script: 'scripts/gates/standalone.sh',
    needs: ['gh 已登录', 'Playwright 驱动与浏览器', '<workspace 路径>'],
  },
}

const argv = process.argv.slice(2)
const flag = (name) => {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : (argv[index + 1]?.startsWith('-') === true ? '' : argv[index + 1])
}
const has = (name) => argv.includes(name)

if (has('--list')) {
  for (const [name, gate] of Object.entries(GATES)) {
    const needs = gate.kind === 'instance' ? `（需要：${gate.needs.join('、')}）` : ''
    console.log(`${name.padEnd(20)} ${gate.about}${needs}`)
  }
  process.exit(0)
}

const only = flag('--only')
const wantInstance = has('--instance') || has('--all')
const workspace = has('--all') ? flag('--all') : flag('--instance')

let names = only === undefined || only === ''
  ? Object.keys(GATES).filter(name => GATES[name].kind === 'static')
  : only.split(',').map(name => name.trim()).filter(name => name !== '')
if (wantInstance && only === undefined) {
  names = Object.keys(GATES).filter(name => GATES[name].kind === 'static')
  names.push(...Object.keys(GATES).filter(name => GATES[name].kind === 'instance'))
}
for (const name of names) {
  if (GATES[name] === undefined) {
    console.error(`未知的门：${name}（--list 看清单）`)
    process.exit(2)
  }
}
if (wantInstance && (workspace === undefined || workspace === '')) {
  console.error('实例门需要一个已绑定的 git 仓库路径：--instance <workspace 路径>')
  process.exit(2)
}

const failures = []
for (const name of names) {
  const gate = GATES[name]
  const started = Date.now()
  let problems = []
  if (gate.command !== undefined) {
    const [command, args] = gate.command
    const result = spawnSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8' })
    if (result.status !== 0) {
      const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-6).join('\n  ')
      problems = [`${command} ${args.join(' ')} 退出 ${String(result.status)}\n  ${tail}`]
    }
  } else if (gate.script !== undefined) {
    const result = spawnSync('bash', [gate.script, workspace], { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'inherit' })
    if (result.status !== 0) problems = [`${gate.script} 退出 ${String(result.status)}`]
  } else {
    problems = gate.check()
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  if (problems.length === 0) {
    console.log(`✅ ${name}  ${gate.about}  (${seconds}s)`)
  } else {
    console.log(`✗ ${name}  ${gate.about}  (${seconds}s)`)
    for (const problem of problems) console.log(`    ${problem}`)
    failures.push(name)
  }
}

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} 个门未通过：${failures.join(', ')}`)
  process.exit(1)
}
console.log(`\n✅ ${names.length} 个门全通`)