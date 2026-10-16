# 工程备忘录（dsh-pr-inbox）

> 这份文件写给**改这个插件的人**：机制、实测环境事实、验证证据、门禁怎么跑。
> 面向使用者（装不装、怎么用、边界在哪）的内容在 [README](../README.md)。

## 1. 机制与结构

```
src/index.ts            Node half：inject=['webServer']，注册 /plugins/dsh-pr-inbox/*
src/host/gh.ts          gh 子进程边界（20s 超时 / 8MiB 输出上限 / 错误码分类 / 探测单飞缓存）
src/host/repo.ts        工作区 → owner/repo（parseRemoteUrl 纯函数；requireAbsoluteCwd 入参围栏）
src/host/prs.ts         三桶查询（author:@me / review-requested:@me / is:merged）+ 60s 有界缓存
src/host/detail.ts      PR 详情取数（正文 64KiB / 评论 8KiB 上限 + 截断标记 + warnings）
src/host/image.ts       图片字节代理（路径/ref 词法围栏、魔数确认、两段体积闸、nosniff）
src/host/routes.ts      HTTP 信封：POST + {op} → {ok,value} / {ok:false,error:{code,message}}
src/shared/types.ts     两端共享类型
src/client/index.tsx    向 better-sidebar 注册 tab（TAB_ID=dsh-pr-inbox:prs）；locale 走 ctx.get 探测
src/client/Panel.tsx    列表：三桶 + 搜索 + 简洁/详细 + 行几何
src/client/Detail.tsx   详情：正文 / 时间线 / 文件清单（插件自渲染，MarkdownText 排版）
src/client/{bits,format,pr-image,api,styles,i18n}.ts(x)
```

- 自有路由：`POST /plugins/dsh-pr-inbox/api`（op = `status` / `list` / `detail`）、
  `GET /plugins/dsh-pr-inbox/image?cwd=&ref=&path=`。
- 凭据：**插件不持有任何 GitHub 凭据**，一律经本机 `gh`（读到的东西不进设置文件、
  不进模型上下文）。
- 稳定性：只在页签可见时取数、不持定时器、重新可见即补刷一次；host 侧每类结果各有
  有界缓存（列表 60s / 详情 30s / 图片 300s）。

## 2. 设计取舍（为什么是这样）

| 决定 | 为什么 |
|---|---|
| **复用本机 `gh` CLI**，而不是插件内填 PAT | token 全程不进插件、不进 profile 设置、不进模型上下文；代价是目标机器要有 `gh` 且已登录——缺它时面板给的是「装 gh / `gh auth login`」这种可操作提示，而不是一个空列表 |
| **绑定当前工作区** | `git rev-parse --show-toplevel` + `remote.origin.url` → `owner/repo`；不需要「先切仓库」 |
| **只读 v1** | 不评论、不 approve、不合并；先证明「看」这件事做对了，写操作留到后面单独一批 |
| **独立插件，不进 better-sidebar 核心** | 核心的 Git 面板刻意保持「纯本地 git、零网络」；本插件用 `ctx.betterSidebar` 注册 tab 即可 |
| 颜色只消费 `--dsw-alias-*` 令牌 | 跟随深浅主题与皮肤中心，插件不持有任何颜色字面量（`scripts/gates` 无此门，但有约定 + 代码评审；`styles.ts` 实测 0 个字面色值） |
| **界面复用 DSH 官方控件** | 搜索框 / 按钮 / 密度切换 / 徽标 / 图标 / 文件路径 / 头像状态分别用 `Input`、`Button`、`Pill`、`Tag`、官方 `Icon*`、`PathLabel`、`StateDot`；官方没有的语义（分区头、PR 行）才自绘 |
| **正文与评论用宿主的 markdown 渲染器** | `MarkdownText`（GFM + TeX，围栏代码走官方 code card，丢弃原始 HTML）；插件不复刻一套排版 |
| **文案走宿主 locale 字典** | `ctx.locale.register` + `bind(ns)`，跟随 DSH 语言偏好；取词失败落回本地表，绝不在宿主渲染路径里抛错 |
| **行几何：头像钉在行首独立列** | 简洁（28px 单行）与详细（50px 两行）下，头像 / 编号 / 标题 / 时间 / 外链**逐项同 x 同宽**（挂载门量坐标，容差 1px）：切密度只是增删第二条事实行 |
| **行边界用 0.5px 中性命线，不靠填充差** | 见 §3 环境事实；分区分界与行边界同档线，靠线的数量（行线 + 28px 头带 + 头带底线）区分层级 |
| **分区头贴顶（sticky）** | 20 行以上的桶滚动时，当前分区的名字与计数始终留在上沿；条带自身填 `bg-base` |
| **行内「在 GitHub 打开」静止不露面** | hover / 键盘聚焦才现形（触屏常显）；静止时 `pointer-events: none`，那 24px 的点击穿透到行本身 |

## 3. 实测环境事实（复现前先读这一节）

| 事实 | 怎么发现的 | 影响 |
|---|---|---|
| DSH **浅色**主题下 `--dsw-alias-bg-base` / `bg-layer-1` / `bg-layer-2` / `bg-layer-3` **同为 `#fff`** | 页面 `getComputedStyle` + 主题表 grep 一致 | 流内分块**不能**靠填充差；边界只能用 0.5px 发丝线（`border-l1`=4% 黑几乎不可见，行线取 `border-l2`=10% 黑，实测 `rgba(0,0,0,0.1)`） |
| `0.5px` 在 DPR=1 上被画成 **1 设备像素** | 挂载门打印 `borderTopWidth` = `1px` | 门里的判据写「≥0.5px」，不写「==0.5」 |
| `raw.githubusercontent.com` 在本环境**完全不可达**（curl HTTP 000）；`avatars.githubusercontent.com` 可达但慢（1–10s） | curl 实测 | PR 正文图片必须走宿主代理路由；头像用真实 URL + 首字母回退（绝不出现破图图标） |
| 插件在自己渲染路径里抛错会**连带打掉宿主那条 slot 的整棵渲染树** | 页签整条不出现 → console 里 `chain is not iterable at LocaleRuntime.lookup`（当时调了私有 `lookup`） | 取词/取数一律裹 `safe()`；只碰公开面（`register` + `bind`） |
| 一个 client 行激活失败会**让整个 web boot 失败** | 负控门 C：坏 client 行 → 控制台 `web boot: 1 entry did not activate`，整页渲染不出来 | client 行的 `inject` 必须与服务名逐字一致；改服务名先跑负控 |
| `gh` 在写缓存时若 `~/.cache` 不可写会失败 | 沙箱内实测 | 门/测试里用 `XDG_CACHE_HOME` 指到自己的 scratch |

## 4. 验证证据（这些数字是"当时实测"，不是承诺）

门禁入口 `node scripts/gates/run.mjs`（`--list` 看清单，`--instance <仓库路径>` 加实例门）。

### 静态门（默认跑，不需要 gh / 浏览器）

| 门 | 守什么 |
|---|---|
| `package-contract` | `main`/`exports`/`dsh.bundle.patch`/`cordis.patch.yml` 的 insert 行/包名/`icon`/`files` 白名单**同源**；`dependencies`/`peerDependencies` 不得声明官方包；`exports["./package.json"]` 与 locale 导出在位 |
| `no-machine-paths` | 入库文本里不得有本机绝对路径与凭据（含会话 token）；单行逃生门 `gate-allow` |
| `decisions` | `decisions/implemented/<category>-<slug>.md` 四段齐全（Problem / Decision / Alternatives considered / Consequences）+ 分类在封闭集合内 + 有日期 |
| `md-links` | 文档里的相对链接都指到真文件 |
| `theme-tokens` | 客户端样式不写死颜色、不自带主题分支（`prefers-color-scheme` / `[data-theme]` / `.dark`）——深色主题露馅的**根因** |
| `generated-freshness` | 重新构建后 `lib/` 无漂移，且 `lib/` 真的被 git 跟踪（产物入库的代价必须有人守） |
| `typecheck` / `unit-tests` / `gate-self-tests` | `tsc --noEmit` / `vitest run` / 每个门禁拿非法样例自证会拒绝 |

### 实例门（`--instance <仓库路径>`，需要 gh 登录 + Playwright）

| 门 | 证明什么 | 最近一次实测 |
|---|---|---|
| `git-source` | **真实发布通道**（`git+file://` 等价于 README 给用户的 `github:` 源）装得上、boot 干净、路由真应答 | 全绿：无 ERESOLVE（git 依赖不装 devDependencies）、日志 0 失败行、三 op + 围栏通过 |
| `mounted` | 隔离 profile 里真装真跑：右栏条目出现 → 面板渲染出绑定的项目 → 行几何/分层/贴顶/头像都量成数字 | 全绿：行高 28/50、头带 47、行首留白 12、头像 x=717 两档一致、行线 1px/`rgba(0,0,0,0.1)`、贴顶 y=滚动口上沿、头像 22/22 无破图无悬挂 |
| `negative-control` | 负控：坏副本必须**响亮**报错，否则上面那条「日志干净」不算证据 | 全绿：A 基线 `entry:true`；B 坏 host → `did not activate` + `pending (waiting for service: …)` + 路由 405；C 坏 client → 条目不出现 + 控制台 `web boot: 1 entry did not activate` |
| `standalone` | better-sidebar 缺席时：host 半照常应答、client 半安全未激活 | 全绿 |

### 单元测试覆盖的"只有纯函数才钉得住"的东西

`tests/` 121 条（2 条 live 冒烟默认跳过，`PR_INBOX_LIVE=1` 才跑）：

- `repo.spec.ts`：`https` / `scp` / `ssh` / 带凭据 / 多段 owner 五种 remote 形态；
  且**凭据绝不进身份**。
- `prs.spec.ts` / `detail.spec.ts` / `image.spec.ts`：三个桶的限定词、分页与每个桶的
  独立降级；详情的有界截断；图片代理的词法围栏、扩展名与魔数、两段体积闸。
- `pr-image.spec.ts`：`refs/pull/<n>/head` 取图（fork PR 上 `headRefName` 必 404）+
  路径逃逸/绝对 URL/非 github host 一律拒。
- `gates.spec.mjs`：每个门禁的非法样例。

### 已知未完成的验收项

- **视觉验收**（图标与 UI 的实际观感、**深色主题**、窄侧栏）由人看图确认——本仓库的
  agent 侧只做到几何/计算样式/加载状态这类机械证据，见 §5。
- 正文图片只对"公开仓库 + 相对路径"做过代理取字节的验证；私有仓库未实测。

## 5. 视觉自检的现状

已做（机械/几何）：

- 浅色主题下量过：行几何坐标、发丝线颜色、圆角、卡片数、选中强调条（伪元素）、
  贴顶位置、头像槽全部 settle。
- 状态覆盖：静止 / hover（外链现形）/ 选中 / `:focus-visible`（官方 outline）/
  折叠分区；`prefers-reduced-motion` 有分支。
- 样式没被宿主吃掉：**在真实 GUI 里**取的计算样式（不是看源码）。

未做（需要人的眼睛）：

- 深色主题实看（token-only 写法在机制上成立，但没有目视证据）。
- 图标在 Plugins 页真实尺寸下的观感（机械证据：data URL、36×36、`naturalWidth>0`）。
- 窄侧栏（<320px）下长标签/长标题的观感。

## 6. 决策记录索引

非平凡改动都在 [`decisions/implemented/`](../decisions/implemented/)：

- `architecture-independent-plugin` — 为什么独立插件
- `architecture-gh-cli-not-pat` — 为什么复用 gh、不存 token
- `architecture-official-controls-injected-css` — 复用官方控件 + 注入表（而不是全量 JS 内联）
- `bug-fix-body-images-via-pull-ref` — fork PR 取图 404 的修法
- `bug-fix-hairlines-instead-of-fill-layers` — 分块/行边界（含 §3 的浅色主题事实）
- `bug-fix-locale-lookup-crashed-sidebar` — 取词崩溃连带打掉右栏
- `feature-readonly-three-buckets-v1` — v1 的边界
- `process-generated-lib-and-gate-shape` — 产物入库 + 门禁形态
- `testing-real-mount-gate-with-coordinates` — 为什么用坐标断言验收

## 7. 迭代状态

- 阶段一：工作区绑定 + `gh` 环境自检 + host↔client 通路。
- 阶段二：三桶列表 + 顶部搜索 + 简洁/详细切换（几何按 §4 的数字钉住）。
- 阶段三：点开一行 → 插件自渲染详情（正文、评论与评审时间线、改动文件清单；
  正文与时间线有界并如实标注截断，支线失败进 `warnings` 而不是空白）。
- 阶段四：发布前收敛（包契约、门禁、决策记录、locale 显示元数据、真实通道与负控）。
- 写操作（评论 / approve / merge）不在只读 v1 范围内。