import { describe, expect, it } from 'vitest'
import { formatAge, formatDate, matchesQuery } from '../src/client/format'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const ago = (ms: number): string => new Date(NOW - ms).toISOString()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatAge', () => {
  it('collapses anything under a minute (and the future) to 刚刚', () => {
    expect(formatAge(ago(0), NOW)).toBe('刚刚')
    expect(formatAge(ago(59_000), NOW)).toBe('刚刚')
    expect(formatAge(new Date(NOW + HOUR).toISOString(), NOW)).toBe('刚刚')
  })

  it('steps through minutes / hours / days / months / years', () => {
    expect(formatAge(ago(5 * MINUTE), NOW)).toBe('5 分钟前')
    expect(formatAge(ago(3 * HOUR), NOW)).toBe('3 小时前')
    expect(formatAge(ago(4 * DAY), NOW)).toBe('4 天前')
    expect(formatAge(ago(60 * DAY), NOW)).toBe('2 个月前')
    expect(formatAge(ago(800 * DAY), NOW)).toBe('2 年前')
  })

  it('returns an empty string for an unparseable timestamp instead of NaN text', () => {
    expect(formatAge('', NOW)).toBe('')
    expect(formatAge('not a date', NOW)).toBe('')
  })
})

describe('formatDate', () => {
  it('renders a zero-padded calendar date', () => {
    expect(formatDate('2026-01-05T03:00:00Z')).toMatch(/^2026-01-0[45]$/)
    expect(formatDate('nope')).toBe('')
  })
})

describe('matchesQuery', () => {
  const row = { number: 969, title: 'feat(git-graph): 只读提交图', author: 'vlln', labels: ['enhancement', 'sidebar'] }

  it('matches everything on an empty query', () => {
    expect(matchesQuery(row, '')).toBe(true)
    expect(matchesQuery(row, '   ')).toBe(true)
  })

  it('matches the number with or without the leading hash', () => {
    expect(matchesQuery(row, '969')).toBe(true)
    expect(matchesQuery(row, '#969')).toBe(true)
    expect(matchesQuery(row, '#96')).toBe(true)
    expect(matchesQuery(row, '968')).toBe(false)
  })

  it('matches title / author / label case-insensitively', () => {
    expect(matchesQuery(row, 'GIT-GRAPH')).toBe(true)
    expect(matchesQuery(row, 'VLLN')).toBe(true)
    expect(matchesQuery(row, 'Sidebar')).toBe(true)
    expect(matchesQuery(row, 'nope')).toBe(false)
  })
})