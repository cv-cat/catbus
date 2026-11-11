<script setup lang="ts">
import { SearchX, ShieldCheck, TriangleAlert, LogIn, Copy } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type { CatbusError } from '@/api/types'
import { animateFrom } from '@/composables/motion'

import { verifyUrlOf } from '@/stores/verify'
import { copyText } from '@/stores/toast'

const props = defineProps<{ kind: 'empty' | 'error'; error?: CatbusError | null }>()
defineEmits<{ retry: []; login: []; verify: [url: string] }>()
/** 平台要求人机验证时的网页验证链接 */
const verifyUrl = computed(() => verifyUrlOf(props.error))

const root = ref<HTMLElement>()
onMounted(() =>
  animateFrom(root.value!, { y: 16, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: 'power3.out' }),
)
</script>

<template>
  <div ref="root" class="state" role="status">
    <div class="icon" :class="kind">
      <SearchX v-if="kind === 'empty'" :size="22" />
      <LogIn v-else-if="error?.code?.startsWith('AUTH')" :size="22" />
      <ShieldCheck v-else-if="verifyUrl" :size="22" />
      <TriangleAlert v-else :size="22" />
    </div>
    <template v-if="kind === 'empty'">
      <h2>没有找到内容</h2>
      <p>换个关键词，或者切换到别的渠道试试。</p>
    </template>
    <template v-else>
      <h2>{{ error?.message ?? '出错了' }}</h2>
      <p v-if="verifyUrl">需要在浏览器里完成一次人机验证，验证后重试即可。</p>
      <div v-else-if="error?.hint" class="hint">
        <span class="hint-label">建议</span>
        <button type="button" class="cmd mono" :title="`${error.hint}\n点击复制`" @click="copyText(error.hint)">
          <span class="cmd-text">{{ error.hint }}</span>
          <Copy :size="13" class="cmd-icon" />
        </button>
      </div>
      <p class="code mono">{{ error?.code }}</p>
      <div class="actions">
        <button v-if="error?.code?.startsWith('AUTH')" type="button" class="btn primary" @click="$emit('login')">
          <LogIn :size="15" />去登录
        </button>
        <button v-if="verifyUrl" type="button" class="btn primary" @click="$emit('verify', verifyUrl)">
   <ShieldCheck :size="15" />去验证
 </button>
        <button type="button" class="btn" :class="{ primary: !error?.code?.startsWith('AUTH') && !verifyUrl }" @click="$emit('retry')">重试</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  width: min(480px, 100%);
  margin: 64px auto 0;
  padding: 36px 32px 32px;
  border-radius: var(--radius-xl);
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(40px) saturate(1.6);
  color: var(--ink-2);
}
.icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--hair);
  color: var(--ink-2);
  margin-bottom: 6px;
}
.icon.error {
  color: var(--red);
  background: var(--red-soft);
}
h2 {
  margin: 0;
  font-size: 16px;
  color: var(--ink);
}
p {
  margin: 0;
  font-size: 13px;
}
.hint {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  font-size: 13px;
}
.hint-label {
  flex: none;
}
.cmd {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--hair);
  color: var(--ink);
  font-size: 12px;
  line-height: 1.4;
  text-align: left;
  cursor: copy;
  transition: background 0.2s var(--ease-out);
}
.cmd:hover {
  background: var(--red-soft);
}
.cmd-text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmd-icon {
  flex: none;
  color: var(--ink-3);
}
.cmd:hover .cmd-icon {
  color: var(--red);
}
.code {
  font-size: 11px;
  color: var(--ink-3);
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: 16px;
  background: var(--hair);
  color: var(--ink);
  font-size: 13px;
  transition: transform 0.2s var(--ease-out);
}
.btn:hover {
  transform: translateY(-1px);
}
.btn.primary {
  background: var(--primary-btn);
  color: #fff;
}
/* 手机：卡片收窄，长命令和长错误不撑破 */
h2,
p {
  max-width: 100%;
  overflow-wrap: anywhere;
}
@media (max-width: 640px) {
  .state {
    margin-top: 36px;
    padding: 28px 18px 22px;
    border-radius: var(--radius-lg);
  }
  h2 {
    font-size: 15px;
  }
  .hint {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .hint-label {
    text-align: left;
  }
  .actions {
    flex-wrap: wrap;
    justify-content: center;
  }
  .btn {
    min-height: var(--tap);
    padding: 8px 20px;
  }
}
@media (hover: none) {
  .btn:hover {
    transform: none;
  }
}
</style>
