import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { ROUTE_PATH, registerRoutes } from '../src/host/routes'

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

/** 用假的 webServer 接住路由 handler；只测信封层，不真的跑 gh。 */
function harness(): { call: (body: string, headers?: Record<string, string>) => Promise<{ status: number, body: Record<string, unknown> }>, dispose: () => void } {
  let handler: Handler | undefined
  const ctx = {
    get: (name: string) => (name === 'webServer'
      ? {
          register: (route: { path: string, handler: Handler }) => {
            if (route.path === ROUTE_PATH) handler = route.handler
            return () => {}
          },
        }
      : undefined),
  }
  const dispose = registerRoutes(ctx)
  expect(handler).toBeDefined()
  return {
    call: (body, headers = {}) => new Promise((resolve) => {
      const req = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
      Object.assign(req, { method: 'POST', url: ROUTE_PATH, headers })
      const res = {
        status: 0,
        writeHead(status: number) { this.status = status; return this },
        end(text: string) { resolve({ status: this.status, body: JSON.parse(text) as Record<string, unknown> }) },
      }
      handler!(req, res as unknown as ServerResponse)
    }),
    dispose,
  }
}

describe('op table', () => {
  it('rejects prototype keys instead of calling them (constructor / __proto__)', async () => {
    const { call, dispose } = harness()
    for (const op of ['constructor', '__proto__', 'toString']) {
      const out = await call(JSON.stringify({ op, cwd: '/w/repo' }))
      expect(out.status, op).toBe(400)
      expect(out.body, op).toMatchObject({ ok: false, error: { code: 'unknown-op' } })
    }
    dispose()
  })

  it('rejects a cross-site Origin before parsing the body', async () => {
    const { call, dispose } = harness()
    const out = await call(JSON.stringify({ op: 'list', cwd: '/w/repo' }), {
      origin: 'http://evil.example', host: '127.0.0.1:3080',
    })
    expect(out.status).toBe(403)
    expect(out.body).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    dispose()
  })

  it('allows a same-origin request through to the op table', async () => {
    const { call, dispose } = harness()
    const out = await call(JSON.stringify({ op: 'constructor', cwd: '/w/repo' }), {
      origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080',
    })
    expect(out.status).toBe(400)
    expect(out.body).toMatchObject({ ok: false, error: { code: 'unknown-op' } })
    dispose()
  })
})
