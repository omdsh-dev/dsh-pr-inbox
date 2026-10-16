/**
 * 发布门：把「这个包能被 DSH 正确加载、能被市场接受」这件事钉成断言，
 * 而不是靠发布前手点一遍。它守的是**产物与 manifest 的契约**，
 * 与 tests/*.spec.ts 的功能测试互补：
 *
 *  1. 名字/版本/许可/非 private；
 *  2. `exports` 的每个落点都真实存在，且 `main` 与 `exports['.']` 一致；
 *  3. `dsh.bundle.patch` 指向存在的文件，patch 里的 insert 行就是本包；
 *  4. `dsh.client` 是 web、且声明了对 better-sidebar bundle 的加载依赖；
 *  5. `files` 覆盖运行时真正要发的那些路径（漏一个 = 装完崩）；
 *  6. 市场硬约束：依赖里不得出现 `cordis` 本体、scripts 不得含安装期钩子；
 *  7. **依赖三字段不声明官方包**（`@deepseek-ai/*` / `cordis` 由挂载环境注入）；
 *  8. 包显示元数据：`locale/*.json` 有非空 title/description，且进了 exports 与 files；
 *  8. **构建产物契约**：host bundle 导出 apply/inject；client bundle 是
 *     `__ModuleLoader__` 包装、只 require 宿主模块、**不** value-require
 *     `dsh-better-sidebar`（那会踩 better-sidebar 的构建纯度门）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const readText = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
const readJson = (rel: string): Record<string, unknown> => JSON.parse(readText(rel)) as Record<string, unknown>
const manifest = readJson('package.json')

const fileExists = (rel: string): boolean => {
  try {
    readFileSync(join(ROOT, rel))
    return true
  } catch {
    return false
  }
}

describe('package manifest', () => {
  it('is a publishable, non-private package with a semver version', () => {
    expect(manifest.name).toBe('dsh-pr-inbox')
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    expect(manifest.private).not.toBe(true)
    expect(manifest.license).toBe('MIT')
    expect(fileExists('LICENSE')).toBe(true)
  })

  it('declares no official package as a dependency (the mount environment injects them)', () => {
    // 官方包自带整条 peer 闭包，声明了会让使用者那一步安装 ERESOLVE。
    // 门禁 package-contract 是权威；这里留一条更快的本地红线。
    const official = /^(@deepseek-ai\/|cordis$|@cordisjs\/)/
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const table = (manifest[field] ?? {}) as Record<string, string>
      const declared = Object.keys(table).filter(name => official.test(name))
      expect(declared, `${field} 不得声明官方包`).toEqual([])
    }
  })

  it('ships display metadata for the Plugins page (locale/*.json)', () => {
    const files = manifest.files as string[]
    const exports = manifest.exports as Record<string, string>
    expect(exports['./locale/*.json']).toBe('./locale/*.json')
    expect(files.some(entry => entry.startsWith('locale'))).toBe(true)
    for (const lang of ['zh', 'en']) {
      const meta = (readJson(`locale/${lang}.json`) as { meta?: { title?: string, description?: string } }).meta
      expect(typeof meta?.title, `locale/${lang}.json 缺 meta.title`).toBe('string')
      expect(meta?.title).not.toBe('')
      expect(typeof meta?.description, `locale/${lang}.json 缺 meta.description`).toBe('string')
      expect(meta?.description).not.toBe('')
    }
  })

  it('satisfies the market constraints (no `cordis` dependency, no install hooks)', () => {
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const table = (manifest[field] ?? {}) as Record<string, string>
      expect(Object.keys(table), `${field} must not declare cordis`).not.toContain('cordis')
    }
    const scripts = (manifest.scripts ?? {}) as Record<string, string>
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
      expect(Object.keys(scripts), `scripts.${hook} is forbidden by the market`).not.toContain(hook)
    }
  })
})

describe('DSH load contract', () => {
  it('points every exports target and main at a file that exists', () => {
    const exports = manifest.exports as Record<string, string>
    for (const [key, target] of Object.entries(exports)) {
      expect(typeof target, `exports["${key}"] must be a string`).toBe('string')
      if (target.includes('*')) {
        // 通配导出（`./locale/*.json`）：至少有一个文件真的落在它的形状里。
        const probe = target.replace(/\*[^/]*$/, 'zh.json')
        expect(fileExists(probe), `exports["${key}"] -> ${target} 没有任何文件命中（试了 ${probe}）`).toBe(true)
      } else {
        expect(fileExists(target), `exports["${key}"] -> ${target} is missing`).toBe(true)
      }
    }
    // `main` 与 `exports['.']` 指向同一个文件即可（前者惯例不带 `./`）。
    const strip = (path: string): string => path.replace(/^\.\//, '')
    expect(strip(manifest.main as string)).toBe(strip(exports['.']!))
    expect(exports['./client']).toBe('./lib/client.js')
  })

  it('ships the patch layer, and that patch inserts this very package', () => {
    const dsh = manifest.dsh as { bundle: { patch: string }, client: { platform: string, inject: string[] } }
    expect(dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(fileExists(dsh.bundle.patch)).toBe(true)
    const patch = readText(dsh.bundle.patch)
    expect(patch).toContain('- insert:')
    expect(patch).toContain(`name: '${manifest.name}'`)
  })

  it('registers a web client half that loads after the better-sidebar bundle', () => {
    const dsh = manifest.dsh as { client: { platform: string, inject: string[] } }
    expect(dsh.client.platform).toBe('web')
    expect(dsh.client.inject).toContain('dsh-better-sidebar')
  })

  it('publishes everything the runtime needs (a missing `files` entry installs broken)', () => {
    const files = manifest.files as string[]
    const exports = manifest.exports as Record<string, string>
    const dsh = manifest.dsh as { bundle: { patch: string } }
    const required = [...Object.values(exports), dsh.bundle.patch]
      .map(target => target.replace(/^\.\//, ''))
      // npm always publishes package.json; README/LICENSE are auto-included too.
      .filter(target => target !== 'package.json')
    for (const target of required) {
      const covered = files.some(entry => target === entry || target.startsWith(`${entry}/`))
      expect(covered, `${target} is not covered by package.json#files`).toBe(true)
    }
    expect(files).toContain('README.md')
  })
})

describe('built artifacts', () => {
  it('host bundle exports the cordis apply/inject surface', async () => {
    const module = await import(join(ROOT, 'lib/index.js')) as Record<string, unknown>
    expect(typeof module.apply).toBe('function')
    expect(Array.isArray(module.inject)).toBe(true)
    expect(module.inject).toContain('webServer')
    expect(module.name).toBeTypeOf('string')
  })

  it('client bundle is a ModuleLoader module that only requires host modules', () => {
    const client = readText('lib/client.js')
    expect(client.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(client).toContain('id: "dsh-pr-inbox"')
    // react / react-dom 与宿主 client 包由页面提供，必须留在外部。
    expect(client).toContain('require("react")')
    // 构建纯度门：**绝不** value-require better-sidebar（运行时只走 ctx.betterSidebar）。
    expect(client).not.toContain('require("dsh-better-sidebar")')
    expect(client).not.toMatch(/require\("@dsh-external\//)
  })

  it('host bundle keeps gh invocations explicit-GET where fields are passed', () => {
    // 真实冒烟抓过的 bug（gh api 带 -f 默认 POST）在产物层面也留一条痕迹。
    const host = readText('lib/index.js')
    expect(host).toContain('-X')
    expect(host).toContain('/plugins/dsh-pr-inbox/api')
  })
})