<script setup lang="ts">
import { computed, onMounted, reactive, ref, useId } from 'vue'
import { Globe, Lock } from 'lucide-vue-next'
import CatbusLoader from '../CatbusLoader.vue'
import { loadServerSettings, saveServerSettings, type ServerSettings } from '@/api/settings'
import { isDemo } from '@/stores/source'
import { toast } from '@/stores/toast'

/**
 * 服务端设置（AGENTS.md 7.9「设置」）：经 bridge 的 GET / PUT /api/settings 读写，不在 localStorage。
 * 只有代理：catbus 的全局 proxy（config.toml，与 `catbus config set proxy` 同一套校验）；平台代理只读展示。
 * 下载由浏览器保存，没有服务端下载目录可设。
 * 演示模式下 bridge 拒绝全部 /api/*，这里整组禁用并说明原因。
 */
const demo = isDemo()
const data = ref<ServerSettings | null>(null)
const loadError = ref<string | null>(null)
const loading = ref(!demo)
const draft = reactive({ proxy: '' })
const errors = reactive<{ proxy: string | null }>({ proxy: null })
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
    loadError.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

const disabled = computed(() => demo || !data.value)
const reason = computed(() =>
  demo ? '演示模式下不连接 catbus，不能读取或修改服务端设置。' : loadError.value ? `读不到服务端设置：${loadError.value}` : null,
)
const platformProxies = computed(() => Object.entries(data.value?.proxy.platforms ?? {}))
const proxyChanged = computed(() => !!data.value && draft.proxy.trim() !== (data.value.proxy.value ?? ''))

async function save(value: string | null, done: string) {
  if (disabled.value || saving.proxy) return
  saving.proxy = true
  errors.proxy = null
  try {
    apply(await saveServerSettings({ proxy: value }))
    toast(done)
  } catch (e) {
    errors.proxy = (e as Error).message
  } finally {
    saving.proxy = false
  }
}

const saveProxy = () => save(draft.proxy.trim() || null, draft.proxy.trim() ? '代理已保存' : '已清空代理')
const clearProxy = () => {
  draft.proxy = ''
  void save(null, '已清空代理')
}
</script>

<template>
  <div class="server" data-setting-row>
    <div class="head">
      <span class="label">服务端设置</span>
      <span v-if="loading" class="badge"><CatbusLoader :size="12" label="读取中" />读取中</span>
      <span v-else-if="disabled" class="badge"><Lock :size="11" aria-hidden="true" />不可用</span>
    </div>
    <p class="hint">保存在本机的 catbus 里，对所有浏览器生效；命令行同样会用到代理。下载的文件由浏览器保存，位置看浏览器的下载设置。</p>
    <p v-if="reason" class="reason" role="note">{{ reason }}</p>
  </div>

  <!-- 代理 -->
  <div class="srow" :class="{ disabled }" data-setting-row>
    <div class="text">
      <div :id="ids.proxy" class="title"><Globe :size="15" aria-hidden="true" />代理</div>
      <p :id="ids.proxyDesc" class="desc">
        catbus 访问平台时用的全局代理（config.toml 的 <code>proxy</code>），支持 http、https、socks4、socks5、socks5h；留空表示不用代理。
      </p>
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
        <CatbusLoader v-if="saving.proxy" :size="12" label="保存中" />保存
      </button>
      <button v-if="data?.proxy.value" class="btn" type="button" :disabled="disabled || saving.proxy" @click="clearProxy">清空</button>
    </form>
    <p v-if="errors.proxy" class="error" role="alert">{{ errors.proxy }}</p>
    <div v-if="platformProxies.length" class="platforms">
      <span class="p-title">平台代理（优先于全局代理，只读；用 <code>catbus config set &lt;平台&gt;.proxy</code> 修改）</span>
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
