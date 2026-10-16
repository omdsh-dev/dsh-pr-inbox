/**
 * 路由 op 的实现。第一阶段只有 `status`（绑定 + 环境自检），
 * 三桶查询（`list`）与详情（`detail`）在此文件追加，协议不变。
 */
import type { StatusValue } from '../shared/types'
import { probeGh } from './gh'
import { detectRepo, requireAbsoluteCwd } from './repo'

/** `status`：这个会话的工作区是哪个项目 + 本机 gh 能不能用、以谁的身份用。 */
export async function statusOp(payload: Record<string, unknown>): Promise<StatusValue> {
  const cwd = requireAbsoluteCwd(payload.cwd)
  const [gh, repo] = await Promise.all([probeGh(), detectRepo(cwd)])
  return { gh, repo: repo ?? null }
}