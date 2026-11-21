<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SaleCountdown from '../SaleCountdown.vue'
import type { Item } from '@/api/types'
import type { TorrentInfo } from '@/composables/torrent'
import type { ShowInfo } from '@/composables/show'
import { compact } from '@/composables/format'
import { detailStats } from './stats'

/**
 * 详情卡片底部：演出是起价和开售倒计时（设计稿 N），种子是做种 / 下载 / 文件数（设计稿 L），其余是互动数。
 * 只读：互动数只显示数量。
 */
const props = defineProps<{
  item: Item
  torrent: TorrentInfo | null
  show: ShowInfo | null
}>()
const { t } = useI18n()
const stats = computed(() => detailStats(props.item, props.torrent))
</script>

<template>
  <footer v-if="show" class="stats show rv">
    <span class="s-price"><template v-if="show.price"><strong class="mono">{{ show.price }}</strong><small>{{ t('detail.show.priceFrom') }}</small></template></span>
    <SaleCountdown :at="show.saleAt" :text="show.saleText" />
  </footer>
  <footer v-else class="stats rv" :class="{ torrent: !!torrent }">
    <span v-for="s in stats" :key="s.key" class="stat" :aria-label="t('detail.stat.aria', { n: s.v ?? 0, label: s.label })">
      <component :is="s.icon" :size="18" aria-hidden="true" />
      <span class="mono">{{ compact(s.v) }}</span>
      <small v-if="torrent">{{ s.label }}</small>
    </span>
  </footer>
</template>

<style scoped>
/* 先后顺序与拆分前一致：横屏、全屏的内边距写在后面，覆盖种子、演出的内边距 */
.stats.torrent {
  padding-inline: 40px;
}
.stat small {
  font-size: 12px;
  font-weight: 400;
  color: var(--ink-3);
}
/* 演出（猫眼演出，设计稿 N） */
.stats.show {
  align-items: center;
  padding: 12px 22px;
}
.s-price {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.s-price strong {
  color: var(--red);
  font-size: 22px;
  font-weight: 700;
}
.s-price small {
  font-size: 12px;
  color: var(--ink-3);
}

.stats {
  display: flex;
  justify-content: space-between;
  padding: 16px 28px;
  border-top: 1px solid var(--hair);
}
.stat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.stat svg {
  color: var(--ink-2);
}

/* 横屏：信息栏窄一些 */
.landscape .stats {
  padding: 14px 20px;
}
/* 全屏：吸在底部 */
.compact .stats {
  position: sticky;
  bottom: 0;
  z-index: 1;
  padding: 12px max(24px, var(--safe-right)) calc(12px + var(--safe-bottom)) max(24px, var(--safe-left));
  background: var(--detail-bg);
}
</style>
