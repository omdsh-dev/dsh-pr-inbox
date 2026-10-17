import { describe, expect, it } from 'vitest'
import { ageParts, ageText, formatDate, matchesQuery, sortRowsForBucket } from '../src/client/format'
import type { PrRow } from '../src/shared/types'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const ago = (ms: number): string => new Date(NOW - ms).toISOString()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 假翻译器：把 key/参数原样拼出来，证明 format 层不再携带任何语言文案。 */
const tf = (key: string, params?: Record<string, string | number>): string =>
  params === undefined ? key : `${key}:${String(params.n)}`

describe('ageParts', () => {
  it('collapses anything under a minute (and the future) to justNow', () => {
    expect(ageParts(ago(0), NOW)).toEqual({ key: 'justNow' })
    expect(ageParts(ago(59_000), NOW)).toEqual({ key: 'justNow' })
    expect(ageParts(new Date(NOW + HOUR).toISOString(), NOW)).toEqual({ key: 'justNow' })
  })

  it('steps through minutes / hours / days / months / years', () => {
    expect(ageParts(ago(5 * MINUTE), NOW)).toEqual({ key: 'minutesAgo', value: 5 })
    expect(ageParts(ago(3 * HOUR), NOW)).toEqual({ key: 'hoursAgo', value: 3 })
    expect(ageParts(ago(4 * DAY), NOW)).toEqual({ key: 'daysAgo', value: 4 })
    expect(ageParts(ago(60 * DAY), NOW)).toEqual({ key: 'monthsAgo', value: 2 })
    expect(ageParts(ago(800 * DAY), NOW)).toEqual({ key: 'yearsAgo', value: 2 })
  })

  it('returns undefined for an unparseable timestamp instead of NaN text', () => {
    expect(ageParts('', NOW)).toBeUndefined()
    expect(ageParts('not a date', NOW)).toBeUndefined()
  })
})

describe('ageText', () => {
  it('hands the unit to the translator — no Chinese or English literals live here', () => {
    expect(ageText(tf, ago(0), NOW)).toBe('justNow')
    expect(ageText(tf, ago(5 * MINUTE), NOW)).toBe('minutesAgo:5')
    expect(ageText(tf, ago(3 * HOUR), NOW)).toBe('hoursAgo:3')
    expect(ageText(tf, ago(800 * DAY), NOW)).toBe('yearsAgo:2')
    expect(ageText(tf, 'nope', NOW)).toBe('')
  })
})

describe('formatDate', () => {
  it('renders a zero-padded calendar date', () => {
    expect(formatDate('2026-01-05T03:00:00Z')).toMatch(/^2026-01-0[45]$/)
    expect(formatDate('nope')).toBe('')
  })
})

describe('sortRowsForBucket', () => {
  const row = (number: number, mergedAt: string | undefined, updatedAt: string): PrRow => ({
    number,
    title: `#${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    author: 'vlln',
    isDraft: false,
    state: 'closed',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt,
    ...(mergedAt === undefined ? {} : { mergedAt }),
    labels: [],
    comments: 0,
  })

  it('orders the merged bucket by merge time, newest first', () => {
    const rows = [
      row(1, '2026-10-01T00:00:00Z', '2026-10-16T00:00:00Z'),
      row(2, '2026-10-10T00:00:00Z', '2026-10-10T00:00:00Z'),
      row(3, '2026-10-05T00:00:00Z', '2026-10-15T00:00:00Z'),
    ]
    expect(sortRowsForBucket('merged', rows).map(item => item.number)).toEqual([2, 3, 1])
    // 不改调用方的数组。
    expect(rows.map(item => item.number)).toEqual([1, 2, 3])
  })

  it('leaves the other buckets in upstream order', () => {
    const rows = [row(1, undefined, '2026-10-01T00:00:00Z'), row(2, undefined, '2026-10-16T00:00:00Z')]
    expect(sortRowsForBucket('authored', rows).map(item => item.number)).toEqual([1, 2])
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
