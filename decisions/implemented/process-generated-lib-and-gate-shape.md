---
category: process
date: 2026-10-16
---

# `lib/` 随提交入库；门禁分静态/实例两类并各自自证

## Problem

分发形态要求"真一行安装"（`dsh plugin --profile web add github:owner/repo`）。
若产物不入库，用户装完还得自己构建（pnpm ≥10 还会拦 `prepare`，要手工放行
`allowBuilds`）。但产物入库带来一个反向风险：**产物可能悄悄落后于源码**，
表现出来是"改了没生效"这种最难查的症状。

## Decision

- `lib/` 入库，并在门禁里用 `generated-freshness` 守它：重新构建后
  `git diff --exit-code -- lib` 必须为空。
- 门禁收敛到**一个入口** `scripts/gates/run.mjs`，分两类：
  **静态门**（package-contract / no-machine-paths / decisions / md-links /
  generated-freshness / typecheck / unit-tests / gate-self-tests）默认跑；
  **实例门**（mounted / negative-control / standalone）按改动面显式跑。
- 每个门都配**自证测试**（`tests/gates.spec.ts`）：喂一个非法样例，断言门会拒绝。

## Alternatives considered

- **产物不入库 + `prepare`**：多一步 `allowBuilds` 交互，且那一步的语义是
  "允许该包在你机器上执行代码"——对使用者是负担与风险。
- **门只写在 CI 里**：本地改完不知道漂了没；且 CI 跑不了实例门（需要 gh 登录态）。

## Consequences

- 改源码必须连产物一起提交（忘了会被 `generated-freshness` 与 CI 同时抓）。
- 新增门禁=新增一条自证测试；"门自己坏了"这件事因此有下限保障。
- 发布卫生（本机路径 / 凭据）也进了静态门，发布前不再靠人肉 grep。
