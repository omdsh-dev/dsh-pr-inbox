import { describe, expect, it } from 'vitest'
import { classifyGhFailure, PrInboxError } from '../src/host/gh'

describe('classifyGhFailure', () => {
  it('maps the unauthenticated family to 401', () => {
    for (const detail of [
      'To get started with GitHub CLI, please run: gh auth login',
      'gh: not logged in',
      'HTTP 401: Bad credentials',
      'authentication required',
      // GitHub Actions 里 gh 检测到 GITHUB_ACTIONS 时会换一句提示（不是 gh auth login）。
      'gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.',
    ]) {
      const error = classifyGhFailure(detail)
      expect(error.code, detail).toBe('gh-unauthenticated')
      expect(error.status, detail).toBe(401)
    }
  })

  it('maps rate limiting to 429', () => {
    for (const detail of ['API rate limit exceeded for user ID 1', 'HTTP 403: rate limit']) {
      const error = classifyGhFailure(detail)
      expect(error.code).toBe('gh-rate-limit')
      expect(error.status).toBe(429)
    }
  })

  it('maps unknown resources to 404', () => {
    const error = classifyGhFailure('GraphQL: Could not resolve to a Repository with the name nope')
    expect(error.code).toBe('not-found')
    expect(error.status).toBe(404)
  })

  it('falls back to a 502 with the collapsed detail text', () => {
    const error = classifyGhFailure('some\n  unexpected   failure')
    expect(error.code).toBe('gh-error')
    expect(error.status).toBe(502)
    expect(error.message).toBe('some unexpected failure')
  })

  it('always produces a non-empty message', () => {
    expect(classifyGhFailure('   ').message).toBe('gh 命令失败')
    expect(classifyGhFailure('').message).toBe('gh 命令失败')
  })

  it('is a PrInboxError so the route layer can read status and code', () => {
    expect(classifyGhFailure('HTTP 404')).toBeInstanceOf(PrInboxError)
  })
})