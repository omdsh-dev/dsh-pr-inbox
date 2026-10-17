import { describe, expect, it } from 'vitest'
import { isSameOrigin } from '../src/host/trust'
import type { IncomingMessage } from 'node:http'

const req = (headers: Record<string, string>): IncomingMessage => ({ headers } as unknown as IncomingMessage)

describe('isSameOrigin', () => {
  it('allows requests without an Origin header (curl / same-origin GET images)', () => {
    expect(isSameOrigin(req({ host: '127.0.0.1:3080' }))).toBe(true)
  })

  it('allows a matching Origin and rejects a foreign one', () => {
    expect(isSameOrigin(req({ origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' }))).toBe(true)
    expect(isSameOrigin(req({ origin: 'http://evil.example', host: '127.0.0.1:3080' }))).toBe(false)
  })

  it('rejects missing/invalid Origin hosts instead of throwing', () => {
    expect(isSameOrigin(req({ origin: 'http://127.0.0.1:3080' }))).toBe(false)
    expect(isSameOrigin(req({ origin: 'not a url', host: '127.0.0.1:3080' }))).toBe(false)
  })
})
