/**
 * 展示层的纯函数：相对时间、日期、搜索匹配、合并桶排序。
 *
 * 这里**不写任何用户可见文案**：相对时间产出「单位 + 数字」，文案由 i18n 字典给
 * （`ageText(tf, …)`）。这样同一个函数在中文/英文宿主下都不会漏出对方语言。
 */
import type { BucketKey, PrRow } from '../shared/types'

/** 与 `I18n.tf` 同形；format 层只依赖这个最小面，不依赖整个 i18n 对象。 */
export type Translate = (key: string, params?: Record<string, string | number>) => string
/** GitHub 给的是 ISO 8601 UTC；解析失败返回 undefined 而不是 NaN 时间。 */
function timeOf(iso: string): number | undefined {
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : undefined
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export type AgeUnit = 'justNow' | 'minutesAgo' | 'hoursAgo' | 'daysAgo' | 'monthsAgo' | 'yearsAgo'

/** 相对时间的**语义**部分：字典键 + 数字（`justNow` 没有数字）。 */
export interface AgeParts {
  key: AgeUnit
  value?: number
}

/** 把 ISO 时间归到字典键；解析失败返回 undefined（调用方回空串，不显示 NaN）。 */
export function ageParts(iso: string, now = Date.now()): AgeParts | undefined {
  const time = timeOf(iso)
  if (time === undefined) return undefined
  const delta = now - time
  if (delta < MINUTE) return { key: 'justNow' }
  if (delta < HOUR) return { key: 'minutesAgo', value: Math.floor(delta / MINUTE) }
  if (delta < DAY) return { key: 'hoursAgo', value: Math.floor(delta / HOUR) }
  const days = Math.floor(delta / DAY)
  if (days < 30) return { key: 'daysAgo', value: days }
  const months = Math.floor(days / 30)
  if (months < 12) return { key: 'monthsAgo', value: months }
  return { key: 'yearsAgo', value: Math.floor(days / 365) }
}

/** 相对时间 → 当前语言的文案（中文「3 天前」/ 英文「3 days ago」）。 */
export function ageText(tf: Translate, iso: string, now = Date.now()): string {
  const parts = ageParts(iso, now)
  if (parts === undefined) return ''
  return parts.value === undefined ? tf(parts.key) : tf(parts.key, { n: parts.value })
}

/**
 * 头像 URL（host 的 list / detail 提供 `authorAvatar`）。
 *
 * 用结构化读取而不是直接读字段：头像字段由 host 车道并行加入，这里先按「有就渲染、
 * 没有就只显示名字」处理，两边不必抢同一个类型文件的编辑权。
 */
export function avatarUrlOf(value: unknown): string | undefined {
  const avatar = (value as { authorAvatar?: unknown } | null | undefined)?.authorAvatar
  return typeof avatar === 'string' && avatar !== '' ? avatar : undefined
}

/** 是否在最近 `days` 天内动过——列表用它把「刚动过的行」提到第二层色阶。 */
export function isFresh(iso: string, days = 1, now = Date.now()): boolean {
  const time = timeOf(iso)
  if (time === undefined) return false
  return now - time <= days * DAY
}

/** 绝对日期（合并时间这类「已经定下来的事实」用日期而不是相对时间）。 */
export function formatDate(iso: string): string {
  const time = timeOf(iso)
  if (time === undefined) return ''
  const date = new Date(time)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 合并桶按**合并时间**倒序展示（搜索接口只能按 updated 取一页；取回之后
 * 在本地按 mergedAt 排一次，避免「刚合并但没再更新」的 PR 被压到下面）。
 * 其它桶保持上游 updated 顺序；返回新数组，不改调用方的数据。
 */
export function sortRowsForBucket(bucket: BucketKey, rows: readonly PrRow[]): PrRow[] {
  if (bucket !== 'merged') return [...rows]
  const at = (row: PrRow): number => {
    const parsed = Date.parse(row.mergedAt ?? row.updatedAt)
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
  }
  return [...rows].sort((left, right) => at(right) - at(left))
}

/** 搜索框匹配：编号（可带 #）、标题、作者、标签，大小写不敏感。 */
export function matchesQuery(row: {
  number: number
  title: string
  author: string
  labels: readonly string[]
}, raw: string): boolean {
  const query = raw.trim().toLowerCase()
  if (query === '') return true
  const needle = query.startsWith('#') ? query.slice(1) : query
  if (String(row.number).includes(needle)) return true
  if (row.title.toLowerCase().includes(query)) return true
  if (row.author.toLowerCase().includes(query)) return true
  return row.labels.some(label => label.toLowerCase().includes(query))
}
