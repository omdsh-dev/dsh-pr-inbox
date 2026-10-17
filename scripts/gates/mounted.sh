#!/usr/bin/env bash
# dsh-pr-inbox 的真实挂载门（隔离 DSH_HOME，不碰 ~/.dsh 与任何在跑的 GUI）：
#   构建 → 打包 → 装进全新 profile（better-sidebar + 本插件）→ 起实例
#   → ① host 路由（gh + 工作区绑定 + 图片代理）② 浏览器级（右栏条目 + 面板渲染 + 行几何）
#   → ③ 插件图标（Plugins 页里宿主把 icon.svg 变成图片）
#
# 环境变量：THEME=dark 让浏览器按深色偏好加载（宿主读 prefers-color-scheme），
# 于是同一套断言与截图都能在深色下再跑一遍（截图名带 -dark 后缀）。
#
# 用法： scripts/gates/mounted.sh <workspace 路径> [期望的 owner/repo]
# 前置：本机 gh 已登录（门会真的打 GitHub API）、Playwright 驱动与浏览器（见 lib/playwright.mjs）。
# 退出码：0 全通；非 0 表示某一步失败（日志在 $SCRATCH/server.log）。
set -uo pipefail

HERE=$(cd "$(dirname "$0")/../.." && pwd)
BASE=${SCRATCH:-${TMPDIR:-/tmp}/dsh-pr-inbox-gates}
SCRATCH="$BASE/mounted"
HOME_DIR="$SCRATCH/home"
WORKSPACE=${1:?用法: scripts/gates/mounted.sh <workspace 路径> [期望的 owner/repo]——需要一个已绑定的 git 仓库路径}
EXPECT_REPO=${2:-}
BS_VERSION=${BETTER_SIDEBAR_VERSION:-0.28.0}
PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-$SCRATCH/browsers}
export PLAYWRIGHT_BROWSERS_PATH

rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR" "$SCRATCH"

echo "== 构建 + 打包 =="
pnpm -C "$HERE" build || exit 1
TARBALL=$(pnpm -C "$HERE" pack --pack-destination "$SCRATCH" 2>/dev/null | tail -1)
[ -f "$TARBALL" ] || { echo "打包失败"; exit 1; }

echo "== 装进隔离 profile =="
DSH_HOME="$HOME_DIR" dsh plugin --profile web add "dsh-better-sidebar@$BS_VERSION" >/dev/null || exit 1
DSH_HOME="$HOME_DIR" dsh plugin --profile web add "$TARBALL" >/dev/null || exit 1

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
echo "== ① host 路由 =="
node "$HERE/scripts/gates/host-ops.mjs" "$URL" "$WORKSPACE" || STATUS=1
echo "== ② 浏览器级（右栏条目 + 面板渲染 + 行几何）=="
SCREENSHOT_DIR="$SCRATCH" node "$HERE/scripts/gates/mount.mjs" "$URL" "$WORKSPACE" "$EXPECT_REPO" || STATUS=1
echo "== ③ 插件图标（Plugins 页：宿主把 icon.svg 变成图片）=="
SCREENSHOT_DIR="$SCRATCH" node "$HERE/scripts/gates/plugin-icon.mjs" "$URL" dsh-pr-inbox || STATUS=1

kill "$SERVER_PID" 2>/dev/null
[ "$STATUS" -eq 0 ] && echo "✅ 挂载门全通（截图在 ${SCRATCH}）"
exit "$STATUS"