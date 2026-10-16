/** host 与 client 共享的**类型**（两端各自打包，不共享运行时）。 */

/** 本机 gh CLI 的自检结果。 */
export interface GhProbeValue {
  available: boolean
  version?: string
  /** 当前 `gh` 的登录账号；未登录时为 undefined。 */
  login?: string
  /** 不可用/未登录时的一句人话。 */
  error?: string
  code?: string
}

/** 当前工作区绑定到的 forge 项目。 */
export interface RepoValue {
  host: string
  owner: string
  name: string
  /** `owner/name`。 */
  fullName: string
  remoteUrl: string
  root: string
}

export interface StatusValue {
  gh: GhProbeValue
  repo: RepoValue | null
}

/** 三桶的键。 */
export type BucketKey = 'authored' | 'review' | 'merged'

/** 列表里的一行 PR（只带渲染简洁/详细两种密度所需的最小字段集）。 */
export interface PrRow {
  number: number
  title: string
  url: string
  author: string
  isDraft: boolean
  state: string
  createdAt: string
  updatedAt: string
  /** 已合并时间；未合并为 undefined。 */
  mergedAt?: string
  labels: string[]
  comments: number
}

/** 一个桶：命中总数 + 这一页的行；失败时带 per-bucket 错误（其它桶照常显示）。 */
export interface BucketValue {
  total: number
  rows: PrRow[]
  error?: { code?: string; message: string }
}

export interface ListValue {
  repo: RepoValue | null
  gh: GhProbeValue
  /** 这一份列表的取数时间（ISO）。 */
  fetchedAt: string
  buckets: Record<BucketKey, BucketValue>
  /** 服务端提示（例如非 github.com 的 host 暂不支持）——非致命。 */
  note?: string
}

/** 详情里的一个改动文件。 */
export interface PrDetailFile {
  path: string
  /** added / modified / removed / renamed / copied / changed / unchanged。 */
  status: string
  additions: number
  deletions: number
  /** 改名时的原名。 */
  previousPath?: string
}

/** 详情时间线上的一条（issue 评论或一次 review）。 */
export interface PrDetailComment {
  kind: 'comment' | 'review'
  author: string
  createdAt: string
  body: string
  /** 仅 review：APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED / PENDING。 */
  reviewState?: string
}

/**
 * 一个 PR 的完整内容（面板自己渲染，不嵌网页）。
 *
 * 有界：正文/评论正文各自截断并置 `*Truncated`；文件与时间线都是**取到的这一页**，
 * 与 GitHub 报的总数比较后给出截断标记。上游失败时（例如评论 403）
 * 仍然返回已取到的部分，失败原因进 `warnings`——详情页不会因为一条支线失败变空白。
 */
export interface PrDetailValue {
  repo: RepoValue
  number: number
  title: string
  body: string
  bodyTruncated: boolean
  url: string
  author: string
  state: string
  isDraft: boolean
  createdAt: string
  updatedAt: string
  mergedAt?: string
  baseRef: string
  headRef: string
  labels: string[]
  additions: number
  deletions: number
  changedFiles: number
  commits: number
  /** issue 评论总数（GitHub 的 `comments`）。 */
  comments: number
  /** 行内 review 评论总数（`review_comments`）。 */
  reviewComments: number
  mergeableState?: string
  files: PrDetailFile[]
  filesTruncated: boolean
  timeline: PrDetailComment[]
  timelineTruncated: boolean
  /** 支线失败的人话（每条形如「评论：…」）；为空表示全都取到了。 */
  warnings: string[]
  fetchedAt: string
}