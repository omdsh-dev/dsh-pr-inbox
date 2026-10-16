/**
 * dsh-pr-inbox 的浏览器半：向 better-sidebar 注册一个原生 tab 类型。
 *
 * 只做 type-only import（`import type {} from 'dsh-better-sidebar'`）触发
 * `ctx.betterSidebar` 的类型合并——运行时符号一律走 `ctx.betterSidebar` 方法调用，
 * 不 value-import 宿主插件。
 *
 * 文案经宿主 locale 服务（`createI18n`），图标用官方 `IconBranchOutlineRegular`
 * （primitives 里没有 PR 专用图标，分支是语义最近的一个）。
 */
import { createElement } from 'react'
import type {} from 'dsh-better-sidebar'
import type { Context } from '@deepseek-ai/cordis'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { Panel } from './Panel'
import { createI18n } from './i18n'
import { injectStyles } from './styles'

/** 服务依赖：只等 better-sidebar 就绪（tab 宿主）。
 *  locale 不写进 inject —— 它是可选增强，`createI18n` 用 `ctx.get('locale')` 结构化探测，
 *  缺席时退回浏览器语言兜底；写进 inject 一旦服务名对不上就是整行永久 pending
 *  （严格注入两个方向都会出事，见 make-dsh-plugin 的 Step 2 与 gotchas §7）。 */
export const inject = ['betterSidebar']

export const TAB_ID = 'dsh-pr-inbox:prs'

export function apply(ctx: Context): void {
  injectStyles()
  const i18n = createI18n(ctx)
  ctx.effect(() => () => { i18n.dispose() })
  ctx.effect(() =>
    ctx.betterSidebar.registerTab({
      id: TAB_ID,
      title: () => i18n.t('tabTitle'),
      description: () => i18n.t('tabDescription'),
      icon: (size: number) => createElement(IconBranchOutlineRegular, { size }),
      order: 25,
      dedupeKey: () => TAB_ID,
      component: ({ scope, visible }) => createElement(Panel, {
        ctx,
        i18n,
        sessionId: scope.sessionId,
        cwd: scope.cwd,
        visible,
      }),
    }), 'pr-inbox: register PR tab')
}