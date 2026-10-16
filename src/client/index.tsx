/**
 * dsh-pr-inbox 的浏览器半：向 better-sidebar 注册一个原生 tab 类型。
 *
 * 只做 type-only import（`import type {} from 'dsh-better-sidebar'`）触发
 * `ctx.betterSidebar` 的类型合并——运行时符号一律走 `ctx.betterSidebar` 方法调用，
 * 不 value-import 宿主插件（构建纯度门会挡）。
 */
import { createElement } from 'react'
import type {} from 'dsh-better-sidebar'
import type { Context } from '@deepseek-ai/cordis'
import { Panel } from './Panel'
import { PrIcon } from './icons'
import { injectStyles } from './styles'

/** 服务依赖：better-sidebar 就绪后才激活本插件。 */
export const inject = ['betterSidebar']

export const TAB_ID = 'dsh-pr-inbox:prs'

export function apply(ctx: Context): void {
  injectStyles()
  ctx.effect(() =>
    ctx.betterSidebar.registerTab({
      id: TAB_ID,
      title: () => 'PR',
      description: () => '本项目 Pull Request：我提的 / 待我审 / 最近合并',
      icon: (size: number) => createElement(PrIcon, { size }),
      order: 25,
      dedupeKey: () => TAB_ID,
      component: ({ scope, visible }) => createElement(Panel, {
        ctx,
        sessionId: scope.sessionId,
        cwd: scope.cwd,
        visible,
      }),
    }), 'pr-inbox: register PR tab')
}