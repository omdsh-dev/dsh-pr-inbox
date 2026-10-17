---
category: feature
date: 2026-10-17
---

# 「最近合并」改成「我合并的」

## Problem

原查询是 `repo:<repo> is:pr is:merged`：这是**仓库全局**的合并流，不是「与我相关」。
在一个 285 条 merged 的仓库里，桶头显示 285、实际只渲染 20 行，而「我刚合并的那条」
很可能不在这 20 行里。README 把它解释成「我刚做的事落地没有」，与查询语义不一致；
另外三桶统一按 `updated` 排序，`is:merged` 按 updated 排会把它变成「最近有动静的
已合并 PR」，而不是「最近合并」。

## Decision

1. merged 查询加 `author:@me`（`repo:<repo> is:pr is:merged author:@me`），桶名改为
   **「我合并的」**。
2. 仍取 20 行（搜索接口只能按 updated 取一页），但**展示时按 `mergedAt` 倒序**排序
   （`sortRowsForBucket`），让「最近合并」在已取回的这一页里成立。
3. 桶头计数在「只加载了一页」时显示 `已加载 / 总数`，不再把 total 当成行数。
4. README、设计稿、已知限制同步改成「我合并的」口径。

## Alternatives considered

- **保留仓库全局，另加第四桶「我合并的」**：四个桶会让每个桶的取数与降级路径再翻一倍，
  而「仓库最近合并了什么」不是这个面板要回答的问题。否掉。
- **用 `involves:@me`**：会把「我评论过 / 被 @ 过」的 PR 也算进来，混入 review 噪音，
  不回答「我的工作有没有落地」。否掉。
- **做时间窗（最近 24h）**：搜索 API 不支持按 merged_at 过滤/排序，仍要自己翻页；
  当前 20 条的上界已经够用。留到有真实需求再说。

## Consequences

- 从不 merge 的用户这个桶会是空的——这是正确的（它回答的是「我合并的」）。
- 取数仍按 updated 取一页，只是展示排序变了；服务端排序受 GitHub 搜索能力限制，
  这一点写进 README 的已知限制。
- 新增 `bucketQueries` 的 author 限定词测试与 `sortRowsForBucket` 单测。
