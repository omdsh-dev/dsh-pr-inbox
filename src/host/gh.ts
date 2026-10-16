/**
 * `gh` 子进程的唯一边界。
 *
 * 所有 GitHub 数据都经本机已登录的 `gh` CLI（见 README 的鉴权取舍）：插件自己不
 * 存 token、不碰 `~/.config/gh`，token 因此永远不进模型上下文，也不会被写进
 * profile / 设置里。代价是目标机器必须装 `gh` 并登录——缺它时这一层给出
 * `gh-missing` / `gh-unauthenticated` 这两种**可操作**的错误，而不是空列表。
 */
import { execFile } from 'node:child_process'
import type { GhProbeValue } from '../shared/types'

/** 单条 gh 命令的时间上限：慢网络下 `gh search` 也可能几十秒，但不能无限挂住路由。 */
const GH_TIMEOUT_MS = 20_000
/** 输出上限：一页 PR 列表远小于此；超过即视为异常而不是默默截断。 */
const GH_MAX_OUTPUT = 8 * 1024 * 1024

/** 带 wire 错误码与 HTTP 状态的插件错误：路由层据此回信封。 */
export class PrInboxError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message)
    this.name = 'PrInboxError'
  }
}

/** 把 gh 的 stderr 归成可操作的错误码（客户端按 code 出人话提示）。 */
export function classifyGhFailure(detail: string): PrInboxError {
  const text = detail.replace(/\s+/g, ' ').trim()
  if (/gh auth login|not logged in|authentication required|HTTP 401|Bad credentials/i.test(text)) {
    return new PrInboxError(text === '' ? 'gh 未登录' : text, 'gh-unauthenticated', 401)
  }
  if (/rate limit|HTTP 403|secondary rate/i.test(text)) {
    return new PrInboxError(text === '' ? 'gh 触达 API 速率上限' : text, 'gh-rate-limit', 429)
  }
  if (/Could not resolve to a (?:Repository|PullRequest|User)|HTTP 404/i.test(text)) {
    return new PrInboxError(text, 'not-found', 404)
  }
  return new PrInboxError(text === '' ? 'gh 命令失败' : text, 'gh-error', 502)
}

/** gh 子进程统一环境（分页/交互/颜色/提示都关掉，解析不依赖终端能力）。 */
function ghEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GH_PAGER: 'cat',
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    NO_COLOR: '1',
    GIT_TERMINAL_PROMPT: '0',
  }
}

/** 把 execFile 的失败翻译成带错误码的插件错误（两个 runner 共用）。 */
function ghExecFailure(error: NodeJS.ErrnoException, stderr: string, timeoutMs: number, tooLargeCode: string): PrInboxError {
  if (error.code === 'ENOENT') {
    return new PrInboxError('未找到 gh CLI（请安装 GitHub CLI 并 `gh auth login`）', 'gh-missing', 501)
  }
  if (error.code === tooLargeCode) {
    return new PrInboxError('文件超过本插件允许的大小', 'too-large', 413)
  }
  if (error.code === 'ETIMEDOUT' || (error as { killed?: boolean }).killed === true) {
    return new PrInboxError(`gh 命令超时（${Math.round(timeoutMs / 1000)}s）`, 'gh-timeout', 504)
  }
  return classifyGhFailure(stderr.trim() || error.message)
}

/** 跑一条 gh 命令，返回 stdout。失败的分类在这一层统一做掉。 */
export async function runGh(args: readonly string[], timeoutMs = GH_TIMEOUT_MS): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile('gh', [...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: GH_MAX_OUTPUT,
      windowsHide: true,
      env: ghEnv(),
    }, (error, stdout, stderr) => {
      if (error === null || error === undefined) { resolve(stdout); return }
      reject(ghExecFailure(error as NodeJS.ErrnoException, stderr, timeoutMs, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'))
    })
  })
}

/**
 * 二进制读（图片等字节流）：stdout 以 **Buffer** 回——用 utf8 解码会把字节弄坏。
 *
 * `maxBuffer` 就是硬上限：超了 Node 杀掉子进程并回
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`，调用方据此回 413，**大文件从不整体进内存**。
 */
export async function runGhBuffer(args: readonly string[], maxBuffer = GH_MAX_OUTPUT, timeoutMs = GH_TIMEOUT_MS): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    execFile('gh', [...args], {
      encoding: 'buffer',
      timeout: timeoutMs,
      maxBuffer,
      windowsHide: true,
      env: ghEnv(),
    }, (error, stdout, stderr) => {
      if (error === null || error === undefined) { resolve(stdout as unknown as Buffer); return }
      reject(ghExecFailure(error as NodeJS.ErrnoException, String(stderr), timeoutMs, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'))
    })
  })
}

/** 跑一条 gh 命令并解析 JSON。解析失败算**上游输出异常**，不伪装成空结果。 */
export async function ghJson<T>(args: readonly string[]): Promise<T> {
  const out = await runGh(args)
  try {
    return JSON.parse(out) as T
  } catch {
    throw new PrInboxError('gh 返回了非 JSON 输出', 'gh-bad-output', 502)
  }
}

/** 与 client 共享的探测结果形状（见 `src/shared/types.ts`）。 */
export type GhProbe = GhProbeValue

/** 探测结果 5 分钟内复用：面板每次刷新都问一遍会导致「版本 + 账号」两跳白跑。 */
const PROBE_TTL_MS = 5 * 60_000
let probeCache: { expires: number; value: GhProbe } | undefined
let probeInFlight: Promise<GhProbe> | undefined

/** 单飞探测：并发的多个刷新只触发一次 `gh --version` + `gh api user`。 */
export function probeGh(now = Date.now()): Promise<GhProbe> {
  if (probeCache !== undefined && probeCache.expires > now) return Promise.resolve(probeCache.value)
  if (probeInFlight !== undefined) return probeInFlight
  const promise = probeGhUncached().then((value) => {
    probeCache = { expires: Date.now() + PROBE_TTL_MS, value }
    probeInFlight = undefined
    return value
  }, (error: unknown) => {
    probeInFlight = undefined
    throw error
  })
  probeInFlight = promise
  return promise
}

async function probeGhUncached(): Promise<GhProbe> {
  let version: string
  try {
    version = (await runGh(['--version'], 8_000)).split('\n')[0]?.trim() ?? ''
  } catch (error) {
    if (error instanceof PrInboxError) {
      return { available: false, error: error.message, code: error.code }
    }
    throw error
  }
  try {
    const login = (await runGh(['api', 'user', '-q', '.login'], 12_000)).trim()
    return { available: true, version, login }
  } catch (error) {
    if (error instanceof PrInboxError) {
      // 装了但没登录：可用（版本在），但没有身份——三桶里两桶依赖身份。
      return { available: true, version, error: error.message, code: error.code }
    }
    throw error
  }
}

/** 测试与 dispose 用：清掉探测缓存。 */
export function resetGhProbe(): void {
  probeCache = undefined
  probeInFlight = undefined
}