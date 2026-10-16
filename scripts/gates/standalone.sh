#!/usr/bin/env bash
# 「better-sidebar 缺席」形态门（optional peer 的预期形态，设计文档 §5）：
# 只装 dsh-pr-inbox 的隔离 profile → host 半照常应答、client 半安全未激活。
#
# 用法： scripts/gates/standalone.sh <workspace 路径>
# 退出码：0 全通；非 0 表示某一步失败（日志在 $SCRATCH/server.log）。
#
# 之所以要有这个包装：脚本本体依赖 Playwright 的浏览器路径，而手敲很容易漏掉
# `PLAYWRIGHT_BROWSERS_PATH`（漏了会在 chromium.launch 处报一个与插件无关的错）。
set -uo pipefail

HERE=$(cd "$(dirname "$0")/../.." && pwd)
BASE=${SCRATCH:-${TMPDIR:-/tmp}/dsh-pr-inbox-gates}
SCRATCH="$BASE/standalone"
HOME_DIR="$SCRATCH/home"
WORKSPACE=${1:?用法: scripts/gates/standalone.sh <workspace 路径>——需要一个已绑定的 git 仓库路径}
PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-$SCRATCH/browsers}
export PLAYWRIGHT_BROWSERS_PATH

rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR" "$SCRATCH"

echo "== 构建 + 打包 =="
pnpm -C "$HERE" build || exit 1
TARBALL=$(pnpm -C "$HERE" pack --pack-destination "$SCRATCH" 2>/dev/null | tail -1)
[ -f "$TARBALL" ] || { echo "打包失败"; exit 1; }

echo "== 只装本插件（刻意不装 dsh-better-sidebar）=="
DSH_HOME="$HOME_DIR" dsh plugin --profile web add "$TARBALL" >/dev/null || exit 1
BUNDLES=$(node -e "console.log(JSON.stringify(require('$HOME_DIR/profiles/web/package.json').dsh.profile.bundles))")
echo "profile bundles: $BUNDLES"
case "$BUNDLES" in
  *dsh-better-sidebar*) echo "profile 里混进了 better-sidebar，这个门就失去意义了"; exit 1 ;;
esac

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
node "$HERE/scripts/gates/standalone.mjs" "$URL" "$WORKSPACE" || STATUS=1
kill "$SERVER_PID" 2>/dev/null
exit "$STATUS"