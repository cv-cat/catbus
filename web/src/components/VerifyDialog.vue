<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy, ExternalLink, RotateCw, ShieldCheck, X } from 'lucide-vue-next'
import { platformById } from '@/data/platforms'
import { useVerifyStore } from '@/stores/verify'
import BottomSheet from './BottomSheet.vue'
import GlassButton from '@/components/ui/GlassButton.vue'

/**
 * 人机验证引导（AGENTS.md 7.9）：平台风控（RISK_CONTROL）给出验证链接时，
 * 引导用户在登录了同一账号的浏览器里打开、完成验证，再回来重试。WebUI 不代为验证。
 */
const { t } = useI18n()
const { verify, close } = useVerifyStore()
const platform = computed(() => platformById(verify.platform))
const opened = ref(false)
const copied = ref(false)

function openPage() {
  if (!verify.url) return
  window.open(verify.url, '_blank', 'noopener,noreferrer')
  opened.value = true
}
async function copy() {
  if (!verify.url) return
  try {
    await navigator.clipboard.writeText(verify.url)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch {
    window.prompt(t('verify.copyPrompt'), verify.url)
  }
}
function done() {
  const retry = verify.retry
  close()
  retry?.()
}

// Esc、遮罩、下滑关闭由 BottomSheet 处理
watch(
  () => verify.open,
  (v) => {
    if (v) {
      opened.value = false
      copied.value = false
    }
  },
)
</script>

<template>
  <BottomSheet :open="verify.open" labelledby="verify-title" width="440px" :z="60" @close="close">
        <div class="panel">
          <header class="head">
     <span class="badge">
       <ShieldCheck :size="20" />
       <img v-if="platform" class="logo" :src="platform.logo" alt="" />
     </span>
     <div class="titles">
       <h2 id="verify-title">{{ t('verify.title', { platform: platform?.name ?? '' }) }}</h2>
       <p>{{ verify.message || t('verify.defaultMessage') }}</p>
            </div>
     <GlassButton icon class="close" :aria-label="t('common.action.close')" @click="close"><X :size="18" /></GlassButton>
   </header>

   <ol v-if="verify.url" class="steps">
     <li :class="{ done: opened }">
       <span class="no">
  <Check v-if="opened" :size="13" />
  <template v-else>1</template>
       </span>
       <div class="body">
  <strong>{{ t('verify.open.title') }}</strong>
  <i18n-t keypath="verify.open.desc" tag="p">
    <template #account><b>{{ t('verify.open.account', { platform: platform?.name ?? '' }) }}</b></template>
  </i18n-t>
  <div class="row">
    <GlassButton tone="primary" class="open" @click="openPage">
      <ExternalLink :size="15" />{{ opened ? t('verify.open.again') : t('verify.open.title') }}
    </GlassButton>
           <GlassButton class="ghost" :title="verify.url" @click="copy">
      <Check v-if="copied" :size="14" />
      <Copy v-else :size="14" />{{ copied ? t('common.action.copied') : t('verify.open.copyLink') }}
    </GlassButton>
         </div>
       </div>
     </li>
     <li>
<span class="no">2</span>
       <div class="body">
         <strong>{{ t('verify.solve.title') }}</strong>
         <p>{{ t('verify.solve.desc') }}</p>
       </div>
     </li>
     <li>
       <span class="no">3</span>
       <div class="body">
  <strong>{{ t('verify.back.title') }}</strong>
  <p>{{ t('verify.back.desc') }}</p>
       </div>
     </li>
          </ol>
   <p v-else class="none">
            {{ t('verify.noLink', { platform: platform?.name ?? t('verify.platformFallback') }) }}
   </p>

          <footer class="foot">
     <GlassButton size="lg" class="ghost" @click="close">{{ t('verify.later') }}</GlassButton>
     <GlassButton v-if="verify.retry" size="lg" tone="primary" class="primary" :class="{ ready: opened || !verify.url }" @click="done">
<RotateCw :size="15" />{{ t('verify.doneRetry') }}
     </GlassButton>
          </footer>
        </div>
  </BottomSheet>
</template>

<style scoped>
/* 外壳（背景、圆角、滚动、手机底部弹层、进出场）由 BottomSheet 提供 */
.panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.badge {
  position: relative;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: var(--red);
  background: var(--red-soft);
}
.badge .logo {
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  box-shadow: 0 0 0 2px var(--glass-strong);
}
.titles {
  flex: 1;
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: 17px;
}
.titles p {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--ink-3);
}
.steps {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.steps li {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 16px;
}
.steps li:first-child {
  background: color-mix(in srgb, var(--ink) 3%, transparent);
  border: 1px solid var(--hair);
}
/* 步骤之间的连线 */
.steps li:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 23px;
  top: 38px;
  bottom: -10px;
  width: 1.5px;
  background: var(--hair);
}
.no {
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-2);
  background: var(--glass-strong);
  border: 1px solid var(--hair);
  z-index: 1;
  transition: background 0.3s, color 0.3s, border-color 0.3s;
}
.done .no {
  color: #fff;
  background: var(--online);
  border-color: var(--online);
}
.body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.body strong {
  font-size: 13.5px;
}
.body p {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink-3);
}
.body b {
  color: var(--ink-2);
}
.row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
/* 外观来自 GlassButton（styles/glass-button.css） */
.row .lg-btn {
  --lg-h: 36px;
}
.none {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-2);
}
.foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
/* 还没打开验证页时，重试按钮先淡一些 */
.primary:not(.ready) {
  opacity: 0.55;
}


/* ---------- 触屏：可点区域至少 --tap ---------- */
@media (hover: none) and (pointer: coarse) {
  .close {
    margin: -6px -6px -6px 0;
  }
  .row .lg-btn {
    --lg-h: var(--tap);
  }
}

/* ---------- 手机：底部弹层里的排版 ---------- */
@media (max-width: 640px) {
  .panel {
    gap: 14px;
    padding: 6px 18px 18px;
  }
  .steps li {
    padding: 10px;
  }
  .row {
    flex-wrap: wrap;
  }
  .row .open,
  .row .ghost {
    flex: 1 1 130px;
  }
  /* 底部按钮：主操作在上、整行宽 */
  .foot {
    flex-direction: column-reverse;
    align-items: stretch;
  }
}
</style>
