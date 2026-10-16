/**
 * 浏览器侧取数：两条来源。
 *
 *  1. 本插件自己的 host 路由 `POST /plugins/dsh-pr-inbox/api`（跑 gh）；
 *  2. better-sidebar 的 `/sidebar/api/session.cwd`（拿会话权威 cwd，仅当
 *     `scope.cwd` 缺失时用）。
 *
 * 两条都走**相对路径 + 页面前缀**：`hostRouteUrl()` 用宿主同款传输基底
 * （桌面壳的 `__DSH_TRANSPORT__` 优先，回落 `document.baseURI`）解析，
 * 绝不写前导斜杠——反代把 GUI 挂在子路径时前导斜杠会甩掉前缀。
 */
import type { Context } from '@deepseek-ai/cordis'

interface RouteCapableService {
  features?: readonly string[]
  /** 宿主（better-sidebar）返回**绝对 URL**——注意是 `URL` 实例，不是字符串（实测）。 */
  hostRouteUrl?: (path: string) => string | URL
}

export interface Envelope<T> {
  ok?: boolean
  value?: T
  error?: { code?: string; message?: string }
}

export class RouteError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'RouteError'
  }
}

function serviceOf(ctx: Context): RouteCapableService {
  return (ctx as unknown as { betterSidebar?: RouteCapableService }).betterSidebar ?? {}
}

/**
 * 相对路径 → 绝对 URL（保留页面前缀）。
 *
 * 返回的可能是宿主给的 `URL` 实例（`fetch` 能用，字符串运算不行），所以要求字符串的
 * 调用方用 {@link absoluteHostUrl}。
 */
export function hostRouteUrl(ctx: Context, path: string): string | URL {
  const service = serviceOf(ctx)
  if (typeof service.hostRouteUrl === 'function' && service.features?.includes('hostRouteUrl') === true) {
    return service.hostRouteUrl(path)
  }
  return new URL(path, document.baseURI).href
}

/** 拿一个绝对 URL 基址：只认 http(s)——`<img>` 跨源加载不需要 CORS，所以桌面壳里用得上。 */
function httpBase(): string | undefined {
  const candidates = [
    typeof document === 'undefined' ? undefined : document.baseURI,
    (globalThis as { __DSH_TRANSPORT__?: { streamBaseUrl?: string } }).__DSH_TRANSPORT__?.streamBaseUrl,
  ]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === '') continue
    try {
      const protocol = new URL(candidate).protocol
      if (protocol === 'http:' || protocol === 'https:') return candidate
    } catch { /* 试下一个 */ }
  }
  return undefined
}

/**
 * **必须绝对**的 URL（图片用）：官方 markdown 渲染器只接受 `new URL(x)` 能解析、且协议是
 * `http` / `https` / `blob` / `data` 的地址（`vocabularyImageUrl`）——相对路径会被判成
 * "没有可显示的图"，正文里的图片于是退化成 alt 文本。
 *
 * 页面基址是 `http(s)` 时就用它（web 形态与反代前缀都对）；桌面壳的页面基址是
 * `dsh-app://app/`，那个协议**不在官方白名单里**（白名单只额外放行
 * `dsh-app://app/api/file?`），所以改用注入的传输基址——它正是宿主真实 origin，
 * 而 `<img>` 跨源取图不受同源策略限制（这也是它不能拿来做 fetch 的原因）。
 */
export function absoluteHostUrl(ctx: Context, path: string): string {
  const resolved = hostRouteUrl(ctx, path)
  const text = typeof resolved === 'string' ? resolved : resolved.href
  const base = httpBase()
  return base === undefined ? text : new URL(text, base).href
}

/** 调本插件自己的 host op。失败抛 `RouteError`（码原样带出，UI 可分辨 gh 缺失）。 */
export async function callOp<T>(ctx: Context, op: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(hostRouteUrl(ctx, 'plugins/dsh-pr-inbox/api'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, ...payload }),
  })
  let body: Envelope<T>
  try {
    body = await response.json() as Envelope<T>
  } catch {
    throw new RouteError(`PR 路由返回了非 JSON（HTTP ${response.status}）`)
  }
  if (body.ok !== true) {
    throw new RouteError(body.error?.message ?? `PR 路由失败（HTTP ${response.status}）`, body.error?.code)
  }
  return body.value as T
}

/** 会话权威 cwd：`scope.cwd` 优先，缺失时问 better-sidebar。 */
export async function resolveCwd(ctx: Context, sessionId: string, cwd: string | undefined): Promise<string | undefined> {
  if (typeof cwd === 'string' && cwd !== '') return cwd
  try {
    const response = await fetch(hostRouteUrl(ctx, 'sidebar/api/session.cwd'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    const body = await response.json() as Envelope<{ cwd?: string }>
    const resolved = body.value?.cwd
    return typeof resolved === 'string' && resolved !== '' ? resolved : undefined
  } catch {
    return undefined
  }
}