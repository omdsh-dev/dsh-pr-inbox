---
category: architecture
date: 2026-10-16
---

# 复用官方控件，样式仍走注入表（而不是全量 JS 内联）

## Problem

两条官方铁律：**库里有控件就不要抄第二份**；**不要写死颜色、不要定义第二套主题**。
另有一条实测环境事实：宿主的全局 CSS 有可能覆盖插件注入的 `<style>`
（清理 style 标签、或更高优先级的类），所以关键样式"看起来对了"不等于在真 GUI 里对。

## Decision

- 控件全部用 `@deepseek-ai/dsh-client-ui-primitives`（`Input` / `Button` / `Pill` /
  `Tag` / `PathLabel` / `StateDot` / `MarkdownText`）+ 官方 `Icon*`；
  自绘只限官方没有的语义（分区头、PR 行、文件行），几何照官方规范。
- 颜色**只消费 `--dsw-alias-*` 令牌**（门禁可扫：`styles.ts` 里 0 个字面色值）。
- 样式仍以**一张注入表**（`.pi-*` 前缀，运行时插进 `head`）交付；不以"关键样式全部
  JS 内联"来代替它——代价（260 行 CSS 变对象、失去 `:hover`/媒体查询/伪元素表达力）
  大于收益。
- 取而代之：**在真实 GUI 里量计算样式**。挂载门对行几何、发丝线颜色、圆角、
  选中强调条、贴顶位置都取 `getComputedStyle`/`getBoundingClientRect` 断言，
  样式被宿主吃掉会直接红。

## Alternatives considered

- **全量 JS 内联**：宿主无法覆盖，但丢掉伪元素（选中条）、`:hover`/`:focus-within`
  （外链按钮的静止隐藏）、`@media`（触屏与 reduced-motion），且 260 行 CSS 变成难读的对象。
- **CSS Modules**：构建期作用域化，但没有解决"宿主覆盖"，还多一层构建耦合。

## Consequences

- 残留风险：将来宿主改全局 CSS 可能压过注入表——**由门当哨兵**（跑 `mounted` 即知），
  而不是靠内联消掉风险。
- 自绘处都在代码里写明"库内没有该语义"的理由，避免下一个人误以为漏了复用。
