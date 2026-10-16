---
category: architecture
date: 2026-10-16
---

# 独立插件，而不是 better-sidebar 核心的一页

## Problem

「看与我相关的 GitHub PR」需要网络、需要 `gh` 登录态、需要打 GitHub API。
better-sidebar 的 Git 面板刻意保持**纯本地 git、零网络**：它的测试与心智模型都建立在
"不联网也能用"上。把 PR 面板塞进核心，等于给一条零网络的通道引入一个会超时、会限流、
会因未登录而失败的子系统。

## Decision

做成**独立插件** `dsh-pr-inbox`，用 `ctx.betterSidebar.registerTab` 注册一个页签。
核心保持零网络；想用 PR 面板的人自己装这一个包，不想要的人完全不受影响。

## Alternatives considered

- **进 better-sidebar 核心**：省掉一次安装，但把网络依赖、gh 前置、GitHub 限流语义
  一起塞进核心，与核心既有承诺冲突。否掉。
- **做进聊天里的斜杠命令**（`/pr` 之类）：能看，但"扫一眼有哪几件需要我动手"这件事
  天生是**常驻面板**的活；命令形态每次都要主动想起来去打。否掉（作为将来的补充可以）。

## Consequences

- 插件要自带 tab 注册、i18n、图标、README、门禁——成本比"核心加一页"高，换来的是隔离。
- 需要用的人多一步安装；better-sidebar 的推荐插件目录里可以放一条（后续动作）。
- PR 面板崩了不会影响核心的 Git 面板，反之亦然。
