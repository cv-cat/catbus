#!/usr/bin/env bash
# 跨平台搜索同一个关键词，每个平台取 N 条，合并成一个 jsonl。
#
# 用法：
#   examples/search-to-jsonl.sh <关键词> [每个平台的条数，默认 20] [输出文件，默认 search.jsonl]
#
# 例子：
#   examples/search-to-jsonl.sh 露营 30 camping.jsonl
#   PLATFORMS="xhs bilibili x" examples/search-to-jsonl.sh <keyword>
#
# 环境变量：
#   PLATFORMS  要搜索的平台，空格分隔。默认：item search 已实现、并且本机有 web 账号的平台
#              （由 catbus platforms 和 catbus auth list 得出，两者都不联网）
#   SLEEP      平台之间的间隔秒数，默认 3
#   CATBUS     catbus 命令，默认 catbus；从源码运行时可设为 "node /path/to/catbus/dist/cli/main.js"
#
# 输出：每行一个 Item（字段见 AGENTS.md 6.2），前面加上 platform 字段区分来源，例如
#   {"platform":"bilibili","id":"BV...","kind":"video","url":"https://...","title":"...",...}
#
# 某个平台失败（未登录、风控、网络错误）时跳过它，继续下一个；已经取到的条目照样保留。
# 至少一个平台成功时退出码为 0，否则为 1。
#
# 依赖：bash、jq。
set -euo pipefail

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//' >&2
  exit 2
}

[[ $# -ge 1 && -n $1 ]] || usage
keyword=$1
limit=${2:-20}
out=${3:-search.jsonl}
[[ $limit =~ ^[1-9][0-9]*$ ]] || { echo "条数要是正整数：$limit" >&2; exit 2; }
command -v jq >/dev/null || { echo "需要 jq：https://jqlang.org/download/" >&2; exit 2; }

read -r -a CATBUS_CMD <<<"${CATBUS:-catbus}"
cb() { "${CATBUS_CMD[@]}" "$@"; }

# stderr 里最后一个 JSON 行是摘要信封（-o jsonl 时）；没有时返回 {}
envelope() {
  local line
  line=$(grep '^{' "$1" | tail -n 1 || true)
  if [[ -n $line ]]; then printf '%s\n' "$line"; else echo '{}'; fi
}

if [[ -z ${PLATFORMS:-} ]]; then
  implemented=$(cb platforms | jq -r '.data[]
    | select(any(.commands[]; .endpoint == "web" and .resource == "item" and .action == "search" and .status == "implemented"))
    | .id')
  logged_in=$(cb auth list | jq -r '.data[] | select(.endpoint == "web") | .platform' | sort -u)
  PLATFORMS=$(printf '%s\n' "$implemented" | grep -Fx -f <(printf '%s\n' "$logged_in") | tr '\n' ' ' || true)
  if [[ -z ${PLATFORMS// /} ]]; then
    echo "没有可以搜索的平台：先登录，例如 catbus bilibili auth login；或者用 PLATFORMS=\"xhs bilibili\" 指定" >&2
    exit 1
  fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

: >"$out"
succeeded=0
first=1
for p in $PLATFORMS; do
  [[ $first == 1 ]] || sleep "${SLEEP:-3}"
  first=0

  rc=0
  # -o jsonl：stdout 每行一条，结束时 stderr 写一行摘要信封；关键词放在 -- 之后，以 - 开头也没问题
  cb "$p" item search --limit "$limit" -o jsonl -- "$keyword" >"$tmp/items" 2>"$tmp/err" </dev/null || rc=$?
  got=$(grep -c . "$tmp/items" || true)
  # 出错前已经输出的条目也是完整的 Item，一并保留
  jq -c --arg p "$p" '{platform: $p} + .' "$tmp/items" >>"$out"

  if [[ $rc -eq 0 ]]; then
    echo "[$p] $got 条" >&2
    succeeded=$((succeeded + 1))
    continue
  fi

  env=$(envelope "$tmp/err")
  code=$(jq -r '.error.code // "ERROR"' <<<"$env")
  message=$(jq -r '.error.message // "未知错误"' <<<"$env")
  hint=$(jq -r '.error.hint // empty' <<<"$env")
  case $rc in
    3) echo "[$p] 跳过：没有登录或登录已失效（$code）。${hint:+登录：$hint}" >&2 ;;
    2 | 4) echo "[$p] 跳过：$message" >&2 ;;
    5) echo "[$p] 被风控拦下（$(jq -r '.error.detail.kind // "未知"' <<<"$env")）：$message；保留已取到的 $got 条" >&2 ;;
    6) echo "[$p] 网络错误：$message；检查代理（catbus config get proxy）" >&2 ;;
    *) echo "[$p] 出错（$code，退出码 $rc）：$message${hint:+；建议：$hint}" >&2 ;;
  esac
done

total=$(grep -c . "$out" || true)
echo "共 $total 条，$succeeded 个平台成功 → $out" >&2
[[ $succeeded -gt 0 ]]
