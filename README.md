# dsh-pr-inbox

DSH 侧边栏的 **PR 面板**：自动绑定当前会话工作区的项目，按「与我相关」分桶原生渲染
GitHub Pull Request。数据来自**本机已登录的 `gh` CLI**，插件自己不存 token。

```text
┌ 顶部：搜索框 ······························ [简洁|详细] ┐
│ ▸ 我提的 (3)        #969 …  #968 …                      │
│ ▸ 待我审 (1)        #944 …                              │
│ ▸ 最近合并 (5)      #967 …                              │
└─────────────────────────────────────────────────────────┘
```

## 设计取舍

| 决定 | 为什么 |
|---|---|
| **复用本机 `gh` CLI**，而不是插件内填 PAT | token 全程不进插件、不进 profile 设置、不进模型上下文；代价是目标机器要有 `gh` 且已登录——缺它时面板给的是「装 gh / `gh auth login`」这种可操作提示，而不是一个空列表 |
| **绑定当前工作区** | `git rev-parse --show-toplevel` + `remote.origin.url` → `owner/repo`；不再需要「先切仓库」 |
| **只读 v1** | 不评论、不 approve、不合并；先证明「看」这件事做对了，写操作留到后面单独一批 |
| **独立插件，不进 better-sidebar 核心** | 核心的 Git 面板刻意保持「纯本地 git、零网络」；GitHub 那半边生态一直在做（`dsh-github-workbench` 等），本插件用 `ctx.betterSidebar` 注册 tab 即可 |
| 颜色只消费 `--dsw-alias-*` 令牌 | 跟随深浅主题与皮肤中心，插件不持有任何颜色字面量 |

## 安装

```bash
# 前置：better-sidebar（tab 宿主）+ 本机 gh 已登录
dsh plugin --profile web add dsh-better-sidebar
dsh plugin --profile web add dsh-pr-inbox
```

开发/验证：`pnpm install && pnpm build`，然后见 `scripts/`（隔离 `DSH_HOME` 的真实挂载自检）。

## 结构

```
src/index.ts          Node half：注册 /plugins/dsh-pr-inbox/api
src/host/gh.ts        gh 子进程边界（超时/输出上限/错误码分类/单飞探测）
src/host/repo.ts      工作区 → owner/repo（parseRemoteUrl 纯函数）
src/host/routes.ts    HTTP 信封（POST + { op } → { ok, value }）
src/client/index.tsx  向 better-sidebar 注册 tab
src/client/Panel.tsx  面板（阶段一：绑定与自检）
src/shared/types.ts   两端共享的类型
```

## 状态

- 阶段一（本版）：工作区绑定 + `gh` 环境自检 + host↔client 通路。
- 阶段二：三桶列表（我提的 / 待我审 / 最近合并）+ 顶部搜索 + 简洁/详细切换。
- 阶段三：PR 详情（正文 / 评论 / 文件，插件自渲染）。