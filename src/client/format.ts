/**
 * 展示层的纯函数：相对时间、日期、搜索匹配。抽出来是为了单测能钉住口径
 * （列表里那个「3 天前」不该随 locale 飘）。
 */

/** GitHub 给的是 ISO 8601 UTC；解析失败返回 undefined 而不是 NaN 时间。 */
function timeOf(iso: string): number | undefined {
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : undefined
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 相对时间：刚刚 / n 分钟前 / n 小时前 / n 天前 / n 个月前 / n 年前。 */
export function formatAge(iso: string, now = Date.now()): string {
  const time = timeOf(iso)
  if (time === undefined) return ''
  const delta = now - time
  if (delta < 0) return '刚刚'
  if (delta < MINUTE) return '刚刚'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} 分钟前`
  if (delta < DAY) return `${Math.floor(delta / HOUR)} 小时前`
  const days = Math.floor(delta / DAY)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(days / 365)} 年前`
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