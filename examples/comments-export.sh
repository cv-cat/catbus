#!/usr/bin/env bash
# 导出某条内容的全部评论到 jsonl：一直翻到没有更多；中途被风控或断网时停下，
# 把游标存起来，下次用同样的参数再运行就从断点继续。
#
# 用法：
#   examples/comments-export.sh <platform> <item> [输出文件，默认 comments-<platform>.jsonl]
#
# 例子：
#   examples/comments-export.sh bilibili BV1xx411c7mD
#   examples/comments-export.sh xhs "<note_url>" note-comments.jsonl
#   REPLIES=1 examples/comments-export.sh douyin "<video_url>"
#
# 环境变量：
#   PAGE       每次调用取多少条，默认 200
#   SLEEP      两次调用之间的间隔秒数，默认 5（小红书的评论接口请求太密会要求人机验证）
#   REPLIES=1  评论导完后，再用 comment replies --all 导出每条评论的回复，写到 <输出文件>.replies.jsonl
#   CATBUS     catbus 命令，默认 catbus；从源码运行时可设为 "node /path/to/catbus/dist/cli/main.js"
#
# 为什么不一次 --all：一次调用中途失败时，摘要信封的 page 为 null，拿不到续翻的游标。
# 所以分批调用（每批 --limit $PAGE，catbus 在批内自动翻页），批与批之间把 page.cursor 存进 <输出文件>.cursor。
# 遇到 RISK_CONTROL（退出码 5）或 NETWORK（退出码 6）时停下；这一批的结果丢掉，续翻时从存下的游标重取，
# 不会重复也不会漏。全部导出后删除 .cursor 文件。要从头导出，先删掉输出文件和 .cursor 文件。
#
# 退出码：0 全部导出；5 被风控拦下（可续翻）；6 网络错误（可续翻）；其余同 catbus（见 AGENTS.md 6.4）。
#
# 依赖：bash、jq。
set -euo pipefail

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//' >&2
  exit 2
}

[[ $# -ge 2 && -n $1 && -n $2 ]] || usage
platform=$1
item=$2
out=${3:-comments-$platform.jsonl}
page=${PAGE:-200}
state=$out.cursor
[[ $page =~ ^[1-9][0-9]*$ ]] || { echo "PAGE 要是正整数：$page" >&2; exit 2; }
command -v jq >/dev/null || { echo "需要 jq：https://jqlang.org/download/" >&2; exit 2; }

read -r -a CATBUS_CMD <<<"${CATBUS:-catbus}"
cb() { "${CATBUS_CMD[@]}" "$@"; }

# -o jsonl 时，摘要信封是 stderr 里最后一个 JSON 行；没有时返回 {}
envelope() {
  local line
  line=$(grep '^{' "$1" | tail -n 1 || true)
  if [[ -n $line ]]; then printf '%s\n' "$line"; else echo '{}'; fi
}

count() { grep -c . "$1" || true; }

# 按退出码说明失败原因；$3 为 1 时提示可以续翻
explain() {
  local rc=$1 env=$2 resumable=$3 code message hint
  code=$(jq -r '.error.code // "ERROR"' <<<"$env")
  message=$(jq -r '.error.message // "未知错误"' <<<"$env")
  hint=$(jq -r '.error.hint // empty' <<<"$env")
  case $rc in
    5) echo "被风控拦下（$(jq -r '.error.detail.kind // "未知"' <<<"$env")）：$message" >&2 ;;
    6) echo "网络错误：$message（检查代理：catbus config get proxy）" >&2 ;;
    3) echo "需要登录：$message${hint:+。登录：$hint}" >&2 ;;
    *) echo "出错（$code，退出码 $rc）：$message${hint:+。建议：$hint}" >&2 ;;
  esac
  if [[ $resumable == 1 ]]; then
    echo "已导出 $(count "$out") 条。过一会儿用同样的参数重新运行，会从断点继续。" >&2
  fi
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cursor=
finished=0
if [[ -s $state ]]; then
  cursor=$(cat "$state")
  echo "从上次的断点继续（游标 $cursor）" >&2
elif [[ -s $out ]]; then
  echo "$out 已存在且没有断点：评论已经导出过了，跳过（要重新导出，先删掉它）" >&2
  finished=1
fi
touch "$out"
[[ $finished == 1 ]] || : >"$tmp/started"

batch=0
while [[ $finished == 0 ]]; do
  [[ $batch -eq 0 ]] || sleep "${SLEEP:-5}"
  batch=$((batch + 1))
  args=("$platform" comment list "$item" --limit "$page" -o jsonl)
  # 写成 --cursor=<值>：游标是不透明字符串，可能以 - 开头
  [[ -z $cursor ]] || args+=("--cursor=$cursor")

  rc=0
  cb "${args[@]}" >"$tmp/batch" 2>"$tmp/err" </dev/null || rc=$?
  env=$(envelope "$tmp/err")
  if [[ $rc -ne 0 ]]; then
    # 游标只在成功的批次之后更新，所以这一批丢掉即可：续翻时从 $cursor 重取
    if [[ -n $cursor ]]; then printf '%s' "$cursor" >"$state"; fi
    # 风控和网络错误过一会儿可能恢复；其余错误（未登录、参数错、平台不支持）要先改命令或登录。游标都保留着
    resumable=0
    [[ $rc -ne 5 && $rc -ne 6 ]] || resumable=1
    explain "$rc" "$env" "$resumable"
    exit "$rc"
  fi

  cat "$tmp/batch" >>"$out"
  echo "第 $batch 批：$(count "$tmp/batch") 条，累计 $(count "$out") 条" >&2
  has_more=$(jq -r '.page.has_more // false' <<<"$env")
  next=$(jq -r '.page.cursor // empty' <<<"$env")
  if [[ $has_more != true || -z $next || $next == "$cursor" ]]; then
    finished=1
  else
    cursor=$next
    printf '%s' "$cursor" >"$state"
  fi
done
rm -f "$state"
[[ ! -e $tmp/started ]] || echo "评论导出完成：$(count "$out") 条 → $out" >&2

[[ ${REPLIES:-} == 1 ]] || exit 0

# 回复：对每条有回复的评论调一次 comment replies --all（单条评论的回复一般不多，失败时整条重跑即可）
replies=$out.replies.jsonl
: >"$replies"
jq -r 'select((.stats.replies // 0) > 0) | .id' "$out" | sort -u >"$tmp/ids"
echo "导出 $(count "$tmp/ids") 条评论的回复 → $replies" >&2
while read -r cid; do
  sleep "${SLEEP:-5}"
  rc=0
  cb "$platform" comment replies "$item" "$cid" --all -o jsonl >"$tmp/batch" 2>"$tmp/err" </dev/null || rc=$?
  cat "$tmp/batch" >>"$replies"
  if [[ $rc -eq 2 || $rc -eq 4 ]]; then
    echo "$platform 不支持 comment replies：$(envelope "$tmp/err" | jq -r '.error.message // empty')" >&2
    break
  fi
  if [[ $rc -ne 0 ]]; then
    echo "导出评论 $cid 的回复时中断，已导出的回复在 $replies：" >&2
    explain "$rc" "$(envelope "$tmp/err")" 0
    exit "$rc"
  fi
done <"$tmp/ids"
echo "回复导出完成：$(count "$replies") 条" >&2
