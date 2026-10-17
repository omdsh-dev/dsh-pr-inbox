import { describe, expect, it } from 'vitest'
import { errorText, hintFor } from '../src/client/errors'
import type { I18n } from '../src/client/i18n'

const i18n: I18n = {
  t: (key: string) => `t:${key}`,
  tf: (key: string, params?: Record<string, string | number>) => (params === undefined ? `t:${key}` : `t:${key}:${JSON.stringify(params)}`),
  dispose: () => {},
}

describe('errorText', () => {
  it('maps known codes to localized keys instead of leaking the host message', () => {
    expect(errorText(i18n, { code: 'gh-missing', message: '未找到 gh CLI（请安装…）' })).toBe('t:errGhMissing')
    expect(errorText(i18n, { code: 'gh-error', message: 'gh 命令失败' })).toBe('t:errGhFailed')
    expect(errorText(i18n, { code: 'forbidden', message: '跨站请求被拒绝' })).toBe('t:errForbidden')
  })

  it('falls back to the raw message for unknown codes (usually English gh stderr)', () => {
    expect(errorText(i18n, { message: 'HTTP 500: Something went wrong' })).toBe('HTTP 500: Something went wrong')
    expect(errorText(i18n, { code: 'some-new-code', message: 'detail' })).toBe('detail')
  })

  it('never returns an empty string for an unknown failure', () => {
    expect(errorText(i18n, {})).toBe('t:errUnknown')
    expect(errorText(i18n, { message: '   ' })).toBe('t:errUnknown')
  })
})

describe('hintFor', () => {
  it('gives an actionable next step for known codes only', () => {
    expect(hintFor(i18n, 'gh-missing')).toBe('t:hintGhMissing')
    expect(hintFor(i18n, 'no-cwd')).toBe('t:hintCwd')
    expect(hintFor(i18n, 'not-found')).toBeUndefined()
    expect(hintFor(i18n, undefined)).toBeUndefined()
  })
})
