---
category: architecture
date: 2026-10-16
---

# 依赖三字段不声明官方包（并在真实通道上验证）

## Problem

官方 `@deepseek-ai/*` 包在公共 npm 可见，但**单独安装不成立**：它们之间是一整条 peer
闭包，钉进去就要把整条闭包声明出来，等于把插件版本与官方版本硬耦合。生态里的既有做法
并不统一——`omdsh-dev/DSH-better-sidebar` 就声明了 20 多个官方 peer 与 devDependency。
但本插件的分发形态是 `github:` 源安装（零依赖、产物入库），任何一端把官方包拖进使用者
那一步安装，都可能以 ERESOLVE 收场。

## Decision

- `dependencies` 为空；`peerDependencies` **整个删掉**（原来留着 `@deepseek-ai/cordis`、
  `react`、`dsh-better-sidebar`，都是挂载环境注入的，声明只会多一条解析面）。
- `devDependencies` 保留（`tsdown` / `typescript` / `vitest` / 官方 `ui-primitives` 类型）——
  它们只服务"本仓库自己构建与 typecheck"，不是分发契约。
- 这条不再靠推理：**真实通道冒烟门**（`scripts/gates/git-source.sh`）clone 已提交 HEAD
  后按用户那条命令装，实测 `+ dsh-pr-inbox git+file://…` 无 ERESOLVE、boot 干净、
  三 op 真应答——证明 pnpm 对 git 依赖**不安装** devDependencies（也没有 `prepare`
  要跑，因为 `lib/` 入库）。

## Alternatives considered

- **照 better-sidebar 声明官方 peer**：它自己能用，是因为它是长驻 npm 包 + 安装环境里
  本来就有整条闭包；对本插件的 git 源通道是纯风险，收益只有"版本声明好看"。
- **本地 link SDK 代替 devDependency**（skill 的默认配方）：能跑，但会让 `git clone` +
  `pnpm install` 的新贡献者 typecheck 直接红，得先读文档才知道要 link。
- **删掉 devDependencies 里的官方包、CI 里临时 `npm i --no-save`**：让 CI 依赖一个
  与 lockfile 无关的旁路安装，比多一个 devDependency 更难解释。

## Consequences

- 新增依赖前先问"使用者那一步会不会被拖进来"；只有 `dependencies` 会。
- 本仓库的 typecheck/构建依赖官方包类型，故它们是 devDependencies；**若将来 pnpm 改变
  git 依赖对 devDependencies 的处理**，`git-source` 门会立刻红——这正是它存在的理由。
- `dsh.client.inject: ['dsh-better-sidebar']` 仍然是运行时契约（client 模块图），
  与"不声明 peer"不矛盾：那是加载顺序声明，不是 npm 依赖。
