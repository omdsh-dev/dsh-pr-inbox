#!/usr/bin/env bash
# git 源安装冒烟：**真实发布通道**（README 里给用户的那条命令）在本地走一遍。
#
#   clone 已提交的 HEAD → 装进全新隔离 profile（better-sidebar + `git+file://<clone>`）
#   → 起实例 → ① boot 日志不得有"没激活/加载失败" ② 真调一次自有路由（三 op + 围栏）
#
# 为什么单独一道门：tarball 装得上不代表 git 源装得上——两者由 pnpm 用不同路径解析
# （git 源要 clone、要按 git 依赖规则处理 devDependencies / prepare）。发布前跑一次，
# 比发布后听用户说"装完没反应"便宜得多。
#
# 用法： scripts/gates/git-source.sh <workspace 路径>
# 前置：gh 已登录、Playwright 驱动（复用的是 host-ops 门，它要 request context）。
set -uo pipefail

HERE=$(cd "$(dirname "$0")/../.." && pwd)
BASE=${SCRATCH:-${TMPDIR:-/tmp}/dsh-pr-inbox-gates}
SCRATCH="$BASE/git-source"
HOME_DIR="$SCRATCH/home"
WORKSPACE=${1:?用法: scripts/gates/git-source.sh <workspace 路径>——host-ops 需要一个已绑定的 git 仓库}
BS_VERSION=${BETTER_SIDEBAR_VERSION:-0.26.1}

rm -rf "$SCRATCH"
mkdir -p "$HOME_DIR" "$SCRATCH"

echo "== clone 已提交的 HEAD（git 源安装拿到的东西）=="
git clone --quiet "$HERE" "$SCRATCH/repo" || exit 1
echo "commit: $(git -C "$SCRATCH/repo" log --oneline -1)"

echo "== 装进隔离 profile（git+file 源）=="
DSH_HOME="$HOME_DIR" dsh plugin --profile web add "dsh-better-sidebar@$BS_VERSION" >/dev/null || exit 1
if ! DSH_HOME="$HOME_DIR" dsh plugin --profile web add "git+file://$SCRATCH/repo" > "$SCRATCH/install.log" 2>&1; then
  echo "git 源安装失败，日志尾部："
  tail -20 "$SCRATCH/install.log"
  exit 1
fi
echo "安装输出尾部：$(tail -3 "$SCRATCH/install.log" | tr '\n' ' ')"

echo "== 起实例（随机端口）=="
DSH_HOME="$HOME_DIR" dsh web --port 0 --no-open > "$SCRATCH/server.log" 2>&1 &
SERVER_PID=$!
URL=""
for _ in $(seq 1 60); do
  URL=$(grep -oE "http://127\.0\.0\.1:[0-9]+/\?token=[^ ]*" "$SCRATCH/server.log" | tail -1)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "实例未就绪，日志尾部："
  tail -20 "$SCRATCH/server.log"
  kill "$SERVER_PID" 2>/dev/null
  exit 1
fi
echo "实例：$URL"

STATUS=0
LOUD=$(grep -icE "did not activate|failed to load|Cannot find (module|package)" "$SCRATCH/server.log" || true)
echo "· boot 日志里「没激活/加载失败」行数：$LOUD"
[ "$LOUD" -eq 0 ] || { echo "  ✗ git 源装出来的实例 boot 不干净："; grep -iE "did not activate|failed to load|Cannot find (module|package)" "$SCRATCH/server.log" | head -5; STATUS=1; }

echo "== 真调一次自有路由 =="
node "$HERE/scripts/gates/host-ops.mjs" "$URL" "$WORKSPACE" || STATUS=1

kill "$SERVER_PID" 2>/dev/null
[ "$STATUS" -eq 0 ] && echo "✅ git 源安装冒烟通过（日志在 ${SCRATCH}）"
exit "$STATUS"