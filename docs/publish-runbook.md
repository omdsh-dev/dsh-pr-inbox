# 发布 runbook（照做即可）

> 为什么有这份文件：功能、契约、门禁、文档都已经收敛（见
> [engineering-notes.md](engineering-notes.md)），剩下的只有**几个人类决定**和按下按钮。
> 本文件只写"决定 → 命令"，不含需要重新调查的内容。

## 0. 状态与待拍板

**已定（2026-10-17）**：发布到 **`omdsh-dev/dsh-pr-inbox`（public）**，只走 GitHub
git 源（`lib/` 入库，使用者免构建）；暂不发 npm、暂不发官方 Discussions。

- [x] GitHub 所有者 + 仓库名：**`omdsh-dev/dsh-pr-inbox`**（2026-10-17 定）
- [x] 公开性：**public**
- [ ] 是否同时发 npm：暂缓（只走 `github:` 源完全可以）
- [ ] 是否在官方 Discussions 的 `Show Your Plugins!` 发一条介绍（对外可见的动作，需单独明确同意）

npm 名 `dsh-pr-inbox` 已确认未被占用（2026-10-16 查 `registry.npmjs.org` 返回 404）。

## 1. 发布前最后一次验证（本地，需要 gh 已登录 + Playwright）

```bash
node scripts/gates/run.mjs                      # 9 个静态门
node scripts/gates/run.mjs --list               # 看实例门与各自前置
node scripts/gates/run.mjs --instance /path/to/some/repo   # 4 个实例门
```

实例门各自证明什么、最近一次实测看到什么，见
[engineering-notes.md](engineering-notes.md) §4。其中 `git-source` 走的就是 README 给
用户的通道（clone 已提交 HEAD → 装 → 干净 boot → 真调路由），`negative-control` 保证
"日志干净"这句话有对照。

## 2. 建远端并推 `main`

```bash
gh repo create omdsh-dev/dsh-pr-inbox --public --source . --remote origin --push
# 等价手工形态：
# git remote add origin git@github.com:omdsh-dev/dsh-pr-inbox.git && git push -u origin main
```

推上去 CI 自动生效（[.github/workflows/ci.yml](../.github/workflows/ci.yml)）：
`pnpm install --frozen-lockfile` → `node scripts/gates/run.mjs` → tarball 内容断言。
**不需要任何凭据**（实例门不在 CI 里跑，真实 gh 的冒烟用例默认跳过）。

## 3. 打 tag（README 的"钉版本"命令引用的就是它）

```bash
git tag -a v0.1.1 -m "dsh-pr-inbox v0.1.1"
git push origin v0.1.1
```

## 4. 仓库描述与 topics（搜索里能被一眼看懂 + 能被搜到）

```bash
gh repo edit omdsh-dev/dsh-pr-inbox \
  --description "把与你相关的 GitHub PR（我提的 / 待我审 / 我合并的）照进 DSH 侧边栏，复用本机 gh 登录，只读（DeepSeek Harness 插件）" \
  --add-topic dsh-plugin --add-topic deepseek-harness \
  --add-topic pull-request --add-topic github --add-topic sidebar
```

description 只写"是什么 + 能干什么"，安装命令属于 README。
topics 必选 `dsh-plugin` / `deepseek-harness`，其余是功能词。

## 5. （可选）发 npm

```bash
pnpm publish --access public
```

走 Trusted Publishing（OIDC）就照 better-sidebar 的 `.github/workflows/release.yml`
模式加一个 release 工作流；配好 npm 的 Trusted Publisher（Provider `GitHub Actions` +
Org/Repo + Workflow filename）后不需要 `NPM_TOKEN`。

## 6. （可选）加进 better-sidebar 的推荐插件目录

给 `omdsh-dev/DSH-better-sidebar` 一个小 PR（**目标分支是 `dev`**，分支名用
`feat/catalog-pr-inbox` 这类）：

1. `src/client/plugins-tabs.ts`：按 id 字母序插入一条
   - `id: 'dsh-pr-inbox'`（= npm 包名）
   - `url: 'https://github.com/omdsh-dev/dsh-pr-inbox'`
   - `name: () => t('pluginPrInboxName')` / `description: () => t('pluginPrInboxDesc')`
   - `install: 'cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add github:omdsh-dev/dsh-pr-inbox'`
     （该仓库的 `tests/plugin-list.spec.ts` 要求安装行以 `cd ~/.dsh` 开头）
2. `src/client/locales.ts`：加 `pluginPrInboxName` / `pluginPrInboxDesc` 的 zh 与 en
3. `src/client/locales-ja.ts`：同步 ja（该仓库硬规则：新增 zh key 必须同步 ja）
4. 门禁：`pnpm typecheck && pnpm lint && pnpm test`，再按 AGENTS 的分支模型提 PR 到 `dev`

## 7. （可选）官方 Discussions 发一条介绍

发之前先核实分类还在（分类名会被维护者改）：

```bash
gh api graphql -f query='{ repository(owner: "deepseek-ai", name: "deepseek-harness") {
  hasDiscussionsEnabled discussionCategories(first: 20) { nodes { name slug } } } }'
```

然后 `gh discussion create --repo deepseek-ai/deepseek-harness --category <slug> \
--title "<插件名>：<一句话价值主张>" --body-file <文件>`。正文一屏读完：一句话是什么、
安装命令、一张截图、仓库链接；**一个插件一条**，更新就编辑原帖。

## 8. 发布后应被接受的边界（避免事后当成缺陷）

- 只支持 `github.com`（其它 host：列表回 `note`、详情回 `unsupported-host/501`）
- 只读：没有任何写操作，也不接管聊天里的 GitHub 链接
- 需要本机 `gh` 已登录（凭据不进插件、不进设置、不进模型上下文——有意的取舍）
- `我合并的` 是最近 20 条，不是时间窗（展示按合并时间倒序）；搜索只在已加载的行里做
- 深色已机械验证并留了截图；**图标观感与窄侧栏**仍需人工目视（见 engineering-notes §5）