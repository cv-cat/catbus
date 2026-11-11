<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Copy, ExternalLink, RotateCw, ShieldCheck, X } from 'lucide-vue-next'
import { platformById } from '@/data/platforms'
import { useVerifyStore } from '@/stores/verify'
import BottomSheet from './BottomSheet.vue'

/**
 * 人机验证引导（AGENTS.md 7.9）：平台风控（RISK_CONTROL）给出验证链接时，
 * 引导用户在登录了同一账号的浏览器里打开、完成验证，再回来重试。WebUI 不代为验证。
 */
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
    window.prompt('复制验证链接：', verify.url)
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
       <h2 id="verify-title">完成{{ platform?.name ?? '' }}人机验证</h2>
       <p>{{ verify.message || '平台暂时拦下了请求，需要你亲自验证一次' }}</p>
            </div>
     <button class="close" type="button" aria-label="关闭" @click="close"><X :size="18" /></button>
   </header>

   <ol v-if="verify.url" class="steps">
     <li :class="{ done: opened }">
       <span class="no">
  <Check v-if="opened" :size="13" />
  <template v-else>1</template>
       </span>
       <div class="body">
  <strong>打开验证页</strong>
  <p>请用<b>已登录同一个{{ platform?.name }}账号</b>的浏览器打开；没登录的话先在新标签页里登录。</p>
  <div class="row">
    <button type="button" class="open" @click="openPage">
      <ExternalLink :size="15" />{{ opened ? '再次打开' : '打开验证页' }}
    </button>
           <button type="button" class="ghost" :title="verify.url" @click="copy">
      <Check v-if="copied" :size="14" />
      <Copy v-else :size="14" />{{ copied ? '已复制' : '复制链接' }}
    </button>
         </div>
       </div>
     </li>
     <li>
<span class="no">2</span>
       <div class="body">
         <strong>按页面提示完成验证</strong>
         <p>滑块、点选或短信验证码，看到验证通过即可关掉那个标签页。</p>
       </div>
     </li>
     <li>
       <span class="no">3</span>
       <div class="body">
  <strong>回到这里重试</strong>
  <p>验证有时要过几秒才生效；仍然被拦时稍等片刻再试，请求别太密。</p>
       </div>
     </li>
          </ol>
   <p v-else class="none">
            {{ platform?.name ?? '平台' }}没有给出验证链接。可以在浏览器里打开{{ platform?.name ?? '平台' }}网页版，按提示完成验证；或者过几分钟再试。
   </p>

          <footer class="foot">
     <button type="button" class="ghost" @click="close">稍后再说</button>
     <button v-if="verify.retry" type="button" class="primary" :class="{ ready: opened || !verify.url }" @click="done">
<RotateCw :size="15" />已完成验证，重试
     </button>
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
.close {
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  background: var(--hair);
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
.open,
.ghost,
.primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transition: transform 0.2s var(--ease-out), background 0.2s, box-shadow 0.2s, opacity 0.2s;
}
.open {
  color: #fff;
  background: var(--red);
  box-shadow: 0 6px 16px #e8414f40;
}
.open:hover,
.primary:hover {
  transform: translateY(-1px);
}
.ghost {
  color: var(--ink-2);
  background: var(--hair);
  font-weight: 500;
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
/* 底部两个按钮等高 */
.foot .ghost,
.foot .primary {
  height: 40px;
}
.primary {
  color: #fff;
  background: var(--primary-btn);
  opacity: 0.55;
}
.primary.ready {
  opacity: 1;
  box-shadow: 0 8px 20px #23283833;
}


/* ---------- 触屏：可点区域至少 --tap ---------- */
@media (hover: none) and (pointer: coarse) {
  .close {
    width: var(--tap);
    height: var(--tap);
    margin: -6px -6px -6px 0;
  }
  .open,
  .ghost,
  .foot .ghost,
  .foot .primary {
    height: auto;
    min-height: var(--tap);
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
  .foot .ghost,
  .foot .primary {
    height: auto;
    min-height: var(--tap);
  }
}
</style>
