import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import type { Item } from '@/api/types'
import { getItem, mediaSrc } from '@/api/client'
import { useSettingsStore } from '@/stores/settings'
import { useDiscoverStore } from '@/stores/discover'

/**
 * 瀑布流里悬停视频卡片的静音预览（设置 › 实验性 › hoverPreview）：
 * 鼠标停留约 400ms 后取视频地址，卡片浮起、长成视频的比例，然后静音循环播放；
 * 离开就收回并释放；同一时间只播一张；触屏不触发。
 * 搜索结果里多数平台不带视频直链（如小红书），这时请求一次 `item get` 补全，结果按条目缓存。
 * B 站、YouTube 只能走官方嵌入播放器，不预览。
 */

const DELAY_MS = 400
/** 只能用嵌入播放器的平台（见 DetailMedia 的 embed） */
const EMBED_ONLY = new Set(['bilibili', 'youtube'])

/** 正在预览的卡片：全局只有一张，别的卡片开始预览时这一张的 src 随之变成 null */
const active = ref<symbol | null>(null)

/** 补全出来的视频地址（已经过 /api/media 转发）；null 表示这条没有可预览的视频，不再重试 */
const resolved = new Map<string, Promise<string | null>>()

const directVideo = (item: Item) => item.media.find((m) => m.type === 'video' && m.url)?.url ?? null

/** 列表条目里已有的视频直链；没有时返回 null（不发请求） */
export function previewUrl(platform: string, item: Item): string | null {
  if (EMBED_ONLY.has(platform)) return null
  const url = directVideo(item)
  return url ? mediaSrc(platform, url) : null
}

/** 视频地址：先用条目里的直链，没有时 `item get` 一次（按平台 + id 缓存，失败也缓存） */
function resolveUrl(platform: string, item: Item, account: string | null): Promise<string | null> {
  if (EMBED_ONLY.has(platform)) return Promise.resolve(null)
  const direct = previewUrl(platform, item)
  if (direct) return Promise.resolve(direct)
  if (item.kind !== 'video') return Promise.resolve(null)
  const key = `${platform}:${item.id}`
  let p = resolved.get(key)
  if (!p) {
    p = getItem(platform, item, account)
      .then((env) => {
        const url = env.ok && env.data ? directVideo(env.data) : null
        return url ? mediaSrc(platform, url) : null
      })
      .catch(() => null)
    resolved.set(key, p)
  }
  return p
}

export function useHoverPreview(
  platform: () => string,
  item: () => Item,
): {
  src: ComputedRef<string | null>
  /** 停留够久、正在取视频地址 */
  pending: ComputedRef<boolean>
  enter: (e: PointerEvent) => void
  leave: () => void
} {
  const settings = useSettingsStore().settings
  const discover = useDiscoverStore()
  const id = Symbol('preview')
  const url = ref<string | null>(null)
  const waiting = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  /** 每次进入加一，丢掉过期的异步结果 */
  let token = 0

  function leave() {
    clearTimeout(timer)
    timer = undefined
    token++
    url.value = null
    waiting.value = false
    if (active.value === id) active.value = null
  }

  function enter(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || !settings.hoverPreview || !matchMedia('(hover: hover)').matches) return
    const p = platform()
    const it = item()
    if (EMBED_ONLY.has(p) || (it.kind !== 'video' && !directVideo(it))) return
    if (url.value || waiting.value) return
    clearTimeout(timer)
    const my = ++token
    timer = setTimeout(async () => {
      active.value = id
      waiting.value = true
      const u = await resolveUrl(p, it, discover.accountOf(it, p))
      if (my !== token || active.value !== id) return
      waiting.value = false
      if (u) url.value = u
      else leave()
    }, DELAY_MS)
  }

  // 设置关掉时立即停下
  watch(() => settings.hoverPreview, (on) => !on && leave())
  onBeforeUnmount(leave)

  return {
    src: computed(() => (active.value === id ? url.value : null)),
    pending: computed(() => active.value === id && waiting.value),
    enter,
    leave,
  }
}

/** 卸载 <video> 前清掉 src 并 load()，让浏览器立即断开连接、释放解码器 */
export function releaseVideo(v: HTMLVideoElement | null | undefined) {
  if (!v) return
  v.pause()
  v.removeAttribute('src')
  v.load()
}
