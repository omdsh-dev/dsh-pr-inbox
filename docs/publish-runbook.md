# 发布 runbook（决定一到即可照做）

> 为什么有这份文件：功能与验证已经闭环，唯一卡住的是**仓库归属**这个人类决定。
> 把它写成可执行清单，决定落地后不需要任何重新调查。

## 0. 前置（需要人拍板）

- [ ] GitHub 所有者（用户或组织）+ 仓库名（当前 `package.json` 里的名字是 `dsh-pr-inbox`）
- [ ] 公开性（`--public` / `--private`）
- [ ] 是否同时发 npm（只走 `github:` 源安装也可以：`lib/` 已入库，使用者免构建）
- [ ] 用户验收结论（原型已可复现验收，见 §4）

npm 名 `dsh-pr-inbox` 已确认未被占用（2026-10-16 查，`registry.npmjs.org` 404）。

## 1. 建远端并推 `main`

```bash
cd dsh-pr-inbox
gh repo create <owner>/dsh-pr-inbox --public --source . --remote origin --push
# 等价的手工形态：
# git remote add origin git@github.com:<owner>/dsh-pr-inbox.git && git push -u origin main
```

推上去 CI 自动生效（[.github/workflows/ci.yml](../.github/workflows/ci.yml)）：
`install --frozen-lockfile → typecheck → test → build → lib 与提交一致 → tarball 内容断言`。
**不需要任何凭据**——真实 gh 的冒烟用例默认跳过。

## 2. （可选）发 npm

```bash
pnpm publish --access public
```

- 走 Trusted Publishing（OIDC）就照 better-sidebar 的 `.github/workflows/release.yml`
  模式加一个 release 工作流；配了 npm 的 Trusted Publisher（Provider `GitHub Actions`、
  Org/Repo、Workflow filename）后不需要 `NPM_TOKEN`。
- 只走 `github:` 源安装（`dsh plugin --profile web add "github:<owner>/dsh-pr-inbox#v0.1.0"`）
  则跳过本步；`lib/` 入库正是为这条路准备的。

## 3. 分批节奏（本轮已按此提交，发布时对应 tag/批次）

| 批次 | 内容 | 现成提交 |
|---|---|---|
| ① host 取数层 | 绑定 + `gh` 边界 + 三桶 + 详情取数 + 契约测试 | `0454361` `54f4ff2` `0454361` 一带 |
| ② 列表 UI | tab 注册 + 三桶 + 搜索 + 简洁/详细 | `ad7696a` |
| ③ 详情 UI | 点开一行 → 插件自渲染详情 | `7ab4c75` |
| ④ 门与文档 | 两层真实挂载门、发布门、CI、设计记录 | `c36e935` `e56ac7c` `9c71c9b` `ba482f1` `a5c46e3` |

## 4. 复现验收（一条命令）

```bash
SCRATCH=/tmp/pr-inbox-accept bash scripts/verify-host.sh /path/to/some/repo owner/repo
```

它会：build → pack → 装进**全新隔离 profile**（better-sidebar + 本插件）→ 起随机端口实例
→ ① 断言自有路由三 op（含入参围栏）② 用 Playwright 种子会话并断言原生右栏条目、
三桶行数、密度切换、搜索过滤、**详情打开/返回**，并打印实例 URL 与三张截图。

独立形态（没装 better-sidebar）另有一条：

```bash
node scripts/verify-standalone.mjs <launch-url> <cwd>
```

## 5. （可选）加进 better-sidebar 的推荐插件目录

这是给 `omdsh-dev/DSH-better-sidebar` 的一个小 PR（**PR 目标分支是 `dev`**，
分支名用 `feat/catalog-pr-inbox` 这类，别用 `dev/` 前缀）：

1. `src/client/plugins-tabs.ts`：追加一条 entry（按 id 字母序插入）
   - `id: 'dsh-pr-inbox'`（= npm 包名）
   - `url: 'https://github.com/<owner>/dsh-pr-inbox'`
   - `name: () => t('pluginPrInboxName')` / `description: () => t('pluginPrInboxDesc')`
   - `install: 'cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add dsh-pr-inbox'`
     （安装行必须以 `cd ~/.dsh` 开头——该仓库的 `tests/plugin-list.spec.ts` 会校验）
2. `src/client/locales.ts`：加 `pluginPrInboxName` / `pluginPrInboxDesc` 的 **zh 与 en** 两份
3. `src/client/locales-ja.ts`：同步 ja 翻译（该仓库硬规则：新增 zh key 必须同步 ja）
4. 门禁：那个仓库里跑 `pnpm typecheck && pnpm lint && pnpm test`，再按 AGENTS 的
   分支模型提 PR 到 `dev`

## 6. 发布前应被接受的边界（写在这里，避免事后当成缺陷）

- 只支持 `github.com`（其它 host：列表回 `note`、详情回 `unsupported-host/501`）
- 只读：没有任何写操作，也不接管聊天里的 GitHub 链接
- 需要本机 `gh` 已登录（凭据不进插件、不进设置、不进模型上下文——这是有意的取舍）
- `Recently merged` 是最近 20 条，不是时间窗；搜索只在已加载页内做