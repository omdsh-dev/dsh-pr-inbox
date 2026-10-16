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
  const remoteUrl = await originRemote(cwd)
  if (remoteUrl === undefined) return undefined
  const identity = parseRemoteUrl(remoteUrl)
  if (identity === undefined) return undefined
  return { ...identity, remoteUrl, root, fullName: `${identity.owner}/${identity.name}` }
}

/** `remote.origin.url` 优先；没有 origin 就取第一个 remote（多 remote 仓库的常见形态）。 */
async function originRemote(cwd: string): Promise<string | undefined> {
  try {
    const url = (await gitOut(cwd, ['config', '--get', 'remote.origin.url'])).trim()
    if (url !== '') return url
  } catch {
    // 没有 origin 不算错误，继续看其它 remote。
  }
  try {
    const remotes = (await gitOut(cwd, ['remote'])).split('\n').map(line => line.trim()).filter(Boolean)
    const first = remotes[0]
    if (first === undefined) return undefined
    const url = (await gitOut(cwd, ['config', '--get', `remote.${first}.url`])).trim()
    return url === '' ? undefined : url
  } catch {
    return undefined
  }
}