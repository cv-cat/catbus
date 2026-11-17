<script setup lang="ts">
import { computed } from 'vue'

/**
 * 统一的透明玻璃按钮（样式在 styles/glass-button.css，变量在 tokens.css 的 --lg-*）。
 * - 只放图标时加 `icon`，必须给 aria-label（透传到根元素）。
 * - 给了 `href` 渲染成 <a>（外链自己加 target / rel），否则是 <button type="button">。
 * - `pressed` 为开关按钮：同时写 aria-pressed 和开启态外观。
 * 其余属性、事件、class 都透传到根元素。
 */
const props = withDefaults(
  defineProps<{
    tone?: 'default' | 'accent' | 'primary' | 'media' | 'danger' | 'quiet'
    size?: 'sm' | 'md' | 'lg'
    icon?: boolean
    pressed?: boolean
    href?: string
    type?: 'button' | 'submit' | 'reset'
  }>(),
  { tone: 'default', size: 'md', icon: false, pressed: undefined, href: undefined, type: 'button' },
)

const cls = computed(() => [
  'lg-btn',
  props.tone !== 'default' && `lg-${props.tone}`,
  props.size !== 'md' && `lg-${props.size}`,
  props.icon && 'lg-icon',
])
</script>

<template>
  <a v-if="href" :href="href" :class="cls"><slot /></a>
  <button v-else :type="type" :class="cls" :aria-pressed="pressed"><slot /></button>
</template>
