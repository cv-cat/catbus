#!/usr/bin/env bash
# 备份某个用户发布的全部内容：元数据写成 items.jsonl，媒体（图片 / 视频）下载到 media/。
# 中断后用同样的参数再运行：已经下载过的内容跳过，从没下完的地方继续。
#
# 用法：
#   examples/user-items-backup.sh <platform> <user> [备份目录，默认 backup-<platform>]
#
# 例子：
#   examples/user-items-backup.sh bilibili "<space_url>"
#   examples/user-items-backup.sh xhs "<user_url>" ./xhs-backup
#   examples/user-items-backup.sh douyin me
#   MAX=50 examples/user-items-backup.sh x @<username>
#
# 环境变量：
#   MAX       最多备份多少条，默认全部（user items --all）
#   SLEEP     两次下载之间的间隔秒数，默认 3
#   CATBUS    catbus 命令，默认 catbus；从源码运行时可设为 "node /path/to/catbus/dist/cli/main.js"
#
# 备份目录的内容：
#   items.jsonl     每行一个 Item（字段见 AGENTS.md 6.2）。每次运行都重新拉取；列表中途失败时与上次的合并，不丢数据
#   media/          item download 下载的文件，文件名为 <platform>_<id>_<序号>.<ext>
#   downloaded.txt  已经下载完的 item id，续跑时跳过
#   failed.txt      下载失败的 item id 和原因（下次运行会重试）
#
# 平台的 item download 还没实现时，只备份元数据。遇到 RISK_CONTROL（退出码 5）时立即停下，
# 过一会儿再运行即可续跑；单条内容的其他错误（已删除、不可见等）记到 failed.txt，继续下一条。
#
# 依赖：bash、jq。
set -euo pipefail

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//' >&2
  exit 2
}

[[ $# -ge 2 && -n $1 && -n $2 ]] || usage
platform=$1
user=$2
dir=${3:-backup-$platform}
command -v jq >/dev/null || { echo "需要 jq：https://jqlang.org/download/" >&2; exit 2; }
if [[ -n ${MAX:-} && ! $MAX =~ ^[1-9][0-9]*$ ]]; then
  echo "MAX 要是正整数：$MAX" >&2
  exit 2
fi

read -r -a CATBUS_CMD <<<"${CATBUS:-catbus}"
cb() { "${CATBUS_CMD[@]}" "$@"; }

envelope() {
  local line
  line=$(grep '^{' "$1" | tail -n 1 || true)
  if [[ -n $line ]]; then printf '%s\n' "$line"; else echo '{}'; fi
}
err_field() { jq -r ".error.$1 // empty" <<<"$2"; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$dir/media"
touch "$dir/downloaded.txt"

# 1. 这个平台支不支持 user items / item download（platforms 只读注册表，不联网）
supports() {
  cb platforms "$platform" | jq -e --arg r "$1" --arg a "$2" \
    'any(.data.commands[]; .endpoint == "web" and .resource == $r and .action == $a and .status == "implemented")' >/dev/null
}
if ! supports user items; then
  echo "$platform 的 user items 还没有实现，没法备份（catbus platforms $platform 查看支持的命令）" >&2
  exit 4
fi
can_download=1
if ! supports item download; then
  can_download=0
  echo "$platform 的 item download 还没有实现，只备份元数据" >&2
fi

# 2. 元数据：user items 一次翻完（-o jsonl 边翻边输出）
paging=(--all)
[[ -z ${MAX:-} ]] || paging=(--limit "$MAX")
echo "拉取 $user 发布的内容…" >&2
rc=0
cb "$platform" user items "$user" "${paging[@]}" -o jsonl >"$tmp/items" 2>"$tmp/err" </dev/null || rc=$?
env=$(envelope "$tmp/err")
if [[ $rc -ne 0 ]]; then
  got=$(grep -c . "$tmp/items" || true)
  echo "拉取列表时出错（$(err_field code "$env")）：$(err_field message "$env")" >&2
  [[ -z $(err_field hint "$env") ]] || echo "建议：$(err_field hint "$env")" >&2
  # 没取到任何条目时直接退出；取到一部分时照样备份这一部分
  if [[ $got -eq 0 ]]; then exit "$rc"; fi
  echo "只取到 $got 条，先备份这些；之后再运行一次可以补全" >&2
  # 列表不完整时不丢掉上次的元数据：新取到的在前，上次有、这次没取到的接在后面（按 id 去重）
  if [[ -s $dir/items.jsonl ]]; then
    jq -c -n 'reduce inputs as $x ({seen: {}, out: []};
      if .seen[$x.id] then . else .seen[$x.id] = true | .out += [$x] end) | .out[]' \
      "$tmp/items" "$dir/items.jsonl" >"$tmp/merged"
    mv "$tmp/merged" "$tmp/items"
  fi
fi
mv "$tmp/items" "$dir/items.jsonl"
total=$(grep -c . "$dir/items.jsonl" || true)
echo "元数据：$total 条 → $dir/items.jsonl" >&2
[[ $can_download == 1 ]] || exit "$rc"

# 3. 媒体：逐条 item download。传 url 而不是 id：小红书的 url 带 xsec_token，只给 id 取不到详情
: >"$dir/failed.txt"
done_count=0
skipped=0
first=1
while IFS=$'\t' read -r id url; do
  if grep -Fxq -- "$id" "$dir/downloaded.txt"; then
    skipped=$((skipped + 1))
    continue
  fi
  [[ $first == 1 ]] || sleep "${SLEEP:-3}"
  first=0
  target=${url:-$id}
  rc=0
  cb "$platform" item download "$target" --dir "$dir/media" -q >"$tmp/out" 2>"$tmp/err" </dev/null || rc=$?
  if [[ $rc -eq 0 ]]; then
    files=$(jq -r '.data | length' "$tmp/out")
    echo "$id" >>"$dir/downloaded.txt"
    done_count=$((done_count + 1))
    echo "[$((done_count + skipped))/$total] $id：$files 个文件" >&2
    continue
  fi
  # 失败时信封在 stdout（-o json）
  env=$(envelope "$tmp/out")
  code=$(err_field code "$env")
  message=$(err_field message "$env")
  case $rc in
    5) echo "被风控拦下（$(jq -r '.error.detail.kind // "未知"' <<<"$env")）：$message" >&2
       echo "已下载 $((done_count + skipped))/$total 条。过一会儿用同样的参数重新运行，会从这里继续。" >&2
       exit 5 ;;
    3 | 6) echo "$id：$message${code:+（$code）}" >&2
       echo "登录态或网络有问题，先停下。解决后重新运行即可续跑。" >&2
       exit "$rc" ;;
    *) printf '%s\t%s\t%s\n' "$id" "${code:-ERROR}" "$message" >>"$dir/failed.txt"
       echo "$id：下载失败（${code:-ERROR}）：$message，继续下一条" >&2 ;;
  esac
done < <(jq -r '[.id, (.url // "")] | @tsv' "$dir/items.jsonl")

failed=$(grep -c . "$dir/failed.txt" || true)
echo "完成：本次下载 $done_count 条，之前已下载 $skipped 条，失败 $failed 条 → $dir/media" >&2
[[ $failed -eq 0 ]] || { echo "失败的条目见 $dir/failed.txt，重新运行会再试一次" >&2; exit 1; }
