/**
 * 自有 host 路由：`POST /plugins/dsh-pr-inbox/api`，body `{ op, … }`，
 * 统一回 `{ ok: true, value }` / `{ ok: false, error: { code, message } }` 信封
 * （与 better-sidebar 的 `/sidebar/api/*` 同形，客户端只写一套取数代码）。
 *
 * 路由经 `ctx.webServer.register` 挂进 DSH 的 web 服务，卸载时随 fiber 撤销。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PrInboxError } from './gh'
import { detailOp, listOp, statusOp } from './ops'

export const ROUTE_PATH = '/plugins/dsh-pr-inbox/api'

/** body 上限：本插件的请求只有 op + cwd + 少量筛选参数，256 KiB 已是两个数量级的余量。 */
const BODY_LIMIT = 256 * 1024

interface WebServerRoute {
  kind: 'exact'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

interface WebServerService {
  register(route: WebServerRoute): () => void
}

type OpHandler = (payload: Record<string, unknown>) => Promise<unknown>

/** op 表：每个 op 只做「校验入参 → 取数 → 返回可 JSON 化的值」。 */
const OPS: Record<string, OpHandler> = {
  status: statusOp,
  list: listOp,
  detail: detailOp,
}

function webServerOf(ctx: unknown): WebServerService | undefined {
  const get = (ctx as { get?: (name: string) => unknown }).get
  if (typeof get !== 'function') return undefined
  const service = get.call(ctx, 'webServer') as Partial<WebServerService> | undefined
  return typeof service?.register === 'function' ? service as WebServerService : undefined
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new PrInboxError('请求体过大', 'bad-request', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', (error) => { reject(error) })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text === '') { resolve({}); return }
      try {
        const parsed: unknown = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new PrInboxError('请求体必须是 JSON 对象', 'bad-request', 400))
          return
        }
        resolve(parsed)
      } catch {
        reject(new PrInboxError('请求体不是合法 JSON', 'bad-request', 400))
      }
    })
  })
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '只用 POST' } })
      return
    }
    const payload = await readBody(req) as Record<string, unknown>
    const op = payload.op
    if (typeof op !== 'string' || op === '') {
      send(res, 400, { ok: false, error: { code: 'bad-request', message: '缺少 op' } })
      return
    }
    const handler = OPS[op]
    if (handler === undefined) {
      send(res, 400, { ok: false, error: { code: 'unknown-op', message: `未知 op：${op}` } })
      return
    }
    send(res, 200, { ok: true, value: await handler(payload) })
  } catch (error) {
    if (error instanceof PrInboxError) {
      send(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    send(res, 500, { ok: false, error: { code: 'internal', message } })
  }
}

/** 挂路由；返回 disposer（`ctx.effect` 的返回值）。webServer 缺席时安静降级。 */
export function registerRoutes(ctx: unknown): () => void {
  const server = webServerOf(ctx)
  if (server === undefined) return () => {}
  return server.register({ kind: 'exact', path: ROUTE_PATH, handler: (req, res) => { void handle(req, res) } })
}