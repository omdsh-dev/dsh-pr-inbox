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
| **界面复用 DSH 官方控件** | 搜索框 / 按钮 / 密度切换 / 徽标 / 图标 / 文件路径分别用 `Input`、`Button`、`Pill`、`Tag`、官方 `Icon*`、`PathLabel`；官方没有的语义（分区头、PR 行）才自绘，且几何照官方规范（0.5px 分隔线、圆角按角色取 token） |
| **正文与评论用宿主的 markdown 渲染器** | `MarkdownText`（GFM + TeX，围栏代码走官方 code card，丢弃原始 HTML）；插件不复刻一套排版 |
| **文案走宿主 locale 字典** | `ctx.locale.register` + `bind(ns)`，跟随 DSH 语言偏好；取词失败落回本地表，绝不在宿主渲染路径里抛错 |

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
src/client/Panel.tsx  面板（阶段二：三桶列表 / 搜索 / 简洁·详细）
src/client/Detail.tsx 详情视图（阶段三：正文 / 时间线 / 文件清单，插件自渲染）
src/shared/types.ts   两端共享的类型
```

## 状态

- 阶段一：工作区绑定 + `gh` 环境自检 + host↔client 通路。
- 阶段二：三桶列表（我提的 / 待我审 / 最近合并）+ 顶部搜索 + 简洁/详细切换，规格对齐
  better-sidebar 的原生尺度（36px 头带 / 28px 行与控件 / 2-3-4px 圆角 / 悬停与选中态）。
- 阶段三：点开一行 → **插件自渲染**的 PR 详情（正文、评论与评审时间线、改动文件清单；
  正文与时间线有界并如实标注截断，支线失败进 `warnings` 而不是空白）。

写操作（评论 / approve / merge）不在只读 v1 的范围内。