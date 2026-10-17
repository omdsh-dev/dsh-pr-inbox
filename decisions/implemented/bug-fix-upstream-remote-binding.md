---
category: bug-fix
date: 2026-10-17
---

# fork checkout 绑到 origin，看不到主仓的 PR

## Problem

`detectRepo` 优先 `remote.origin.url`。开源贡献者的常见布局是 `origin` = 自己的 fork、
`upstream` = 主仓；面板会绑到 fork，`author:@me` / `review-requested:@me` 都看不到主仓的
PR——这恰好是「PR 收件箱」最常用的场景。

## Decision

绑定顺序改为 **`upstream` → `origin` → 按名字取第一个 remote**（`preferredRemote`），
并把选中的 remote 名放进 `RepoValue.remoteName`；状态行的仓库名 `title` 会显示
`owner/repo (upstream)`，用户能看出绑的是哪个。

## Alternatives considered

- **每次让用户选 remote**：多一个配置面，且大多数仓库只有一个合理答案；先按约定排序。
- **`gh repo view --json parent` 推父仓**：要网络与登录态，且不是所有 fork 都有 parent；
  在绑定阶段引入一次 API 调用不划算。
- **保持 origin 优先、只加一个切换入口**：仍然默认错，用户要先发现错再切。

## Consequences

- 少数仓库的 `upstream` 指向不相关的项目时会被误绑；`remoteName` 与 title 让这件事可发现，
  后续再加切换控件。
- 新增 `tests/repo-remote.spec.ts`：用真实 `git init` + `remote add` 验证优先级与
  `detectRepo` 的 `remoteName`。
