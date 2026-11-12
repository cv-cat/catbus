<script setup lang="ts">
/**
 * 加载图标：挎包里的小黑猫。
 * 红线是挎包的包口，猫头从包口后面探出来、歪头看一眼、再缩回去，只露两只耳朵尖。
 * 主体用 currentColor，跟随文字色；眼睛是镂空的，背景是什么颜色都透得出来。
 * 小尺寸（< 20px）不画眼睛，只保留剪影，避免糊成一团。
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 16, label: undefined })
const { t } = useI18n()

const uid = useId()
const clipId = `cbl-clip-${uid}`
const maskId = `cbl-mask-${uid}`
const eyes = computed(() => props.size >= 20)
const box = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
</script>

<template>
  <span class="catbus-loader" role="status" :aria-label="label ?? t('layout.loading')" :style="box">
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <!-- 包口以下看不见 -->
        <clipPath :id="clipId">
          <rect x="-4" y="-6" width="32" height="24.5" />
        </clipPath>
        <mask v-if="eyes" :id="maskId" maskUnits="userSpaceOnUse" x="-4" y="-6" width="32" height="32">
          <rect x="-4" y="-6" width="32" height="32" fill="#fff" />
          <g class="eyes">
            <ellipse cx="9.4" cy="12.6" rx="1.25" ry="1.45" fill="#000" />
            <ellipse cx="14.6" cy="12.6" rx="1.25" ry="1.45" fill="#000" />
          </g>
        </mask>
      </defs>
      <g :clip-path="`url(#${clipId})`">
        <g class="rise">
          <g class="tilt">
     <path
       d="M4.6 21V11.4c0-1.3.3-2.5.9-3.6L6.6 3.9l3.5 2.7a8.6 8.6 0 0 1 3.8 0l3.5-2.7 1.1 3.9c.6 1.1.9 2.3.9 3.6V21Z"
       fill="currentColor"
       :mask="eyes ? `url(#${maskId})` : undefined"
     />
   </g>
        </g>
      </g>
      <line class="bag" x1="2.6" y1="18.6" x2="21.4" y2="18.6" stroke-width="2.4" stroke-linecap="round" />
    </svg>
  </span>
</template>

<style scoped>
.catbus-loader {
  display: inline-block;
  flex: none;
  position: relative;
  vertical-align: -0.2em;
  line-height: 0;
}

svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.bag {
  stroke: var(--red, #e8414f);
}

/* 一个循环 1.4s：耳朵尖 → 探头（轻微过冲）→ 歪头 → 缩回 → 耳朵尖 */
.rise {
  animation: cbl-rise 1.4s cubic-bezier(0.45, 0, 0.25, 1) infinite;
}

.tilt {
  transform-box: view-box;
  transform-origin: 12px 18.6px;
  animation: cbl-tilt 1.4s ease-in-out infinite;
}

.eyes {
  transform-box: view-box;
  transform-origin: 12px 12.6px;
  animation: cbl-blink 1.4s linear infinite;
}

@keyframes cbl-rise {
  0%,
  100% {
    transform: translateY(9px);
  }
  28% {
    transform: translateY(-0.8px);
  }
  36%,
  64% {
    transform: translateY(0);
  }
  86% {
    transform: translateY(9px);
  }
}

@keyframes cbl-tilt {
  0%,
  34% {
    transform: rotate(0);
  }
  46% {
    transform: rotate(-9deg);
  }
  58% {
    transform: rotate(4deg);
  }
  68%,
  100% {
    transform: rotate(0);
  }
}

@keyframes cbl-blink {
  0%,
  49%,
  56%,
  100% {
    transform: scaleY(1);
  }
  52.5% {
    transform: scaleY(0.12);
  }
}

@media (prefers-reduced-motion: reduce) {
  .rise,
  .tilt,
  .eyes {
    animation: none;
  }
  .catbus-loader {
    animation: cbl-fade 1.4s ease-in-out infinite;
  }
}

@keyframes cbl-fade {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
</style>
