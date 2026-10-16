---
category: bug-fix
date: 2026-10-16
---

# 取词走了私有 lookup，整条右栏跟着崩

## Problem

挂载门点右栏页签时超时：`[data-dockkit-add-tab]` 一直不出现。把浏览器 console 打出来才看到
`TypeError: chain is not iterable at LocaleRuntime.lookup`，紧接着一行
`slot entry crashed in 'sidebar.right.pane.tab'`——我的词表取词调到了 locale 服务的**私有**
`lookup(ns, key)`，抛出的异常把整个原生右栏的渲染带崩了（不只是我的页签消失）。

## Decision

只用公开面：`ctx.locale.register(ns, { zh, en })` + `bind(ns)` 拿 `t`；
并且自己的 `safe()` 包装**永不抛**——查不到就落回本地表，再不行显示键本身。
locale 服务本身也**不进 `inject`**（用 `ctx.get('locale')` 探测），缺它时面板照常可用。

## Alternatives considered

- **改用 `ctx.locale.resolveText`**：那是给 `{ en, zh }` 形状的包文本用的，不是按键取词。
- **把 locale 写进 `inject` 强制依赖**：会让"没装 locale 的宿主"整条页签不激活，
  而这份 UI 没有它也能用（只是不跟随语言）。

## Consequences

- 环境事实：**插件在自己渲染路径里抛的错，会连带打掉宿主那条 slot 的整棵渲染树**——
  第三方 UI 代码必须假设"我的异常会影响宿主"，凡是可能失败的取词/取数都裹住。
- 门里保留了"页签真的出现 + 面板真的渲染"这一步：它正是抓到这个崩的地方。
