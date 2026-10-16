/**
 * 门禁共用的最小工具：仓库根、入库文件清单、文本读取。
 *
 * 门禁一律只看**入库内容**（`git ls-files`）——工作区里的临时产物不进门的判断范围，
 * 这样「发布出去的东西」和「门看到的东西」是同一份。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根（scripts/gates/lib/ → 上三级）。 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** 入库文件（相对仓库根，posix 分隔符）。 */
export function trackedFiles(root = REPO_ROOT) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  return out.split('\0').filter(name => name !== '')
}

/** 读入库文件；不存在或不合法 UTF-8 时返回 undefined（门自己决定要不要报）。 */
export function readTracked(root, name) {
  try {
    return readFileSync(resolve(root, name), 'utf8')
  } catch {
    return undefined
  }
}

/** 二进制判定：图片/字体等按扩展名跳过文本扫描。 */
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|tgz)$/i
export function isBinary(name) {
  return BINARY.test(name)
}

/** 文本文件（非二进制）的入库清单。 */
export function trackedTextFiles(root = REPO_ROOT) {
  return trackedFiles(root).filter(name => !isBinary(name))
}

/** 统一的失败收集器：门只需要往里 push 人话。 */
export function problems() {
  const list = []
  return {
    add(message) { list.push(message) },
    get list() { return list },
    get ok() { return list.length === 0 },
  }
}