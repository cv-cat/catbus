import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import type { Item } from '@/api/types'
import { platformById } from '@/data/platforms'
import { t } from '@/i18n'
import { closeOverlays, isLocalPath, localActive } from './route'
import { toast } from './toast'
import { afterLoad } from '@/composables/lazy'
import { LazyGroupMenu } from '@/components/lazy'

/**
 * 本地收藏与稍后看（AGENTS.md 7.9「本地收藏与稍后看」，设计稿 mine-desgin Z5–Z7、Z9）。
 * 只存在浏览器里：localStorage `catbus.local` = `{version: 1, groups, items}`，不发请求、不同步到平台。
 */

const KEY = 'catbus.local'
export const LATER = 'later'
export const MAX_ITEMS = 2000
export const GROUP_NAME_MAX = 20

export interface LocalGroup {
  id: string
  name: string
  created_at: string
}
export interface LocalEntry {
  platform: string
  item: Item
  added_at: string
  /** 所在分组（可以为空：只在「全部」里） */
  groups: string[]
}
interface Saved {
  version: 1
  groups: LocalGroup[]
  items: LocalEntry[]
}

export const keyOf = (platform: string, id: string) => `${platform}\n${id}`
const str = (v: unknown) => (typeof v === 'string' ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 只留 6.2 Item 的字段（去掉 --raw 挂的原始对象等）；不合法时返回 null */
export function cleanItem(v: unknown): Item | null {
  const o = v as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id || typeof o.url !== 'string') return null
  const kinds = ['video', 'image', 'text', 'article', 'goods', 'torrent']
  const a = o.author as Record<string, unknown> | null
  const s = (o.stats ?? {}) as Record<string, unknown>
  const p = o.price as Record<string, unknown> | null
  const media = Array.isArray(o.media) ? o.media : []
  const item: Item = {
    id: o.id,
    kind: (kinds.includes(o.kind as string) ? o.kind : 'text') as Item['kind'],
    url: o.url,
    title: str(o.title),
    text: str(o.text),
    author: a && typeof a === 'object' && typeof a.id === 'string' ? { id: a.id, name: str(a.name), url: str(a.url), avatar: str(a.avatar) } : null,
    created_at: str(o.created_at),
    cover: str(o.cover),
    media: media
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && ['image', 'video', 'audio'].includes((m as { type?: string }).type!))
      .map((m) => ({ id: str(m.id), type: m.type as 'image' | 'video' | 'audio', url: str(m.url), width: num(m.width), height: num(m.height), duration: num(m.duration) })),
    stats: { views: num(s.views), likes: num(s.likes), comments: num(s.comments), collects: num(s.collects), shares: num(s.shares) },
    price: p && typeof p === 'object' && num(p.amount) != null && typeof p.currency === 'string' ? { amount: p.amount as number, currency: p.currency } : null,
    status: str(o.status),
  }
  // 种子的扩展字段（AGENTS 6.2 Torrent）
  for (const k of ['size', 'file_count', 'seeders', 'leechers', 'completed'] as const) if (k in o) item[k] = num(o[k])
  if ('discount' in o) item.discount = str(o.discount)
  return item
}

function readSaved(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return parseSaved(JSON.parse(raw)).saved
  } catch {
    // 读不出来（被改坏了、隐私模式）：从空的开始
  }
  return { version: 1, groups: [], items: [] }
}

/** 校验一份存档（本地读到的或导入的）：不认识的字段丢掉，不合法的条目跳过 */
export function parseSaved(v: unknown): { saved: Saved; skipped: number } {
  const o = (v ?? {}) as { groups?: unknown; items?: unknown }
  const groups: LocalGroup[] = []
  const ids = new Set<string>([LATER])
  for (const g of Array.isArray(o.groups) ? o.groups : []) {
    const id = str((g as LocalGroup)?.id)
    const name = str((g as LocalGroup)?.name)?.trim()
    if (!id || !name || ids.has(id) || [...name].length > GROUP_NAME_MAX) continue
    ids.add(id)
    groups.push({ id, name, created_at: str((g as LocalGroup).created_at) ?? new Date().toISOString() })
  }
  const items: LocalEntry[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const e of Array.isArray(o.items) ? o.items : []) {
    const platform = str((e as LocalEntry)?.platform)
    const item = cleanItem((e as LocalEntry)?.item)
    if (!platform || !platformById(platform) || !item || seen.has(keyOf(platform, item.id))) {
      skipped++
      continue
    }
    seen.add(keyOf(platform, item.id))
    const gs = Array.isArray((e as LocalEntry).groups) ? (e as LocalEntry).groups.filter((g) => typeof g === 'string' && ids.has(g)) : []
    items.push({ platform, item, added_at: str((e as LocalEntry).added_at) ?? new Date().toISOString(), groups: [...new Set(gs)] })
  }
  return { saved: { version: 1, groups, items }, skipped }
}

export const useLocalStore = defineStore('local', () => {
  const init = readSaved()
  const groups = ref<LocalGroup[]>(init.groups)
  const entries = shallowRef<LocalEntry[]>(init.items)
  const index = computed(() => new Map(entries.value.map((e) => [keyOf(e.platform, e.item.id), e])))

  // ---------- 持久化 ----------
  let warned = false
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, groups: groups.value, items: entries.value } satisfies Saved))
    } catch {
      // 写不进去（隐私模式、空间满）：提示一次，本次会话里照常可用
      if (!warned) toast(t('local.toast.storageFailed'), 3200)
      warned = true
    }
  }
  watch([groups, entries], save, { deep: true })
  // 别的标签页改了本地收藏：跟着更新
  addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    const next = readSaved()
    groups.value = next.groups
    entries.value = next.items
  })

  const commit = (next: LocalEntry[]) => (entries.value = next)
  const entry = (platform: string, id: string) => index.value.get(keyOf(platform, id)) ?? null
  const has = (platform: string, id: string) => index.value.has(keyOf(platform, id))

  /** 加入（已有时只更新分组为 groups 的并集）；满了返回 false */
  function add(platform: string, item: Item, gs: string[] = [LATER]): boolean {
    const old = entry(platform, item.id)
    if (old) {
      commit(entries.value.map((e) => (e === old ? { ...e, groups: [...new Set([...e.groups, ...gs])] } : e)))
      return true
    }
    if (entries.value.length >= MAX_ITEMS) {
      toast(t('local.toast.full', { n: MAX_ITEMS }), 3200)
      return false
    }
    const clean = cleanItem(item)
    if (!clean) return false
    commit([{ platform, item: clean, added_at: new Date().toISOString(), groups: [...new Set(gs)] }, ...entries.value])
    return true
  }
  function remove(keys: string[]) {
    const drop = new Set(keys)
    commit(entries.value.filter((e) => !drop.has(keyOf(e.platform, e.item.id))))
  }
  /** 把一条放进 / 移出一个分组 */
  function toggleGroup(platform: string, id: string, group: string) {
    const e = entry(platform, id)
    if (!e) return
    const gs = e.groups.includes(group) ? e.groups.filter((g) => g !== group) : [...e.groups, group]
    commit(entries.value.map((x) => (x === e ? { ...x, groups: gs } : x)))
  }
  /** 批量移到一个分组（加进去，原来的分组保留） */
  function addToGroup(keys: string[], group: string) {
    const set = new Set(keys)
    commit(entries.value.map((e) => (set.has(keyOf(e.platform, e.item.id)) && !e.groups.includes(group) ? { ...e, groups: [...e.groups, group] } : e)))
  }
  /** 撤销用：恢复成加入前的样子 */
  function restore(snapshot: LocalEntry[]) {
    commit(snapshot)
  }

  // ---------- 分组 ----------
  const allGroups = computed<LocalGroup[]>(() => [{ id: LATER, name: t('local.group.later'), created_at: '' }, ...groups.value])
  const groupName = (id: string) => allGroups.value.find((g) => g.id === id)?.name ?? ''
  /** 名字不合法时返回原因 */
  function checkName(name: string, except?: string): string | null {
    const n = name.trim()
    if (!n) return t('local.group.nameEmpty')
    if ([...n].length > GROUP_NAME_MAX) return t('local.group.nameLong', { n: GROUP_NAME_MAX })
    if (allGroups.value.some((g) => g.id !== except && g.name === n)) return t('local.group.nameTaken')
    return null
  }
  function createGroup(name: string): string | null {
    if (checkName(name)) return null
    const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    groups.value = [...groups.value, { id, name: name.trim(), created_at: new Date().toISOString() }]
    return id
  }
  function renameGroup(id: string, name: string): boolean {
    if (id === LATER || checkName(name, id)) return false
    groups.value = groups.value.map((g) => (g.id === id ? { ...g, name: name.trim() } : g))
    return true
  }
  /** 删分组不删条目，条目只是离开这个分组 */
  function deleteGroup(id: string) {
    if (id === LATER) return
    groups.value = groups.value.filter((g) => g.id !== id)
    commit(entries.value.map((e) => (e.groups.includes(id) ? { ...e, groups: e.groups.filter((g) => g !== id) } : e)))
    if (group.value === id) setGroup(null)
  }
  const countOf = (id: string | null) => (id ? entries.value.filter((e) => e.groups.includes(id)).length : entries.value.length)

  // ---------- 导出 / 导入 ----------
  function exportFile() {
    const doc = { schema: 1, exported_at: new Date().toISOString(), groups: groups.value, items: entries.value }
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    a.href = URL.createObjectURL(blob)
    a.download = `catbus-local-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  /** 合并导入：分组按名字合并，条目按「平台 + 条目 id」去重、分组取并集 */
  function importText(text: string): { added: number; merged: number; skipped: number } | null {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return null
    }
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { items?: unknown }).items)) return null
    const { saved, skipped } = parseSaved(raw)
    // 导入的分组 id → 本地的分组 id（同名的合并）
    const map = new Map<string, string>([[LATER, LATER]])
    const nextGroups = [...groups.value]
    for (const g of saved.groups) {
      const same = nextGroups.find((x) => x.name === g.name)
      if (same) map.set(g.id, same.id)
      else {
        const id = nextGroups.some((x) => x.id === g.id) ? `${g.id}-${Date.now().toString(36)}` : g.id
        nextGroups.push({ ...g, id })
        map.set(g.id, id)
      }
    }
    groups.value = nextGroups
    const byKey = new Map(entries.value.map((e) => [keyOf(e.platform, e.item.id), { ...e }]))
    let added = 0
    let merged = 0
    let over = 0
    for (const e of saved.items) {
      const gs = e.groups.map((g) => map.get(g)).filter((g): g is string => !!g)
      const k = keyOf(e.platform, e.item.id)
      const old = byKey.get(k)
      if (old) {
        old.groups = [...new Set([...old.groups, ...gs])]
        merged++
      }
      else if (byKey.size >= MAX_ITEMS) over++
      else {
        byKey.set(k, { ...e, groups: gs })
        added++
      }
    }
    commit([...byKey.values()].sort((a, b) => b.added_at.localeCompare(a.added_at)))
    return { added, merged, skipped: skipped + over }
  }

  // ---------- 不可用的条目（详情取不到）：只在本页会话里标记 ----------
  const gone = reactive(new Set<string>())
  const markGone = (platform: string, id: string) => has(platform, id) && gone.add(keyOf(platform, id))

  // ---------- 页面与地址 ----------
  const active = localActive
  const group = ref<string | null>(groupFromUrl())
  function groupFromUrl(): string | null {
    return new URLSearchParams(location.search).get('group')
  }
  function toUrl(g: string | null) {
    const parts: string[] = []
    if (new URLSearchParams(location.search).has('demo')) parts.push('demo')
    if (g) parts.push(`group=${encodeURIComponent(g)}`)
    return `/local${parts.length ? `?${parts.join('&')}` : ''}`
  }
  function push(g: string | null) {
    const next = toUrl(g)
    if (next !== location.pathname + location.search) history.pushState(null, '', next)
  }
  function open() {
    if (active.value) return
    closeOverlays()
    active.value = true
    // 分组已经不存在时回到「全部」
    if (group.value && !allGroups.value.some((g) => g.id === group.value)) group.value = null
    push(group.value)
  }
  function leave() {
    active.value = false
  }
  function setGroup(g: string | null) {
    if (group.value === g) return
    group.value = g
    if (active.value) push(g)
  }
  addEventListener('popstate', () => {
    if (!isLocalPath()) return void (active.value = false)
    active.value = true
    const g = groupFromUrl()
    group.value = g && allGroups.value.some((x) => x.id === g) ? g : null
  })

  // ---------- 分组菜单（设计稿 Z7）：一个全局的菜单，从卡片、详情卡片上打开 ----------
  const menu = shallowRef<{ platform: string; item: Item; anchor: DOMRect } | null>(null)
  function openMenu(platform: string, item: Item, el: Element | null) {
    if (!has(platform, item.id)) add(platform, item, [])
    // 位置在点下时就量好：等菜单的代码加载时按钮可能已经动了
    const anchor = (el ?? document.body).getBoundingClientRect()
    afterLoad(LazyGroupMenu, () => (menu.value = { platform, item, anchor }))
  }
  const closeMenu = () => (menu.value = null)

  /** 卡片、详情卡片上的书签按钮：没收藏过 → 加入稍后看并提示；已收藏 → 打开分组菜单 */
  function bookmark(platform: string, item: Item, el: Element | null) {
    if (has(platform, item.id)) return openMenu(platform, item, el)
    const before = entries.value
    if (!add(platform, item, [LATER])) return
    toast(t('local.toast.added', { group: groupName(LATER) }), 4000, [
      { label: t('local.toast.toGroup'), run: () => openMenu(platform, item, el) },
      { label: t('local.toast.undo'), run: () => restore(before) },
    ])
  }

  return {
    groups,
    allGroups,
    entries,
    entry,
    has,
    add,
    remove,
    toggleGroup,
    addToGroup,
    groupName,
    checkName,
    createGroup,
    renameGroup,
    deleteGroup,
    countOf,
    exportFile,
    importText,
    gone,
    markGone,
    active,
    group,
    open,
    leave,
    setGroup,
    menu,
    openMenu,
    closeMenu,
    bookmark,
  }
})
