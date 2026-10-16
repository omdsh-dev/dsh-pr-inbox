/**
 * 路由 op 的实现：`status`（绑定 + 环境自检）、`list`（三桶）、`detail`（单个 PR）。
 * 三个 op 的协议一致：校验入参 → 取数 → 返回可 JSON 化的值。
 */
import type { StatusValue } from '../shared/types'
import { detailOp } from './detail'
import { probeGh } from './gh'
import { listOp } from './prs'
import { detectRepo, requireAbsoluteCwd } from './repo'

/** `status`：这个会话的工作区是哪个项目 + 本机 gh 能不能用、以谁的身份用。 */
export async function statusOp(payload: Record<string, unknown>): Promise<StatusValue> {
  const cwd = requireAbsoluteCwd(payload.cwd)
  const [gh, repo] = await Promise.all([probeGh(), detectRepo(cwd)])
  return { gh, repo: repo ?? null }
}

export { detailOp, listOp }