<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Globe, Lock } from 'lucide-vue-next'
import CatbusLoader from '../CatbusLoader.vue'
import { loadServerSettings, saveServerSettings, type ServerSettings } from '@/api/settings'
import { errorText } from '@/api/client'
import { isDemo } from '@/stores/source'
import { toast } from '@/stores/toast'

/**
 * 服务端设置（AGENTS.md 7.9「设置」）：经 bridge 的 GET / PUT /api/settings 读写，不在 localStorage。
 * 只有代理：catbus 的全局 proxy（config.toml，与 `catbus config set proxy` 同一套校验）；平台代理只读展示。
 * 下载由浏览器保存，没有服务端下载目录可设。
 * 演示模式下 bridge 拒绝全部 /api/*，这里整组禁用并说明原因。
 */
const { t } = useI18n()
const demo = isDemo()
const data = ref<ServerSettings | null>(null)
/** 原样存下错误，显示时再取文字（随语言切换） */
const loadError = shallowRef<unknown>(null)
const loading = ref(!demo)
const draft = reactive({ proxy: '' })
const errors = reactive<{ proxy: unknown }>({ proxy: null })
const saving = reactive({ proxy: false })

const uid = useId()
const ids = { proxy: `${uid}-proxy`, proxyDesc: `${uid}-proxy-desc` }

function apply(s: ServerSettings) {
  data.value = s
  draft.proxy = s.proxy.value ?? ''
}

onMounted(async () => {
  if (demo) return
  try {
    apply(await loadServerSettings())
  } catch (e) {
    loadError.value = e
  } finally {
    loading.value = false
  }
})

const disabled = computed(() => demo || !data.value)
const reason = computed(() =>
  demo
    ? t('settings.server.demo')
    : loadError.value
      ? t('settings.server.loadFailed', { error: errorText(loadError.value) })
      : null,
)
const platformProxies = computed(() => Object.entries(data.value?.proxy.platforms ?? {}))
const proxyChanged = computed(() => !!data.value && draft.proxy.trim() !== (data.value.proxy.value ?? ''))

async function save(value: string | null, done: () => string) {
  if (disabled.value || saving.proxy) return
  saving.proxy = true
  errors.proxy = null
  try {
    apply(await saveServerSettings({ proxy: value }))
    toast(done())
  } catch (e) {
    errors.proxy = e
  } finally {
    saving.proxy = false
  }
}

const saved = () => t('settings.server.proxy.saved')
const cleared = () => t('settings.server.proxy.cleared')
const saveProxy = () => save(draft.proxy.trim() || null, draft.proxy.trim() ? saved : cleared)
const clearProxy = () => {
  draft.proxy = ''
  void save(null, cleared)
}
</script>

<template>
  <div class="server" data-setting-row>
    <div class="head">
      <span class="label">{{ t('settings.server.title') }}</span>
      <span v-if="loading" class="badge"><CatbusLoader :size="12" :label="t('settings.server.loading')" />{{ t('settings.server.loading') }}</span>
      <span v-else-if="disabled" class="badge"><Lock :size="11" aria-hidden="true" />{{ t('settings.server.unavailable') }}</span>
    </div>
    <p class="hint">{{ t('settings.server.hint') }}</p>
    <p v-if="reason" class="reason" role="note">{{ reason }}</p>
  </div>

  <!-- 代理 -->
  <div class="srow" :class="{ disabled }" data-setting-row>
    <div class="text">
      <div :id="ids.proxy" class="title"><Globe :size="15" aria-hidden="true" />{{ t('settings.server.proxy.title') }}</div>
      <p :id="ids.proxyDesc" class="desc">{{ t('settings.server.proxy.desc') }}</p>
    </div>
    <form class="field" @submit.prevent="saveProxy">
      <input
        v-model="draft.proxy"
        class="input"
        :class="{ invalid: errors.proxy }"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="http://127.0.0.1:7890"
        :aria-labelledby="ids.proxy"
        :aria-describedby="ids.proxyDesc"
        :aria-invalid="!!errors.proxy"
        :disabled="disabled"
        @input="errors.proxy = null"
      />
      <button class="btn primary" type="submit" :disabled="disabled || !proxyChanged || saving.proxy">
        <CatbusLoader v-if="saving.proxy" :size="12" :label="t('settings.server.saving')" />{{ t('common.action.save') }}
      </button>
      <button v-if="data?.proxy.value" class="btn" type="button" :disabled="disabled || saving.proxy" @click="clearProxy">{{ t('settings.server.proxy.clear') }}</button>
    </form>
    <p v-if="errors.proxy" class="error" role="alert">{{ errorText(errors.proxy) }}</p>
    <div v-if="platformProxies.length" class="platforms">
      <i18n-t keypath="settings.server.proxy.platforms" tag="span" class="p-title" scope="global">
        <template #command><code>catbus config set {{ t('settings.server.proxy.platformPlaceholder') }}.proxy</code></template>
      </i18n-t>
      <ul>
        <li v-for="[p, v] in platformProxies" :key="p"><span class="p-id">{{ p }}</span><code>{{ v }}</code></li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.server {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--hair);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-3);
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-2);
  background: var(--hair);
}
.hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ink-3);
}
.reason {
  margin: 10px 0 0;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  color: var(--ink-2);
  background: var(--hair);
}
.srow {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 0;
  border-bottom: 1px solid var(--hair);
}
.srow:last-child {
  border-bottom: none;
}
.title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.title svg {
  color: var(--ink-2);
}
.desc {
  margin: 3px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ink-2);
}
code {
  font-family: var(--font-mono);
  font-size: 11.5px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--hair);
  overflow-wrap: anywhere;
}
.srow.disabled .text {
  opacity: 0.6;
}
.field {
  display: flex;
  gap: 8px;
  align-items: center;
}
.input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--hair);
  background: var(--glass-strong);
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.input::placeholder {
  color: var(--ink-3);
}
.input:focus {
  outline: none;
  border-color: var(--red);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--red) 18%, transparent);
}
.input.invalid {
  border-color: var(--red);
}
.input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  background: var(--hair);
}
.btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  border: 1px solid var(--hair);
  background: var(--glass-strong);
  font: inherit;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, background 0.2s, opacity 0.2s;
}
.btn:hover:not(:disabled) {
  color: var(--red);
  border-color: var(--red);
}
.btn.primary:not(:disabled) {
  color: #fff;
  border-color: var(--red);
  background: var(--red);
}
.btn.primary:hover:not(:disabled) {
  color: #fff;
  background: color-mix(in srgb, var(--red) 88%, #000);
}
.btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.btn:focus-visible,
.input:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: 2px;
}
.error {
  margin: -2px 0 0;
  font-size: 12px;
  color: var(--red);
}
.platforms {
  font-size: 12px;
  color: var(--ink-2);
}
.p-title {
  color: var(--ink-3);
}
.platforms ul {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.platforms li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.p-id {
  min-width: 64px;
  font-weight: 600;
  color: var(--ink);
}
@media (max-width: 640px) {
  .field {
    flex-wrap: wrap;
  }
  .input {
    flex-basis: 100%;
    /* iOS 聚焦时不放大页面：字号不小于 16px */
    font-size: 16px;
    height: var(--tap, 44px);
  }
  .btn {
    height: var(--tap, 44px);
  }
}
</style>
