<script setup lang="ts">
import { reducedMotion } from '@/composables/motion'

/**
 * 毛玻璃后面的两团光晕，让 backdrop-filter 有东西可模糊：
 * 右上角一团品牌红（搜索框一带，和点阵最完整的地方重合），左下角一团藏青。只用品牌色，漂移幅度小、很慢。
 *
 * 漂移是 CSS 动画、只动 transform（只平移，不缩放），交给合成器跑：主线程不用每帧写样式，
 * 模糊后的光晕也不会因为缩放每帧重新栅格化。减少动效（系统或设置）时停在原位，切换立即生效。
 */
</script>

<template>
  <div class="blobs" :class="{ still: reducedMotion }" aria-hidden="true">
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
  /* 漂移幅度：桌面 ±70 / ±50，手机缩小 */
  --dx: 70px;
  --dy: 50px;
}
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  transition: background 0.6s;
  will-change: transform;
  animation: drift-a 44s ease-in-out infinite;
}
.b1 { width: 620px; height: 520px; right: -140px; top: -200px; background: var(--blob-1); }
.b2 { width: 700px; height: 520px; left: 120px; bottom: -220px; background: var(--blob-2); animation-name: drift-b; animation-duration: 56s; }
.still .blob {
  animation: none;
}
/* 两条不同的缓慢路径（周期也不同），每段之间 ease-in-out，接近原来随机游走的感觉 */
@keyframes drift-a {
  0%, 100% { transform: translate3d(0, 0, 0); }
  25% { transform: translate3d(calc(var(--dx) * -0.8), calc(var(--dy) * 0.6), 0); }
  50% { transform: translate3d(calc(var(--dx) * 0.3), calc(var(--dy) * 1), 0); }
  75% { transform: translate3d(calc(var(--dx) * 0.9), calc(var(--dy) * -0.5), 0); }
}
@keyframes drift-b {
  0%, 100% { transform: translate3d(0, 0, 0); }
  30% { transform: translate3d(calc(var(--dx) * 0.7), calc(var(--dy) * -0.9), 0); }
  60% { transform: translate3d(calc(var(--dx) * -0.6), calc(var(--dy) * -0.3), 0); }
  80% { transform: translate3d(calc(var(--dx) * -0.2), calc(var(--dy) * 0.8), 0); }
}
/* 手机：光斑缩小、模糊半径减半、漂移幅度减半，减少合成开销 */
@media (max-width: 640px) {
  .blobs { --dx: 30px; --dy: 24px; }
  .blob { filter: blur(64px); }
  .b1 { width: 320px; height: 280px; right: -80px; top: -100px; }
  .b2 { width: 360px; height: 280px; left: -40px; bottom: -120px; }
}
</style>
