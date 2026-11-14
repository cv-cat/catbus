<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Rocket } from 'lucide-vue-next'

/**
 * 回顶按钮（发现页、作者页、12306 查询页共用）：放在滚动容器的直接子级里（容器要有定位），
 * 滚过 `after` 后从右侧弹入，点击后火箭向上发射、容器平滑滚回顶部。
 *
 * 不监听 scroll 读 scrollTop（页面上一直有 CSS 动画，样式每帧都是脏的，读一次就强制一次样式重算），
 * 改用 IntersectionObserver 看一个绝对定位在这个深度的 1px 哨兵：哨兵整个滚出容器顶部即出现。
 */
const props = withDefaults(defineProps<{ after?: number; lifted?: boolean }>(), { after: 640, lifted: false })
const { t } = useI18n()

const sentinel = ref<HTMLElement>()
const show = ref(false)
const launching = ref(false)
let io: IntersectionObserver | undefined

onMounted(() => {
  const root = sentinel.value!.parentElement
  io = new IntersectionObserver(
    ([e]) => {
      if (!e) return
      const above = e.rootBounds ? e.boundingClientRect.bottom <= e.rootBounds.top : false
      show.value = !e.isIntersecting && above
    },
    { root },
  )
  io.observe(sentinel.value!)
})
onBeforeUnmount(() => io?.disconnect())

function toTop() {
  launching.value = true
  sentinel.value?.parentElement?.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <i ref="sentinel" class="top-sentinel" :style="{ top: `${props.after - 1}px` }" aria-hidden="true" />
  <Transition name="to-top" @after-leave="launching = false">
    <button
      v-if="show"
      class="to-top glass"
      :class="{ launching, lifted }"
      type="button"
      :aria-label="t('discover.toTop')"
      :title="t('discover.toTop')"
      @click="toTop"
    >
      <Rocket :size="20" />
    </button>
  </Transition>
</template>

<style scoped>
/* 哨兵：脱离文档流，不占位置，只给 IntersectionObserver 看 */
.top-sentinel {
  position: absolute;
  left: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
  visibility: hidden;
}

/* 从右侧弹入，点击后火箭向上发射 */
.to-top {
  position: fixed;
  right: calc(28px + var(--safe-right));
  bottom: calc(28px + var(--safe-bottom));
  z-index: 10;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink);
  box-shadow: 0 10px 30px #1b1f2e1f;
  transition: color 0.2s, box-shadow 0.25s, transform 0.25s var(--ease-out);
}
.to-top:hover {
  color: var(--red);
  transform: translateY(-3px);
  box-shadow: 0 14px 34px #1b1f2e29, 0 0 0 4px var(--red-soft);
}
.to-top svg {
  transform: rotate(-45deg);
  transition: transform 0.3s var(--ease-out);
}
.to-top:hover svg {
  transform: rotate(-45deg) translate(1px, -1px);
}
.to-top.launching svg {
  animation: launch 0.6s cubic-bezier(0.55, 0, 0.75, 0) forwards;
}
@keyframes launch {
  to {
    transform: rotate(-45deg) translate(28px, -28px);
    opacity: 0;
  }
}
.to-top-enter-active {
  transition: transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease-out;
}
.to-top-leave-active {
  transition: transform 0.3s ease-in, opacity 0.3s ease-in;
}
.to-top-enter-from,
.to-top-leave-to {
  opacity: 0;
  transform: translateX(120px);
}

@media (prefers-reduced-motion: reduce) {
  .to-top-enter-active,
  .to-top-leave-active {
    transition: opacity 0.2s;
  }
  .to-top-enter-from,
  .to-top-leave-to {
    transform: none;
  }
  .to-top.launching svg {
    animation: none;
  }
}

@media (max-width: 640px) {
  .to-top {
    right: calc(14px + var(--safe-right));
    bottom: calc(16px + var(--safe-bottom));
    width: var(--tap);
    height: var(--tap);
    transition: color 0.2s, box-shadow 0.25s, transform 0.25s var(--ease-out), bottom 0.35s var(--ease-out);
  }
  .to-top svg {
    width: 18px;
    height: 18px;
  }
  /* 底部操作条出现时上移避让 */
  .to-top.lifted {
    bottom: calc(92px + var(--safe-bottom));
  }
}
@media (hover: none) {
  .to-top:hover {
    transform: none;
    color: var(--ink);
    box-shadow: 0 10px 30px #1b1f2e1f;
  }
}
</style>
