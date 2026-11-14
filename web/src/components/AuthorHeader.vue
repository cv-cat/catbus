<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ExternalLink } from 'lucide-vue-next'
import UserAvatar from './UserAvatar.vue'
import type { User } from '@/api/types'
import type { PlatformMeta } from '@/data/platforms'
import { compact, tintOf } from '@/composables/format'
import { currentLocale } from '@/i18n'
import { gsap, prefersReducedMotion } from '@/composables/motion'

/**
 * 作者页头部（设计稿 P 的 Author Header、P3 的状态、P4 的手机版）：
 * 头像带平台角标，昵称、@handle、简介（最多三行），粉丝 / 关注 / 作品 / 获赞；「原主页」外链，没有关注按钮。
 * `user` 为 null 时显示同尺寸的骨架。计数为 null 的项整项不显示，全部缺失时整行不显示；没有简介时不显示简介行。
 */
const props = defineProps<{ user: User | null; platform: PlatformMeta }>()
const { t } = useI18n()

/** 12800 → 12.8万（与平台的中文显示一致）；其他语言用 Intl 的 compact 写法 */
function wan(n: number): string {
  if (currentLocale() !== 'zh-CN') return compact(n)
  const trim = (v: number) => v.toFixed(1).replace(/\.0$/, '')
  if (n >= 1e8) return `${trim(n / 1e8)}亿` // i18n-ignore
  if (n >= 1e4) return `${trim(n / 1e4)}万` // i18n-ignore
  return n.toLocaleString('en-US')
}

const stats = computed(() => {
  const s = props.user?.stats
  if (!s) return []
  return (
    [
      ['followers', s.followers],
      ['following', s.following],
      ['items', s.items],
      ['likes', s.likes],
    ] as const
  ).flatMap(([key, v]) => (v == null ? [] : [{ key, label: t(`author.stats.${key}`), value: wan(v) }]))
})
const handle = computed(() => {
  const h = props.user?.handle?.trim()
  return h ? `@${h.replace(/^@/, '')}` : null
})
const bio = computed(() => props.user?.bio?.trim() || null)

// 进入作者页：头部从下方 12px 浮上来并淡入（减少动效时只淡入）
const root = ref<HTMLElement>()
watch(
  () => props.user?.id,
  (id) => {
    if (!id || !root.value) return
    const reduce = prefersReducedMotion()
    gsap.fromTo(
      root.value.querySelectorAll('.reveal'),
      { y: reduce ? 0 : 12, opacity: 0 },
      { y: 0, opacity: 1, duration: reduce ? 0.1 : 0.32, ease: 'expo.out', clearProps: 'transform,opacity' },
    )
  },
  { flush: 'post' },
)
</script>

<template>
  <section ref="root" class="author-head" :aria-busy="!user" :aria-label="user ? t('author.header.label', { name: user.name ?? t('author.header.fallbackName') }) : t('author.header.loading')">
    <template v-if="user">
      <div class="ava-wrap reveal">
        <UserAvatar class="ava" :user="user" :style="{ background: tintOf(user.id) }" />
        <span class="badge" :title="platform.name"><img :src="platform.logo" :alt="platform.name" draggable="false" /></span>
      </div>
      <div class="info reveal">
        <div class="name-row">
          <h2 class="name">{{ user.name ?? t('author.header.unknown') }}</h2>
          <span v-if="handle" class="handle mono">{{ handle }}</span>
        </div>
        <p v-if="bio" class="bio">{{ bio }}</p>
        <dl v-if="stats.length" class="stats">
          <div v-for="s in stats" :key="s.key" class="stat">
            <dt class="label">{{ s.label }}</dt>
            <dd class="value mono">{{ s.value }}</dd>
          </div>
        </dl>
      </div>
      <a v-if="user.url" class="origin reveal" :href="user.url" target="_blank" rel="noopener noreferrer">
        <ExternalLink :size="14" aria-hidden="true" />{{ t('author.origin') }}
      </a>
    </template>
    <template v-else>
      <div class="ava-wrap"><span class="ava sk" /></div>
      <div class="info">
        <span class="sk sk-name" />
        <span class="sk sk-line" />
        <span class="sk sk-line short" />
        <div class="stats">
          <span v-for="i in 4" :key="i" class="sk sk-stat" />
        </div>
      </div>
      <span class="sk sk-btn" />
    </template>
  </section>
</template>

<style scoped>
.author-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas: 'ava info act';
  align-items: center;
  gap: 24px;
  padding: 24px;
  border-radius: 24px;
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  backdrop-filter: blur(24px) saturate(1.5);
  box-shadow: 0 6px 24px #1b1f2e10;
}
.ava-wrap {
  grid-area: ava;
  position: relative;
  width: 96px;
  height: 96px;
}
.ava {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 3px solid #fff;
  color: #fff;
  font-size: 34px;
  font-weight: 700;
}
[data-theme='dark'] .ava {
  border-color: #2a2f4a;
}
/* 右下角平台角标：白底圆里放侧栏同款平台 logo */
.badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 6px #1b1f2e26;
}
[data-theme='dark'] .badge {
  background: #2a2f4a;
}
.badge img {
  width: 20px;
  height: 20px;
  border-radius: 6px;
}
.info {
  grid-area: info;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.name-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.name {
  margin: 0;
  min-width: 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.25;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.handle {
  flex: none;
  font-size: 13px;
  color: var(--ink-3);
}
.bio {
  margin: 0;
  max-width: 640px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-2);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  margin: 0;
  padding-top: 6px;
}
/* 数值在前、标签在后（dl 里 dt 在前，用 order 调换），底部对齐 */
.stat {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.value {
  order: -1;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--ink);
}
.label {
  font-size: 13px;
  color: var(--ink-3);
}
.origin {
  grid-area: act;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px;
  border-radius: 20px;
  background: var(--glass);
  border: 1px solid var(--glass-stroke);
  color: var(--ink);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.2s, box-shadow 0.25s, transform 0.25s var(--ease-out);
}
.origin svg {
  color: var(--ink-2);
  transition: color 0.2s;
}
.origin:hover,
.origin:focus-visible {
  color: var(--red);
  box-shadow: 0 0 0 4px var(--red-soft);
}
.origin:hover svg {
  color: var(--red);
}

/* 骨架：与真实头部同尺寸，避免加载完跳动 */
.sk {
  display: block;
  background: var(--hair);
  position: relative;
  overflow: hidden;
}
.sk::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 30%, var(--glass-strong) 50%, transparent 70%);
  transform: translateX(-100%);
  animation: sweep 1.2s linear infinite;
}
@keyframes sweep {
  to {
    transform: translateX(100%);
  }
}
.ava.sk {
  border: 0;
}
.sk-name {
  width: 180px;
  height: 22px;
  border-radius: 11px;
  margin-bottom: 4px;
}
.sk-line {
  width: min(560px, 100%);
  height: 12px;
  border-radius: 6px;
}
.sk-line.short {
  width: min(420px, 75%);
}
.sk-stat {
  width: 72px;
  height: 18px;
  border-radius: 9px;
}
.sk-btn {
  grid-area: act;
  width: 96px;
  height: 40px;
  border-radius: 20px;
}

/* 平板：仍是横排，简介撑满，「原主页」放到 Info 下方 */
@media (max-width: 1024px) {
  .author-head {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: 'ava info' 'ava act';
    row-gap: 14px;
  }
  .bio {
    max-width: none;
  }
  .origin,
  .sk-btn {
    justify-self: start;
  }
}
/* 手机（P4）：竖排居中；「原主页」收进顶栏的图标按钮 */
@media (max-width: 640px) {
  .author-head {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'ava' 'info';
    justify-items: center;
    gap: 12px;
    padding: 20px 16px;
    border-radius: 20px;
    text-align: center;
  }
  .ava-wrap {
    width: 80px;
    height: 80px;
  }
  .ava {
    font-size: 28px;
  }
  .badge {
    width: 24px;
    height: 24px;
  }
  .badge img {
    width: 16px;
    height: 16px;
    border-radius: 5px;
  }
  .info {
    width: 100%;
    align-items: center;
    gap: 6px;
  }
  .name-row {
    flex-direction: column;
    align-items: center;
    gap: 4px;
    max-width: 100%;
  }
  .name {
    max-width: 100%;
    font-size: 20px;
  }
  .handle {
    font-size: 12px;
  }
  .bio {
    font-size: 13px;
  }
  .stats {
    width: 100%;
    flex-wrap: nowrap;
    gap: 0;
    padding-top: 8px;
  }
  .stat {
    flex: 1;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .value {
    font-size: 16px;
  }
  .label {
    font-size: 12px;
  }
  .origin,
  .sk-btn {
    display: none;
  }
  .sk-stat {
    flex: 1;
    width: auto;
    margin: 0 8px;
  }
  .sk-name {
    width: 140px;
    margin: 4px auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sk::after {
    animation: none;
    display: none;
  }
  .origin {
    transition: none;
  }
}
</style>
