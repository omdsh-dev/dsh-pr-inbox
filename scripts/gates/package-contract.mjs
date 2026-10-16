/**
 * 门禁：package-contract —— 包的「三处同名」与能力面契约。
 *
 * 为什么单独立门：入口路径、bundle patch 的 insert 行、包名、icon、files 白名单
 * 这几处必须彼此同源，靠人眼盯**必然漏**（少一处 `locale`、insert 里写错包名，
 * 表现出来是「装上了但功能全无」）。规则来源：make-dsh-plugin
 * `references/dev-conventions.md`「门禁」与 `references/bundle-plugins.md`。
 *
 * 纯函数 `checkPackageContract` 供自证测试用非法样例直接调用。
 */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { REPO_ROOT, readTracked, trackedFiles } from './lib/repo.mjs'

/** 官方包的两种形态：`@deepseek-ai/*` 与裸 `cordis`——由挂载环境注入，不得声明。 */
const OFFICIAL = [/^@deepseek-ai\//, /^cordis$/, /^@cordisjs\//]
const ICON_EXT = /\.(svg|png|jpe?g|webp)$/i
const ICON_MAX = 256 * 1024

/** cordis.patch.yml 的极小解析：只取 `insert:` 段里的 `id:` / `name:`。 */
export function parsePatchInserts(text) {
  const inserts = []
  let current = null
  let inInsert = false
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').trimEnd()
    if (/^-?\s*insert:\s*$/.test(line)) { inInsert = true; continue }
    if (inInsert && /^\S/.test(line) && !line.startsWith('-')) { inInsert = false; current = null; continue }
    if (!inInsert) continue
    const id = /^\s*-\s*id:\s*(.+)$/.exec(line)
    if (id !== null) { current = { id: unquote(id[1]), name: undefined }; inserts.push(current); continue }
    const name = /^\s*name:\s*(.+)$/.exec(line)
    if (name !== null && current !== null) current.name = unquote(name[1])
  }
  return inserts
}

function unquote(value) {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

/** 声明块里出现的官方包（dependencies / peerDependencies 都算）。 */
export function officialDeclarations(manifest) {
  const found = []
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (OFFICIAL.some(pattern => pattern.test(name))) found.push(`${field}.${name}`)
    }
  }
  return found
}

/**
 * @param {{ dir: string, manifest: unknown, patch?: string, exists?: (rel: string) => boolean, size?: (rel: string) => number, hasLocaleDir?: boolean }} input
 * @returns {string[]} 问题清单（空 = 通过）
 */
export function checkPackageContract(input) {
  const out = []
  const manifest = input.manifest ?? {}
  const exists = input.exists ?? (() => true)
  const patch = input.patch

  if (typeof manifest.name !== 'string' || manifest.name === '') out.push('package.json 缺 name')
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    out.push(`package.json 的 version 不是 semver 形状：${String(manifest.version)}`)
  }

  // 官方包不得出现在 dependencies / peerDependencies（挂载环境注入；声明了会拖垮安装）。
  for (const entry of officialDeclarations(manifest)) {
    out.push(`${entry}：官方包由挂载环境注入，不得声明（去掉这一行）`)
  }

  // 入口与 client 通道指向真实文件。
  const main = manifest.main ?? manifest.exports?.['.']
  const entry = typeof main === 'string' ? main : main?.default
  if (typeof entry !== 'string') out.push('package.json 没有可解析的 main / exports["."]')
  else if (!exists(entry)) out.push(`main / exports["."] 指向不存在的文件：${entry}`)

  const dsh = manifest.dsh ?? {}
  if (dsh.bundle?.patch !== undefined) {
    if (!exists(dsh.bundle.patch)) out.push(`dsh.bundle.patch 指向不存在的文件：${dsh.bundle.patch}`)
    if (patch === undefined) out.push(`读不到 dsh.bundle.patch 的内容：${dsh.bundle.patch}`)
    else {
      const inserts = parsePatchInserts(patch)
      if (inserts.length === 0) out.push('cordis.patch.yml 里没有 insert 行（装上了也不会挂载）')
      if (!inserts.some(item => item.name === manifest.name)) {
        out.push(`cordis.patch.yml 的 insert 里没有 name: '${String(manifest.name)}'（insert 行必须与包名同源）`)
      }
      for (const item of inserts) {
        if (item.id === undefined || item.id === '') out.push('cordis.patch.yml 的 insert 行缺 id')
      }
    }
  } else {
    out.push('package.json 没有 dsh.bundle.patch（本仓库按 bundle 形态分发）')
  }

  if (dsh.client !== undefined) {
    if (dsh.client.platform !== 'web') out.push(`dsh.client.platform 应为 "web"，实际 ${String(dsh.client.platform)}`)
    const clientExport = manifest.exports?.['./client']
    const clientPath = typeof clientExport === 'string' ? clientExport : clientExport?.default
    if (typeof clientPath !== 'string') out.push('声明了 dsh.client 却没有 exports["./client"]')
    else if (!exists(clientPath)) out.push(`exports["./client"] 指向不存在的文件：${clientPath}`)
    const external = dsh.client.external ?? []
    if (external.includes(manifest.name)) out.push('dsh.client.external 不得声明自己（同包自引用会抛错）')
  }

  if (manifest.exports?.['./package.json'] !== './package.json') {
    out.push('exports 必须保留 "./package.json": "./package.json"（宿主读 manifest 与 icon）')
  }

  // icon：顶层字段（不是 dsh.icon）、可解析、大小与扩展名合格、不越出包目录。
  if (typeof manifest.icon !== 'string' || manifest.icon === '') out.push('package.json 缺顶层 icon')
  else {
    if (!ICON_EXT.test(manifest.icon)) out.push(`icon 扩展名不在 SVG/PNG/JPEG/WebP 之内：${manifest.icon}`)
    if (!exists(manifest.icon)) out.push(`icon 指向不存在的文件：${manifest.icon}`)
    else {
      const size = input.size?.(manifest.icon)
      if (typeof size === 'number' && size > ICON_MAX) out.push(`icon 超过 256 KiB：${size} 字节`)
    }
    if (resolve(input.dir, manifest.icon).split(sep).includes('..')) out.push('icon 路径不得越出包目录')
  }

  // files 白名单必须覆盖发布后要用的东西。
  const files = manifest.files ?? []
  const required = [
    ['构建产物目录', 'lib'],
    ['bundle patch', 'cordis.patch.yml'],
    ['icon', 'icon.svg'],
    ['README', 'README.md'],
  ]
  for (const [label, name] of required) {
    if (!files.some(entry => entry === name || entry.startsWith(`${name}/`) || name.startsWith(entry.replace(/\*.*$/, '')))) {
      out.push(`files 白名单缺${label}：${name}`)
    }
  }
  if (input.hasLocaleDir === true) {
    if (!files.includes('locale') && !files.includes('locale/*.json')) out.push('files 白名单缺 locale/*.json（发布出去就丢）')
    if (manifest.exports?.['./locale/*.json'] !== './locale/*.json') out.push('exports 缺 "./locale/*.json"')
  }

  return out
}

/** 真实仓库上的门。 */
export function runPackageContract(root = REPO_ROOT) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const patch = readTracked(root, 'cordis.patch.yml')
  const exists = (rel) => {
    try { statSync(resolve(root, rel)); return true } catch { return false }
  }
  const size = (rel) => {
    try { return statSync(resolve(root, rel)).size } catch { return undefined }
  }
  const hasLocaleDir = trackedFiles(root).some(name => name.startsWith('locale/'))
  const list = checkPackageContract({ dir: root, manifest, patch, exists, size, hasLocaleDir })
  // icon 的 realpath 边界（符号链接不得绕过包目录）。
  if (typeof manifest.icon === 'string' && exists(manifest.icon)) {
    try {
      const real = realpathSync(resolve(root, manifest.icon))
      if (!real.startsWith(realpathSync(root) + sep)) list.push('icon 的 realpath 越出了包目录')
    } catch { /* exists 已报 */ }
  }
  return list
}

export function main() {
  const list = runPackageContract()
  if (list.length === 0) return 0
  for (const item of list) console.error(`  ✗ ${item}`)
  return 1
}

if (process.argv[1]?.endsWith('package-contract.mjs')) process.exit(main())