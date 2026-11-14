<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LogIn, Menu, RefreshCw } from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StateView from '@/components/StateView.vue'
import MeStats from '@/components/mteam/MeStats.vue'
import MeExam from '@/components/mteam/MeExam.vue'
import MeSeeds from '@/components/mteam/MeSeeds.vue'
import MeBonus from '@/components/mteam/MeBonus.vue'
import MeCollects from '@/components/mteam/MeCollects.vue'
import { useMteamStore, MTEAM_ID } from '@/stores/mteam'
import { useDiscoverStore } from '@/stores/discover'
import { useNavStore } from '@/stores/nav'
import { useSourceStore } from '@/stores/source'
import { openLogin } from '@/stores/login'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { waveWhileLoading } from '@/composables/motion'
import { dateTime } from '@/composables/format'
import { platformById } from '@/data/platforms'

/**
 * M-Team「我的」页（AGENTS.md 7.9「M-Team「我的」页与筛选」，设计稿 Y1–Y3、Y10）：
 * 四块数字、考核、我的种子、魔力流水、收藏。只在点刷新时重新请求，各块各自加载、各自出错。
 */
const { t } = useI18n()
const m = useMteamStore()
const d = useDiscoverStore()
const nav = useNavStore()
const src = useSourceStore()
const bp = useBreakpoint()
const meta = platformById(MTEAM_ID)!

const updated = computed(() => {
  if (m.busy) return t('common.state.loading')
  if (!m.updatedAt) return ''
  const time = dateTime(m.updatedAt, { hour: '2-digit', minute: '2-digit', hour12: false })
  return m.elapsed == null ? t('mteam.me.updated', { time }) : t('mteam.me.updatedIn', { time, s: m.elapsed.toFixed(2) })
})
/** 账号卡副标题里写登录方式；这里在标题下面一行也写上 */
const method = computed(() => {
  const a = m.account
  if (!a) return ''
  return a.method === 'apikey' ? t('mteam.me.method.apikey') : a.method === 'password' ? t('mteam.me.method.password') : a.method
})

/** 手机：标题下面「发现 / 我的」分段 */
const sections = computed(() => [
  { value: 'discover', label: t('mteam.nav.discover') },
  { value: 'me', label: t('mteam.nav.me') },
])
const section = computed({
  get: () => 'me',
  set: (v: string) => {
    if (v !== 'discover') return
    m.leave()
    d.search()
  },
})

watch(() => m.busy, (on) => waveWhileLoading(on), { immediate: true })
onBeforeUnmount(() => waveWhileLoading(false))
// 账号读到之后（或登录后）才请求
watch(() => m.hasAccount, (on) => on && m.ensureLoaded(), { immediate: true })
</script>

<template>
  <main class="me-page">
    <header class="top">
      <button
        v-if="bp.phone"
        type="button"
        class="menu glass"
        :aria-label="t('layout.nav.open')"
        aria-controls="catbus-nav"
        :aria-expanded="nav.navOpen"
        @click="nav.openNav()"
      >
        <Menu :size="20" />
      </button>
      <div class="title">
        <div class="eyebrow">
          <img class="logo" :src="meta.logo" alt="" />{{ meta.name }} · {{ t('mteam.nav.me') }}<template v-if="method"> · {{ method }}</template>
        </div>
        <div class="heading">
          <h1>{{ t('mteam.me.title') }}</h1>
          <span v-if="src.source === 'demo'" class="demo-tag" :title="t('discover.demo.title')">
            <i class="demo-dot" aria-hidden="true" /><span class="demo-long">{{ t('discover.demo.long') }}</span
            ><span class="demo-short">{{ t('discover.demo.short') }}</span>
          </span>
        </div>
      </div>
      <div class="spacer" />
      <button
        v-if="m.hasAccount"
        type="button"
        class="refresh glass"
        :aria-label="t('mteam.me.refresh')"
        :disabled="m.busy"
        @click="m.refresh()"
      >
        <RefreshCw :size="15" :class="{ spin: m.busy }" aria-hidden="true" />
        <span class="upd mono">{{ updated || t('mteam.me.refresh') }}</span>
      </button>
      <ThemeToggle class="tool" />
    </header>

    <div v-if="bp.phone" class="phone-seg">
      <SegmentedControl v-model="section" :options="sections" :label="meta.name" />
      <span v-if="m.hasAccount && updated" class="upd-phone mono">{{ updated }}</span>
    </div>

    <!-- 没有 M-Team 账号 -->
    <div v-if="!m.hasAccount" class="login glass">
      <span class="login-ico"><LogIn :size="22" /></span>
      <h2>{{ t('mteam.me.login') }}</h2>
      <p>{{ t('mteam.me.loginDesc') }}</p>
      <button type="button" class="btn primary" @click="openLogin(MTEAM_ID)">{{ t('common.action.login') }}</button>
    </div>

    <!-- 全部失败且是同一种原因：整页报一次 -->
    <StateView
      v-else-if="m.pageError"
      kind="error"
      :error="m.pageError"
      @retry="m.refresh()"
      @login="openLogin(MTEAM_ID, m.account?.account)"
    />

    <div v-else class="grid">
      <MeStats class="span" />
      <MeExam class="span" />
      <MeSeeds class="seeds" />
      <div class="side">
        <MeBonus />
        <MeCollects />
      </div>
    </div>
  </main>
</template>

<style scoped>
.me-page {
  position: absolute;
  inset: 0 0 0 var(--content-left);
  overflow-y: auto;
  padding: 16px calc(24px + var(--safe-right)) calc(40px + var(--safe-bottom)) 28px;
  z-index: 2;
  transition: left 0.5s var(--ease-out);
  scrollbar-width: thin;
  scrollbar-color: var(--hair) transparent;
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.title {
  flex: none;
  min-width: 0;
}
.eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-3);
  white-space: nowrap;
}
.logo {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}
.heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
h1 {
  margin: 2px 0 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.spacer {
  flex: 1;
}
.menu {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--ink);
}
.refresh {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid var(--glass-stroke);
  font: inherit;
  font-size: 12.5px;
  color: var(--ink-2);
  cursor: pointer;
}
.refresh:hover:not(:disabled) {
  color: var(--ink);
}
.refresh:disabled {
  cursor: progress;
}
.refresh:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: 2px;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 372px);
  gap: 16px;
  align-items: start;
}
.span {
  grid-column: 1 / -1;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.login {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: 440px;
  margin: 60px auto;
  padding: 32px 24px;
  border-radius: var(--radius-lg, 20px);
  border: 1px solid var(--glass-stroke);
  text-align: center;
}
.login h2 {
  margin: 6px 0 0;
  font-size: 17px;
}
.login p {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--ink-3);
}
.login-ico {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--red-soft);
  color: var(--red);
}
.btn {
  min-height: 40px;
  padding: 0 22px;
  border: none;
  border-radius: 999px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.btn.primary {
  background: var(--red);
  color: #fff;
}
.demo-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  padding: 4px 11px 4px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #8a5a00;
  background: linear-gradient(135deg, #ffe08acc 0%, #f5b8244d 100%);
  border: 1px solid #f5c84299;
  box-shadow: inset 0 1px 0 #ffffffb3, 0 4px 14px #f5a52433;
  backdrop-filter: blur(12px) saturate(1.6);
}
.demo-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f5a524;
  box-shadow: 0 0 0 3px #f5a52433;
}
.demo-short {
  display: none;
}
[data-theme='dark'] .demo-tag {
  color: #ffd770;
  background: linear-gradient(135deg, #f5b82438 0%, #f5a5241a 100%);
  border-color: #f5c84259;
  box-shadow: inset 0 1px 0 #ffffff1f, 0 4px 16px #f5a52426;
}
.phone-seg {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: -4px 0 12px;
}
.upd-phone {
  font-size: 11.5px;
  color: var(--ink-3);
}
@media (max-width: 1024px) {
  .me-page {
    padding-left: 20px;
  }
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 640px) {
  .me-page {
    padding: calc(12px + var(--safe-top)) calc(12px + var(--safe-right)) calc(32px + var(--safe-bottom)) calc(12px + var(--safe-left));
  }
  .top {
    gap: 8px;
    margin-bottom: 12px;
  }
  .title {
    flex: 1;
  }
  .spacer {
    display: none;
  }
  h1 {
    font-size: 22px;
  }
  .demo-long {
    display: none;
  }
  .demo-short {
    display: inline;
  }
  .refresh {
    width: 44px;
    height: 44px;
    padding: 0;
    justify-content: center;
  }
  .refresh .upd {
    display: none;
  }
  .grid,
  .side {
    gap: 12px;
  }
  .btn {
    min-height: var(--tap);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
