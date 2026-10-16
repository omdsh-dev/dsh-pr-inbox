---
category: architecture
date: 2026-10-16
---

# 数据走本机 gh CLI，插件不存 token

## Problem

要读 GitHub PR，就得有凭据。常见做法是让用户在插件设置里填一个 Personal Access
Token（PAT）——那条路有三个后果：token 进了 profile 设置文件、进了插件进程内存、
也进了"要教用户去 GitHub 页面点哪几个 scope"的文档。

## Decision

**复用本机已登录的 `gh` CLI**（`gh api` / `gh search`），插件自己不持有任何凭据。
探测 `gh` 是否在、是否登录（`gh auth status`）后，缺它时给的是一句可操作的话
（装 gh、`gh auth login`），而不是一个空列表。

## Alternatives considered

- **PAT 存设置**：凭据多一份副本，且用户要手动管理 scope/过期。否掉。
- **OAuth device flow**：体验最好，但要插件自己实现一套 token 生命周期与刷新，
  且仍然要落盘存 token。v1 不做。
- **只读公开 API（无凭据）**：看不到私有仓库、看不到 review 请求，也就是看不到
  这个插件真正要解决的问题。否掉。

## Consequences

- 前置条件写进了 README：目标机器要有 `gh` 且已登录。
- 凭据不进插件、不进设置文件、不进模型上下文。
- `gh` 的失败形态（未安装 / 未登录 / 限流 / 超时）要在 host 侧分类成可操作提示。
