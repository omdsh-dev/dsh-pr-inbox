/**
 * 错误码 → 当前语言的文案。
 *
 * host 侧的错误 `message` 是**排查用的原始信息**（常常是 gh 的英文 stderr，或
 * 我们自己的中文兜底）；用户界面显示的是按 `code` 翻好的短句。未知码才回退到
 * 原始 message——这样英文宿主里不会再出现中文的「gh 未登录」。
 */
import type { I18n } from './i18n'

const ERROR_KEYS: Record<string, string> = {
  'gh-missing': 'errGhMissing',
  'gh-unauthenticated': 'errGhUnauthenticated',
  'gh-rate-limit': 'errGhRateLimit',
  'gh-timeout': 'errGhTimeout',
  'not-found': 'errNotFound',
  'gh-bad-output': 'errGhBadOutput',
  'gh-error': 'errGhFailed',
  'bad-request': 'errBadRequest',
  'unsupported-host': 'errUnsupportedHost',
  'no-repo': 'errNoRepo',
  'too-large': 'errTooLarge',
  'unsupported-type': 'errUnsupportedType',
  'method-not-allowed': 'errMethodNotAllowed',
  'unknown-op': 'errUnknownOp',
  internal: 'errInternal',
  forbidden: 'errForbidden',
}

const HINT_KEYS: Record<string, string> = {
  'gh-missing': 'hintGhMissing',
  'gh-unauthenticated': 'hintGhUnauthenticated',
  'gh-rate-limit': 'hintGhRateLimit',
  'gh-timeout': 'hintGhTimeout',
  'no-cwd': 'hintCwd',
}

export interface ErrorLike {
  code?: string
  message?: string | undefined
}

/** 已知错误码给人话；未知码回退到原始 message（通常已经是 gh 的英文原文）。 */
export function errorText(i18n: I18n, error: ErrorLike | undefined): string {
  if (error === undefined) return ''
  const code = error.code
  if (code !== undefined && Object.hasOwn(ERROR_KEYS, code)) return i18n.t(ERROR_KEYS[code]!)
  const message = error.message?.trim() ?? ''
  return message === '' ? i18n.t('errUnknown') : message
}

/** 可操作的下一步（装 gh / 登录 / 等配额 / 检查网络）；没有对应建议时返回 undefined。 */
export function hintFor(i18n: I18n, code: string | undefined): string | undefined {
  if (code === undefined || !Object.hasOwn(HINT_KEYS, code)) return undefined
  return i18n.t(HINT_KEYS[code]!)
}
