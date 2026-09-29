#!/usr/bin/env bash
# 监听直播间的弹幕、礼物、进场等事件一段时间，写到 jsonl 文件；结束时按事件类型统计。
#
# 用法：
#   examples/live-to-file.sh <platform> <room> [时长，默认 10m] [输出文件，默认 live-<platform>-<时间>.jsonl]
#
# 例子：
#   examples/live-to-file.sh bilibili <room_id> 30m
#   examples/live-to-file.sh douyin "https://live.douyin.com/<web_rid>" 1h douyin-live.jsonl
#   examples/live-to-file.sh tiktok @<host_username> 600
#
# 时长：秒数，或 30s、10m、1h（catbus 的 --duration）。到时间或按 Ctrl-C 都正常结束，已收到的事件都在文件里。
# 哪些平台支持 live listen：catbus platforms 查看（目前是 xhs、douyin、tiktok、bilibili、kuaishou）。
#
# 环境变量：
#   APPEND=1  追加到已有文件，不覆盖
#   CATBUS    catbus 命令，默认 catbus；从源码运行时可设为 "node /path/to/catbus/dist/cli/main.js"
#
# 输出：每行一个 Event（AGENTS.md 6.2），例如
#   {"type":"chat","time":"2026-09-29T20:00:01+08:00","user":{"id":"...","name":"...","url":"..."},"text":"...","gift":null}
#   type 取值 chat / gift / like / enter / follow / other。
#
# 依赖：bash；jq 只用于结束时的统计，没有 jq 也能录。
set -euo pipefail

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//' >&2
  exit 2
}

[[ $# -ge 2 && -n $1 && -n $2 ]] || usage
platform=$1
room=$2
duration=${3:-10m}
out=${4:-live-$platform-$(date +%Y%m%d-%H%M%S).jsonl}
[[ $duration =~ ^[0-9]+(\.[0-9]+)?[smh]?$ ]] || { echo "时长的格式是秒数，或 30s、10m、1h：$duration" >&2; exit 2; }

read -r -a CATBUS_CMD <<<"${CATBUS:-catbus}"
cb() { "${CATBUS_CMD[@]}" "$@"; }

[[ ${APPEND:-} == 1 ]] || : >"$out"
echo "监听 $platform 直播间 $room，时长 $duration → $out（Ctrl-C 提前结束）" >&2

# live listen 总是输出 jsonl：stdout 每行一个事件；日志和结束时的摘要信封在 stderr，原样显示在终端。
# 显式写上 -o jsonl：这样连「未登录」这类开始前的错误也写到 stderr，不会混进事件文件。
# Ctrl-C 由 catbus 自己处理（写完已收到的事件，退出码 0）。这里给 SIGINT 装一个空的 trap，
# 让脚本等 catbus 收尾后继续做统计，而不是跟着一起退出（用 trap '' 会让子进程也忽略 Ctrl-C，不能用）。
trap ':' INT
rc=0
cb "$platform" live listen "$room" --duration "$duration" -o jsonl >>"$out" || rc=$?
trap - INT

total=$(grep -c . "$out" || true)
if [[ $rc -ne 0 ]]; then
  case $rc in
    2) echo "参数有误，或 $platform 没有这个命令（错误信息见上面的信封）" >&2 ;;
    3) echo "需要登录：catbus $platform auth login" >&2 ;;
    4) echo "$platform 的 live listen 还没有实现（catbus platforms $platform 查看支持的命令）" >&2 ;;
    5) echo "被平台风控拦下，稍后再试（detail 见上面的信封）" >&2 ;;
    6) echo "网络错误；长连接断线会自动重连，这里是重连也失败了。检查网络和代理（catbus config get proxy）" >&2 ;;
    *) echo "监听失败，退出码 $rc（错误信息见上面的信封）" >&2 ;;
  esac
  [[ $total -eq 0 ]] || echo "已收到的 $total 条事件仍在 $out" >&2
  exit "$rc"
fi

echo "结束：共 $total 条事件 → $out" >&2
if command -v jq >/dev/null && [[ $total -gt 0 ]]; then
  # 按类型计数；礼物再按名称汇总数量
  jq -rs 'group_by(.type) | map("  \(.[0].type)\t\(length)") | .[]' "$out" >&2
  gifts=$(jq -rs '[.[] | select(.type == "gift" and .gift != null)] | group_by(.gift.name)
    | map("  \(.[0].gift.name)\t\(map(.gift.count // 1) | add)") | .[]' "$out")
  if [[ -n $gifts ]]; then
    echo "礼物：" >&2
    echo "$gifts" >&2
  fi
fi
