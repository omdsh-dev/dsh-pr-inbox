---
category: process
date: 2026-10-17
---

# 兼容矩阵跟上 0.2.1：better-sidebar ≥ 0.28.0

## Problem

本机 `dsh --version` 是 `0.2.1-rc.1`。按仓库的实例门起隔离 profile（默认
`BETTER_SIDEBAR_VERSION=0.26.1`）时 boot 日志是：

```text
dsh: warning: 1 entry did not activate
better-sidebar (dsh-better-sidebar): pending (waiting for service: webRuntime)
```

0.2.1 的运行时里已经没有 `webRuntime`，而 better-sidebar 0.26.1 的 `inject` 仍要求它。
结果是页签宿主永久 pending，PR 页签根本不会出现；PR 插件自己的 host 半其实是激活的。
better-sidebar 0.28.0 已改为 `webServer / sessions / connection / tools`，peer 写明
`@deepseek-ai/dsh-host-webserver ^0.2.1-rc.1`。

## Decision

1. `scripts/gates/mounted.sh` 的默认 pin 升到 `0.28.0`；`package.json` 的
   `devDependencies` 同步到 `^0.28.0`（锁文件一起更新）。
2. README 安装节写明：**0.2.1 线需要 better-sidebar ≥ 0.28.0**，并说明 0.26.x 的症状。
3. 在 `0.2.1-rc.1 + better-sidebar 0.28.0` 上重跑实例门；兼容性表按
   `0.2.0-rc.2` 与 `0.2.1-rc.x` 分列，只写实际验证过的组合。
4. 说明这是**页签宿主**的版本耦合：PR 插件不直接依赖 `webRuntime`，但它依赖的
   better-sidebar 会。

## Alternatives considered

- **在插件里 fork/补丁 better-sidebar**：把宿主的兼容责任搬进插件，维护成本更高。
- **绕过 better-sidebar，改用 DSH 原生右栏槽**：目前没有面向第三方页签的官方槽；
  better-sidebar 就是这个入口。
- **等 0.2.1 稳定再处理**：0.2.1 已是 `next` 通道，用户会先撞上；文档与门禁先跟上。

## Consequences

- 插件与 better-sidebar 的版本矩阵需要随宿主 rc 更新；实例门仍是手动的（CI 只跑静态门）。
- 静态门不会发现这类问题——它只能在 boot 日志里出现，这正是负控/实例门存在的理由。
