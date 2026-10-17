/**
 * 单个 PR 的详情取数（面板自己渲染：正文 / 时间线 / 文件清单）。
 *
 * 一条主查询 + 三条支线：
 *   pulls/{n}                    主：身份、正文、统计、分支、标签（失败即整体失败）
 *   pulls/{n}/files              支线：改动文件（**有界**取一页）
 *   issues/{n}/comments          支线：issue 评论
 *   pulls/{n}/reviews            支线：review（含状态与正文）
 *
 * 支线失败**不**让详情变空白：已取到的部分照常返回，失败原因进 `warnings`。
 * 所有文本都有上限（正文 64 KiB、单条评论 8 KiB），返回值因此有界。
 */
import { PrInboxError, ghJson } from './gh'
import { detectRepo, requireAbsoluteCwd } from './repo'
import type { PrDetailComment, PrDetailFile, PrDetailValue, PrDetailWarning, RepoValue } from '../shared/types'

/** 文件与时间线各取一页（配合 PR 上的总数给出截断标记）。 */
const FILES_PAGE = 100
const COMMENTS_PAGE = 50
const REVIEWS_PAGE = 50
/** 正文 / 单条评论正文的上限（面板渲染成本与响应体积都有界）。 */
const BODY_CAP = 64 * 1024
const COMMENT_CAP = 8 * 1024
/** 详情缓存 30 s：同一 PR 反复点开不重复打 API。 */
const CACHE_TTL_MS = 30_000
const CACHE_MAX = 8

/** PR 编号必须是正整数（客户端输入，词法校验挡掉 0 / 负数 / 小数 / 字符串）。 */
export function requirePullNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new PrInboxError('需要合法的 PR 编号', 'bad-request', 400)
  }
  return value
}

/** 截断文本并如实报告（绝不静默截断）。**不切开代理对**（否则尾部会变成 U+FFFD）。 */
export function capText(text: string, cap = BODY_CAP): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false }
  let end = cap
  const last = text.charCodeAt(end - 1)
  if (last >= 0xD800 && last <= 0xDBFF) end -= 1
  return { text: text.slice(0, end), truncated: true }
}

interface PullPayload {
  number?: unknown
  title?: unknown
  body?: unknown
  html_url?: unknown
  user?: { login?: unknown; avatar_url?: unknown }
  state?: unknown
  draft?: unknown
  created_at?: unknown
  updated_at?: unknown
  merged_at?: unknown
  additions?: unknown
  deletions?: unknown
  changed_files?: unknown
  commits?: unknown
  comments?: unknown
  review_comments?: unknown
  mergeable_state?: unknown
  labels?: unknown
  head?: { ref?: unknown }
  base?: { ref?: unknown }
}

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** 作者头像 URL：只接受非空字符串，缺失/空串就**不产出该键**
 *  （与 mergedAt / previousPath 同一风格，渲染方自己回退占位）。 */
function avatarOf(user: unknown): { authorAvatar?: string } {
  const url = (user as { avatar_url?: unknown } | undefined)?.avatar_url
  return typeof url === 'string' && url !== '' ? { authorAvatar: url } : {}
}

function labelNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(label => (typeof label === 'object' && label !== null ? (label as { name?: unknown }).name : undefined))
    .filter((name): name is string => typeof name === 'string' && name !== '')
}

/** `pulls/{n}` → 详情骨架。缺 number/title 视为上游形状异常（返回 undefined）。 */
export function normalizePull(raw: PullPayload): Omit<PrDetailValue, 'repo' | 'files' | 'filesTruncated' | 'timeline' | 'timelineTruncated' | 'warnings' | 'fetchedAt'> | undefined {
  const number = raw.number
  const title = raw.title
  if (typeof number !== 'number' || typeof title !== 'string') return undefined
  const body = capText(str(raw.body))
  const mergedAt = raw.merged_at
  const mergeableState = str(raw.mergeable_state)
  return {
    number,
    title,
    body: body.text,
    bodyTruncated: body.truncated,
    url: str(raw.html_url),
    author: str(raw.user?.login),
    ...avatarOf(raw.user),
    state: str(raw.state, 'open'),
    isDraft: raw.draft === true,
    createdAt: str(raw.created_at),
    updatedAt: str(raw.updated_at),
    ...(typeof mergedAt === 'string' && mergedAt !== '' ? { mergedAt } : {}),
    baseRef: str(raw.base?.ref),
    headRef: str(raw.head?.ref),
    labels: labelNames(raw.labels),
    additions: num(raw.additions),
    deletions: num(raw.deletions),
    changedFiles: num(raw.changed_files),
    commits: num(raw.commits),
    comments: num(raw.comments),
    reviewComments: num(raw.review_comments),
    ...(mergeableState === '' ? {} : { mergeableState }),
  }
}

/** `pulls/{n}/files` 的一行。 */
export function normalizeFile(raw: Record<string, unknown>): PrDetailFile | undefined {
  const path = raw.filename
  if (typeof path !== 'string' || path === '') return undefined
  const previous = str(raw.previous_filename)
  return {
    path,
    status: str(raw.status, 'modified'),
    additions: num(raw.additions),
    deletions: num(raw.deletions),
    ...(previous === '' ? {} : { previousPath: previous }),
  }
}

/** `issues/{n}/comments` 的一条。 */
export function normalizeIssueComment(raw: Record<string, unknown>): PrDetailComment | undefined {
  const rawBody = raw.body
  if (typeof rawBody !== 'string') return undefined
  const capped = capText(rawBody, COMMENT_CAP)
  return {
    kind: 'comment',
    author: str((raw.user as { login?: unknown } | undefined)?.login),
    ...avatarOf(raw.user),
    createdAt: str(raw.created_at),
    body: capped.truncated ? `${capped.text}\n\n…（本条评论过长，已截断）` : capped.text,
  }
}

/** `pulls/{n}/reviews` 的一条。 */
export function normalizeReview(raw: Record<string, unknown>): PrDetailComment | undefined {
  const state = str(raw.state)
  if (state === '') return undefined
  const capped = capText(str(raw.body), COMMENT_CAP)
  return {
    kind: 'review',
    author: str((raw.user as { login?: unknown } | undefined)?.login),
    ...avatarOf(raw.user),
    createdAt: str(raw.submitted_at ?? raw.created_at),
    body: capped.text,
    reviewState: state,
  }
}

/** 评论 + review 合成一条按时间升序的时间线。无法解析的时间排到最后（而不是打乱顺序）。 */
export function mergeTimeline(comments: PrDetailComment[], reviews: PrDetailComment[]): PrDetailComment[] {
  const timeOf = (iso: string): number => {
    const parsed = Date.parse(iso)
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
  }
  return [...comments, ...reviews].sort((left, right) => timeOf(left.createdAt) - timeOf(right.createdAt))
}

interface CacheEntry { expires: number; value: PrDetailValue }
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<PrDetailValue>>()

/** 测试与 dispose 用。 */
export function resetDetailCache(): void {
  cache.clear()
  inflight.clear()
}

async function loadDetail(repo: RepoValue, number: number): Promise<PrDetailValue> {
  const base = `repos/${repo.owner}/${repo.name}`
  const pull = await ghJson<PullPayload>(['api', `${base}/pulls/${number}`])
  const skeleton = normalizePull(pull)
  if (skeleton === undefined) {
    throw new PrInboxError('上游返回的 PR 形状不完整', 'gh-bad-output', 502)
  }
  const warnings: PrDetailWarning[] = []
  const [files, comments, reviews] = await Promise.all([
    ghJson<unknown>(['api', '-X', 'GET', `${base}/pulls/${number}/files`, '-f', `per_page=${FILES_PAGE}`])
      .then(raw => (Array.isArray(raw) ? raw as Record<string, unknown>[] : []))
      .catch((error: unknown) => { warnings.push(warningOf('files', error)); return [] as Record<string, unknown>[] }),
    ghJson<unknown>(['api', '-X', 'GET', `${base}/issues/${number}/comments`, '-f', `per_page=${COMMENTS_PAGE}`])
      .then(raw => (Array.isArray(raw) ? raw as Record<string, unknown>[] : []))
      .catch((error: unknown) => { warnings.push(warningOf('comments', error)); return [] as Record<string, unknown>[] }),
    ghJson<unknown>(['api', '-X', 'GET', `${base}/pulls/${number}/reviews`, '-f', `per_page=${REVIEWS_PAGE}`])
      .then(raw => (Array.isArray(raw) ? raw as Record<string, unknown>[] : []))
      .catch((error: unknown) => { warnings.push(warningOf('reviews', error)); return [] as Record<string, unknown>[] }),
  ])

  const normalizedFiles = files.map(normalizeFile).filter((file): file is PrDetailFile => file !== undefined)
  const timeline = mergeTimeline(
    comments.map(normalizeIssueComment).filter((row): row is PrDetailComment => row !== undefined),
    reviews.map(normalizeReview).filter((row): row is PrDetailComment => row !== undefined),
  )
  return {
    ...skeleton,
    repo,
    files: normalizedFiles,
    filesTruncated: normalizedFiles.length < skeleton.changedFiles,
    timeline,
    // 评论侧总数用 PR 上的 `comments`；review 侧没有总数，只能按页满判断。
    timelineTruncated: timeline.length < skeleton.comments || reviews.length >= REVIEWS_PAGE,
    warnings,
    fetchedAt: new Date().toISOString(),
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 支线失败 → 可本地化的结构（分区名由客户端翻译，错误码让客户端挑人话）。 */
function warningOf(part: PrDetailWarning['part'], error: unknown): PrDetailWarning {
  const code = error instanceof PrInboxError && error.code !== '' ? error.code : undefined
  return { part, ...(code === undefined ? {} : { code }), message: messageOf(error) }
}

/** `detail`：给定 cwd + PR 编号，取回面板渲染所需的全部内容（有界 + 缓存）。 */
export async function detailOp(payload: Record<string, unknown>): Promise<PrDetailValue> {
  const cwd = requireAbsoluteCwd(payload.cwd)
  const number = requirePullNumber(payload.number)
  const repo = await detectRepo(cwd)
  if (repo === undefined) {
    throw new PrInboxError('当前工作区没有可识别的 forge 项目', 'no-repo', 404)
  }
  if (repo.host !== 'github.com') {
    throw new PrInboxError(`当前只支持 github.com（这个工作区绑定的是 ${repo.host}）`, 'unsupported-host', 501)
  }
  const key = `${repo.fullName}#${number}`
  const hit = cache.get(key)
  if (hit !== undefined && hit.expires > Date.now()) {
    // 命中即刷新 LRU 位置。
    cache.delete(key)
    cache.set(key, hit)
    return hit.value
  }
  const pending = inflight.get(key)
  if (pending !== undefined) return pending
  const promise = loadDetail(repo, number).then((value) => {
    cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value })
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    inflight.delete(key)
    return value
  }, (error: unknown) => {
    inflight.delete(key)
    throw error
  })
  inflight.set(key, promise)
  return promise
}