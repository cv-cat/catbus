<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BadgePercent } from 'lucide-vue-next'
import SegmentedControl from '@/components/SegmentedControl.vue'
import AppSelect, { type SelectOption } from '@/components/AppSelect.vue'
import FilterChip from '@/components/FilterChip.vue'
import { MTEAM_MODES, type MteamMode } from '@/api/mteam'
import { groupedCategories } from '@/data/mteam'
import { useDiscoverStore } from '@/stores/discover'
import { useSettingsStore } from '@/stores/settings'

/**
 * M-Team 的浏览筛选（AGENTS.md 7.9「M-Team「我的」页与筛选」，设计稿 Y4–Y6）：分区、分类、只看免费。
 * 大类只作分组标题（实测大类 ID 返回空列表），只能选子类；换分区时清掉分类。
 */
const { t } = useI18n()
const d = useDiscoverStore()
const { settings } = useSettingsStore()

const modes = computed(() =>
  MTEAM_MODES.filter((m) => m !== 'adult' || settings.mteamAdult).map((m) => ({ value: m, label: t(`filters.mteam.mode.${m}`) })),
)
const mode = computed({ get: () => d.state.mtMode as MteamMode, set: (v: MteamMode) => d.setMtMode(v) })

const categoryOptions = computed<SelectOption<string>[]>(() => {
  const all = d.mtCategories
  const out: SelectOption<string>[] = [{ value: '', label: t('filters.mteam.category.all'), divider: true }]
  if (!all) return out
  for (const g of groupedCategories(all, d.state.mtMode as MteamMode)) {
    out.push({ value: `g:${g.parent.id}`, label: g.parent.name, header: true })
    g.children.forEach((c, i) => out.push({ value: c.id, label: c.name, divider: i === g.children.length - 1 }))
  }
  return out
})
const category = computed({ get: () => d.state.mtCategory, set: (v: string) => d.setMtCategory(v) })
/** 分类表取不到时整个 chip 置灰 */
const categoryOff = computed(() => (d.mtCategoriesError && !d.mtCategories ? t('filters.mteam.category.unavailable') : null))
</script>

<template>
  <div class="mt-filters">
    <SegmentedControl v-model="mode" :options="modes" :label="t('filters.mteam.mode.label')" />
    <div v-tip="categoryOff" class="cat" :class="{ on: !!category }">
      <AppSelect
        v-model="category"
        :options="categoryOptions"
        :title="t('filters.mteam.category.label')"
        :label="t('filters.mteam.category.label')"
        :disabled="!!categoryOff"
      />
    </div>
    <FilterChip :active="!!d.state.mtFree" @click="d.toggleMtFree()">
      <span class="free"><BadgePercent :size="14" aria-hidden="true" />{{ t('filters.mteam.free') }}</span>
    </FilterChip>
    <span class="sep" aria-hidden="true" />
  </div>
</template>

<style scoped>
.mt-filters {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mt-filters > * {
  flex: none;
}
.cat :deep(.sel) {
  min-width: 132px;
}
/* 选了分类：chip 变红 */
.cat.on :deep(.sel) {
  background: var(--red-soft);
  border-color: color-mix(in srgb, var(--red) 40%, transparent);
  color: var(--red);
  font-weight: 600;
}
.cat.on :deep(.chev) {
  color: var(--red);
}
.free {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.sep {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--hair);
}
</style>
