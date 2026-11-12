<script setup lang="ts">
import { onMounted } from 'vue'
import PixelBackground from '@/components/PixelBackground.vue'
import AmbientBlobs from '@/components/AmbientBlobs.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import DiscoverView from '@/views/DiscoverView.vue'
import AuthorView from '@/views/AuthorView.vue'
import { useAuthorStore } from '@/stores/author'
import LoginDialog from '@/components/LoginDialog.vue'
import VerifyDialog from '@/components/VerifyDialog.vue'
import DetailCard from '@/components/DetailCard.vue'
import Lightbox from '@/components/Lightbox.vue'
import AppToast from '@/components/AppToast.vue'
import SettingsDialog from '@/components/settings/SettingsDialog.vue'
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
const settings = useSettingsStore().settings
// 「减少动效」「人浪动效」两项设置接到 motion.ts（立即生效）
bindMotionSettings()

/** 登录成功：刷新账号状态，再重新搜索 */
async function onLogin() {
  await d.refreshAccounts()
  d.search()
  if (author.active) author.load(true)
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
  d.search()
  // 直接打开的作者页：账号读到之后再请求
  if (author.active) author.load()
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
      @update:aggregate="d.setAggregate"
      @toggle="d.toggleChannel"
      @login="(platform: string, account?: string) => openLogin(platform, account)"
      @toggle-account="d.toggleAccount"
      @set-default="setDefault"
      @remove="removeAccount"
    />
    <DiscoverView :class="{ behind: author.active }" :inert="author.active || undefined" :aria-hidden="author.active || undefined" />
    <AuthorView v-if="author.active" />
  </div>
  <DetailCard />
  <Lightbox />
  <LoginDialog @success="onLogin" />
  <VerifyDialog />
  <SettingsDialog />
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
