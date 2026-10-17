---
category: simplification
date: 2026-10-17
---

# 面板视觉节奏：空桶收成一行、卡片与标题统一

## Problem

- 空桶的「Nothing in this bucket yet」在 28px 的分区头下又占约 30px；两个空桶就是
  116px 的空白，把真正的行推下去。空桶也没有可折叠的内容，chevron 是误导。
- 详情卡片 16px 圆角、文件行 8px、分区标题 30px/13px、列表分区头 28px/12px、
  详情 body padding 10/10/14——同一面板里混了多套节奏。
- README 用的是整页截图：左侧聊天区的失败提示（红字/红点）每张都在；详情截图选了
  #969，正文里的 Git Graph 大图被误读成「插件混入了一张 git graph 图」。

## Decision

1. **空桶只留 28px 分区头**：不画 chevron、不显示占位文案；过滤无命中与桶错误仍保留
   可折叠的 body（那些是有信息量的状态）。
2. **统一节奏**：详情卡片圆角 `--dsw-radius-md`（12px）、padding 12；文件行 28px；
   详情分区标题 28px + `--dsw-font-xxs-strong-12`（与列表分区头同档）；detail body
   padding 12 / gap 12；状态行 28px；列表行右内距 12（与分区头同一条右边界）。
3. **README 预览只截面板**：挂载门新增 `shootPanel()`，用 element screenshot 截
   `[data-dsh-pr-inbox-panel]`，不再把宿主聊天、失败消息或外壳带进图；详情预览固定用
   #968（纯文字正文），避免把 PR 正文里的 Git Graph 当成插件界面。

## Alternatives considered

- **隐藏空桶**：会丢掉「这个桶现在是 0」的信息，也让三桶结构不可见；保留一行头更稳。
- **继续整页截图、发布前再裁**：裁图容易带进左侧聊天/红字，而且每次尺寸变化都要重裁；
  element screenshot 是同一份真实渲染，稳定且可重复。
- **卡片继续用 16px（lg）**：在窄侧栏的密集列表里偏圆；12px 与文件行、chip 的 8/4px
  形成更连续的三档。
- **把空桶文案改成「暂无」**：仍然占一行；删掉 body 才是真正减少噪音。

## Consequences

- 空桶的分区头不再可点击（没有可折叠内容）；`data-empty='true'` 可供门禁/样式使用。
- 仍然是官方 token，没有新增颜色或主题分支；`theme-tokens` 门保持绿。
- README 图片变为 575×682 的面板截图；`docs/preview/detail-dark.png` 也由同一套
  `shootPanel()` 生成，避免旧整页图回流。
