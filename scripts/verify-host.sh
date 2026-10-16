#!/usr/bin/env bash
# dsh-pr-inbox 的真实挂载自检（隔离 DSH_HOME，不碰 ~/.dsh 与任何在跑的 GUI）：
#   构建 → 打包 → 装进全新 profile（better-sidebar + 本插件）→ 起实例
#   → ① host 路由断言（gh + 工作区绑定）② 浏览器级断言（右栏 PR 条目 + 面板渲染）
#
# 用法： scripts/verify-host.sh [workspace 路径] [期望的 owner/repo]
# 退出码：0 全通；非 0 表示某一步失败（日志在 $SCRATCH/server.log）。
set -uo pipefail

HERE=$(cd "$(dirname "$0")/.." && pwd)
SCRATCH=${SCRATCH:-$HERE/../.scratch/pr-inbox-verify}
HOME_DIR="$SCRATCH/home"
WORKSPACE=${1:-/Users/vlln/Project/dsh-plugins/DSH-better-sidebar}
EXPECT_REPO=${2:-omdsh-dev/DSH-better-sidebar}
BS_VERSION=${BETTER_SIDEBAR_VERSION:-0.26.1}
PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-/tmp/dsh-git-playwright}
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
node "$HERE/scripts/verify-host.mjs" "$URL" "$WORKSPACE" || STATUS=1
echo "== ② 浏览器级（右栏条目 + 面板渲染 + 头像解码）=="
SCREENSHOT_DIR="$SCRATCH" node "$HERE/scripts/mount-check.mjs" "$URL" "$WORKSPACE" "$EXPECT_REPO" || STATUS=1
echo "== ③ 插件图标（Plugins 页：宿主把 icon.svg 变成图片）=="
SCREENSHOT_DIR="$SCRATCH" node "$HERE/scripts/verify-icon.mjs" "$URL" dsh-pr-inbox || STATUS=1

kill "$SERVER_PID" 2>/dev/null
[ "$STATUS" -eq 0 ] && echo "✅ 三项自检全通（截图在 ${SCRATCH}）"
exit "$STATUS"