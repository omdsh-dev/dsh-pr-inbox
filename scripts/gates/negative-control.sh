#!/usr/bin/env bash
# 负控门：证明"坏副本会响亮报错"，否则 mounted 的干净日志不算证据。
#
# 三个阶段，全部在**隔离 DSH_HOME + 随机端口**里跑：
#   A 基线（未改动的产物）：boot 干净 + 自有路由应答 + 右栏条目真的出现
#   B 坏 host 半（inject 指向不存在的服务）：boot 日志必须点名 "did not activate" /
#     "pending (waiting for service: …)"，且自有路由不再应答
#   C 坏 client 半（client 行的 inject 指向不存在的服务）：右栏条目不得出现，
#     且浏览器控制台必须报 "did not activate"
#
# 三者都用**同一个探针**判定，所以 A 绿 / B,C 红构成对照——只跑坏的那几个看不出
# "探针本来能不能判绿"。
#
# 用法： scripts/gates/negative-control.sh <workspace 路径>
# 前置：gh 已登录（better-sidebar 与实例启动需要）、Playwright 驱动与浏览器。
set -uo pipefail

HERE=$(cd "$(dirname "$0")/../.." && pwd)
BASE=${SCRATCH:-${TMPDIR:-/tmp}/dsh-pr-inbox-gates}
SCRATCH="$BASE/negative-control"
WORKSPACE=${1:?用法: scripts/gates/negative-control.sh <workspace 路径>}
BS_VERSION=${BETTER_SIDEBAR_VERSION:-0.26.1}
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-$SCRATCH/browsers}

rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"

STATUS=0
say() { echo "$@"; }
bad() { echo "  ✗ $*"; STATUS=1; }

# ── 0) 打包 + 造两个坏副本（改的都是**已提交的产物**，即使用者真正拿到的东西）──
say "== 打包 + 造坏副本 =="
pnpm -C "$HERE" build >/dev/null || exit 1
TARBALL=$(pnpm -C "$HERE" pack --pack-destination "$SCRATCH" 2>/dev/null | tail -1)
[ -f "$TARBALL" ] || { echo "打包失败"; exit 1; }
for variant in good host client; do
  mkdir -p "$SCRATCH/build/$variant"
  tar xzf "$TARBALL" -C "$SCRATCH/build/$variant"
done
patch_file() { # $1=file $2=old $3=new $4=人话
  node -e '
    const [file, from, to, what] = process.argv.slice(1)
    const { readFileSync, writeFileSync } = require("node:fs")
    const text = readFileSync(file, "utf8")
    const next = text.replace(from, to)
    if (next === text) { console.error(`负控：没能改坏${what}（产物形态变了？缺 "${from}"）`); process.exit(1) }
    writeFileSync(file, next)
  ' "$1" "$2" "$3" "$4" || exit 1
}
patch_file "$SCRATCH/build/host/package/lib/index.js" \
  'const inject = ["webServer"]' 'const inject = ["noSuchService"]' " host 半的 inject" || exit 1
patch_file "$SCRATCH/build/client/package/lib/client.js" \
  'const inject = ["betterSidebar"]' 'const inject = ["noSuchClientService"]' " client 行的 inject" || exit 1

tar czf "$SCRATCH/good.tgz" -C "$SCRATCH/build/good" package
tar czf "$SCRATCH/broken-host.tgz" -C "$SCRATCH/build/host" package
tar czf "$SCRATCH/broken-client.tgz" -C "$SCRATCH/build/client" package
say "  good / broken-host / broken-client 三个产物就绪"

# ── 1) 起一个装了指定 tarball 的隔离实例；把 URL 写进 $URL_FILE ────────────────
start_instance() { # $1=名字 $2=tarball
  local name=$1 tarball=$2 home="$SCRATCH/$1/home"
  rm -rf "$home"; mkdir -p "$home"
  DSH_HOME="$home" dsh plugin --profile web add "dsh-better-sidebar@$BS_VERSION" >/dev/null 2>&1 \
    || { echo "better-sidebar 装不上"; return 1; }
  DSH_HOME="$home" dsh plugin --profile web add "$tarball" >/dev/null 2>&1 \
    || { echo "$name 装不上"; return 1; }
  DSH_HOME="$home" dsh web --port 0 --no-open > "$SCRATCH/$name/server.log" 2>&1 &
  echo $! > "$SCRATCH/$name/pid"
  local url="" i
  for i in $(seq 1 60); do
    url=$(grep -oE "http://127\.0\.0\.1:[0-9]+/\?token=[^ ]*" "$SCRATCH/$name/server.log" | tail -1)
    [ -n "$url" ] && break
    sleep 1
  done
  [ -n "$url" ] || { echo "$name 实例未就绪"; tail -5 "$SCRATCH/$name/server.log"; return 1; }
  echo "$url" > "$SCRATCH/$name/url"
  echo "$url"
}

stop_instance() { # $1=名字
  local pid
  pid=$(cat "$SCRATCH/$1/pid" 2>/dev/null || true)
  [ -n "$pid" ] && kill "$pid" 2>/dev/null
  return 0
}

probe_entry() { # $1=url → 打印 JSON
  node "$HERE/scripts/gates/lib/panel-entry-probe.mjs" "$1" "$WORKSPACE"
}

# ── A) 基线：好副本必须"绿"（探针能判绿，B/C 的红才有意义）──────────────────
say "== A 基线（未改动的产物）=="
GOOD_URL=$(start_instance good "$SCRATCH/good.tgz") || exit 1
say "  实例：$GOOD_URL"
GOOD_STATUS=$(node "$HERE/scripts/gates/lib/probe-route.mjs" "$GOOD_URL" status)
LOUD=$(grep -icE "did not activate|failed to load" "$SCRATCH/good/server.log" || true)
say "  路由状态 $GOOD_STATUS · 日志里的失败行 $LOUD"
case "$GOOD_STATUS" in 200|400) ;; *) bad "基线：自有路由不应答（状态 ${GOOD_STATUS}）";; esac
[ "$LOUD" -eq 0 ] || bad "基线：boot 日志里出现激活/加载失败"
GOOD_PROBE=$(probe_entry "$GOOD_URL")
say "  条目探针：$GOOD_PROBE"
case "$GOOD_PROBE" in *'"entry":true'*) ;; *) bad "基线：右栏条目没出现（探针判不出绿，后面 B/C 的红不作数）";; esac
stop_instance good

# ── B) 坏 host 半 ────────────────────────────────────────────────────────────
say "== B 坏 host 半（inject → 不存在的服务）=="
HOST_URL=$(start_instance host "$SCRATCH/broken-host.tgz") || exit 1
HOST_STATUS=$(node "$HERE/scripts/gates/lib/probe-route.mjs" "$HOST_URL" status)
say "  路由状态 ${HOST_STATUS}（基线是 ${GOOD_STATUS}）"
grep -iE "did not activate|pending \(waiting for service" "$SCRATCH/host/server.log" | head -3 | sed 's/^/  | /'
grep -qiE "did not activate" "$SCRATCH/host/server.log" || bad "坏 host：boot 日志没有点名的 'did not activate'（失败不够响亮）"
grep -q "noSuchService" "$SCRATCH/host/server.log" || bad "坏 host：日志没有点出缺的是哪个服务"
case "$HOST_STATUS" in 200|400) bad "坏 host：自有路由竟然还应答（状态 ${HOST_STATUS}）";; esac
stop_instance host

# ── C) 坏 client 半 ─────────────────────────────────────────────────────────
say "== C 坏 client 半（client 行 inject → 不存在的服务）=="
CLIENT_URL=$(start_instance client "$SCRATCH/broken-client.tgz") || exit 1
CLIENT_PROBE=$(probe_entry "$CLIENT_URL")
say "  条目探针：$CLIENT_PROBE"
case "$CLIENT_PROBE" in
  *'"entry":true'*) bad "坏 client：右栏条目竟然还出现了（坏得不够明显）";;
esac
case "$CLIENT_PROBE" in
  *'did not activate'*) ;;
  *) bad "坏 client：浏览器控制台没有 'did not activate'（失败不够响亮）";;
esac
stop_instance client

if [ "$STATUS" -eq 0 ]; then
  echo "✅ 负控通过：好副本绿、两个坏副本各自响亮报错（日志在 ${SCRATCH}）"
else
  echo "✗ 负控未通过——在负控修好之前，任何「干净日志」都不算证据"
fi
exit "$STATUS"