<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, AtSign, Bell, ChevronRight, ChevronUp, Clock, ExternalLink, Heart, Inbox as InboxIcon, Lock, LogIn, Menu, MessageCircle, MessageSquare, RefreshCw, UserPlus, Users } from 'lucide-vue-next'
import CatbusLoader from '@/components/CatbusLoader.vue'
import StateView from '@/components/StateView.vue'
import LoadingBar from '@/components/LoadingBar.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import EmojiText from '@/components/EmojiText.vue'
import InboxEmpty from '@/components/inbox/InboxEmpty.vue'
import CopyCommand from '@/components/tools/CopyCommand.vue'
import GlassButton from '@/components/ui/GlassButton.vue'
import { useInboxStore } from '@/stores/inbox'
import { useNavStore } from '@/stores/nav'
import { openLogin } from '@/stores/login'
import { openVerify } from '@/stores/verify'
import { openLightbox } from '@/stores/lightbox'
import { useSettingsStore } from '@/stores/settings'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { usePageSections } from '@/composables/sections'
import { toCommand } from '@/composables/command'
import { dateTime, tintOf } from '@/composables/format'
import { fullTime, groupByDay, inboxTime, shortId } from '@/composables/inbox'
import { waveWhileLoading } from '@/composables/motion'
import { platformById } from '@/data/platforms'
import { imgSrc } from '@/api/client'
import { NOTICE_TYPES, inboxArgv, type InboxTab, type NoticeType } from '@/api/inbox'
import type { CatbusError, Conversation, Message, Notice } from '@/api/types'
import { errorTitle } from '@/i18n/errors'

/**
 * 收件箱（AGENTS.md 7.9「通知与私信」，设计稿 inbox-desgin X1–X5）：
 * 通知是按日期分组的连续面板，桌面上右侧是选中通知的详情和按类型概览；私信是左会话列表、右消息（手机上两级）。全部只读。
 */
const ib = useInboxStore()
const nav = useNavStore()
const bp = useBreakpoint()
const settings = useSettingsStore()
const { t } = useI18n()

const platform = computed(() => platformById(ib.platform)!)
const count = computed(() => ib.countOf(ib.platform))
/** 桌面上通知旁边有详情栏；点一行是选中 */
const aside = computed(() => bp.desktop)

/** 标题按能力：只有通知、只有私信、两者都有 */
const titleKey = computed(() => (ib.tabs.length > 1 ? 'both' : (ib.tabs[0] ?? 'notices')))
const title = computed(() => t(`inbox.title.${titleKey.value}`))
const tabOptions = computed(() =>
  ib.tabs.map((v) => {
    const n = v === 'notices' ? (count.value?.total ?? 0) : 0
    return { value: v, label: t(`inbox.tab.${v}`), badge: n ? (n > 99 ? '99+' : String(n)) : null }
  }),
)
const tabModel = computed({ get: () => ib.tab ?? ib.tabs[0]!, set: (v: InboxTab) => ib.setTab(v) })

// ---------- 通知 ----------
const NOTICE_ICON = { comment: MessageCircle, mention: AtSign, like: Heart, follow: UserPlus, system: Bell } as const
const iconOf = (type: string) => NOTICE_ICON[type as NoticeType] ?? Bell

/** 平台给了分类的未读数时 chip 和概览用它；没有时 chip 不带数字，概览按已加载的统计 */
const typeCount = computed(() => {
  const c = count.value
  return c && NOTICE_TYPES.some((v) => c[v] != null) ? c : null
})
const loadedNotices = computed(() => ib.noticeList?.items ?? [])
const loadedByType = computed(() => {
  const m: Record<string, number> = {}
  for (const n of loadedNotices.value) m[n.type] = (m[n.type] ?? 0) + 1
  return m
})
const badgeNum = (n: number | null | undefined) => (n ? (n > 99 ? '99+' : String(n)) : null)
const typeChips = computed(() => [
  { value: null as NoticeType | null, label: t('inbox.type.all'), n: typeCount.value ? badgeNum(typeCount.value.total) : null },
  ...NOTICE_TYPES.map((v) => ({ value: v as NoticeType | null, label: t(`inbox.type.${v}`), n: typeCount.value ? badgeNum(typeCount.value[v]) : null })),
])
/** 没有平台的未读数、通知也还没加载出来时，概览不写 0，写「—」 */
const overviewReady = computed(() => Boolean(typeCount.value || ib.noticeList?.loaded))
const overview = computed(() => {
  const rows = NOTICE_TYPES.map((v) => ({ type: v, n: typeCount.value ? (typeCount.value[v] ?? 0) : (loadedByType.value[v] ?? 0) }))
  const max = Math.max(1, ...rows.map((r) => r.n))
  return rows.map((r) => ({ ...r, pct: (r.n / max) * 100 }))
})

const groups = computed(() => groupByDay(ib.shownNotices))
const noticeName = (n: Notice) => n.user?.name || ''
/** 没有用户（或没有名字）时，名字位置写类型说明 */
const anon = (n: Notice) => !noticeName(n)

// 选中：桌面上默认第一条；换类型、换平台时回到第一条
const selId = ref<string | null>(null)
const selected = computed<Notice | null>(() => ib.shownNotices.find((n) => n.id === selId.value) ?? ib.shownNotices[0] ?? null)
watch(
  () => [ib.platform, ib.type] as const,
  () => (selId.value = null),
)
const rowsEl = ref<HTMLElement>()
function select(n: Notice) {
  selId.value = n.id
}
function onListKey(e: KeyboardEvent) {
  if (!aside.value || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
  const list = ib.shownNotices
  const i = list.findIndex((n) => n.id === selected.value?.id)
  const next = list[Math.min(list.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
  if (!next) return
  e.preventDefault()
  selId.value = next.id
  void nextTick(() => rowsEl.value?.querySelector<HTMLElement>(`[data-id="${CSS.escape(next.id)}"]`)?.focus())
}

// ---------- 状态 ----------
const loading = computed(() => ib.busy)
const listError = computed<CatbusError | null>(() => (ib.tab === 'notices' ? (ib.noticeList?.error ?? null) : (ib.convList?.error ?? null)))
const elapsedOf = (l: { loaded: boolean; elapsed: number | null } | null | undefined) => (l?.loaded && l.elapsed != null ? ` · ${l.elapsed.toFixed(2)}s` : '')
const noticeMeta = computed(() => {
  const l = ib.noticeList
  return l?.loaded ? t('inbox.loaded', { n: l.items.length }, l.items.length) + elapsedOf(l) : ''
})
const convMeta = computed(() => {
  const l = ib.convList
  return l?.loaded ? t('inbox.conv.loaded', { n: l.items.length }, l.items.length) + elapsedOf(l) : ''
})

const login = () => openLogin(ib.platform, ib.account() ?? undefined)
const verifyWith = (err: CatbusError | null, retry: () => void) => (url: string) =>
  openVerify({ platform: ib.platform, url, message: err ? errorTitle(err) : undefined, retry })

const command = () => {
  const [argv, pos] = inboxArgv(ib.platform, ib.tab ?? ib.tabs[0]!, ib.conv, ib.account(), settings.settings.pageSize)
  return toCommand(argv, pos)
}

/** 手机：标题下面的分段 */
const { options: sections, model: section } = usePageSections(() => ib.platform, () => 'inbox')

// ---------- 私信 ----------
const convs = computed(() => ib.convList?.items ?? [])
const convName = (c: Conversation) => c.peer?.name || t('inbox.conv.group')
// 桌面上默认选中第一个会话（替换地址，不多出一条历史）；手机上先显示列表
watch(
  () => [ib.tab, convs.value, ib.conv, bp.phone] as const,
  ([tab, list, c, phone]) => {
    if (tab === 'messages' && !phone && !c && list.length) ib.setConv(list[0]!.id, true)
  },
  { immediate: true },
)

const messages = computed(() => ib.msgList?.items ?? [])
const mine = (m: Message) => Boolean(ib.myId && m.from?.id === ib.myId)
/** 与上一条隔超过 10 分钟时插一行时间 */
const GAP = 10 * 60_000
function showTime(i: number): boolean {
  const cur = messages.value[i]?.created_at
  if (!cur) return false
  if (i === 0) return true
  const prev = messages.value[i - 1]?.created_at
  return !prev || Date.parse(cur) - Date.parse(prev) > GAP
}
const msgTime = (iso: string | null) => dateTime(iso, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const images = (m: Message) => m.media.filter((x) => x.type === 'image' && x.url)
function placeholder(m: Message): string {
  if (m.type === 'video') return t('inbox.msg.video')
  if (m.type === 'card') return t('inbox.msg.card')
  if (m.type === 'image') return t('inbox.msg.image')
  return t('inbox.msg.other')
}
function zoom(m: Message, i: number) {
  openLightbox(images(m).map((x) => imgSrc(x.url!)), i)
}
/** 群聊：对方的消息上方写发送人 */
const showFrom = (m: Message) => !mine(m) && Boolean(ib.curConv && !ib.curConv.peer && m.from?.name)

/** 消息流：打开会话时滚到最下面；往上翻时接在上面，保持当前看到的位置 */
const stream = ref<HTMLElement>()
let keepFrom: number | null = null
function older() {
  const el = stream.value
  keepFrom = el ? el.scrollHeight - el.scrollTop : null
  ib.loadOlder()
}
watch(
  () => [ib.conv, ib.msgList?.loaded] as const,
  async ([, loaded]) => {
    if (!loaded) return
    stick = true
    await nextTick()
    toBottom()
  },
  { immediate: true },
)
watch(
  () => messages.value.length,
  async () => {
    await nextTick()
    const el = stream.value
    if (el && keepFrom != null) {
      el.scrollTop = el.scrollHeight - keepFrom
      keepFrom = null
    }
  },
)
/** 打开会话后停在最底下；图片加载完把内容撑高时仍贴着底，用户往上翻过就不再跟 */
let stick = true
function toBottom() {
  const el = stream.value
  if (el) el.scrollTop = el.scrollHeight
}
function onImgLoad() {
  if (stick) toBottom()
}
function onStreamScroll() {
  const el = stream.value
  if (el) stick = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  if (el && el.scrollTop < 40 && ib.msgList?.hasMore && !ib.msgList.loadingMore) older()
}

// ---------- 滚动：滚到底翻页 ----------
const root = ref<HTMLElement>()
const sentinel = ref<HTMLElement>()
const convSentinel = ref<HTMLElement>()
let io: IntersectionObserver | undefined
let convIo: IntersectionObserver | undefined
watch(
  () => [ib.tab, ib.platform],
  () => {
    root.value?.scrollTo({ top: 0 })
    rowsEl.value?.scrollTo({ top: 0 })
  },
)
watch(loading, (busy) => waveWhileLoading(busy))
onMounted(() => {
  // root 为视口：列表在面板里滚动时同样按可见区域判断（滚动容器会裁剪交叉区域）
  io = new IntersectionObserver(([e]) => e?.isIntersecting && ib.loadMoreNotices(), { rootMargin: '400px' })
  convIo = new IntersectionObserver(([e]) => e?.isIntersecting && ib.loadMoreConvs(), { rootMargin: '300px' })
  ib.ensure()
})
watch(
  sentinel,
  (el, old) => {
    if (old) io?.unobserve(old)
    if (el) io?.observe(el)
  },
  { flush: 'post' },
)
watch(
  convSentinel,
  (el, old) => {
    if (old) convIo?.unobserve(old)
    if (el) convIo?.observe(el)
  },
  { flush: 'post' },
)
onBeforeUnmount(() => {
  io?.disconnect()
  convIo?.disconnect()
  waveWhileLoading(false)
})
</script>

<template>
  <main ref="root" class="inbox-page" :class="{ phone: bp.phone, fill: !bp.phone && ib.hasAccount && !ib.expired }">
    <header class="top" :class="{ phone: bp.phone }">
      <GlassButton v-if="bp.phone" icon :aria-label="t('layout.nav.open')" aria-controls="catbus-nav" :aria-expanded="nav.navOpen" @click="nav.openNav()">
        <Menu :size="20" />
      </GlassButton>
      <div class="title">
        <div v-if="!bp.phone" class="eyebrow"><img class="logo" :src="platform.logo" alt="" />{{ platform.name }}</div>
        <h1>{{ bp.phone ? `${platform.name} · ${t(`inbox.tab.${ib.tab ?? ib.tabs[0] ?? 'notices'}`)}` : title }}</h1>
      </div>
      <SegmentedControl v-if="!bp.phone && tabOptions.length > 1 && ib.hasAccount && !ib.expired" v-model="tabModel" class="tabs-seg" :options="tabOptions" :label="t('inbox.tab.label')" />
      <span class="spacer" />
      <span v-if="!bp.phone" class="note"><Lock :size="13" aria-hidden="true" />{{ t('inbox.readonlyNote', { platform: platform.name }) }}</span>
      <GlassButton v-if="bp.phone && ib.hasAccount && !ib.expired" icon :aria-label="t('common.action.refresh')" :disabled="loading" @click="ib.refresh()">
        <RefreshCw :size="18" :class="{ spin: loading }" />
      </GlassButton>
    </header>

    <div v-if="bp.phone && sections.length > 1" class="phone-seg">
      <SegmentedControl v-model="section" :options="sections" :label="platform.name" />
    </div>

    <!-- 没有这个平台的账号 / 登录已失效：整页 -->
    <section v-if="!ib.hasAccount || ib.expired" class="panel whole">
      <InboxEmpty
        :icon="ib.expired ? Lock : LogIn"
        :tone="ib.expired ? 'red' : 'default'"
        :title="ib.expired ? t('inbox.expired', { platform: platform.name }) : t(`inbox.login.${titleKey}`, { platform: platform.name })"
        :desc="ib.expired ? t('inbox.expiredDesc') : t('inbox.loginDesc')"
      >
        <GlassButton tone="primary" size="lg" class="cta" @click="login"><LogIn :size="16" />{{ ib.expired ? t('common.action.relogin') : t('common.action.login') }}</GlassButton>
      </InboxEmpty>
    </section>

    <template v-else>
      <div v-if="bp.phone && tabOptions.length > 1" class="phone-seg">
        <SegmentedControl v-model="tabModel" :options="tabOptions" :label="t('inbox.tab.label')" />
      </div>

      <!-- 通知 -->
      <div v-if="ib.tab === 'notices'" class="n-layout" :class="{ aside }">
        <section class="panel n-panel">
          <div class="p-head">
            <div class="chips" role="group" :aria-label="t('inbox.type.label')">
              <button
                v-for="c in typeChips"
                :key="c.value ?? 'all'"
                type="button"
                class="chip"
                :class="[{ on: ib.type === c.value }, c.value ? `t-${c.value}` : '']"
                :aria-pressed="ib.type === c.value"
                @click="ib.setType(c.value)"
              >
                <component :is="iconOf(c.value)" v-if="c.value" :size="14" class="chip-ico" aria-hidden="true" />
                {{ c.label }}<span v-if="c.n" class="chip-n">{{ c.n }}</span>
              </button>
            </div>
            <div v-if="!bp.phone" class="meta">
              <span v-if="loading" class="meta-text"><CatbusLoader :size="13" />{{ t('common.state.loading') }}</span>
              <span v-else-if="noticeMeta" class="meta-text">{{ noticeMeta }}</span>
              <CopyCommand :size="15" :command="command" />
              <GlassButton icon size="sm" :aria-label="t('common.action.refresh')" v-tip="t('common.action.refresh')" :disabled="loading" @click="ib.refresh()">
                <RefreshCw :size="15" :class="{ spin: loading }" />
              </GlassButton>
            </div>
            <LoadingBar class="head-progress" :active="loading" />
          </div>

          <div ref="rowsEl" class="p-body" @keydown="onListKey">
            <div v-if="!ib.noticeList?.loaded && !ib.noticeList?.error" class="skel-list" aria-hidden="true">
              <span class="skel-label skel" />
              <div v-for="i in 7" :key="i" class="skel-row">
                <span class="skel ava" />
                <span class="skel-lines"><span class="skel l1" :style="{ width: `${90 + ((i * 53) % 80)}px` }" /><span class="skel l2" :style="{ width: `${42 + ((i * 17) % 40)}%` }" /></span>
                <span class="skel l3" />
              </div>
            </div>
            <StateView v-else-if="listError && !ib.shownNotices.length" kind="error" :error="listError" @retry="ib.refresh()" @login="login" @verify="verifyWith(listError, ib.refresh)" />
            <template v-else-if="!ib.shownNotices.length && !ib.noticeList?.loadingMore && !ib.noticeList?.hasMore">
              <InboxEmpty v-if="ib.type" :icon="iconOf(ib.type)" tone="type" :type="ib.type" :title="t('inbox.empty.type')" :desc="t('inbox.empty.typeDesc', { n: loadedNotices.length }, loadedNotices.length)">
                <GlassButton @click="ib.setType(null)">{{ t('inbox.empty.all') }}</GlassButton>
              </InboxEmpty>
              <InboxEmpty v-else :icon="InboxIcon" :title="t('inbox.empty.notices')" :desc="t('inbox.empty.noticesDesc')" />
            </template>
            <template v-else>
              <section v-for="g in groups" :key="g.group + g.items[0]!.id" class="n-group">
                <h3 class="g-head">{{ t(`inbox.group.${g.group}`) }}</h3>
                <ul class="n-list">
                  <li v-for="n in g.items" :key="n.id">
                    <component
                      :is="aside ? 'button' : n.target?.url ? 'a' : 'div'"
                      class="n-row"
                      :class="{ on: aside && selected?.id === n.id, link: !aside && n.target?.url }"
                      :data-id="n.id"
                      :type="aside ? 'button' : undefined"
                      :aria-current="aside && selected?.id === n.id ? 'true' : undefined"
                      :href="!aside ? (n.target?.url ?? undefined) : undefined"
                      :target="!aside && n.target?.url ? '_blank' : undefined"
                      :rel="!aside && n.target?.url ? 'noopener noreferrer' : undefined"
                      @click="aside && select(n)"
                    >
                      <span class="n-ava" :class="`t-${n.type}`">
                        <template v-if="!anon(n)">
                          <UserAvatar class="ava" :user="n.user" :style="{ background: tintOf(n.user?.id) }" />
                          <span class="n-badge"><component :is="iconOf(n.type)" :size="10" :stroke-width="2.6" /></span>
                        </template>
                        <span v-else class="ava tile"><component :is="iconOf(n.type)" :size="18" /></span>
                      </span>
                      <span class="n-main">
                        <span class="n-head">
                          <template v-if="!anon(n)">
                            <b class="n-name">{{ noticeName(n) }}</b>
                            <span class="n-what">{{ t(`inbox.what.${n.type}`) }}</span>
                          </template>
                          <b v-else class="n-name">{{ t(`inbox.anon.${n.type}`) }}</b>
                          <span class="n-time" v-tip="fullTime(n.created_at)">{{ inboxTime(n.created_at) }}</span>
                        </span>
                        <span v-if="n.text" class="n-text" :class="{ quote: n.type === 'like' }"><EmojiText :platform="ib.platform" :text="n.text" /></span>
                      </span>
                    </component>
                  </li>
                </ul>
              </section>
              <div ref="sentinel" class="sentinel" aria-hidden="true" />
              <p v-if="ib.noticeList?.loadingMore" class="more"><CatbusLoader :size="15" />{{ t('common.state.loading') }}</p>
              <p v-else-if="!ib.noticeList?.hasMore" class="more">{{ t('discover.end') }}</p>
            </template>
          </div>
        </section>

        <!-- 桌面：详情 + 按类型 -->
        <aside v-if="aside" class="n-aside">
          <section class="panel a-card detail">
            <h3 class="a-title">{{ t('inbox.detail.title') }}</h3>
            <template v-if="selected">
              <div class="d-who">
                <span class="n-ava lg" :class="`t-${selected.type}`">
                  <template v-if="!anon(selected)">
                    <UserAvatar class="ava" :user="selected.user" :style="{ background: tintOf(selected.user?.id) }" />
                    <span class="n-badge"><component :is="iconOf(selected.type)" :size="11" :stroke-width="2.6" /></span>
                  </template>
                  <span v-else class="ava tile"><component :is="iconOf(selected.type)" :size="22" /></span>
                </span>
                <span class="d-names">
                  <b>{{ anon(selected) ? t(`inbox.anon.${selected.type}`) : noticeName(selected) }}</b>
                  <span v-if="!anon(selected)">{{ t(`inbox.what.${selected.type}`) }}</span>
                </span>
              </div>
              <p v-if="selected.text" class="d-text" :class="{ quote: selected.type === 'like' }"><EmojiText :platform="ib.platform" :text="selected.text" /></p>
              <p class="d-time"><Clock :size="14" aria-hidden="true" />{{ fullTime(selected.created_at) }}</p>
              <div v-if="selected.target?.url || selected.user?.url" class="d-actions">
                <GlassButton v-if="selected.target?.url" size="lg" class="d-btn navy" :href="selected.target.url" target="_blank" rel="noopener noreferrer">
                  <ExternalLink :size="16" />{{ t('inbox.detail.open', { platform: platform.name }) }}
                </GlassButton>
                <GlassButton v-if="selected.user?.url" size="lg" class="d-btn" :href="selected.user.url" target="_blank" rel="noopener noreferrer">
                  <ExternalLink :size="16" />{{ t('inbox.detail.profile') }}
                </GlassButton>
                <p class="d-hint">{{ t('inbox.detail.hint', { platform: platform.name }) }}</p>
              </div>
            </template>
            <div v-else-if="!ib.noticeList?.loaded && !ib.noticeList?.error" class="d-skel" aria-hidden="true">
              <span class="skel ava" /><span class="skel l1" /><span class="skel block" />
            </div>
            <p v-else class="a-none">{{ t('inbox.detail.none') }}</p>
          </section>

          <section class="panel a-card">
            <div class="a-row-head">
              <h3 class="a-title">{{ t('inbox.overview.title') }}</h3>
              <span class="a-sub">{{ typeCount ? t('inbox.overview.unread') : noticeMeta.split(' · ')[0] }}</span>
            </div>
            <ul class="ov">
              <li v-for="r in overview" :key="r.type">
                <button type="button" class="ov-row" :class="[`t-${r.type}`, { on: ib.type === r.type }]" :aria-pressed="ib.type === r.type" @click="ib.setType(ib.type === r.type ? null : r.type)">
                  <span class="ov-ico"><component :is="iconOf(r.type)" :size="14" /></span>
                  <span class="ov-label">{{ t(`inbox.type.${r.type}`) }}</span>
                  <span class="ov-bar"><span :style="{ width: `${overviewReady && r.n ? Math.max(4, r.pct) : 0}%` }" /></span>
                  <span class="ov-n">{{ overviewReady ? r.n : '—' }}</span>
                </button>
              </li>
            </ul>
            <p class="a-hint">{{ typeCount ? t('inbox.overview.countHint') : t('inbox.overview.loadedHint') }}</p>
          </section>
        </aside>
      </div>

      <!-- 私信：左会话，右消息；手机上两级 -->
      <section v-else-if="ib.tab === 'messages'" class="dm" :class="{ phone: bp.phone, panel: !bp.phone }">
        <aside v-if="!bp.phone || !ib.conv" class="c-col" :class="{ panel: bp.phone }">
          <div class="p-head c-head">
            <h3 class="c-title">{{ t('inbox.conv.title') }}</h3>
            <span class="meta-text">
              <template v-if="ib.convList?.loading"><CatbusLoader :size="13" /></template>
              <template v-else>{{ convMeta }}</template>
            </span>
            <span class="spacer" />
            <CopyCommand v-if="!bp.phone" :size="15" :command="command" />
            <GlassButton v-if="!bp.phone" icon size="sm" :aria-label="t('common.action.refresh')" v-tip="t('common.action.refresh')" :disabled="loading" @click="ib.refresh()">
              <RefreshCw :size="15" :class="{ spin: loading }" />
            </GlassButton>
            <LoadingBar class="head-progress" :active="Boolean(ib.convList?.loading)" />
          </div>
          <div class="c-list">
            <template v-if="!ib.convList?.loaded && !ib.convList?.error">
              <div v-for="i in 7" :key="i" class="skel-row conv" aria-hidden="true">
                <span class="skel ava lg" />
                <span class="skel-lines"><span class="skel l1" :style="{ width: `${70 + ((i * 31) % 50)}px` }" /><span class="skel l2" :style="{ width: `${50 + ((i * 13) % 30)}%` }" /></span>
              </div>
            </template>
            <StateView v-else-if="ib.convList?.error && !convs.length" kind="error" :error="ib.convList.error" @retry="ib.refresh()" @login="login" @verify="verifyWith(ib.convList?.error ?? null, ib.refresh)" />
            <InboxEmpty v-else-if="!convs.length" :icon="MessageSquare" :title="t('inbox.empty.convs')" :desc="t('inbox.empty.convsDesc')" />
            <button
              v-for="c in convs"
              :key="c.id"
              type="button"
              class="c-row"
              :class="{ on: c.id === ib.conv && !bp.phone }"
              :aria-current="c.id === ib.conv ? 'true' : undefined"
              @click="ib.setConv(c.id)"
            >
              <UserAvatar v-if="c.peer" class="ava lg" :user="c.peer" :style="{ background: tintOf(c.peer.id) }" />
              <span v-else class="ava lg group"><Users :size="20" /></span>
              <span class="c-main">
                <span class="c-line">
                  <b class="c-name">{{ convName(c) }}</b>
                  <span v-if="!c.peer" class="c-id mono">{{ shortId(c.id) }}</span>
                  <span class="c-time" v-tip="fullTime(c.updated_at)">{{ inboxTime(c.updated_at) }}</span>
                </span>
                <span class="c-line">
                  <span class="c-last">{{ c.last_message ?? '' }}</span>
                  <span v-if="c.unread" class="c-unread">{{ c.unread > 99 ? '99+' : c.unread }}</span>
                </span>
              </span>
              <ChevronRight v-if="bp.phone" :size="16" class="c-go" />
            </button>
            <div ref="convSentinel" class="sentinel" aria-hidden="true" />
            <p v-if="ib.convList?.loadingMore" class="more"><CatbusLoader :size="15" /></p>
          </div>
        </aside>

        <section v-if="ib.conv" class="thread" :class="{ panel: bp.phone }">
          <div class="t-head">
            <GlassButton v-if="bp.phone" icon tone="quiet" :aria-label="t('common.action.back')" @click="ib.setConv(null)"><ArrowLeft :size="18" /></GlassButton>
            <UserAvatar v-if="ib.curConv?.peer" class="ava md" :user="ib.curConv.peer" :style="{ background: tintOf(ib.curConv.peer.id) }" />
            <span v-else class="ava md group"><Users :size="17" /></span>
            <span class="t-names">
              <b>{{ ib.curConv ? convName(ib.curConv) : shortId(ib.conv) }}<span v-if="ib.curConv && !ib.curConv.peer" class="c-id mono">{{ shortId(ib.curConv.id) }}</span></b>
              <span v-if="ib.msgList?.loaded">{{ t('inbox.conv.msgs', { n: messages.length }, messages.length) }}</span>
            </span>
            <span class="spacer" />
            <GlassButton
              v-if="ib.curConv?.peer?.url"
              :icon="bp.phone"
              :size="bp.phone ? 'md' : 'sm'"
              :href="ib.curConv.peer.url"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="t('inbox.detail.open', { platform: platform.name })"
            >
              <ExternalLink :size="15" /><template v-if="!bp.phone">{{ t('inbox.detail.open', { platform: platform.name }) }}</template>
            </GlassButton>
          </div>
          <div ref="stream" class="stream" @scroll.passive="onStreamScroll">
            <template v-if="!ib.msgList?.loaded && !ib.msgList?.error">
              <div v-for="i in 5" :key="i" class="bubble-skel skel" :class="{ right: i % 2 === 0 }" aria-hidden="true" />
            </template>
            <StateView v-else-if="ib.msgList?.error && !messages.length" kind="error" :error="ib.msgList.error" @retry="ib.retryMsgs()" @login="login" @verify="verifyWith(ib.msgList?.error ?? null, ib.retryMsgs)" />
            <InboxEmpty v-else-if="!messages.length" :icon="MessageCircle" :title="t('inbox.empty.msgs')" />
            <template v-else>
              <button v-if="ib.msgList?.hasMore" type="button" class="older lg-btn lg-sm" :disabled="ib.msgList.loadingMore" @click="older">
                <CatbusLoader v-if="ib.msgList.loadingMore" :size="13" /><ChevronUp v-else :size="14" />{{ t('inbox.older') }}
              </button>
              <template v-for="(m, i) in messages" :key="m.id">
                <p v-if="showTime(i)" class="sep">{{ msgTime(m.created_at) }}</p>
                <div class="msg" :class="{ me: mine(m) }">
                  <UserAvatar v-if="!mine(m)" class="ava sm" :user="m.from" :style="{ background: tintOf(m.from?.id) }" />
                  <div class="bubble-wrap">
                    <span v-if="showFrom(m)" class="from">{{ m.from!.name }}</span>
                    <div v-if="images(m).length" class="imgs">
                      <button v-for="(x, k) in images(m)" :key="k" type="button" class="img" :aria-label="t('inbox.msg.image')" @click="zoom(m, k)">
                        <img :src="imgSrc(x.url!)" alt="" loading="lazy" referrerpolicy="no-referrer" @load="onImgLoad" :style="x.width && x.height ? { aspectRatio: `${x.width} / ${x.height}` } : undefined" />
                      </button>
                    </div>
                    <div v-if="m.text || !images(m).length" class="bubble" :class="{ dim: !m.text }">
                      <EmojiText v-if="m.text" :platform="ib.platform" :text="m.text" />
                      <template v-else>{{ placeholder(m) }}</template>
                    </div>
                  </div>
                </div>
              </template>
            </template>
          </div>
          <div class="readonly">
            <Lock :size="14" aria-hidden="true" />
            <span>{{ t('inbox.readonly', { platform: platform.name }) }}</span>
            <span class="spacer" />
            <GlassButton v-if="ib.curConv?.peer?.url" :size="bp.phone ? 'md' : 'sm'" :href="ib.curConv.peer.url" target="_blank" rel="noopener noreferrer">
              <ExternalLink :size="14" />{{ t('inbox.reply', { platform: platform.name }) }}
            </GlassButton>
          </div>
        </section>
      </section>
    </template>
  </main>
</template>

<style scoped>
.inbox-page {
  position: absolute;
  inset: 0 0 0 var(--content-left);
  overflow-y: auto;
  padding: 16px calc(24px + var(--safe-right)) calc(40px + var(--safe-bottom)) 20px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: left 0.5s var(--ease-out);
  scrollbar-width: thin;
  scrollbar-color: var(--hair) transparent;
}
/* 桌面和平板：页面撑满视口，面板里各自滚动 */
.inbox-page.fill {
  overflow: hidden;
  padding-bottom: calc(16px + var(--safe-bottom));
}
.panel {
  background: var(--glass);
  border: 1px solid var(--glass-stroke);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
  backdrop-filter: blur(30px) saturate(1.6);
  -webkit-backdrop-filter: blur(30px) saturate(1.6);
}
.spacer {
  flex: 1;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---------- 标题区 ---------- */
.top {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  flex: none;
}
.title {
  flex: none;
  white-space: nowrap;
}
.eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-2);
}
.logo {
  width: 18px;
  height: 18px;
  border-radius: 5px;
}
h1 {
  margin: 4px 0 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.5px;
  line-height: 1.25;
}
.tabs-seg {
  margin-bottom: 1px;
}
.note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.phone-seg {
  display: flex;
  justify-content: center;
  overflow-x: auto;
  scrollbar-width: none;
  flex: none;
}

/* ---------- 整页状态 ---------- */
.whole {
  margin: 24px auto 0;
  width: min(520px, 100%);
}
.cta {
  font-weight: 600;
  gap: 6px;
}

/* ---------- 面板头 ---------- */
.p-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 60px;
  padding: 0 16px 0 20px;
  border-bottom: 1px solid var(--hair);
  flex: none;
}
.head-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.meta-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-3);
  white-space: nowrap;
}
.chips {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px 0;
}
.chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  border: 1px solid var(--hair);
  background: var(--glass-strong);
  color: var(--ink-2);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}
.chip:hover {
  border-color: color-mix(in srgb, var(--ink-3) 40%, transparent);
}
.chip:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: 2px;
}
.chip.on {
  background: var(--red-soft);
  border-color: color-mix(in srgb, var(--red) 50%, transparent);
  color: var(--lg-accent-ink);
  font-weight: 600;
}
.chip-ico {
  color: var(--tc);
}
.chip.on .chip-ico {
  color: currentColor;
}
.chip-n {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-3);
}
.chip.on .chip-n {
  color: currentColor;
  opacity: 0.85;
}
/* 类型色 */
.t-comment { --tc: var(--type-comment); }
.t-mention { --tc: var(--type-mention); }
.t-like { --tc: var(--type-like); }
.t-follow { --tc: var(--type-follow); }
.t-system { --tc: var(--type-system); }

/* ---------- 通知 ---------- */
.n-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
}
.n-layout.aside {
  grid-template-columns: minmax(0, 1fr) 332px;
}
.n-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.p-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--hair) transparent;
  padding-bottom: 12px;
}
.g-head {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 12px 20px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
  background: linear-gradient(var(--glass-strong) 70%, transparent);
}
.n-list {
  list-style: none;
  margin: 0;
  padding: 0 8px;
}
.n-list li + li .n-row::before {
  content: '';
  position: absolute;
  top: 0;
  left: 68px;
  right: 12px;
  height: 1px;
  background: var(--hair);
}
.n-row {
  position: relative;
  display: flex;
  gap: 16px;
  width: 100%;
  padding: 13px 12px 14px;
  border: 0;
  border-radius: 14px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  text-decoration: none;
  transition: background 0.2s;
}
button.n-row,
a.n-row {
  cursor: pointer;
}
button.n-row:hover,
a.n-row:hover {
  background: var(--lg-fill-hover);
}
.n-row:hover::before,
li:hover + li .n-row::before,
.n-row.on::before,
li:has(.n-row.on) + li .n-row::before {
  opacity: 0;
}
.n-row:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: -2px;
}
.n-row.on {
  background: color-mix(in srgb, var(--red) 8%, transparent);
}
.n-row.on::after {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 2px;
  background: var(--red);
}
.n-ava {
  position: relative;
  flex: none;
  width: 40px;
  height: 40px;
}
.ava {
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}
.ava.sm {
  width: 32px;
  height: 32px;
  font-size: 13px;
}
.ava.md {
  width: 36px;
  height: 36px;
  font-size: 14px;
}
.ava.lg {
  width: 44px;
  height: 44px;
  font-size: 16px;
}
.ava.tile {
  border-radius: 12px;
  background: color-mix(in srgb, var(--tc) 14%, transparent);
  color: var(--tc);
}
.ava.group {
  border-radius: 14px;
  background: var(--hair);
  color: var(--ink-2);
}
.n-badge {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--tc);
  color: var(--type-on);
  box-shadow: 0 0 0 2px var(--detail-bg);
}
.n-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.n-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  min-width: 0;
}
.n-name {
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.n-what {
  color: var(--ink-2);
  white-space: nowrap;
}
.n-time {
  margin-left: auto;
  padding-left: 12px;
  flex: none;
  font-size: 12px;
  color: var(--ink-3);
}
.n-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  padding-right: 24px;
}
.n-text.quote,
.d-text.quote {
  color: var(--ink-2);
  font-size: 13px;
  padding-left: 10px;
  border-left: 2px solid color-mix(in srgb, var(--ink-3) 50%, transparent);
}

/* 骨架 */
.skel {
  display: block;
  border-radius: 6px;
  background: var(--skeleton);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.45;
  }
}
.skel-list {
  padding: 14px 20px;
}
.skel-label {
  width: 40px;
  height: 12px;
  margin-bottom: 10px;
}
.skel-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 14px 0;
}
.skel-row.conv {
  padding: 14px 16px;
  align-items: center;
}
.skel.ava {
  border-radius: 50%;
}
.skel-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 2px;
}
.skel.l1 {
  height: 12px;
}
.skel.l2 {
  height: 12px;
  opacity: 0.7;
}
.skel.l3 {
  width: 56px;
  height: 10px;
  flex: none;
}

.sentinel {
  height: 1px;
  flex: none;
}
.more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 10px 0 4px;
  font-size: 12px;
  color: var(--ink-3);
}

/* ---------- 详情栏 ---------- */
.n-aside {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  scrollbar-width: none;
}
.a-card {
  padding: 18px 20px 20px;
  flex: none;
}
.a-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
}
.a-row-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.a-sub {
  font-size: 12px;
  color: var(--ink-3);
}
.d-who {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 16px;
}
.n-ava.lg {
  width: 48px;
  height: 48px;
}
.n-ava.lg .ava {
  width: 48px;
  height: 48px;
  font-size: 18px;
}
.n-ava.lg .ava.tile {
  border-radius: 14px;
}
.n-ava.lg .n-badge {
  width: 20px;
  height: 20px;
}
.d-names {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.d-names b {
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.d-names span {
  font-size: 13px;
  color: var(--ink-2);
}
.d-text {
  margin: 16px 0 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--detail-chip);
  font-size: 15px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 260px;
  overflow-y: auto;
}
.d-text.quote {
  border-left-width: 3px;
}
.d-time {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 14px 0 0;
  font-size: 12px;
  color: var(--ink-3);
}
.d-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 18px;
}
.d-btn {
  width: 100%;
  justify-content: center;
  gap: 8px;
  font-weight: 600;
}
/* 稿里的藏青主按钮：只在这里用，不改 GlassButton 的 primary（tokens.css 的 --navy-btn*，亮暗各一套） */
.d-btn.navy {
  --lg-bg: var(--navy-btn);
  --lg-fg: var(--navy-btn-ink);
  border-color: transparent;
}
.d-btn.navy:hover {
  --lg-bg: var(--navy-btn-hover);
  --lg-fg: var(--navy-btn-ink);
}
.d-hint {
  margin: 2px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--ink-3);
}
.a-none {
  margin: 24px 0 8px;
  text-align: center;
  font-size: 13px;
  color: var(--ink-3);
}
.d-skel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}
.d-skel .ava {
  width: 48px;
  height: 48px;
}
.d-skel .l1 {
  width: 50%;
}
.d-skel .block {
  height: 80px;
  border-radius: 14px;
}
.ov {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}
.ov-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: calc(100% + 16px);
  margin: 0 -8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}
.ov-row:hover {
  background: var(--lg-fill-hover);
}
.ov-row.on {
  background: color-mix(in srgb, var(--red) 8%, transparent);
}
.ov-row:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
}
.ov-ico {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--tc) 14%, transparent);
  color: var(--tc);
  flex: none;
}
.ov-label {
  width: 56px;
  font-size: 13px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ov-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--skeleton);
  overflow: hidden;
}
.ov-bar span {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--tc);
  transition: width 0.4s var(--ease-out);
}
.ov-n {
  width: 36px;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.a-hint {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-3);
}

/* ---------- 私信 ---------- */
.dm {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 348px minmax(0, 1fr);
  overflow: hidden;
}
.dm.phone {
  display: block;
  overflow: visible;
  flex: none;
}
.c-col {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--hair);
}
.dm.phone .c-col {
  border-right: 0;
  overflow: hidden;
}
.c-head {
  padding: 0 16px 0 20px;
  gap: 8px;
}
.c-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.c-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--hair) transparent;
  padding: 6px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.c-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 10px 10px;
  border: 0;
  border-radius: 14px;
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s;
}
.c-row:hover {
  background: var(--lg-fill-hover);
}
.c-row:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: -2px;
}
.c-row.on {
  background: color-mix(in srgb, var(--red) 9%, transparent);
}
.c-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.c-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.c-name {
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.c-id {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  color: var(--ink-3);
}
.c-line .c-id {
  margin-left: 0;
}
.c-time {
  margin-left: auto;
  flex: none;
  padding-left: 8px;
  font-size: 12px;
  color: var(--ink-3);
}
.c-last {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-height: 1.3em;
}
.c-unread {
  flex: none;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: var(--red);
}
.c-go {
  flex: none;
  color: var(--ink-3);
}
.thread {
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.t-head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 60px;
  padding: 0 16px 0 20px;
  border-bottom: 1px solid var(--hair);
  flex: none;
}
.t-names {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.t-names b {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t-names span {
  font-size: 12px;
  color: var(--ink-3);
}
.stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 顶部渐隐：被头部切到的那条气泡淡出，不露出半截 */
  mask-image: linear-gradient(to bottom, transparent 0, #000 24px);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 24px);
  scrollbar-width: thin;
  scrollbar-color: var(--hair) transparent;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.older {
  align-self: center;
  gap: 5px;
  margin-bottom: 8px;
}
.sep {
  align-self: center;
  margin: 10px 0 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.msg {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-width: min(78%, 560px);
}
.msg.me {
  align-self: flex-end;
  flex-direction: row-reverse;
}
.bubble-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.msg.me .bubble-wrap {
  align-items: flex-end;
}
.from {
  font-size: 12px;
  color: var(--ink-3);
  padding-left: 4px;
}
.bubble {
  padding: 9px 14px;
  border-radius: 18px 18px 18px 6px;
  background: var(--glass-strong);
  border: 1px solid var(--hair);
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.msg.me .bubble {
  border-radius: 18px 18px 6px 18px;
  background: var(--red);
  border-color: transparent;
  color: #fff;
}
.bubble.dim {
  color: var(--ink-3);
}
.msg.me .bubble.dim {
  color: rgba(255, 255, 255, 0.88);
}
.imgs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.img {
  padding: 0;
  border: 0;
  background: none;
  border-radius: 16px;
  overflow: hidden;
  cursor: zoom-in;
}
.img:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: 2px;
}
.img img {
  /* 图片没加载出来时也占好位置，不让气泡塌成空行 */
  display: block;
  width: 220px;
  height: auto;
  aspect-ratio: 4 / 3;
  max-height: 260px;
  object-fit: cover;
  background: var(--skeleton);
}
.bubble-skel {
  width: 46%;
  height: 40px;
  border-radius: 18px;
}
.bubble-skel.right {
  align-self: flex-end;
  width: 34%;
  background: color-mix(in srgb, var(--red) 15%, transparent);
}
.readonly {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 56px;
  padding: 8px 16px 8px 24px;
  border-top: 1px solid var(--hair);
  background: color-mix(in srgb, var(--ink) 3%, transparent);
  font-size: 13px;
  color: var(--ink-2);
}
.readonly svg {
  color: var(--ink-3);
  flex: none;
}

@media (prefers-reduced-motion: reduce) {
  .skel,
  .spin {
    animation: none;
  }
  .ov-bar span {
    transition: none;
  }
}
:global(html[data-motion='reduce']) .inbox-page .skel,
:global(html[data-motion='reduce']) .inbox-page .spin {
  animation: none;
}

/* 平板：没有详情栏；会话列表窄一些 */
@media (max-width: 1024px) {
  .dm {
    grid-template-columns: 300px minmax(0, 1fr);
  }
  .note {
    display: none;
  }
}
/* 手机：顶栏是玻璃条；页面整体滚动；可点元素不低于 44px */
@media (max-width: 640px) {
  .inbox-page {
    padding: 0 calc(8px + var(--safe-right)) calc(24px + var(--safe-bottom)) calc(8px + var(--safe-left));
    gap: 12px;
  }
  .top.phone {
    position: sticky;
    top: 0;
    z-index: 3;
    align-items: center;
    gap: 8px;
    margin: 0 calc(-8px - var(--safe-right)) 0 calc(-8px - var(--safe-left));
    padding: calc(10px + var(--safe-top)) calc(12px + var(--safe-right)) 10px calc(12px + var(--safe-left));
    background: var(--glass);
    backdrop-filter: blur(30px) saturate(1.6);
    -webkit-backdrop-filter: blur(30px) saturate(1.6);
  }
  .top.phone .title {
    flex: 1;
    min-width: 0;
    text-align: center;
  }
  h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .n-layout {
    flex: none;
  }
  .n-panel {
    overflow: visible;
  }
  .p-head {
    min-height: 0;
    padding: 12px 8px;
    border-bottom: 0;
  }
  .n-panel .p-head {
    padding: 12px 0 4px;
    background: none;
  }
  .chips {
    padding: 0 8px;
    mask-image: linear-gradient(90deg, #000 calc(100% - 40px), transparent);
  }
  .chip {
    height: 40px;
    padding: 0 14px;
    border-radius: 20px;
  }
  .p-body {
    overflow: visible;
  }
  .g-head {
    padding: 12px 16px 4px;
  }
  .n-list {
    padding: 0 4px;
  }
  .n-row {
    gap: 14px;
    padding: 13px 12px;
  }
  .n-text {
    padding-right: 0;
  }
  .c-row {
    min-height: 72px;
  }
  .c-list {
    overflow: visible;
  }
  .thread {
    /* 顶栏 + 两行分段之下撑满，只读栏留在屏幕底部 */
    height: calc(100dvh - 216px - var(--safe-top) - var(--safe-bottom));
    min-height: 380px;
    overflow: hidden;
  }
  .t-head {
    padding: 0 8px;
    gap: 8px;
  }
  .stream {
    padding: 12px;
  }
  .msg {
    max-width: 86%;
  }
  .img img {
    width: 180px;
  }
  .readonly {
    padding: 8px 12px calc(8px + var(--safe-bottom)) 16px;
  }
}
</style>
