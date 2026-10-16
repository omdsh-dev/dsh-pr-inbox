# dsh-pr-inbox

DSH 侧边栏的 **PR 面板**：自动绑定当前会话工作区的项目，按「与我相关」分桶原生渲染
GitHub Pull Request。数据来自**本机已登录的 `gh` CLI**，插件自己不存 token。

```text
┌ 顶部：搜索框 ···························· [简洁|详细] ⟳ ┐
│ ▾ 我提的 (2)                            author:@me      │
│   ◯ #969  只读提交图（Git Graph）          3 小时前      │
│   ◯ #968  页签名「文件变动」改为「Git」      3 小时前      │
│ ▾ 待我审 (0)                     review-requested:@me   │
│ ▾ 最近合并 (20)                   is:merged · 最近 20    │
│   ◯ #967  release: v0.26.1 —— 稳态开销治理  4 小时前      │
└─────────────────────────────────────────────────────────┘
   ◯ = 作者头像（行首独立列；详细档多出作者/标签/评论那一条事实行）
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
| **行几何：头像钉在行首独立列** | 简洁（28px 单行）与详细（50px 两行）下，头像 / 编号 / 标题 / 时间 / 外链**逐项同 x 同宽**（挂载门直接量元素坐标，容差 1px）：切密度只是增删第二条事实行，已有信息一律不跳位。代价是简洁档不再重复作者名——作者由行首头像 + 行 tooltip 给出，宽度让给标题 |
| **行边界用 0.5px 中性命线，不靠填充差** | 实测浅色主题下宿主 `bg-base`/`layer-1`/`layer-2`/`layer-3` **同为 `#fff`**，填充差恒为 0；官方 `border-l1`（4% 黑）在这个底色上几乎看不见，所以行线取 `border-l2`（10% 黑）。分区分界与行边界用同档线，靠**线的数量**（上一区块的行线 + 28px 头带 + 头带底线）区分层级 |
| **分区头贴顶（sticky）** | 20 行以上的桶滚动时，当前分区的名字与计数始终留在上沿；条带自身填 `bg-base`（官方 sticky 条带的做法），否则行会从字下面穿过 |
| **行内「在 GitHub 打开」静止不露面** | hover / 键盘聚焦才现形（触屏常显）；静止时 `pointer-events: none`，那 24px 的点击**穿透到行本身**——点哪儿都是开详情，不会误开外链 |
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
- 阶段二：三桶列表（我提的 / 待我审 / 最近合并）+ 顶部搜索 + 简洁/详细切换。几何按实测钉住：
  头带按官方 `Input` 的自然高度（47px）· 分区头与简洁行 28px · 详细行 50px · 行首头像列 16px
  （行内留白 12px 起）· 行线 0.5px `border-l2` · 当前项 = 选中底色 + 2px 内嵌强调条。
- 阶段三：点开一行 → **插件自渲染**的 PR 详情（正文、评论与评审时间线、改动文件清单；
  正文与时间线有界并如实标注截断，支线失败进 `warnings` 而不是空白）。

写操作（评论 / approve / merge）不在只读 v1 的范围内。