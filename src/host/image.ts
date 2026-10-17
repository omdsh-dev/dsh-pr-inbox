/**
 * 图片代理：`GET /plugins/dsh-pr-inbox/image?cwd=&ref=&path=`
 *
 * 为什么必须有这条 host 路由：本环境里 `avatars.githubusercontent.com` /
 * `raw.githubusercontent.com`（`*.githubusercontent.com` 这条 CDN）**不可达**，
 * 而宿主主页面又没有 img-src CSP —— 所以 PR 正文里的仓库相对图片（以及头像）
 * 走客户端直连永远出不来，只能由 host 用本机已登录的 `gh` 把字节取回来再同源发。
 *
 * 安全面：
 *  - 调用方只给 `cwd`，`owner/repo` 由 `detectRepo(cwd)` 自己解析 —— **不接受调用方
 *    直给仓库坐标**，这条路由因此不是「任意仓抓取器」；
 *  - `path` 必须是仓库内相对路径（空串 / 绝对路径 / 任何一段 `..`/`.` 一律 400）；
 *  - `ref` 词法校验（`^[A-Za-z0-9._/~+-]+$`，≤256），绝不拼进 shell（全程 argv）；
 *  - **只放行图片**：扩展名给出 MIME，再用魔数确认；不符回 415；
 *  - 上限 8 MiB：先问 `size`，超了直接 413；raw 读的 `maxBuffer` 是同一条硬上限
 *    的第二道闸（超了子进程被杀，字节从不整体进内存）；
 *  - 只读、无副作用；响应 `cache-control: private, max-age=300` + `nosniff`。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PrInboxError, ghJson, runGhBuffer } from './gh'
import { detectRepo, requireAbsoluteCwd } from './repo'
import { isSameOrigin } from './trust'
import type { RepoValue } from '../shared/types'

export const IMAGE_PATH = '/plugins/dsh-pr-inbox/image'

/** 单张图片字节上限（8 MiB）。 */
const MAX_BYTES = 8 * 1024 * 1024
/** raw 读的 maxBuffer 上限（多留 64 KiB 给可能存在的包装字节）。 */
const READ_MAX_BUFFER = MAX_BYTES + 64 * 1024
/** 缓存 300 s（与响应头的 max-age 对齐：同一张图反复渲染不打 GitHub）。 */
const CACHE_TTL_MS = 300_000
/** 条数上限。 */
const CACHE_MAX_ENTRIES = 24
/** **字节**上限：条数界在图片这种大载荷上不够，再加一条总字节预算。 */
const CACHE_MAX_BYTES = 32 * 1024 * 1024
/** `path` / `ref` 的长度上限（词法闸门）。 */
const MAX_PATH_LENGTH = 512
const MAX_REF_LENGTH = 256

/** 扩展名 → MIME。只有这张表里的扩展名会被代理。 */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

export function imageMimeFor(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return undefined
  return MIME_BY_EXT[path.slice(dot + 1).toLowerCase()]
}

/** 仓库内相对路径：空串 / 绝对 / 任何一段 `.`/`..` / NUL / 超长一律 400。
 *  另外拒绝 `?`/`#`/反斜杠/控制字符与**百分号编码的** dot/slash（`%2e` 等）：
 *  这条字符串会原样拼进 `gh api .../contents/<path>`，词法层必须比调用方更严。 */
export function requireRepoPath(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_PATH_LENGTH) {
    throw new PrInboxError('需要仓库内相对路径', 'bad-request', 400)
  }
  if (value.startsWith('/') || /[?#\\\u0000-\u001f]/.test(value)) {
    throw new PrInboxError('路径必须是仓库内相对路径', 'bad-request', 400)
  }
  if (/%(?:2e|2f|5c)/i.test(value)) {
    throw new PrInboxError('路径里不允许编码后的 `.` / `/` / `\\`', 'bad-request', 400)
  }
  const segments = value.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new PrInboxError('路径里不允许空段 / `.` / `..`', 'bad-request', 400)
  }
  return value
}

/** ref：分支名 / tag / SHA / `refs/pull/<n>/head` 都合法；只做词法校验。
 *  前导 `-` 直接拒（它总是作为 `ref=<value>` 传，但少一个「看起来像选项」的形状）。 */
export function requireRef(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_REF_LENGTH
    || value.startsWith('-') || !/^[A-Za-z0-9._/~+-]+$/.test(value)) {
    throw new PrInboxError('需要合法的 ref（分支 / tag / SHA）', 'bad-request', 400)
  }
  return value
}

/**
 * 魔数确认：扩展名说是图，字节也得像图。这样这条路由不会把任意内容当
 * `image/png` 发出去（同源页面可以拿它当「受信的字节源」）。
 */
export function sniffImageMime(bytes: Buffer, mime: string): boolean {
  const head = (length: number): string => bytes.subarray(0, length).toString('latin1')
  switch (mime) {
    case 'image/png':
      return bytes.length > 8 && bytes[0] === 0x89 && head(4) === '\x89PNG'
    case 'image/jpeg':
      return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    case 'image/gif':
      return head(3) === 'GIF'
    case 'image/webp':
      return bytes.length > 12 && head(4) === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
    case 'image/bmp':
      return head(2) === 'BM'
    case 'image/x-icon':
      return bytes.length > 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01
    case 'image/avif':
      return bytes.length > 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp'
    case 'image/svg+xml': {
      const text = bytes.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase()
      return text.startsWith('<svg') || text.startsWith('<?xml') || text.startsWith('<!--') || text.startsWith('<!doctype svg')
    }
    default:
      return false
  }
}

export interface ImageBytes {
  mime: string
  bytes: Buffer
  /** 是否命中缓存（验证与排障用，不发给客户端）。 */
  cached: boolean
}

/** 有界缓存：TTL + 条数 + 总字节三重约束，按插入序淘汰最旧。 */
const cache = new Map<string, { expires: number; mime: string; bytes: Buffer }>()
const inflight = new Map<string, Promise<{ mime: string; bytes: Buffer }>>()
let cacheBytes = 0

/** cwd → 仓库身份的短缓存：一篇正文里的 N 张图只跑一次 `git`（detectRepo 是 2–3 个子进程）。
 *  **不缓存失败**：工作区可能刚刚才绑定好。 */
const REPO_TTL_MS = 60_000
const REPO_CACHE_MAX = 32
const repoCache = new Map<string, { expires: number; repo: RepoValue }>()

async function detectRepoCached(cwd: string, now: number): Promise<RepoValue | undefined> {
  const hit = repoCache.get(cwd)
  if (hit !== undefined && hit.expires > now) return hit.repo
  const repo = await detectRepo(cwd)
  if (repo === undefined) return undefined
  repoCache.set(cwd, { expires: now + REPO_TTL_MS, repo })
  while (repoCache.size > REPO_CACHE_MAX) {
    const oldest = repoCache.keys().next().value
    if (oldest === undefined) break
    repoCache.delete(oldest)
  }
  return repo
}

function cacheTake(key: string, now: number): { mime: string; bytes: Buffer } | undefined {
  const hit = cache.get(key)
  if (hit === undefined) return undefined
  if (hit.expires <= now) {
    cache.delete(key)
    cacheBytes -= hit.bytes.length
    return undefined
  }
  // 命中即刷新 LRU 位置。
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

function cachePut(key: string, value: { mime: string; bytes: Buffer }): void {
  cacheBytes += value.bytes.length
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, ...value })
  while (cache.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    const dropped = cache.get(oldest)
    cache.delete(oldest)
    if (dropped !== undefined) cacheBytes -= dropped.bytes.length
  }
}

/** 测试与 dispose 用。 */
export function resetImageCache(): void {
  cache.clear()
  inflight.clear()
  cacheBytes = 0
  repoCache.clear()
}

/** 先问大小（超上限不下载字节），再走 raw 读字节，最后魔数确认。 */
async function fetchImage(fullName: string, ref: string, path: string): Promise<{ mime: string; bytes: Buffer }> {
  const mime = imageMimeFor(path)
  if (mime === undefined) {
    throw new PrInboxError('只代理图片（png/jpg/jpeg/gif/webp/svg/bmp/ico/avif）', 'unsupported-type', 415)
  }
  const meta = await ghJson<{ size?: unknown }>(['api', '-X', 'GET', `repos/${fullName}/contents/${path}`,
    '-f', `ref=${ref}`, '-H', 'Accept: application/vnd.github+json'])
  const size = typeof meta.size === 'number' ? meta.size : undefined
  if (size !== undefined && size > MAX_BYTES) {
    throw new PrInboxError(`图片超过上限 8 MiB（${size} 字节）`, 'too-large', 413)
  }
  // 必须显式 `-X GET`：`gh api` 带 `-f` 时默认发 POST（上一轮真冒烟抓到的坑）。
  const bytes = await runGhBuffer(['api', '-X', 'GET', `repos/${fullName}/contents/${path}`,
    '-f', `ref=${ref}`, '-H', 'Accept: application/vnd.github.raw'], READ_MAX_BUFFER)
  if (bytes.length === 0) throw new PrInboxError('取回 0 字节', 'gh-bad-output', 502)
  if (!sniffImageMime(bytes, mime)) {
    throw new PrInboxError('内容与扩展名不符（不是图片）', 'unsupported-type', 415)
  }
  return { mime, bytes }
}

/**
 * 解析并取字节。`cwd` 由本插件自己解析成仓库坐标；同一 (repo, ref, path) 并发只发一次。
 */
export async function resolveImage(cwdRaw: unknown, refRaw: unknown, pathRaw: unknown): Promise<ImageBytes & { fullName: string }> {
  const cwd = requireAbsoluteCwd(cwdRaw)
  const ref = requireRef(refRaw)
  const path = requireRepoPath(pathRaw)
  const repo: RepoValue | undefined = await detectRepoCached(cwd, Date.now())
  if (repo === undefined) {
    throw new PrInboxError('当前工作区没有可识别的 forge 项目', 'no-repo', 404)
  }
  if (repo.host !== 'github.com') {
    throw new PrInboxError(`图片代理当前只支持 github.com（这个工作区绑定的是 ${repo.host}）`, 'unsupported-host', 501)
  }
  const key = `${repo.fullName}@${ref}:${path}`
  const hit = cacheTake(key, Date.now())
  if (hit !== undefined) return { ...hit, fullName: repo.fullName, cached: true }
  const pending = inflight.get(key)
  if (pending !== undefined) return { ...await pending, fullName: repo.fullName, cached: false }
  const promise = fetchImage(repo.fullName, ref, path).then((value) => {
    cachePut(key, value)
    inflight.delete(key)
    return value
  }, (error: unknown) => {
    inflight.delete(key)
    throw error
  })
  inflight.set(key, promise)
  return { ...await promise, fullName: repo.fullName, cached: false }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** `GET` 字节路由：成功回真实字节，失败回与 `/api` 同形的 JSON 信封。 */
export async function imageHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '只用 GET' } })
      return
    }
    if (!isSameOrigin(req)) {
      sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '跨站请求被拒绝' } })
      return
    }
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const value = await resolveImage(url.searchParams.get('cwd'), url.searchParams.get('ref'), url.searchParams.get('path'))
    const headers: Record<string, string> = {
      'content-type': value.mime,
      'content-length': String(value.bytes.length),
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    }
    // SVG 是唯一「能以图片身份携带脚本」的类型：<img> 里不执行，但右键
    // 「在新标签页打开图片」会变成同源顶层文档。sandbox + default-src 'none'
    // 让顶层文档也没有脚本与外部请求（图片子资源不受 CSP 影响）。
    if (value.mime === 'image/svg+xml') {
      headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    }
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : value.bytes)
  } catch (error) {
    if (error instanceof PrInboxError) {
      sendJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 500, { ok: false, error: { code: 'internal', message } })
  }
}