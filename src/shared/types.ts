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