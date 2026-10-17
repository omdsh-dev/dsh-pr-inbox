# dsh-pr-inbox 设计与取舍（2026-10-16）

> 本文是**决策记录**：写清「为什么这样做」以及**已知边界**，避免后来者（或未来的我）
> 把有意的取舍当成缺陷去修。

## 1. 目标与范围

侧边栏的 **PR 面板**：自动绑定当前会话工作区的项目，按「与我相关」分桶原生渲染 Pull Request。

- **v1 只读**：不评论、不 approve、不合并、不改标签。先证明「看」这件事做对了。
- 三桶：`Authored by me`（`author:@me`）· `Needs my review`（`review-requested:@me`）· `Merged by me`（`is:merged author:@me`，取最近 **20** 条，展示按合并时间倒序）。
- 顶部搜索框（客户端过滤已加载页）+ 简洁/详细两档密度（选择持久化在 `localStorage`）。
- 点开一行 → **插件自己渲染**详情（正文 / 时间线 / 文件清单），不嵌网页。

「Needs my team's review」桶**有意未做**：GitHub 的团队口径要么是 org team
（`team-review-requested:<org>/<team>`，需要 `read:org` 且用户确实在 team 里），
要么是一份自配 reviewer 名单——两者都需要先有配置面。等有真实需求再按需要加，
比先做一个空桶好。

## 2. 关键取舍

| 决定 | 为什么 |
|---|---|
| **复用本机 `gh` CLI**，而不是插件内填 PAT | token 全程不进插件、不进 profile 设置、不进模型上下文（`gh` 自己管凭据）；代价是目标机器要有 `gh` 且已登录——缺它时给的是「装 gh / `gh auth login`」这种可操作提示，而不是空列表 |
| **独立插件，不进 better-sidebar 核心** | 核心的 Git 面板刻意保持「纯本地 git、零网络」。GitHub 那半边生态一直在做（`dsh-github-workbench` / `dsh-ide-git` / `dsh-dev-git-graph`），本插件用 `ctx.betterSidebar` 注册 tab 即可，不占核心的审阅带宽 |
| **绑定工作区而不是「先切仓库」** | 原料只有 git 自己：`rev-parse --show-toplevel` + remote → `owner/repo`（**upstream 优先**、其次 origin，fork 布局才绑得到主仓）；切会话即换项目 |
| **三桶走 `search/issues` 而不是 `gh search prs`** | ① 搜索接口回 `total_count`（桶头计数角标要它，`gh search prs` 不给）；② `is:merged` 能写进 q，而 `gh search prs --state` 不认 `merged`（只认 open/closed） |
| **颜色只消费 `--dsw-alias-*` 令牌** | 跟随深浅主题与皮肤中心；插件不持有任何颜色字面量 |

> 2026-10-17 修订：合并桶改为 `author:@me`（回答「我合并的工作有没有落地」，而不是仓库
> 全局合并流）；搜索仍按 updated 取一页，展示时按 `mergedAt` 倒序。密度持久化已按本文
> 实现。其余取舍见 `decisions/implemented/` 下的新记录。

## 3. 数据来源与端点

| op | 端点 | 说明 |
|---|---|---|
| `status` | `git` + `gh --version` + `gh api user` | 绑定与自检（探测结果 5 min 缓存、单飞） |
| `list` | `-X GET search/issues?q=…&per_page=…&sort=updated&order=desc` ×3 | 一桶一条；`total` 取 `total_count`，`rows` 是当页 |
| `detail` | `pulls/{n}` + `pulls/{n}/files` + `issues/{n}/comments` + `pulls/{n}/reviews` | 主查询必成功；三条支线 best-effort |

**坑（真实冒烟抓到，单测抓不到）**：`gh api` 带 `-f` 字段时**默认发 POST** —— 于是
文件清单 404、评论 422（`POST /issues/{n}/comments` 缺 body）。凡带 `-f` 的读都必须
显式 `-X GET`。`tests/detail.spec.ts` 现在有一条 argv 断言把这个教训钉住。

## 4. 有界与稳态

- **缓存**：`list` 60 s / 上限 12；`detail` 30 s / 上限 8；`gh` 探测 5 min / 1 条。
  全部单飞 + LRU 淘汰；**失败永不入缓存**（否则一次限流会在 TTL 内持续显示空桶）。
- **响应有界**：正文 64 KiB、单条评论 8 KiB（截断带 `*Truncated` 标记）；文件 100 /
  评论 50 / review 50 一页，并与 GitHub 报的总数比较给出截断标记。
- **配额**：搜索 API 已认证 30 次/分；一次 `list` = 3 条查询 + 60 s TTL，反复切
  tab 不会打配额（客户端还有可见性门控 + 无定时器）。
- **降级**：桶级错误只影响该桶（其余照常出数据）；`detail` 的支线失败只写
  `warnings[]`。两条都让「一次 403 变空白页」不可能发生。

## 5. 已知边界

1. **只支持 `github.com`**：其他 host 上 `list` 回 `note`（不猜数据）、`detail` 回
   `unsupported-host(501)`。
2. **只读**：没有任何写操作；也**不**接管聊天里的 GitHub 链接。
3. **搜索只在已加载的这一页里做**（不掉配额）；服务端搜索留给后续。
4. `Recently merged` 是**最近 20 条**，不是时间窗。
5. better-sidebar 缺席时：host 半照常加载，client 半因 `inject: ['betterSidebar']`
   保持未激活——不会崩，也不会有入口（这是 `optional peer` 的预期形态）。
   **已实测**（`scripts/verify-standalone.mjs`，只装本插件的隔离 profile）：
   自有路由仍回 200 且绑定可用、页面上没有 `[data-dsh-better-sidebar]`、零 pageerror。

## 6. 验证矩阵

| 层 | 命令 | 覆盖 |
|---|---|---|
| 类型 | `pnpm typecheck` | 两端 + 测试 |
| 单测 | `pnpm test` | 69 条：remote 解析 / gh 错误分类 / 三桶契约 / 详情归一化与降级 / 发布门 |
| 真实 gh（可选） | `PR_INBOX_LIVE=1 pnpm test` | 真数据：三桶 + 详情（默认跳过，不进 CI） |
| 隔离实例两层门 | `bash scripts/verify-host.sh <workspace> <owner/repo>` | ① 自有路由三 op（含入参围栏）② 浏览器级：原生右栏条目→三桶→密度→搜索→详情→返回 |
| 独立形态（better-sidebar 缺席） | `node scripts/verify-standalone.mjs <url> <cwd>` | host 路由仍应答 + 绑定可用；client 半安全未激活、页面零报错 |
| 发布物 | `pnpm pack` + `tests/package.spec.ts` | tarball 只含 `lib/*` + patch + README + LICENSE + package.json |

实测（2026-10-16，**DSH 0.2.0-rc.2** / gh 2.96.0）：`authored` 2 条（含 #969）·
`review` 0 · `merged` total=276 取 20；详情 #969 正文 2804 字符 / 42 文件 / 时间线 1。
错误路径不是靠合成字符串：`tests/gh-errors.spec.ts` 真起进程验证了
gh 缺失（ENOENT→501）、空 config dir 未登录（gh 真实退出码 4→401）、
以及挂住的 gh 被超时杀掉（→504，实测 0.4 s 返回）。

## 7. 发布与分批

功能上可分三批（也是三次提交的主题）：

1. `feat(host): 绑定 + gh 边界 + 三桶取数层`（`src/host/{gh,repo,prs,routes}.ts` + 契约测试）
2. `feat(client): 三桶列表 + 搜索 + 简洁/详细`（tab 注册 + 列表 UI）
3. `feat(client): PR 详情原生渲染` + `feat(host): 详情取数`（两者同批，缺一不可）
   以及 `test: 发布门` / `test: 隔离实例两层门`。

**待定的前置**：这个仓库目前**没有 git 远端**。要提 PR 或走 `github:` 源安装，
需要先决定归属（GitHub 用户/组织、仓库名、公开性）。npm 包名 `dsh-pr-inbox`
已确认未被占用；`lib/` 已随提交入库（`github:` 源安装免构建）。