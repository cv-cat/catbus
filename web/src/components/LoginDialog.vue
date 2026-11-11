<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowLeft, Check, ChevronRight, LoaderCircle, PhoneCall, PhoneOutgoing, RefreshCw, UserRound, X } from 'lucide-vue-next'
import CatbusLoader from '@/components/CatbusLoader.vue'
import SegmentedControl from './SegmentedControl.vue'
import BottomSheet from './BottomSheet.vue'
import { loginApi, METHOD_LABEL, type LoginInfo, type LoginMethod, type LoginStep, type QrSession, type SentStep, type SmsUser } from '@/api/login'
import type { Account, CatbusError, Envelope } from '@/api/types'
import { platformById } from '@/data/platforms'
import { useLoginStore } from '@/stores/login'
import { gsap, prefersReducedMotion } from '@/composables/motion'
import { useSourceStore } from '@/stores/source'

/** 登录弹窗：登录方式来自 catbus 注册表（AGENTS.md 7.9），凭证经 bridge 交给 catbus 落盘 */
const emit = defineEmits<{ success: [account: Account] }>()
const { dialog, close } = useLoginStore()
const src = useSourceStore()

const platform = computed(() => platformById(dialog.platform))
const info = ref<LoginInfo | null>(null)
const method = ref<LoginMethod>('qrcode')
const account = ref('default')
const busy = ref(false)
const error = ref<CatbusError | null>(null)
const success = ref<Account | null>(null)
/** 登录到的不是当前账号时，询问是否设为默认账号 */
const askDefault = ref(false)
const previous = ref('')

// 各方式的表单
const form = ref<Record<string, string>>(Object.create(null))
const sent = ref<SentStep | null>(null)
const resendIn = ref(0)
/** 短信验证后一个手机号有多个用户：第三步选号（catbus … --user <id>） */
const users = ref<SmsUser[] | null>(null)
const picking = ref<string | null>(null)
/** 头像加载失败的用户，改用占位图标 */
const brokenAvatar = ref(new Set<string>())

/**
 * 选号后这个账号还要语音验证码（catbus … --user <id> 返回 {sent, verify: true}）：
 * 第一次返回时还没打电话，「获取语音验证码」再执行一次 --user 才发起；验证码走 step verify（--code）。
 * 一个手机号 + 账号对应一个窗口，返回选号列表后再点同一个账号直接回到这里，不会再发起电话。
 */
interface VoiceStep {
  user: SmsUser
  phone: string | null
  /** 已经发起过电话 */
  called: boolean
}
const voice = ref<VoiceStep | null>(null)
/** 语音验证码窗口是否显示（返回选号列表时保留 voice，不丢中间态） */
const voiceShown = ref(false)
const calling = ref(false)
const verifying = ref(false)
/** 重新拨打的冷却秒数 */
const callIn = ref(0)
const voiceCode = ref('')
const voiceError = ref<{ message: string; detail: string | null; retry: boolean } | null>(null)
const VOICE_COOLDOWN = 30
let callTimer = 0

// 扫码
const qr = ref<QrSession | null>(null)
let pollTimer = 0
let resendTimer = 0

const panel = ref<HTMLElement>()
const successIcon = ref<HTMLElement>()

/** 演示站（catbus web --demo / ?demo）：不请求 bridge，只显示二维码占位 */
const demo = computed(() => src.source === 'demo')

/** 二维码占位：固定的伪随机点阵 + 三个定位角（25 × 25 模块） */
const QR_N = 25
const qrPlaceholder = (() => {
  const finder = (x: number, y: number) => x < 7 && y < 7
  const inFinder = (x: number, y: number) => finder(x, y) || finder(QR_N - 1 - x, y) || finder(x, QR_N - 1 - y)
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const cells: string[] = []
  for (let y = 0; y < QR_N; y++) {
    for (let x = 0; x < QR_N; x++) {
      if (inFinder(x, y) || (x < 8 && y < 8) || (x > QR_N - 9 && y < 8) || (x < 8 && y > QR_N - 9)) continue
      if (rnd() < 0.46) cells.push(`M${x} ${y}h1v1h-1z`)
    }
  }
  return cells.join('')
})()
const QR_FINDERS = [
  [0, 0],
  [QR_N - 7, 0],
  [0, QR_N - 7],
] as const

const methodOptions = computed(() => (info.value?.methods ?? []).map((m) => ({ value: m, label: METHOD_LABEL[m] })))

function reset() {
  stopQr()
  error.value = null
  sent.value = null
  users.value = null
  picking.value = null
  brokenAvatar.value = new Set()
  resetVoice()
  form.value = Object.create(null)
  clearInterval(resendTimer)
  resendIn.value = 0
}

async function load() {
  info.value = null
  success.value = null
  askDefault.value = false
  reset()
  // 默认不指定账号名，由 catbus --auto-bind 按登录的用户选账号（同一用户刷新、新用户新增）
  previous.value = dialog.account
  account.value = ''
  if (demo.value) return
  try {
    info.value = await loginApi.methods(dialog.platform)
    if (!info.value.methods.length) {
      error.value = { code: 'UNSUPPORTED', message: '这个渠道没有可以在 WebUI 里完成的登录方式', hint: `catbus ${dialog.platform} auth login`, detail: null }
      return
    }
    method.value = info.value.default ?? info.value.methods[0]!
    if (method.value === 'qrcode') void startQr()
  } catch (e) {
    error.value = { code: 'BRIDGE', message: (e as Error).message, hint: '用 npm run dev 启动 WebUI，并在仓库根目录 npm run build', detail: null }
  }
}

// ---------- 扫码 ----------

function stopQr() {
  clearInterval(pollTimer)
  if (qr.value && (qr.value.state === 'running' || qr.value.state === 'qrcode')) void loginApi.cancel(qr.value.id)
  qr.value = null
}

async function startQr() {
  stopQr()
  error.value = null
  busy.value = true
  try {
    const s = (await loginApi.start({ platform: dialog.platform, method: 'qrcode', account: account.value || undefined })) as QrSession
    qr.value = s
    pollTimer = window.setInterval(pollQr, 1500)
  } catch (e) {
    error.value = { code: 'BRIDGE', message: (e as Error).message, hint: null, detail: null }
  } finally {
    busy.value = false
  }
}

async function pollQr() {
  if (!qr.value) return
  try {
    const s = await loginApi.session(qr.value.id)
    qr.value = s
    if (s.state === 'done' || s.state === 'error') {
      clearInterval(pollTimer)
      handle(s.envelope)
    }
  } catch (e) {
    clearInterval(pollTimer)
    error.value = { code: 'BRIDGE', message: (e as Error).message, hint: null, detail: null }
  }
}

// ---------- 表单方式 ----------

async function submit(step: LoginStep = 'start') {
  error.value = null
  busy.value = true
  try {
    const res = (await loginApi.start({
      platform: dialog.platform,
      method: method.value,
      account: account.value || undefined,
      step,
      fields: { ...form.value },
    })) as { envelope: Envelope<Account | SentStep> }
    const env = res.envelope
    if (env.ok && env.data && 'sent' in env.data) {
      // 验证码已通过、手机号下有多个用户：CLI 已保存待选中间态，转入选号，不再要验证码
      if (step === 'verify' && env.data.users?.length) {
        users.value = env.data.users
        clearInterval(resendTimer)
        resendIn.value = 0
        return
      }
      // 选号后这个账号要语音验证码：CLI 已保存中间态，还没打电话，转入语音验证码窗口
      if (step === 'select' && env.data.verify === true && form.value.user) {
        const user = users.value?.find((x) => x.id === form.value.user) ?? { id: form.value.user, name: null, avatar: null }
        openVoice(user, env.data.phone ?? null)
        return
      }
      sent.value = env.data
      startResendCountdown()
      await nextTick()
      panel.value?.querySelector<HTMLInputElement>('input[name="code"]')?.focus()
      return
    }
    handle(env as Envelope<Account>)
  } catch (e) {
    error.value = { code: 'BRIDGE', message: (e as Error).message, hint: null, detail: null }
  } finally {
    busy.value = false
    // 密码 / Cookie / API Key 用完就清掉，不留在页面内存里
    for (const k of ['password', 'cookie', 'apiKey']) delete form.value[k]
  }
}

async function pick(u: SmsUser) {
  if (busy.value) return
  // 这个账号已有进行中的语音验证：回到同一个窗口，不重复请求（再请求会直接发起电话）
  if (voice.value?.user.id === u.id) {
    voiceShown.value = true
    await focusVoiceCode()
    return
  }
  picking.value = u.id
  form.value.user = u.id
  try {
    await submit('select')
  } finally {
    picking.value = null
    delete form.value.user
  }
}

// ---------- 语音验证码（快手选号后） ----------

function openVoice(user: SmsUser, phone: string | null) {
  if (voice.value?.user.id !== user.id) {
    resetVoice()
    voice.value = { user, phone, called: false }
  } else if (phone) {
    voice.value.phone = phone
  }
  voiceShown.value = true
}

function resetVoice() {
  clearInterval(callTimer)
  callIn.value = 0
  voice.value = null
  voiceShown.value = false
  voiceCode.value = ''
  voiceError.value = null
  calling.value = false
  verifying.value = false
}

async function focusVoiceCode() {
  await nextTick()
  panel.value?.querySelector<HTMLInputElement>('input[name="voiceCode"]')?.focus()
}

function startCallCooldown() {
  callIn.value = VOICE_COOLDOWN
  clearInterval(callTimer)
  callTimer = window.setInterval(() => {
    if (--callIn.value <= 0) clearInterval(callTimer)
  }, 1000)
}

const errorDetail = (e: CatbusError | undefined | null) => (e?.message ? e.message : null)

/** 发起 / 重发语音验证码电话：再执行一次选号步（--user <id>，不带 --code） */
async function callVoice() {
  const v = voice.value
  if (!v || calling.value || verifying.value || callIn.value > 0) return
  calling.value = true
  voiceError.value = null
  try {
    const { envelope: env } = (await loginApi.start({
      platform: dialog.platform,
      method: 'sms',
      account: account.value || undefined,
      step: 'select',
      fields: { user: v.user.id },
    })) as { envelope: Envelope<Account | SentStep> }
    if (voice.value !== v) return // 期间换了手机号或关了弹窗
    if (env.ok && env.data && 'sent' in env.data) {
      v.called = true
      if (env.data.phone) v.phone = env.data.phone
      startCallCooldown()
      await focusVoiceCode()
      return
    }
    if (env.ok && env.data) return handle(env as Envelope<Account>) // 不需要验证码，直接登录成功
    voiceError.value =
      env.error?.code === 'RISK_CONTROL'
        ? { message: '语音验证码电话发起失败，请稍后再试', detail: errorDetail(env.error), retry: false }
        : { message: env.error?.message ?? '发起语音验证码失败', detail: env.error?.hint ?? null, retry: false }
  } catch (e) {
    voiceError.value = { message: (e as Error).message, detail: null, retry: false }
  } finally {
    calling.value = false
  }
}

/** 提交语音验证码：step verify（--code <验证码>，不带 --user） */
async function submitVoice() {
  const v = voice.value
  const code = voiceCode.value.trim()
  if (!v || verifying.value || calling.value) return
  if (!/^[A-Za-z0-9]{3,12}$/.test(code)) {
    voiceError.value = { message: '请输入电话里听到的验证码', detail: null, retry: false }
    await focusVoiceCode()
    return
  }
  verifying.value = true
  voiceError.value = null
  try {
    const { envelope: env } = (await loginApi.start({
      platform: dialog.platform,
      method: 'sms',
      account: account.value || undefined,
      step: 'verify',
      fields: { code },
    })) as { envelope: Envelope<Account | SentStep> }
    if (voice.value !== v) return
    if (env.ok && env.data && !('sent' in env.data)) return handle(env as Envelope<Account>)
    if (env.ok && env.data && 'sent' in env.data) {
      // 少见：验证后又给出待选用户，回到选号列表
      if (env.data.users?.length) {
        users.value = env.data.users
        resetVoice()
        return
      }
      voiceError.value = { message: '还需要再验证一次，请重新获取语音验证码', detail: null, retry: true }
      return
    }
    voiceError.value =
      env.error?.code === 'RISK_CONTROL'
        ? { message: '验证码错误或已过期：可以重新输入，或重新获取语音验证码', detail: errorDetail(env.error), retry: true }
        : { message: env.error?.message ?? '登录失败', detail: env.error?.hint ?? null, retry: false }
    await nextTick()
    panel.value?.querySelector<HTMLInputElement>('input[name="voiceCode"]')?.select()
  } catch (e) {
    voiceError.value = { message: (e as Error).message, detail: null, retry: false }
  } finally {
    verifying.value = false
  }
}

/** 回到选号列表：保留语音验证的中间态，再点同一个账号回到这个窗口 */
function backToUsers() {
  voiceShown.value = false
  voiceError.value = null
}

const voiceStatus = computed(() => {
  if (calling.value) return '正在发起电话…'
  if (!voice.value?.called) return '未拨打'
  return '已拨打，请接听电话'
})

/** 放弃选号，从头输手机号 */
function restartSms() {
  reset()
}

function startResendCountdown() {
  resendIn.value = 60
  clearInterval(resendTimer)
  resendTimer = window.setInterval(() => {
    if (--resendIn.value <= 0) clearInterval(resendTimer)
  }, 1000)
}

function handle(env: Envelope<Account> | null) {
  if (env?.ok && env.data) {
    success.value = env.data
    emit('success', env.data)
    void nextTick(() => {
      if (successIcon.value && !prefersReducedMotion()) {
        gsap.fromTo(successIcon.value, { scale: 0.3, rotate: -30, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.6, ease: 'back.out(2.4)' })
      }
    })
    // 已经有默认账号、新登录的账号不是它：先问要不要切换，不自动关闭
    if (!env.data.current) {
      askDefault.value = true
      return
    }
    setTimeout(() => dialog.open && success.value && !askDefault.value && close(), 1600)
    return
  }
  error.value = env?.error ?? { code: 'ERROR', message: '登录失败', hint: null, detail: null }
}

async function setDefault() {
  if (!success.value) return
  busy.value = true
  error.value = null
  try {
    const { envelope } = await loginApi.use(dialog.platform, success.value.account)
    if (!envelope.ok || !envelope.data) {
      error.value = envelope.error ?? { code: 'ERROR', message: '设置默认账号失败', hint: null, detail: null }
      return
    }
    success.value = envelope.data
    askDefault.value = false
    emit('success', envelope.data)
    setTimeout(() => dialog.open && close(), 900)
  } catch (e) {
    error.value = { code: 'BRIDGE', message: (e as Error).message, hint: null, detail: null }
  } finally {
    busy.value = false
  }
}

// ---------- 开关与动效 ----------

watch(method, (m, old) => {
  if (!old || !info.value) return
  reset()
  if (m === 'qrcode') void startQr()
})

watch(
  () => dialog.open,
  async (open) => {
    if (open) {
      void load()
    } else {
      reset()
    }
  },
)

// Esc、遮罩、下滑关闭由 BottomSheet 处理
onBeforeUnmount(reset)

function onSubmit() {
  if (method.value === 'sms' && voice.value && voiceShown.value) return void submitVoice()
  void submit(sent.value ? 'verify' : 'start')
}

const isMteam = computed(() => dialog.platform === 'mteam')
</script>

<template>
  <BottomSheet :open="dialog.open" :label="`登录${platform?.name ?? ''}`" width="420px" :z="50" @close="close">
      <div ref="panel" class="panel">
        <header class="head">
          <img v-if="platform" class="logo" :src="platform.logo" alt="" />
          <div class="titles">
            <h2>登录{{ platform?.name }}</h2>
            <p>登录态保存在本机 ~/.catbus，只用于 catbus</p>
          </div>
          <button class="close" type="button" aria-label="关闭" @click="close"><X :size="18" /></button>
        </header>

        <div v-if="success" class="success">
          <span ref="successIcon" class="ok-icon"><Check :size="26" /></span>
          <h3>登录成功</h3>
          <p>{{ success.user?.name ?? success.user?.id }} · 账号 <span class="mono">{{ success.account }}</span></p>
          <p v-if="success.current && !askDefault" class="sub">已是默认账号</p>
          <div v-if="askDefault" class="ask" role="alertdialog" aria-labelledby="ask-default-title">
            <p id="ask-default-title">
              要把 <strong>{{ success.user?.name ?? success.account }}</strong> 设为默认账号吗？
              <span v-if="previous" class="sub">当前默认账号是 <span class="mono">{{ previous }}</span></span>
            </p>
            <div class="ask-actions">
              <button type="button" class="ghost" :disabled="busy" @click="close">暂不</button>
              <button type="button" class="primary" :disabled="busy" @click="setDefault">
                <LoaderCircle v-if="busy" class="spin" :size="16" />设为默认
              </button>
            </div>
          </div>
          <div v-if="error" class="error" role="alert">
            <strong>{{ error.message }}</strong>
            <code v-if="error.hint" class="mono">{{ error.hint }}</code>
          </div>
        </div>

        <template v-else>
          <!-- 演示站：二维码占位，不支持登录 -->
          <div v-if="demo" class="qr-wrap">
            <div class="qr demo-qr" role="img" aria-label="演示站不支持登录">
              <svg :viewBox="`-2 -2 ${QR_N + 4} ${QR_N + 4}`" aria-hidden="true">
                <path :d="qrPlaceholder" />
                <g v-for="[fx, fy] in QR_FINDERS" :key="`${fx}-${fy}`">
                  <path :d="`M${fx} ${fy}h7v7h-7z M${fx + 1} ${fy + 1}v5h5v-5z`" fill-rule="evenodd" />
                  <rect :x="fx + 2" :y="fy + 2" width="3" height="3" />
                </g>
              </svg>
              <span class="demo-qr-badge">演示站不支持登录</span>
            </div>
            <p class="qr-msg">要登录{{ platform?.name }}，请用 <code class="mono">catbus web</code>（不带 --demo）启动</p>
          </div>

          <div v-else-if="!info && !error" class="loading"><LoaderCircle class="spin" :size="20" /></div>

          <template v-if="!demo && info && info.methods.length">
            <SegmentedControl v-if="methodOptions.length > 1" v-model="method" :options="methodOptions" label="登录方式" class="methods" />

            <!-- 扫码 -->
            <div v-if="method === 'qrcode'" class="qr-wrap">
              <div class="qr" :class="{ ready: qr?.qrcode }">
                <img v-if="qr?.qrcode" :src="qr.qrcode" alt="登录二维码" />
                <LoaderCircle v-else-if="!error" class="spin" :size="22" />
                <button v-else type="button" class="refresh" @click="startQr"><RefreshCw :size="18" />重新获取</button>
              </div>
              <p class="qr-msg">
                <template v-if="!error">
                  <CatbusLoader v-if="!qr?.qrcode" :size="14" />
                  <span>{{ qr?.message ?? '正在获取二维码…' }}</span>
                </template>
              </p>
              <button v-if="qr?.qrcode" type="button" class="link" @click="startQr"><RefreshCw :size="13" />刷新二维码</button>
            </div>

            <!-- 表单方式 -->
            <form v-else class="form" @submit.prevent="onSubmit">
              <template v-if="method === 'cookie'">
                <label>
                  <span>Cookie</span>
                  <textarea v-model="form.cookie" name="cookie" rows="5" spellcheck="false" autocomplete="off" placeholder="a1=...; web_session=...  或浏览器导出的 cookie JSON 数组" />
                </label>
                <p class="help">在浏览器里登录{{ platform?.name }}，打开开发者工具 → 网络，复制任一请求的 Cookie 请求头。</p>
              </template>

              <template v-else-if="method === 'apikey'">
                <label>
                  <span>API Key</span>
                  <input v-model="form.apiKey" name="apiKey" type="password" autocomplete="off" placeholder="在站点「控制台 → 实验室」生成" />
                </label>
              </template>

              <!-- 快手选号后要语音验证码 -->
              <template v-else-if="method === 'sms' && voice && voiceShown">
                <div class="voice" aria-live="polite">
                  <div class="voice-who">
                    <img v-if="voice.user.avatar && !brokenAvatar.has(voice.user.id)" class="avatar" :src="voice.user.avatar" alt="" referrerpolicy="no-referrer" @error="brokenAvatar.add(voice.user.id)" />
                    <span v-else class="avatar placeholder"><UserRound :size="18" /></span>
                    <span class="user-text">
                      <span class="user-name">{{ voice.user.name || '（无昵称）' }}</span>
                      <span class="user-id mono">ID {{ voice.user.id }}</span>
                    </span>
                  </div>
                  <p class="help">
                    这个账号还需要语音验证码。将对手机号
                    <span v-if="voice.phone" class="mono">{{ voice.phone }}</span>
                    发起一通语音验证码电话，请接听并记下电话里的验证码。验证状态 10 分钟内有效，过期需要从头登录。
                  </p>
                  <div class="voice-call">
                    <span class="voice-state" :class="{ called: voice.called }">
                      <PhoneCall v-if="voice.called" :size="14" />
                      <PhoneOutgoing v-else :size="14" />
                      {{ voiceStatus }}
                    </span>
                    <button type="button" class="ghost voice-btn" :disabled="calling || verifying || callIn > 0" @click="callVoice">
                      <LoaderCircle v-if="calling" class="spin" :size="14" />
                      {{ callIn > 0 ? `${callIn}s 后可重拨` : voice.called ? '没接到？重新拨打' : '获取语音验证码' }}
                    </button>
                  </div>
                </div>
                <label v-if="voice.called">
                  <span>语音验证码</span>
                  <input v-model="voiceCode" name="voiceCode" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="电话里听到的验证码" :disabled="verifying" />
                </label>
                <div v-if="voiceError" class="error" role="alert">
                  <strong>{{ voiceError.message }}</strong>
                  <span v-if="voiceError.detail" class="detail">{{ voiceError.detail }}</span>
                  <span v-if="voiceError.retry" class="retry">
                    <button type="button" class="link" :disabled="verifying" @click="(voiceError = null), focusVoiceCode()">重新输入</button>
                    <button type="button" class="link" :disabled="calling || verifying || callIn > 0" @click="callVoice">
                      {{ callIn > 0 ? `${callIn}s 后可重新获取` : '重新获取语音验证码' }}
                    </button>
                  </span>
                </div>
                <button v-if="voice.called" class="primary" type="submit" :disabled="verifying || calling || !voiceCode.trim()">
                  <CatbusLoader v-if="verifying" :size="16" label="登录中" />
                  {{ verifying ? '登录中…' : '登录' }}
                </button>
                <span class="voice-links">
                  <button v-if="users && users.length > 1" type="button" class="link" :disabled="verifying || calling" @click="backToUsers"><ArrowLeft :size="13" />返回选择账号</button>
                  <button type="button" class="link" :disabled="verifying || calling" @click="restartSms"><RefreshCw :size="13" />从头开始</button>
                </span>
              </template>

              <template v-else-if="method === 'sms' && users">
                <p class="help">这个手机号下有多个账号，选择要登录的一个：</p>
                <ul class="users" role="list">
                  <li v-for="u in users" :key="u.id">
                    <button type="button" class="user" :disabled="busy" :aria-busy="picking === u.id" @click="pick(u)">
                      <img v-if="u.avatar && !brokenAvatar.has(u.id)" class="avatar" :src="u.avatar" alt="" referrerpolicy="no-referrer" @error="brokenAvatar.add(u.id)" />
                      <span v-else class="avatar placeholder"><UserRound :size="18" /></span>
                      <span class="user-text">
                        <span class="user-name">{{ u.name || '（无昵称）' }}</span>
                        <span class="user-id mono">ID {{ u.id }}</span>
                      </span>
                      <LoaderCircle v-if="picking === u.id" class="spin" :size="16" />
                      <ChevronRight v-else :size="16" class="chev" />
                    </button>
                  </li>
                </ul>
                <button type="button" class="link" :disabled="busy" @click="restartSms"><RefreshCw :size="13" />换个手机号</button>
              </template>

              <template v-else-if="method === 'sms'">
                <label>
                  <span>手机号</span>
                  <div class="row">
                    <input v-model="form.phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="11 位手机号" :disabled="!!sent" />
                    <button type="button" class="ghost" :disabled="busy || resendIn > 0 || !form.phone" @click="(sent = null), submit('start')">
                      {{ resendIn > 0 ? `${resendIn}s` : sent ? '重新发送' : '发送验证码' }}
                    </button>
                  </div>
                </label>
                <label v-if="sent">
                  <span>验证码</span>
                  <input v-model="form.code" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="短信里的验证码" />
                </label>
              </template>

              <template v-else-if="method === 'password'">
                <label>
                  <span>用户名</span>
                  <input v-model="form.username" name="username" autocomplete="username" :disabled="!!sent" />
                </label>
                <label>
                  <span>密码</span>
                  <input v-model="form.password" name="password" type="password" autocomplete="current-password" />
                </label>
                <template v-if="isMteam">
                  <label v-if="!sent">
                    <span>邮箱（新设备两步验证时需要）</span>
                    <input v-model="form.email" name="email" type="email" autocomplete="email" placeholder="可选" />
                  </label>
                  <label>
                    <span>{{ sent ? '邮箱验证码' : '验证码（TOTP，可选）' }}</span>
                    <input v-model="form.code" name="code" inputmode="numeric" autocomplete="one-time-code" />
                  </label>
                  <p v-if="sent" class="help">验证码已发到邮箱。密码需要再输入一次，catbus 不保存密码。</p>
                </template>
              </template>

              <details v-if="!users" class="advanced">
                <summary>保存为账号 <span class="mono">{{ account || '自动' }}</span></summary>
                <input v-model.trim="account" name="account" class="mono" pattern="[a-z0-9][a-z0-9_\-]{0,31}" aria-label="账号名" placeholder="留空：按登录的用户自动选择" />
                <p class="help">留空时，同一用户刷新原来的账号，新用户新增账号；填写账号名则登录到这个账号，原来的用户会被替换。</p>
              </details>

              <button v-if="(method !== 'sms' || sent) && !users" class="primary" type="submit" :disabled="busy">
                <CatbusLoader v-if="busy" :size="16" label="登录中" />
                {{ busy ? '登录中…' : '登录' }}
              </button>
            </form>
          </template>

          <p v-if="info?.note && method === 'password'" class="note">{{ info.note }}</p>

          <div v-if="error" class="error" role="alert">
            <strong>{{ error.message }}</strong>
            <code v-if="error.hint" class="mono">{{ error.hint }}</code>
          </div>
        </template>
      </div>
  </BottomSheet>
</template>

<style scoped>
/* 外壳（背景、圆角、滚动、手机底部弹层）由 BottomSheet 提供，这里只排内容 */
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
.logo {
  width: 40px;
  height: 40px;
  border-radius: 12px;
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
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--ink-3);
}
.close {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  background: var(--hair);
}
.methods {
  align-self: center;
}
.loading {
  display: grid;
  place-items: center;
  padding: 40px;
  color: var(--ink-3);
}
.qr-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.qr {
  width: 216px;
  height: 216px;
  border-radius: 20px;
  display: grid;
  place-items: center;
  background: var(--hair);
  color: var(--ink-3);
  overflow: hidden;
  transition: background 0.3s;
}
.demo-qr {
  position: relative;
  background: #fff;
  box-shadow: 0 10px 30px #1b1f2e18;
}
.demo-qr svg {
  width: 100%;
  height: 100%;
  fill: var(--navy);
  opacity: 0.18;
  filter: blur(1.5px);
}
.demo-qr-badge {
  position: absolute;
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: #8a5a00;
  background: linear-gradient(135deg, #ffe08ae6 0%, #f5b82480 100%);
  border: 1px solid #f5c842aa;
  box-shadow:
    inset 0 1px 0 #ffffffb3,
    0 6px 18px #f5a52440;
  backdrop-filter: blur(10px) saturate(1.6);
}
.qr-msg code {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--hair);
  font-size: 12px;
}
.qr.ready {
  background: #fff;
  box-shadow: 0 10px 30px #1b1f2e18;
}
.qr img {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
.qr-msg {
  margin: 0;
  min-height: 1.4em;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
  text-align: center;
}
.refresh,
.link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
}
.link {
  font-size: 12px;
  color: var(--ink-3);
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-2);
}
input,
textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--hair);
  background: var(--glass);
  font-size: 14px;
  outline: none;
  resize: vertical;
  transition: border-color 0.2s, box-shadow 0.2s;
}
textarea {
  font-family: var(--font-mono);
  font-size: 12px;
}
input:focus,
textarea:focus {
  border-color: #e8414f66;
  box-shadow: 0 0 0 4px var(--red-soft);
}
input:disabled {
  opacity: 0.6;
}
.row {
  display: flex;
  gap: 8px;
}
.ghost {
  flex: none;
  padding: 0 14px;
  border-radius: 12px;
  background: var(--hair);
  font-size: 13px;
  white-space: nowrap;
}
.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.help,
.note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-3);
}
.advanced summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--ink-3);
}
.advanced input {
  margin-top: 8px;
}
.primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 42px;
  border-radius: 14px;
  background: var(--primary-btn);
  color: #fff;
  font-weight: 600;
}
.primary:disabled {
  opacity: 0.7;
  cursor: progress;
}
[data-theme='dark'] .primary {
  --catbus-loader-accent: var(--navy);
}
.error {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--red-soft);
  color: var(--red);
  font-size: 13px;
}
.error code {
  font-size: 11.5px;
  color: var(--ink-2);
  word-break: break-all;
  user-select: all;
}
.success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 24px 0 12px;
  text-align: center;
}
.ok-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--online);
  color: #fff;
  margin-bottom: 6px;
}
.success h3 {
  margin: 0;
  font-size: 16px;
}
.success p {
  margin: 0;
  font-size: 13px;
  color: var(--ink-2);
}
.success .sub {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.ask {
  width: 100%;
  margin-top: 14px;
  padding: 14px;
  border-radius: 16px;
  background: var(--hair);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ask-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.ask-actions .ghost,
.ask-actions .primary {
  height: 36px;
  padding: 0 16px;
}
.success .error {
  width: 100%;
  margin-top: 10px;
  text-align: left;
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.users {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.user {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid var(--hair);
  background: var(--glass);
  text-align: left;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.user:hover:not(:disabled),
.user:focus-visible {
  border-color: #e8414f66;
  box-shadow: 0 0 0 4px var(--red-soft);
  outline: none;
}
.user:disabled {
  cursor: progress;
}
.user:disabled:not([aria-busy='true']) {
  opacity: 0.55;
}
.avatar {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--hair);
}
.avatar.placeholder {
  display: grid;
  place-items: center;
  color: var(--ink-3);
}
.user-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.user-name {
  font-size: 14px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-id {
  font-size: 11.5px;
  color: var(--ink-3);
}
.chev {
  color: var(--ink-3);
}
.form > .link {
  align-self: center;
}

.voice {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--hair);
  background: var(--glass);
}
.voice-who {
  display: flex;
  align-items: center;
  gap: 12px;
}
.voice .help .mono {
  color: var(--ink-2);
}
.voice-call {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.voice-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--ink-3);
  background: var(--hair);
}
.voice-state.called {
  color: var(--red);
  background: var(--red-soft);
}
.voice-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  font-variant-numeric: tabular-nums;
}
.error .detail {
  font-size: 12px;
  color: var(--ink-2);
}
.retry {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.retry .link {
  color: var(--red);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.voice-links {
  display: flex;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
}

/* ---------- 触屏：可点区域至少 --tap ---------- */
@media (hover: none) and (pointer: coarse) {
  .close {
    width: var(--tap);
    height: var(--tap);
    margin: -6px -6px -6px 0;
  }
  .ghost,
  .primary,
  .user,
  .voice-btn,
  .ask-actions .ghost,
  .ask-actions .primary {
    min-height: var(--tap);
  }
  .refresh,
  .link {
    min-height: var(--tap);
    padding: 0 10px;
  }
  .advanced summary {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: var(--tap);
  }
}

/* ---------- 手机：底部弹层里的排版 ---------- */
@media (max-width: 640px) {
  .panel {
    gap: 16px;
    padding: 6px 18px 18px;
  }
  .methods {
    align-self: stretch;
    max-width: 100%;
    overflow-x: auto;
  }
  /* 二维码不超过屏宽，也不把弹层撑得太高 */
  .qr {
    width: min(216px, calc(100vw - 96px), 34dvh);
    height: auto;
    aspect-ratio: 1;
    min-width: 150px;
  }
  /* 「发送验证码」按钮挤不下时换到下一行 */
  .row {
    flex-wrap: wrap;
  }
  .row input {
    flex: 1 1 180px;
    min-width: 0;
  }
  .row .ghost {
    flex: 1 0 auto;
  }
  input,
  textarea {
    min-height: var(--tap);
  }
  .ask-actions {
    flex-wrap: wrap;
  }
  .ask-actions .ghost,
  .ask-actions .primary {
    flex: 1 1 120px;
    height: auto;
  }
  .primary {
    height: auto;
    min-height: var(--tap);
  }
}
</style>
