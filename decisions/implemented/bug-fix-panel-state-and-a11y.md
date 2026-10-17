---
category: bug-fix
date: 2026-10-17
---

# 面板状态：刷新不清空、返回不丢位置、键盘外链不被劫持

## Problem

- 每次 `visible` 变 true 或点刷新，`load()` 先把 state 设成 `loading`，列表/详情
  会先变空再回来（host 有 60s 缓存，快也仍是一次闪动）。
- 打开详情时整个列表被替换，返回后列表重新挂载：滚动位置归零，焦点掉到 body；
  没有 Esc 返回。
- 行是 `role="button"`，外链 `Button` 嵌在行内；在按钮上按 Enter/Space，事件冒泡到行，
  行的 `preventDefault` 把外链点击取消并打开了详情。
- 密度切换用两个 `Pill`，但没有 `aria-pressed`；行没有 `aria-current`；加载/错误没有
  `aria-live`。
- 设计稿写了「密度持久化在 localStorage」，实现没有；详情页没有状态行。

## Decision

1. 列表与详情改成 **stale-while-revalidate**：已有数据时刷新只置 `refreshing`，保留旧值；
   刷新失败保留旧内容 + 一条错误提示（`refreshError` / `detail.error`）。
2. 记录打开前的 `scrollTop` 与行号，返回时在 `useLayoutEffect` 里恢复滚动并
   `focus({preventScroll:true})`；打开详情时把焦点送进详情根；Esc 返回（输入框内除外）。
3. 行的 `onKeyDown` 只在 `event.target === event.currentTarget` 时处理；外链按钮的键盘
   激活不再被行劫持。
4. 密度用 `role="group"` + 每个 Pill `aria-pressed`；行加 `aria-current`；面板加
   `aria-busy`；加载/错误/空状态加 `aria-live`/`role="status"`。
5. 密度读写 `src/client/prefs.ts`（localStorage 不可用时静默回退）；详情页也渲染状态行。

## Alternatives considered

- **保持每次重新挂载**：代码最少，但「点开第 18 条再回来」要重新找位置，体验损耗明确。
- **改用 listbox/option 语义**：更严格的 ARIA，但会改变行内按钮的嵌套关系，属于更大的
  重构；当前先把可点面与状态标清楚。
- **把密度存到 profile 设置**：为一个两档偏好引入设置面不划算；localStorage 足够。

## Consequences

- 状态更多（`refreshing` / `refreshError` / `restoreScroll` / `focusRow`），但都局限在
  Panel 内，host 协议不变。
- 刷新失败时用户会看到「旧内容 + 错误」，而不是空白页——这是有意的语义。
