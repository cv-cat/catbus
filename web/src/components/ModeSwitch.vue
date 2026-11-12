<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * 侧栏的「单一 / 聚合」开关：磨砂玻璃的轨道，上面一颗玻璃滑块。
 * role="switch"，开 = 聚合；空格 / 回车切换（原生 button 自带）。
 * 滑块滑动时被拉长一下再回弹，按住时鼓起来、变得更透，像一滴压在玻璃上的水。
 */
const model = defineModel<boolean>({ required: true })
const { t } = useI18n()
/** 切换过才播拉伸动画，避免一进页面就动一下 */
const touched = ref(false)

function toggle() {
  touched.value = true
  model.value = !model.value
}
</script>

<template>
  <button
    v-tip="model ? t('layout.mode.aggregateTip') : t('layout.mode.singleTip')"
    type="button"
    class="mode"
    :class="{ touched }"
    role="switch"
    :aria-checked="model"
    :aria-label="t('layout.mode.label')"
    @click="toggle"
  >
    <span class="thumb" aria-hidden="true" />
    <span class="opt" :class="{ on: !model }" aria-hidden="true">{{ t('layout.mode.single') }}</span>
    <span class="opt" :class="{ on: model }" aria-hidden="true">{{ t('layout.mode.aggregate') }}</span>
  </button>
</template>

<style scoped>
.mode {
  --pad: 2px;
  position: relative;
  flex: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  height: 28px;
  padding: var(--pad);
  border-radius: 999px;
  /* 轨道：凹下去的磨砂玻璃，上沿暗、下沿一线高光 */
  background: linear-gradient(180deg, color-mix(in srgb, var(--ink) 11%, transparent), color-mix(in srgb, var(--ink) 5%, transparent));
  box-shadow:
    inset 0 1px 2px #1b1f2e24,
    inset 0 0 0 1px var(--hair),
    0 1px 0 #ffffff80;
  backdrop-filter: blur(24px) saturate(1.8);
  transition: background 0.45s var(--ease-out), box-shadow 0.45s var(--ease-out);
}
/* 开（聚合）：轨道透出一点品牌红 */
.mode[aria-checked='true'] {
  background: linear-gradient(180deg, color-mix(in srgb, var(--red) 30%, transparent), color-mix(in srgb, var(--red) 16%, transparent));
  box-shadow:
    inset 0 1px 2px #e8414f38,
    inset 0 0 0 1px color-mix(in srgb, var(--red) 22%, transparent),
    0 1px 0 #ffffff80;
}
.opt {
  position: relative;
  z-index: 1;
  padding: 0 11px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  line-height: 24px;
  white-space: nowrap;
  color: var(--ink-3);
  transition: color 0.3s var(--ease-out);
}
.opt.on {
  color: var(--ink);
}
/* 滑块：一片厚玻璃——上亮下透，四周一圈高光，底下有柔和的投影 */
.thumb {
  position: absolute;
  top: var(--pad);
  bottom: var(--pad);
  left: var(--pad);
  width: calc(50% - var(--pad));
  border-radius: 999px;
  background: linear-gradient(180deg, #fffffff2 0%, #ffffffb8 100%);
  box-shadow:
    inset 0 1px 0 #ffffff,
    inset 0 -1px 1px #1b1f2e12,
    inset 0 0 0 0.5px #ffffffd9,
    0 3px 8px #1b1f2e24,
    0 0.5px 1.5px #1b1f2e33;
  backdrop-filter: blur(6px) saturate(2);
  transition:
    transform 0.55s cubic-bezier(0.3, 1.35, 0.5, 1),
    scale 0.3s var(--ease-out),
    background 0.3s,
    box-shadow 0.3s;
}
.mode[aria-checked='true'] .thumb {
  transform: translateX(100%);
}
/* 滑过去的途中被拉长、压扁，到位后回弹（两个方向各一个动画名，状态一变就重新播） */
.mode.touched[aria-checked='true'] .thumb {
  animation: stretch-on 0.55s var(--ease-out);
}
.mode.touched[aria-checked='false'] .thumb {
  animation: stretch-off 0.55s var(--ease-out);
}
@keyframes stretch-on {
  35% { scale: 1.2 0.84; }
  70% { scale: 0.97 1.03; }
}
@keyframes stretch-off {
  35% { scale: 1.2 0.84; }
  70% { scale: 0.97 1.03; }
}
/* 按住：滑块鼓起来、变透，只剩一圈折射的亮边，能看到底下的字 */
.mode:active .thumb {
  scale: 1.1 1.22;
  background: linear-gradient(180deg, #ffffff66 0%, #ffffff29 100%);
  box-shadow:
    inset 0 0 0 1px #ffffffcc,
    inset 0 5px 8px -5px #ffffff,
    inset 0 -5px 8px -6px #ffffffb3,
    0 6px 16px #1b1f2e2e;
  backdrop-filter: blur(2px) saturate(2.4) brightness(1.08);
  animation: none;
}
.mode:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: 3px;
}

[data-theme='dark'] .mode {
  background: linear-gradient(180deg, #0000004d, #00000026);
  box-shadow:
    inset 0 1px 2px #00000066,
    inset 0 0 0 1px var(--hair),
    0 1px 0 #ffffff14;
}
[data-theme='dark'] .mode[aria-checked='true'] {
  background: linear-gradient(180deg, color-mix(in srgb, var(--red) 46%, transparent), color-mix(in srgb, var(--red) 26%, transparent));
  box-shadow:
    inset 0 1px 2px #00000059,
    inset 0 0 0 1px color-mix(in srgb, var(--red) 40%, transparent),
    0 1px 0 #ffffff14;
}
[data-theme='dark'] .thumb {
  background: linear-gradient(180deg, #ffffff47 0%, #ffffff1f 100%);
  box-shadow:
    inset 0 1px 0 #ffffff73,
    inset 0 0 0 0.5px #ffffff40,
    0 3px 10px #00000066;
}
[data-theme='dark'] .mode:active .thumb {
  background: linear-gradient(180deg, #ffffff26 0%, #ffffff0d 100%);
  box-shadow:
    inset 0 0 0 1px #ffffff80,
    inset 0 5px 8px -5px #ffffffb3,
    0 6px 16px #00000080;
}

@media (prefers-reduced-motion: reduce) {
  .mode,
  .opt,
  .thumb {
    transition: none;
  }
  .mode.touched .thumb {
    animation: none;
  }
}
@media (pointer: coarse) {
  /* 触屏：可点区域至少 44px，视觉大小不变 */
  .mode::after {
    content: '';
    position: absolute;
    inset: -8px;
  }
}
</style>
