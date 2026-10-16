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
  hostRouteUrl?: (path: string) => string
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

/** 相对路径 → 绝对 URL（保留页面前缀）。 */
export function hostRouteUrl(ctx: Context, path: string): string {
  const service = serviceOf(ctx)
  if (typeof service.hostRouteUrl === 'function' && service.features?.includes('hostRouteUrl') === true) {
    return service.hostRouteUrl(path)
  }
  return new URL(path, document.baseURI).href
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