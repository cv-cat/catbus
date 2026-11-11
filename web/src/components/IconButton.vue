<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <button class="icon-btn glass" type="button" :aria-label="label" :title="label">
    <slot />
  </button>
</template>

<style scoped>
.icon-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  transition: color 0.2s, transform 0.2s var(--ease-out);
}
.icon-btn:hover {
  color: var(--ink);
  transform: translateY(-1px);
}
@media (hover: none) {
  .icon-btn:hover {
    transform: none;
    color: var(--ink-2);
  }
}
@media (max-width: 640px) {
  .icon-btn {
    width: var(--tap);
    height: var(--tap);
  }
}
</style>
