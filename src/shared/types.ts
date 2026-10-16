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