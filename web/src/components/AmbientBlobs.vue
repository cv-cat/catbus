<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap, reducedMotion } from '@/composables/motion'
import { MQ } from '@/composables/useBreakpoint'

/**
 * 毛玻璃后面的两团光晕，让 backdrop-filter 有东西可模糊：
 * 右上角一团品牌红（搜索框一带，和点阵最完整的地方重合），左下角一团藏青。只用品牌色，漂移幅度小、很慢。
 */
const root = ref<HTMLElement>()
let ctx: gsap.Context | undefined

function drift() {
  if (ctx || reducedMotion.value) return
  const small = matchMedia(MQ.phone).matches
  ctx = gsap.context(() => {
    gsap.utils.toArray<HTMLElement>('.blob').forEach((el, i) => {
      gsap.to(el, {
        x: small ? `random(-30, 30)` : `random(-70, 70)`,
        y: small ? `random(-24, 24)` : `random(-50, 50)`,
        scale: `random(0.95, 1.08)`,
        duration: 22 + i * 6,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        repeatRefresh: true,
      })
    })
  }, root.value)
}
function still() {
  ctx?.revert()
  ctx = undefined
}
onMounted(drift)
// 减少动效（系统或设置）切换时立即停 / 恢复漂移
watch(reducedMotion, (r) => (r ? still() : drift()))
onBeforeUnmount(still)
</script>

<template>
  <div ref="root" class="blobs" aria-hidden="true">
    <span class="blob b1" />
    <span class="blob b2" />
  </div>
</template>

<style scoped>
.blobs {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  transition: background 0.6s;
}
.b1 { width: 620px; height: 520px; right: -140px; top: -200px; background: var(--blob-1); }
.b2 { width: 700px; height: 520px; left: 120px; bottom: -220px; background: var(--blob-2); }
/* 手机：光斑缩小、模糊半径减半，减少合成开销 */
@media (max-width: 640px) {
  .blob { filter: blur(64px); }
  .b1 { width: 320px; height: 280px; right: -80px; top: -100px; }
  .b2 { width: 360px; height: 280px; left: -40px; bottom: -120px; }
}
</style>
