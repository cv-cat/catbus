<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarClock, CircleAlert, ExternalLink, Lock, RefreshCw, Ticket, WifiOff } from 'lucide-vue-next'
import { getTickets } from '@/api/maoyan'
import { isAbort } from '@/api/client'
import type { CatbusError, Item } from '@/api/types'
import { openLogin } from '@/stores/login'
import { errorDetail, errorTitle } from '@/i18n/errors'
import { dateTime } from '@/composables/format'
import { discounted, firstOpen, money, sessionLines, sessionTitle, stockOf } from '@/composables/tickets'
import { storeTickets, ticketCache, ticketKey, type TicketResult } from '@/composables/ticketCache'

/**
 * 演出详情里的「场次与票档」（AGENTS.md 7.9「猫眼演出的场次与票档」，设计稿 W5–W8）。
 * 点了才查（`item get --tickets`，需要登录）；结果按「平台 + 条目」缓存在本页会话里。
 * 只读：没有购买、抢票、预约、开售提醒，只有「在猫眼打开」外链。
 */
const props = defineProps<{ platform: string; item: Item; account: string | null }>()
const { t } = useI18n()

type Phase = 'idle' | 'loading' | 'auth' | 'expired' | 'error' | 'done'
const phase = ref<Phase>('idle')
const error = shallowRef<CatbusError | null>(null)
const result = shallowRef<TicketResult | null>(null)
const picked = ref(0)

const key = computed(() => ticketKey(props.platform, props.item.id))
const sessions = computed(() => result.value?.sessions ?? [])
const session = computed(() => sessions.value[picked.value] ?? null)
/** 外链：查到的详情里的 url，没有时用列表里那一条的 */
const link = computed(() => result.value?.item.url || props.item.url || null)
const queriedAt = computed(() =>
  result.value ? dateTime(result.value.at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '',
)
const allSoldOut = computed(() => sessions.value.length > 0 && sessions.value.every((s) => s.soldOut))

let ctl: AbortController | null = null
function abort() {
  ctl?.abort()
  ctl = null
}

/** 换条目：有缓存就直接显示，否则回到「查看场次与余票」 */
watch(
  key,
  (k) => {
    abort()
    const hit = ticketCache.get(k) ?? null
    result.value = hit
    error.value = null
    phase.value = hit ? 'done' : 'idle'
    picked.value = hit ? firstOpen(hit.sessions) : 0
  },
  { immediate: true },
)
onBeforeUnmount(abort)

async function query() {
  abort()
  const my = (ctl = new AbortController())
  const k = key.value
  phase.value = 'loading'
  error.value = null
  try {
    const env = await getTickets(props.item, props.account, my.signal)
    if (ctl !== my) return
    if (env.ok && env.data) {
      result.value = storeTickets(props.platform, props.item.id, env.data)
      picked.value = firstOpen(result.value.sessions)
      phase.value = 'done'
      return
    }
    const e = env.error
    error.value = e
    phase.value = e?.code === 'AUTH_REQUIRED' ? 'auth' : e?.code === 'AUTH_EXPIRED' ? 'expired' : 'error'
    // 登录失效：丢掉这一条的旧结果，避免刷新失败后还显示旧余票
    if (phase.value !== 'error') ticketCache.delete(k)
  } catch (e) {
    if (ctl !== my || isAbort(e)) return
    error.value = { code: 'NETWORK', message: (e as Error).message, hint: null, detail: null }
    phase.value = 'error'
  } finally {
    if (ctl === my) ctl = null
  }
}

/** 登录弹窗：错误提示里的 `-a <账号>` 就是要重新登录的账号；登录后再点一次查询 */
function login() {
  const hinted = /\s-a\s+(\S+)/.exec(error.value?.hint ?? '')?.[1]
  openLogin(props.platform, hinted ?? props.account)
}

/** 场次横向滚动：右缘还有内容时渐隐 */
const strip = ref<HTMLElement>()
const fadeR = ref(false)
function updateFade() {
  const el = strip.value
  fadeR.value = !!el && el.scrollLeft + el.clientWidth < el.scrollWidth - 2
}
watch([strip, sessions], () => requestAnimationFrame(updateFade), { flush: 'post' })
/** 查到结果时默认选中的场次（第一个没售罄的）可能在很右边：滚到它，不平滑 */
watch(
  [strip, result],
  ([el]) => {
    const card = el?.children[picked.value] as HTMLElement | undefined
    if (el && card) el.scrollLeft = Math.max(0, card.offsetLeft - el.offsetLeft - 8)
    requestAnimationFrame(updateFade)
  },
  { flush: 'post' },
)

/** 场次是一组单选：← / → 切换 */
function onStripKey(e: KeyboardEvent) {
  const n = sessions.value.length
  if (!n) return
  let next = picked.value
  if (e.key === 'ArrowRight') next = (picked.value + 1) % n
  else if (e.key === 'ArrowLeft') next = (picked.value - 1 + n) % n
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = n - 1
  else return
  e.preventDefault()
  picked.value = next
  const el = strip.value?.children[next] as HTMLElement | undefined
  el?.focus()
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
</script>

<template>
  <section class="tickets" :aria-busy="phase === 'loading'">
    <header class="t-head">
      <h3><Ticket :size="15" aria-hidden="true" />{{ t('maoyan.tickets.title') }}</h3>
      <span v-if="phase === 'done' && sessions.length" class="t-total">{{ t('maoyan.tickets.total', { n: sessions.length }, sessions.length) }}</span>
    </header>

    <!-- 未查询 / 未登录 / 登录失效 / 请求失败 / 没有场次：一块居中的说明卡 -->
    <div v-if="phase === 'idle'" class="t-card">
      <span class="t-ico"><Ticket :size="16" aria-hidden="true" /></span>
      <strong>{{ t('maoyan.tickets.idle.title') }}</strong>
      <small>{{ t('maoyan.tickets.idle.hint') }}</small>
      <button type="button" class="t-btn primary" @click="query">{{ t('maoyan.tickets.idle.action') }}</button>
    </div>
    <div v-else-if="phase === 'auth'" class="t-card">
      <span class="t-ico"><Lock :size="16" aria-hidden="true" /></span>
      <strong>{{ t('maoyan.tickets.auth.title') }}</strong>
      <small>{{ t('maoyan.tickets.auth.hint') }}</small>
      <button type="button" class="t-btn primary" @click="login">{{ t('maoyan.tickets.auth.action') }}</button>
    </div>
    <div v-else-if="phase === 'expired'" class="t-card">
      <span class="t-ico warn"><CircleAlert :size="16" aria-hidden="true" /></span>
      <strong>{{ t('maoyan.tickets.expired.title') }}</strong>
      <small>{{ t('maoyan.tickets.expired.hint') }}</small>
      <button type="button" class="t-btn primary" @click="login">{{ t('maoyan.tickets.expired.action') }}</button>
    </div>
    <div v-else-if="phase === 'error'" class="t-card">
      <span class="t-ico"><WifiOff :size="16" aria-hidden="true" /></span>
      <strong>{{ t('maoyan.tickets.error.title') }}</strong>
      <small :title="error ? (errorDetail(error) ?? undefined) : undefined">{{ error ? errorTitle(error) : '' }}</small>
      <button type="button" class="t-btn" @click="query">{{ t('common.action.retry') }}</button>
    </div>

    <!-- 加载中：场次卡和票档表的骨架 -->
    <div v-else-if="phase === 'loading'" class="t-skeleton" role="status" :aria-label="t('maoyan.tickets.loading')">
      <div class="sk-strip"><span v-for="i in 4" :key="i" /></div>
      <span class="sk-line" />
      <div class="sk-table"><span v-for="i in 4" :key="i" /></div>
    </div>

    <template v-else-if="phase === 'done'">
      <div v-if="!sessions.length" class="t-card">
        <span class="t-ico"><CalendarClock :size="16" aria-hidden="true" /></span>
        <strong>{{ t('maoyan.tickets.none.title') }}</strong>
        <small>{{ t('maoyan.tickets.none.hint') }}</small>
      </div>
      <template v-else>
        <div
          ref="strip"
          class="t-strip"
          :class="{ 'fade-r': fadeR }"
          role="radiogroup"
          :aria-label="t('maoyan.tickets.sessions')"
          @scroll.passive="updateFade"
          @keydown="onStripKey"
        >
          <button
            v-for="(s, i) in sessions"
            :key="`${i}-${s.name}`"
            type="button"
            role="radio"
            class="t-session"
            :class="{ on: i === picked, gone: s.soldOut }"
            :aria-checked="i === picked"
            :tabindex="i === picked ? 0 : -1"
            @click="picked = i"
          >
            <b>{{ sessionLines(s)[0] }}</b>
            <small>{{ sessionLines(s)[1] }}<template v-if="s.soldOut"> · {{ t('maoyan.tickets.soldOut') }}</template></small>
          </button>
        </div>

        <div v-if="session" class="t-sub">
          <strong>{{ sessionTitle(session) }}</strong>
          <span class="t-at">
            {{ t('maoyan.tickets.queriedAt', { time: queriedAt }) }}
            <button type="button" class="t-refresh" :aria-label="t('maoyan.tickets.refresh')" :title="t('maoyan.tickets.refresh')" @click="query">
              <RefreshCw :size="13" />
            </button>
          </span>
        </div>

        <p v-if="allSoldOut" class="t-banner"><Ticket :size="14" aria-hidden="true" />{{ t('maoyan.tickets.allSoldOut') }}</p>

        <div v-if="session && !session.tiers.length" class="t-card">
          <span class="t-ico"><CalendarClock :size="16" aria-hidden="true" /></span>
          <strong>{{ t('maoyan.tickets.noTiers.title') }}</strong>
          <small>{{ t('maoyan.tickets.noTiers.hint') }}</small>
        </div>
        <table v-else-if="session" class="t-table">
          <thead>
            <tr>
              <th scope="col">{{ t('maoyan.tickets.col.tier') }}</th>
              <th scope="col" class="num">{{ t('maoyan.tickets.col.face') }}</th>
              <th scope="col" class="num">{{ t('maoyan.tickets.col.sell') }}</th>
              <th scope="col" class="num">{{ t('maoyan.tickets.col.stock') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(x, i) in session.tiers" :key="`${i}-${x.name}`" :class="{ gone: stockOf(x).kind === 'soldOut' }">
              <!-- 有的演出 CLI 给的票档名是空的：用票面价代替 -->
              <th scope="row">{{ x.name || money(x.face ?? x.sell) || '—' }}</th>
              <!-- 票面价只在打折（与实售价不同）时显示并划线；相同时只看实售价 -->
              <td class="num face mono"><s v-if="discounted(x)">{{ money(x.face) }}</s></td>
              <td class="num sell mono">{{ money(x.sell ?? x.face) }}</td>
              <td class="num stock" :class="{ warn: stockOf(x).kind === 'few' && (stockOf(x) as { warn: boolean }).warn }">
                <template v-if="stockOf(x).kind === 'soldOut'">{{ t('maoyan.tickets.soldOut') }}</template>
                <template v-else-if="stockOf(x).kind === 'plenty'">{{ t('maoyan.tickets.plenty') }}</template>
                <template v-else>{{ t('maoyan.tickets.few', { n: (stockOf(x) as { n: number }).n }, (stockOf(x) as { n: number }).n) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>

    <footer v-if="phase === 'done' || phase === 'error'" class="t-foot">
      <small v-if="phase === 'done' && session?.tiers.length">{{ t('maoyan.tickets.note') }}</small>
      <span class="grow" />
      <a v-if="link" class="t-link" :href="link" target="_blank" rel="noopener noreferrer">
        {{ t('maoyan.tickets.open') }}<ExternalLink :size="13" aria-hidden="true" />
      </a>
    </footer>
  </section>
</template>

<style scoped>
.tickets {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.t-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.t-head h3 {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.t-total {
  font-size: 12px;
  color: var(--ink-3);
}
.t-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px 16px;
  border-radius: var(--radius-md);
  background: var(--detail-chip);
  border: 1px solid var(--hair);
  text-align: center;
}
.t-card strong {
  font-size: 14px;
  font-weight: 600;
}
.t-card small {
  font-size: 12px;
  color: var(--ink-3);
}
.t-ico {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-bottom: 6px;
  border-radius: 50%;
  background: var(--hair);
  color: var(--ink-2);
}
.t-ico.warn {
  background: var(--red-soft);
  color: var(--red);
}
.t-btn {
  margin-top: 10px;
  min-height: 36px;
  padding: 0 18px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  transition: transform 0.2s var(--ease-out), filter 0.2s;
}
.t-btn.primary {
  color: #fff;
  background: var(--primary-btn);
  border-color: transparent;
}
.t-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
}

/* 场次：横向滚动，不分组；右缘还有内容时渐隐 */
.t-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  padding: 2px;
  margin: -2px;
}
.t-strip::-webkit-scrollbar {
  display: none;
}
.t-strip.fade-r {
  -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 36px), transparent);
  mask-image: linear-gradient(90deg, #000 calc(100% - 36px), transparent);
}
.t-session {
  flex: none;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 86px;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--detail-chip);
  border: 1px solid var(--hair);
  color: var(--ink);
  transition: border-color 0.2s, background 0.2s;
}
.t-session b {
  font-size: 13px;
  font-weight: 600;
}
.t-session small {
  font-size: 11px;
  color: var(--ink-2);
  white-space: nowrap;
}
.t-session:hover {
  border-color: var(--ink-3);
}
.t-session.gone {
  color: var(--ink-3);
}
.t-session.gone b,
.t-session.gone small {
  color: var(--ink-3);
  font-weight: 500;
}
.t-session.on {
  background: var(--red-soft);
  border-color: #e8414f80;
}
.t-session.on b,
.t-session.on small {
  color: var(--red);
}

.t-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.t-sub strong {
  font-size: 13px;
  font-weight: 600;
}
.t-at {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
}
.t-refresh {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: var(--ink-2);
}
.t-refresh:hover {
  background: var(--hair);
  color: var(--ink);
}
.t-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--hair);
  font-size: 12px;
  color: var(--ink-2);
}

.t-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  padding: 2px 12px;
  border-radius: var(--radius-md);
  background: var(--detail-chip);
  border: 1px solid var(--hair);
  font-size: 13px;
}
.t-table th,
.t-table td {
  height: 40px;
  padding: 0 4px;
  text-align: left;
  border-bottom: 1px solid var(--hair);
}
.t-table tr:last-child th,
.t-table tr:last-child td {
  border-bottom: 0;
}
.t-table thead th {
  height: 30px;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-3);
}
.t-table tbody th {
  font-weight: 600;
}
.t-table .num {
  text-align: right;
}
.t-table .face {
  font-size: 12px;
  color: var(--ink-3);
}
.t-table .sell {
  font-weight: 700;
}
.t-table .stock {
  font-size: 12px;
  color: var(--ink-2);
  white-space: nowrap;
}
.t-table .stock.warn {
  color: var(--red);
  font-weight: 600;
}
.t-table tr.gone th,
.t-table tr.gone td {
  color: var(--ink-3);
  font-weight: 500;
}

.t-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t-foot small {
  font-size: 11px;
  color: var(--ink-3);
}
.grow {
  flex: 1;
}
.t-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
}
.t-link:hover {
  color: var(--red);
}

/* 骨架 */
.t-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sk-strip {
  display: flex;
  gap: 8px;
}
.sk-strip span {
  flex: 1;
  height: 46px;
  border-radius: 12px;
  background: var(--skeleton);
}
.sk-line {
  width: 40%;
  height: 12px;
  border-radius: 6px;
  background: var(--skeleton);
}
.sk-table {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--skeleton);
}
.sk-table span {
  height: 28px;
  margin: 4px 0;
  border-radius: 6px;
  background: var(--skeleton);
}
@media (prefers-reduced-motion: no-preference) {
  .sk-strip span,
  .sk-line,
  .sk-table {
    animation: sk-pulse 1.2s ease-in-out infinite;
  }
}
@keyframes sk-pulse {
  50% {
    opacity: 0.55;
  }
}

/* 手机：按钮、场次卡、票档行都至少 44 高（设计稿 W7） */
@media (max-width: 640px) {
  .t-btn {
    min-height: 44px;
    padding: 0 22px;
    font-size: 14px;
  }
  .t-session {
    min-height: 52px;
  }
  .t-table th,
  .t-table td {
    height: 46px;
  }
  .t-refresh {
    width: 44px;
    height: 44px;
    margin: -10px -10px -10px 0;
  }
  .t-link {
    min-height: 44px;
  }
}
</style>
