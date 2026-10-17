/**
 * 「当前工作区是哪个项目」——PR 面板的绑定步骤。
 *
 * 原料只有 git 自己：会话 cwd 里的 `rev-parse --show-toplevel` 给出仓库根，
 * `remote.origin.url` 给出 forge 坐标。解析是纯函数（`parseRemoteUrl`），
 * 因此 ssh / https / 带凭据 / 带 `.git` / 自定义 host（GHES）都能单测覆盖。
 */
import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { PrInboxError } from './gh'

const GIT_TIMEOUT_MS = 10_000
const GIT_MAX_OUTPUT = 1024 * 1024

export interface RemoteIdentity {
  /** forge 主机名，如 `github.com`。 */
  host: string
  owner: string
  name: string
}

export interface RepoIdentity extends RemoteIdentity {
  remoteUrl: string
  /** 绑定用的 remote 名（`upstream` / `origin` / 其它）。 */
  remoteName?: string
  /** 仓库根（`rev-parse --show-toplevel` 的原样输出）。 */
  root: string
  /** `owner/name`，UI 与 gh 参数都用它。 */
  fullName: string
}

/**
 * 把 git remote URL 解析成 forge 坐标。纯函数。
 *
 * 覆盖：`https://github.com/o/r(.git)`、`git@github.com:o/r(.git)`、
 * `ssh://git@github.com/o/r`、`https://user:token@host/o/r`、
 * 以及 owner 带多段的自建 forge（GitLab 子组之类）。解析不出来返回 undefined，
 * 由调用方决定是「没有 remote」还是「remote 不是 forge 形态」。
 */
export function parseRemoteUrl(raw: string): RemoteIdentity | undefined {
  const url = raw.trim()
  if (url === '') return undefined
  // scp 形态没有协议头：git@github.com:owner/name
  if (!url.includes('://')) {
    const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(url)
    if (scp === null) return undefined
    return splitRemote(scp[1]!, scp[2]!)
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  // 用户名/密码（含 token）只用于连接，不进身份。
  return splitRemote(parsed.hostname, parsed.pathname)
}

function splitRemote(host: string, path: string): RemoteIdentity | undefined {
  const clean = path.replace(/^\/+/, '').replace(/\.git$/, '')
  const parts = clean.split('/').filter(segment => segment !== '')
  if (host === '' || parts.length < 2) return undefined
  const name = parts[parts.length - 1]!
  const owner = parts.slice(0, -1).join('/')
  return { host, owner, name }
}

function gitOut(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], {
      encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_OUTPUT, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    }, (error, stdout) => {
      if (error === null || error === undefined) resolve(stdout)
      else reject(error)
    })
  })
}

/** cwd 必须是绝对路径：它来自客户端，词法校验挡掉相对路径与空串。 */
export function requireAbsoluteCwd(value: unknown): string {
  if (typeof value !== 'string' || value === '' || !isAbsolute(value)) {
    throw new PrInboxError('需要绝对的会话 cwd', 'bad-request', 400)
  }
  return value
}

/**
 * 识别 cwd 所属的项目。不是 git 仓库 / 没有可解析的 remote 时返回 undefined
 * （面板据此显示「当前工作区不是 git 仓库」或「没有 forge remote」，
 * 而不是一个空列表）。
 */
export async function detectRepo(cwd: string): Promise<RepoIdentity | undefined> {
  let root: string
  try {
    root = (await gitOut(cwd, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return undefined
  }
  const remote = await preferredRemote(cwd)
  if (remote === undefined) return undefined
  const identity = parseRemoteUrl(remote.url)
  if (identity === undefined) return undefined
  return { ...identity, remoteName: remote.name, remoteUrl: remote.url, root, fullName: `${identity.owner}/${identity.name}` }
}

/**
 * 绑定用哪个 remote：**`upstream` 优先**（fork 布局：origin = 自己的 fork，
 * upstream = 主仓），其次 `origin`，最后按名字取第一个。
 *
 * 为什么不是 origin 优先：开源贡献者 checkout 的 origin 通常是自己 fork，
 * 绑到 fork 会让 `author:@me` / `review-requested:@me` 看不到主仓的 PR——那恰好
 * 是这个面板最常用的场景。
 */
export async function preferredRemote(cwd: string): Promise<{ name: string; url: string } | undefined> {
  let names: string[]
  try {
    names = (await gitOut(cwd, ['remote'])).split('\n').map(line => line.trim()).filter(Boolean)
  } catch {
    return undefined
  }
  if (names.length === 0) return undefined
  const rank = (name: string): number => (name === 'upstream' ? 0 : name === 'origin' ? 1 : 2)
  const ordered = [...names].sort((left, right) => rank(left) - rank(right))
  for (const name of ordered) {
    try {
      const url = (await gitOut(cwd, ['config', '--get', `remote.${name}.url`])).trim()
      if (url !== '') return { name, url }
    } catch {
      // 这个 remote 没有 url，试下一个。
    }
  }
  return undefined
}