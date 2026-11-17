<script setup lang="ts">
import { computed, onMounted } from 'vue'
import PixelBackground from '@/components/PixelBackground.vue'
import AmbientBlobs from '@/components/AmbientBlobs.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import DiscoverView from '@/views/DiscoverView.vue'
import { useInboxStore } from '@/stores/inbox'
import { useSubsStore } from '@/stores/subs'
import { useLiveStore } from '@/stores/live'
import { useMineStore } from '@/stores/mine'
import { useLocalStore } from '@/stores/local'
import { useSeenStore } from '@/stores/seen'
import { useMteamStore } from '@/stores/mteam'
import { useAuthorStore } from '@/stores/author'
import { useRailStore } from '@/stores/rail'
import AppToast from '@/components/AppToast.vue'
import LazyMount from '@/components/lazy/LazyMount.vue'
import {
  LazyAuthorView, LazyRailView, LazyMteamMeView, LazyMineView, LazyLocalView, LazyLiveView, LazySubsView, LazyInboxView,
  LazyDetailCard, LazyLightbox, LazyLoginDialog, LazyVerifyDialog, LazySettingsDialog, LazyGroupMenu, LazyDownloadPanel,
} from '@/components/lazy'
import { prefetchWhenIdle } from '@/composables/lazy'
import { openLogin } from '@/stores/login'
import { PLATFORMS } from '@/data/platforms'
import { useDiscoverStore } from '@/stores/discover'
import { useSourceStore } from '@/stores/source'
import { detectSource } from '@/api/client'
import { animateFrom, bindMotionSettings } from '@/composables/motion'
import { useSettingsStore } from '@/stores/settings'
import { MQ } from '@/composables/useBreakpoint'

const d = useDiscoverStore()
const src = useSourceStore()
// 作者页（AGENTS.md 7.9「作者页」）：发现页保持挂载、藏在后面，后退时原样恢复
const author = useAuthorStore()
// 12306 查询页（AGENTS.md 7.9「12306 查询页」）：同样盖在发现页上面，发现页在后台不动
const rail = useRailStore()
// M-Team「我的」页（AGENTS.md 7.9「M-Team「我的」页与筛选」）：同样盖在发现页上面
const me = useMteamStore()
// 各平台的「我的」页、本地收藏（AGENTS.md 7.9）：同样盖在发现页上面
const mine = useMineStore()
const local = useLocalStore()
// 直播弹幕（AGENTS.md 7.9「直播弹幕」）
const live = useLiveStore()
// 收件箱（AGENTS.md 7.9「通知与私信」）
const inbox = useInboxStore()
// 订阅（AGENTS.md 7.9「订阅」）：同样盖在发现页上面，聚合模式下也能进
const subs = useSubsStore()
// 看过的标记：跟着详情卡片记录（AGENTS.md 7.9）
useSeenStore()
/** 盖着发现页的页 */
const covered = computed(() => author.active || rail.active || me.active || mine.active || local.active || subs.active || live.active || inbox.active)
const settings = useSettingsStore().settings
// 「减少动效」「人浪动效」两项设置接到 motion.ts（立即生效）
bindMotionSettings()

/** 登录成功：刷新账号状态，再重新搜索 */
async function onLogin() {
  await d.refreshAccounts()
  d.search()
  if (author.active) author.load(true)
  if (me.active) me.refresh()
  if (mine.active) mine.refresh()
  if (inbox.active) inbox.refresh()
}

/** 在「我的」页上点了「发现」或别的渠道：离开「我的」页，回到发现页 */
function leaveMe(id: string) {
  me.leave()
  mine.leave()
  live.leave()
  inbox.leave()
  if (id === d.state.platform) d.search()
  else d.state.platform = id
}

/** 在查询页上点了别的渠道：离开查询页再切过去；点的正是发现页停着的渠道时，平台不变，要自己触发一次搜索 */
/** 在本地收藏上点了渠道：离开本地收藏再切过去；聚合模式下回到聚合的结果 */
function leaveLocal(id: string) {
  local.leave()
  if (d.aggregate || id === d.state.platform) d.search()
  else d.state.platform = id
}

/** 在订阅页上点了渠道：离开订阅页再切过去；聚合模式下回到聚合的结果 */
function leaveSubs(id: string) {
  subs.leave()
  if (d.aggregate || id === d.state.platform) d.search()
  else d.state.platform = id
}

function leaveRail(id: string) {
  rail.leave()
  if (id === d.state.platform) d.search()
  else d.state.platform = id
}

async function removeAccount(platform: string, account: string, done: (ok: boolean) => void) {
  try {
    await d.deleteAccount(platform, account)
    done(true)
  } catch (e) {
    done(false)
    alert((e as Error).message)
  }
}

async function setDefault(platform: string, account: string) {
  try {
    await d.setDefault(platform, account)
  } catch (e) {
    alert((e as Error).message)
  }
}

onMounted(async () => {
  // 手机上侧栏是收起的抽屉，不做入场动画；结束后清掉 transform，别挡住抽屉自己的位移
  if (!matchMedia(MQ.phone).matches) {
    animateFrom(
      '.sidebar',
      { x: -24, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.8, ease: 'power3.out', clearProps: 'transform,opacity' },
    )
  }
  await detectSource()
  await Promise.all([d.refreshAccounts(), d.initFilters(), author.initCaps()])
  // 直接打开的查询页：发现页先不请求（离开查询页时再搜），查询页按地址查询
  if (rail.active) rail.start()
  else if (me.active) me.ensureLoaded()
  else if (mine.active) mine.ensure()
  else if (inbox.active) inbox.ensure()
  else if (!local.active && !subs.active && !live.active) d.search()
  // 订阅：读一次（侧栏显示未读总数）；订阅页打开时每 60 秒再读
  void subs.init()
  // 直接打开的作者页：账号读到之后再请求
  if (author.active) author.load()
  // 首屏之后空闲时预取常用浮层的代码：第一次打开时不用等，进场动画照常
  prefetchWhenIdle([LazyDetailCard.load, LazyLoginDialog.load, LazyDownloadPanel.load, LazySettingsDialog.load, LazyLightbox.load, LazyVerifyDialog.load, LazyGroupMenu.load])
})
</script>

<template>
  <AmbientBlobs />
  <!-- 关掉像素背景时卸载画布（rAF 一并停掉），换成静态的柔和底色 -->
  <PixelBackground v-if="settings.pixelBackground" />
  <div v-else class="calm-bg" aria-hidden="true" />
  <div class="shell">
    <AppSidebar
      v-model="d.state.platform"
      :platforms="PLATFORMS"
      :health="d.health"
      :accounts="d.accounts"
      :selected-of="d.selectedAccounts"
      :browsing-of="d.accountsFor"
      :is-expired="d.isExpired"
      :source="src.source"
      :aggregate="d.aggregate"
      :selected="d.selected"
      :busy="d.busy"
      :rail-page="rail.active"
      :me-page="me.active || mine.active"
      :has-mine="mine.hasMine"
      :live-page="live.active"
      :has-live="live.hasLive"
      :inbox-page="inbox.active"
      :has-inbox="inbox.hasInbox"
      :inbox-badge="inbox.badge"
      :local-page="local.active"
      :local-count="local.entries.length"
      :subs-page="subs.active"
      :subs-unread="subs.unreadTotal"
      @open-subs="subs.open()"
      @leave-subs="leaveSubs"
      @open-rail="rail.open()"
      @open-me="(id: string) => mine.open(id)"
      @open-live="(id: string) => live.open(id)"
      @open-inbox="(id: string) => inbox.open(id)"
      @open-local="local.open()"
      @leave-local="leaveLocal"
      @leave-me="leaveMe"
      @leave-rail="leaveRail"
      @update:aggregate="d.setAggregate"
      @toggle="d.toggleChannel"
      @login="(platform: string, account?: string) => openLogin(platform, account)"
      @toggle-account="d.toggleAccount"
      @set-default="setDefault"
      @remove="removeAccount"
    />
    <DiscoverView
      :class="{ behind: covered }"
      :inert="covered || undefined"
      :aria-hidden="covered || undefined"
    />
    <!-- 盖在发现页上面的页按需加载（AGENTS.md 7.9）：进入时才取代码，加载中在内容区显示加载图标 -->
    <LazyMount v-if="author.active && !rail.active && !me.active" :lazy="LazyAuthorView" page />
    <LazyMount v-if="rail.active" :lazy="LazyRailView" page />
    <LazyMount v-if="me.active && !rail.active" :lazy="LazyMteamMeView" page />
    <LazyMount v-if="mine.active && !author.active" :lazy="LazyMineView" page />
    <LazyMount v-if="local.active && !author.active" :lazy="LazyLocalView" page />
    <LazyMount v-if="live.active && !author.active" :lazy="LazyLiveView" page />
    <LazyMount v-if="subs.active && !author.active" :lazy="LazySubsView" page />
    <LazyMount v-if="inbox.active && !author.active" :lazy="LazyInboxView" page />
  </div>
  <!-- 浮层：代码到了才挂上（空闲时预取；打开时还没到就先加载再打开，见 composables/lazy.ts 的 afterLoad） -->
  <component :is="LazyDetailCard.comp.value" v-if="LazyDetailCard.comp.value" />
  <component :is="LazyLightbox.comp.value" v-if="LazyLightbox.comp.value" />
  <component :is="LazyGroupMenu.comp.value" v-if="LazyGroupMenu.comp.value" />
  <component :is="LazyLoginDialog.comp.value" v-if="LazyLoginDialog.comp.value" @success="onLogin" />
  <component :is="LazyVerifyDialog.comp.value" v-if="LazyVerifyDialog.comp.value" />
  <component :is="LazySettingsDialog.comp.value" v-if="LazySettingsDialog.comp.value" />
  <AppToast />
</template>

<style scoped>
/* 静态背景：右上角一抹品牌红、左下角一层藏青，再叠一层极淡的细点纹理，不动、不重绘 */
.calm-bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(120% 90% at 100% 0%, var(--calm-1) 0%, transparent 55%),
    radial-gradient(110% 90% at 0% 100%, var(--calm-2) 0%, transparent 60%);
}
.calm-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(var(--calm-dot) 1px, transparent 1.2px);
  background-size: 22px 22px;
  -webkit-mask-image: linear-gradient(225deg, #000 0%, transparent 65%);
  mask-image: linear-gradient(225deg, #000 0%, transparent 65%);
}
/* 在作者页上：发现页不卸载（保留结果和滚动位置），只是藏起来 */
.behind {
  visibility: hidden;
  pointer-events: none;
}
.shell {
  position: relative;
  height: 100%;
  z-index: 1;
}
/* 内容区（发现页）按 --content-left 定位，侧栏的三种形态都不推挤内容：
   桌面 = 侧栏宽，平板 = 窄栏宽（展开时浮在上面），手机 = 0（抽屉浮在上面） */
</style>
