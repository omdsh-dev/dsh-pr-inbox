/**
 * 三桶 PR 的取数层。
 *
 * 三桶都用**同一套 REST 搜索**（`gh api -X GET search/issues`）而不是
 * `gh search prs`：搜索接口回 `total_count`（桶头的计数角标要它），
 * 且 `is:merged` 这类限定词能直接写进 q（`gh search prs --state` 不认 merged）。
 *
 * 三条查询彼此独立：某一条失败（限流、超时）只让**那个桶**带 error，
 * 另外两桶照常出数据——面板因此不会因为一次 403 变成空白页。
 */
import { PrInboxError, ghJson, probeGh } from './gh'
import { detectRepo, requireAbsoluteCwd } from './repo'
import type { BucketKey, BucketValue, ListValue, PrRow } from '../shared/types'

/** 一页取多少行（桶头的 total 是命中总数，不受它限制）。 */
const PAGE_SIZE = 30
/** 「我合并的」按更新时间倒序取多少条（搜索接口只能按 updated 取一页）。 */
export const MERGED_LIMIT = 20
/** 列表缓存 60 s：搜索配额 30 次/分，一次刷新 3 条查询——这个 TTL 下反复切 tab 也安全。 */
const CACHE_TTL_MS = 60_000
/** 缓存条目上限（按仓库 × 桶），淘汰最旧的；模块级表必须有界。 */
const CACHE_MAX = 12

export interface BucketQuery {
  key: BucketKey
  /** GitHub 搜索限定词串。 */
  q: string
  /** 这一桶取多少行。 */
  limit: number
}

/** 三个桶的查询（纯函数：给定 owner/repo 产出限定词，便于单测锁定语义）。
 *
 * 「我合并的」限定 `author:@me`：这一桶回答的是「我刚做的事落地没有」，
 * 不是「仓库最近合并了什么」。仓库全局的合并流会把这一桶变成别人的时间线。
 */
export function bucketQueries(repo: string): BucketQuery[] {
  return [
    { key: 'authored', q: `repo:${repo} is:pr is:open author:@me`, limit: PAGE_SIZE },
    { key: 'review', q: `repo:${repo} is:pr is:open review-requested:@me`, limit: PAGE_SIZE },
    { key: 'merged', q: `repo:${repo} is:pr is:merged author:@me`, limit: MERGED_LIMIT },
  ]
}

/** `search/issues` 里我们用到的那几个字段（宽松类型：上游字段缺失时归一化会挡）。 */
interface SearchItem {
  number?: unknown
  title?: unknown
  html_url?: unknown
  user?: { login?: unknown; avatar_url?: unknown }
  draft?: unknown
  state?: unknown
  created_at?: unknown
  updated_at?: unknown
  labels?: unknown
  comments?: unknown
  pull_request?: { merged_at?: unknown }
}

/** 一条搜索结果 → 一行 PR。缺关键字段就丢弃（上游形状变化时不产出半条脏行）。 */
export function normalizeSearchItem(item: SearchItem): PrRow | undefined {
  const number = item.number
  const title = item.title
  const url = item.html_url
  if (typeof number !== 'number' || typeof title !== 'string' || typeof url !== 'string') return undefined
  const labels = Array.isArray(item.labels)
    ? item.labels
      .map(label => (typeof label === 'object' && label !== null ? (label as { name?: unknown }).name : undefined))
      .filter((name): name is string => typeof name === 'string' && name !== '')
    : []
  const mergedAt = item.pull_request?.merged_at
  const avatar = item.user?.avatar_url
  return {
    number,
    title,
    url,
    author: typeof item.user?.login === 'string' ? item.user.login : '',
    ...(typeof avatar === 'string' && avatar !== '' ? { authorAvatar: avatar } : {}),
    isDraft: item.draft === true,
    state: typeof item.state === 'string' ? item.state : 'open',
    createdAt: typeof item.created_at === 'string' ? item.created_at : '',
    updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
    ...(typeof mergedAt === 'string' ? { mergedAt } : {}),
    labels,
    comments: typeof item.comments === 'number' ? item.comments : 0,
  }
}

interface SearchResponse {
  total_count?: unknown
  items?: unknown
}

/** 一桶的抓取结果（缓存的是它，不含错误——错误永不入缓存）。 */
interface BucketData {
  total: number
  rows: PrRow[]
}

const cache = new Map<string, { expires: number; value: BucketData }>()
const inflight = new Map<string, Promise<BucketData>>()

/** 测试与 dispose 用：清空缓存与在飞表。 */
export function resetPrCache(): void {
  cache.clear()
  inflight.clear()
}

function cached(key: string, now: number): BucketData | undefined {
  const hit = cache.get(key)
  if (hit === undefined) return undefined
  if (hit.expires <= now) {
    cache.delete(key)
    return undefined
  }
  // 命中即刷新 LRU 位置（Map 的插入序就是淘汰序）。
  cache.delete(key)
  cache.set(key, hit)
  return hit.value
}

function remember(key: string, value: BucketData, now: number): void {
  cache.set(key, { expires: now + CACHE_TTL_MS, value })
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** 真取一桶。单飞：并发的同键请求共用一个 Promise。 */
async function fetchBucket(repo: string, query: BucketQuery, now: number): Promise<BucketData> {
  const key = `${repo}|${query.key}`
  const hit = cached(key, now)
  if (hit !== undefined) return hit
  const pending = inflight.get(key)
  if (pending !== undefined) return pending
  const promise = ghJson<SearchResponse>([
    'api', '-X', 'GET', 'search/issues',
    '-f', `q=${query.q}`,
    '-f', `per_page=${query.limit}`,
    '-f', 'sort=updated',
    '-f', 'order=desc',
  ]).then((response) => {
    const items = Array.isArray(response.items) ? response.items as SearchItem[] : []
    const rows = items.map(normalizeSearchItem).filter((row): row is PrRow => row !== undefined)
    const total = typeof response.total_count === 'number' ? response.total_count : rows.length
    const data: BucketData = { total, rows }
    remember(key, data, Date.now())
    inflight.delete(key)
    return data
  }, (error: unknown) => {
    inflight.delete(key)
    throw error
  })
  inflight.set(key, promise)
  return promise
}

function errorOf(error: unknown): { code?: string; message: string } {
  if (error instanceof PrInboxError) {
    return error.code === '' ? { message: error.message } : { code: error.code, message: error.message }
  }
  return { message: error instanceof Error ? error.message : String(error) }
}

/** 三桶并发取数；单桶失败只影响那一桶。 */
export async function listOp(payload: Record<string, unknown>): Promise<ListValue> {
  const cwd = requireAbsoluteCwd(payload.cwd)
  const [gh, repo] = await Promise.all([probeGh(), detectRepo(cwd)])
  const fetchedAt = new Date().toISOString()
  const empty: BucketValue = { total: 0, rows: [] }
  const buckets: Record<BucketKey, BucketValue> = { authored: empty, review: empty, merged: empty }
  if (repo === undefined || repo === null) {
    return { repo: null, gh, fetchedAt, buckets }
  }
  if (repo.host !== 'github.com') {
    return {
      repo, gh, fetchedAt, buckets,
      note: `当前只支持 github.com（这个工作区绑定的是 ${repo.host}）`,
    }
  }
  const now = Date.now()
  await Promise.all(bucketQueries(repo.fullName).map(async (query) => {
    try {
      const data = await fetchBucket(repo.fullName, query, now)
      buckets[query.key] = { total: data.total, rows: data.rows }
    } catch (error) {
      buckets[query.key] = { total: 0, rows: [], error: errorOf(error) }
    }
  }))
  return { repo, gh, fetchedAt, buckets }
}