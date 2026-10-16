/**
 * 门禁的自证测试：每个门都必须**用非法样例证明它会拒绝**。
 *
 * 为什么要有这个文件：门禁最容易烂的方式不是"漏了某个检查"，而是**它自己悄悄变成
 * 永远通过**（改名、正则写错、路径换了），此后再怎么红都红不起来。所以每个门都拿
 * 一个**故意坏的输入**喂进去，断言它报错；再拿真实仓库跑一遍，断言它通过。
 * 规则来源：make-dsh-plugin `references/dev-conventions.md`「门禁」。
 */
import { describe, expect, it } from 'vitest'
import { checkPackageContract, officialDeclarations, parsePatchInserts, runPackageContract } from '../scripts/gates/package-contract.mjs'
import { runNoMachinePaths, scanText } from '../scripts/gates/no-machine-paths.mjs'
import { checkDecision, runDecisions } from '../scripts/gates/decisions.mjs'
import { checkMarkdownLinks, extractLinks } from '../scripts/gates/md-links.mjs'
import { checkGeneratedFreshness } from '../scripts/gates/generated-freshness.mjs'
import { checkThemeTokens, runThemeTokens } from '../scripts/gates/theme-tokens.mjs'

/** 造一份"合法"的 manifest，测试只改坏其中一个点。 */
function manifest(overrides = {}) {
  return {
    name: 'demo-plugin',
    version: '0.1.0',
    main: 'lib/index.js',
    exports: {
      '.': './lib/index.js',
      './client': './lib/client.js',
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
    icon: './icon.svg',
    files: ['lib', 'cordis.patch.yml', 'icon.svg', 'README.md'],
    ...overrides,
  }
}

const PATCH = "- insert:\n    - id: demo\n      name: 'demo-plugin'\n"

describe('package-contract', () => {
  it('接受一份合规的 manifest', () => {
    expect(checkPackageContract({ dir: '/tmp/demo', manifest: manifest(), patch: PATCH })).toEqual([])
  })

  it('拒绝声明官方包（dependencies / peerDependencies 都算）', () => {
    const deps = checkPackageContract({ dir: '/tmp/demo', manifest: manifest({ dependencies: { '@deepseek-ai/dsh-tools': '0.2.0-rc.2' } }), patch: PATCH })
    expect(deps.join()).toMatch(/官方包/)
    const peers = checkPackageContract({ dir: '/tmp/demo', manifest: manifest({ peerDependencies: { cordis: '^4.0.0' } }), patch: PATCH })
    expect(peers.join()).toMatch(/官方包/)
    expect(officialDeclarations({ dependencies: { react: '18' } })).toEqual([])
  })

  it('拒绝 insert 行与包名不同源', () => {
    const wrong = "- insert:\n    - id: demo\n      name: 'other-plugin'\n"
    expect(checkPackageContract({ dir: '/tmp/demo', manifest: manifest(), patch: wrong }).join()).toMatch(/同源/)
    expect(parsePatchInserts(PATCH)).toEqual([{ id: 'demo', name: 'demo-plugin' }])
  })

  it('拒绝缺 icon 的文件、缺 files 白名单、入口指向不存在的文件', () => {
    const missingIcon = checkPackageContract({ dir: '/tmp/demo', manifest: manifest(), patch: PATCH, exists: (rel) => rel !== './icon.svg' })
    expect(missingIcon.join()).toMatch(/icon 指向不存在的文件/)
    const noFiles = checkPackageContract({ dir: '/tmp/demo', manifest: manifest({ files: ['lib'] }), patch: PATCH })
    expect(noFiles.join()).toMatch(/files 白名单缺/)
    const badEntry = checkPackageContract({ dir: '/tmp/demo', manifest: manifest(), patch: PATCH, exists: (rel) => rel !== 'lib/index.js' })
    expect(badEntry.join()).toMatch(/不存在的文件/)
  })

  it('真实仓库通过', () => {
    expect(runPackageContract()).toEqual([])
  })
})

describe('no-machine-paths', () => {
  it('抓本机绝对路径与凭据', () => {
    expect(scanText('const p = "/Users/someone/project"').map(hit => hit.kind)).toContain('本机绝对路径') // gate-allow: fixture
    expect(scanText('WORKSPACE=/home/ubuntu/repo').map(hit => hit.kind)).toContain('本机绝对路径') // gate-allow: fixture
    expect(scanText(`token = "ghp_${'a'.repeat(36)}"`).map(hit => hit.kind)).toContain('GitHub 令牌')
    expect(scanText('https://ci:0123456789abcdef0123@github.com/o/r.git').map(hit => hit.kind)).toContain('URL 里的凭据') // gate-allow: fixture
  })

  it('gate-allow 标记能显式放行单行样例（逃生门本身也要有测试）', () => {
    expect(scanText('const p = "/Users/someone/x" // gate-allow: fixture')).toEqual([])
    expect(scanText('const p = "/Users/someone/x"')).toHaveLength(1) // gate-allow: fixture
  })

  it('不误伤系统路径、公开 URL 与形态示例', () => {
    const clean = [
      'const scratch = "/tmp/dsh-pr-inbox-gates"',
      'clone https://github.com/vlln/dsh-pr-inbox.git',
      // 文档与单测里表示"支持带凭据的 URL"这种**形态示例**，不是真密钥。
      'https://user:token@github.com/o/r.git',
      '`git@github.com:owner/repo.git`',
    ].join('\n')
    expect(scanText(clean)).toEqual([])
  })

  it('真实仓库通过（入库文本里没有本机路径与凭据）', () => {
    expect(runNoMachinePaths()).toEqual([])
  })
})

describe('decisions', () => {
  const good = [
    '---',
    'category: bug-fix',
    'date: 2026-01-01',
    '---',
    '## Problem',
    'p',
    '## Decision',
    'd',
    '## Alternatives considered',
    'a',
    '## Consequences',
    'c',
  ].join('\n')

  it('接受一条合规记录', () => {
    expect(checkDecision({ name: 'decisions/implemented/bug-fix-demo.md', text: good })).toEqual([])
  })

  it('拒绝缺段 / 非法分类 / 文件名与分类不一致', () => {
    expect(checkDecision({ name: 'decisions/implemented/bug-fix-demo.md', text: good.replace('## Consequences', '## Result') }).join()).toMatch(/缺段/)
    expect(checkDecision({ name: 'decisions/implemented/bug-fix-demo.md', text: good.replace('bug-fix', 'refactor') }).join()).toMatch(/封闭集合/)
    expect(checkDecision({ name: 'decisions/implemented/feature-demo.md', text: good }).join()).toMatch(/不一致/)
    expect(checkDecision({ name: 'decisions/implemented/bug-fix-demo.md', text: good.replace(/^date:.*$/m, '') }).join()).toMatch(/date/)
  })

  it('真实仓库通过（每条记录都在）', () => {
    expect(runDecisions()).toEqual([])
  })
})

describe('md-links', () => {
  it('抓仓库内断链，放过外链与锚点', () => {
    expect(extractLinks('see [a](docs/x.md) and ![b](docs/y.png)')).toEqual([
      { target: 'docs/x.md', line: 1 },
      { target: 'docs/y.png', line: 1 },
    ])
    const broken = checkMarkdownLinks({
      files: [{ name: 'README.md', text: '[a](docs/missing.md)\n[ok](https://example.com)\n[anchor](#x)\n[route](/plugins/x)' }],
      exists: (rel) => rel !== 'docs/missing.md',
    })
    expect(broken.join()).toMatch(/不存在的文件：docs\/missing.md/)
    expect(broken).toHaveLength(1)
    expect(checkMarkdownLinks({ files: [{ name: 'docs/a.md', text: '[s](../docs/preview/p.png)' }], exists: () => true })).toEqual([])
  })

  it('真实仓库通过（文档里的相对链接都指到真文件）', async () => {
    const { runMarkdownLinks } = await import('../scripts/gates/md-links.mjs')
    expect(runMarkdownLinks()).toEqual([])
  })
})

describe('theme-tokens', () => {
  it('抓颜色字面量（hex / rgba / 具名色）', () => {
    const bad = checkThemeTokens({
      files: [{ name: 'src/client/styles.ts', text: '.a { color: #fff; }\n.b { background: rgba(0, 0, 0, 0.5); }\n.c { border: 1px solid black; }' }],
    })
    expect(bad).toHaveLength(3)
  })

  it('抓自带主题分支', () => {
    const branch = checkThemeTokens({
      files: [{ name: 'src/client/styles.ts', text: '@media (prefers-color-scheme: dark) { .a { color: var(--dsw-alias-label-primary); } }' }],
    })
    expect(branch.join()).toMatch(/自带主题分支/)
  })

  it('放过令牌、transparent、纯数值与注释', () => {
    const good = checkThemeTokens({
      files: [{ name: 'src/client/styles.ts', text: [
        '.a { color: var(--dsw-alias-label-primary); }',
        '.b { background: transparent; border: 0.5px solid var(--dsw-alias-border-l2); }',
        '.c { box-shadow: var(--dsw-elevation-soft); outline-color: var(--dsw-alias-link); }',
        '/* 历史写法：color: #fff 已改掉 */',
      ].join('\n') }],
    })
    expect(good).toEqual([])
  })

  it('真实仓库通过（客户端样式 0 个字面色值）', () => {
    expect(runThemeTokens()).toEqual([])
  })
})

describe('generated-freshness', () => {
  const okRun = () => ({ code: 0, stdout: '', stderr: '' })

  it('构建失败 → 红', () => {
    const run = (command) => (command === 'pnpm' ? { code: 1, stdout: '', stderr: 'boom' } : okRun())
    expect(checkGeneratedFreshness({ root: '/tmp/demo', run }).join()).toMatch(/构建失败/)
  })

  it('构建后 lib/ 有漂移 → 红', () => {
    const run = (command, args) => (args?.includes('diff')
      ? { code: 1, stdout: ' lib/client.js | 4 ++--\n', stderr: '' }
      : okRun())
    const problems = checkGeneratedFreshness({ root: '/tmp/demo', run })
    expect(problems.join()).toMatch(/不一致/)
  })

  it('生成物没进版本库 → 红', () => {
    // 真实的 git ls-files 来自仓库根，所以这里用真实 root 但让构建/对比都"通过"，
    // 断言的是"lib/ 被跟踪"这一条在真仓库成立的反面：换个不存在的目录名就必然报。
    const run = () => okRun()
    expect(checkGeneratedFreshness({ root: process.cwd(), run })).toEqual([])
    expect(checkGeneratedFreshness({ root: '/tmp/demo', run, tracked: [] }).join()).toMatch(/没有被 git 跟踪/)
  })
})