/**
 * dsh-pr-inbox 的 Node half：注册自有路由（`/plugins/dsh-pr-inbox/api`），
 * 由它跑本机 `gh` 读取本项目 PR。浏览器侧（`lib/client.js`）只负责渲染。
 *
 * `inject: ['webServer']` 保证 apply 时路由注册面已经就绪；没有 web 服务时
 * 插件安静地什么都不挂（而不是把 profile 行拖成 pending）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerRoutes, ROUTE_PATH } from './host/routes'

export const name = 'pr-inbox'

export const inject = ['webServer']

export { ROUTE_PATH }

export function apply(ctx: Context): void {
  ctx.effect(() => registerRoutes(ctx), 'pr-inbox: /plugins/dsh-pr-inbox routes')
}