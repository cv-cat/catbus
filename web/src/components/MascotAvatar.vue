<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap, prefersReducedMotion, reducedMotion } from '@/composables/motion'
import neutralUrl from '@/assets/mascot/anim/neutral.webp'
import atlasUrl from '@/assets/mascot/anim/atlas.webp'
import manifest from '@/data/mascot-anim.json'

/**
 * 侧栏顶部的车掌小姐：关键帧动画 + 代码补间。
 * 帧都在一张图集里（web/src/data/mascot-anim.json 是清单），每个动作分「入 → 循环 → 出」，
 * 入的第一帧和出的最后一帧都是中立姿势，所以任意两个动作可以直接衔接。
 * 点头顶是摸头，点脸是戳脸（再戳会害羞），点肩上的猫它会躲进挎包，连点太多次会生气；
 * 空闲时眨眼、偶尔探出圆环张望，很久没有操作会打瞌睡。
 * 小尺寸（窄栏）只眨眼，不响应点击。
 */
const props = withDefaults(defineProps<{ size?: number }>(), { size: 112 })

type ClipName = keyof typeof manifest.clips
interface Clip {
  fps: number
  frames: number[]
  in: number[]
  loop: number[]
  out: number[]
}
const clips = manifest.clips as Record<ClipName, Clip>
const NEUTRAL = 0

/** 帧画布相对圆环的大小和位置：角色在画布里高 82%、底边在 97.7% 处 */
const FRAME = 1.34
const TOP = -0.21
const interactive = computed(() => props.size >= 80)

const root = ref<HTMLElement>()
const body = ref<HTMLElement>()
const hands = ref<HTMLElement>()
const stage = ref<HTMLElement>()
const band = ref<HTMLElement>()
const fx = ref<HTMLElement>()

const frame = ref(NEUTRAL)
const ready = ref(false)
/** 探出圆环的程度 0–1 */
const pop = { v: 0 }
const popped = ref(false)

const box = computed(() => {
  const f = props.size * FRAME
  return { width: `${f}px`, height: `${f}px`, left: `${(props.size - f) / 2}px`, top: `${props.size * TOP}px` }
})
const spriteStyle = computed(() => {
  if (!ready.value) return { backgroundImage: `url(${neutralUrl})`, backgroundSize: '100% 100%' }
  const { cols, rows } = manifest
  const c = frame.value % cols
  const r = Math.floor(frame.value / cols)
  return {
    backgroundImage: `url(${atlasUrl})`,
    backgroundSize: `${cols * 100}% ${rows * 100}%`,
    backgroundPosition: `${cols > 1 ? (c / (cols - 1)) * 100 : 0}% ${rows > 1 ? (r / (rows - 1)) * 100 : 0}%`,
  }
})

/**
 * 裁剪区是一个圆，底部始终贴着圆环内圈的最低点。平时就是圆环内圈；
 * 探身时这个圆向上长大，角色的上半身越过圆环，下半身仍被圆环的下沿挡住。
 */
function applyClip() {
  const s = props.size
  const f = s * FRAME
  const r = s / 2 - 3
  const cx = f / 2
  const bottom = -s * TOP + s / 2 + r
  const big = r * (1 + pop.v * 0.7)
  if (stage.value) stage.value.style.clipPath = `circle(${big}px at ${cx}px ${bottom - big}px)`
  // 手的一层：只露出画布最下面的一条（扒着圆环的手），盖在圆环上面
  if (band.value) band.value.style.clipPath = `inset(${f * 0.82}px ${f * 0.14}px 0 ${f * 0.14}px)`
}

// ---------- 播放器 ----------
let timer: ReturnType<typeof setTimeout> | undefined
let token = 0
/** 当前动作；null 表示空闲 */
let playing: ClipName | null = null
let extend = 0

function wait(ms: number, t: number) {
  return new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(t === token), ms)
  })
}
async function run(seq: number[], fps: number, t: number, speed = 1) {
  for (const f of seq) {
    frame.value = f
    if (!(await wait(1000 / fps / speed, t))) return false
  }
  return true
}
/** 播一个动作：入 → 循环 loops 次（期间 extend 可追加）→ 出；fps 不给时用清单里的帧率 */
async function play(name: ClipName, loops = 1, hold = 0, fps = 0) {
  const clip = clips[name]
  if (!clip || !ready.value) return false
  const t = ++token
  clearTimeout(timer)
  playing = name
  extend = 0
  squash()
  fps ||= clip.fps
  if (!(await run(clip.in, fps, t))) return false
  for (let i = 0; i < loops + extend && i < 12; i++) if (!(await run(clip.loop, fps, t))) return false
  if (hold && !(await wait(hold, t))) return false
  if (!(await run(clip.out, fps, t))) return false
  frame.value = NEUTRAL
  playing = null
  scheduleIdle()
  return true
}
/** 只停在某一帧一会儿（戳脸、减少动效时的表情） */
async function flash(frames: number[], ms: number) {
  if (!ready.value) return false
  const t = ++token
  clearTimeout(timer)
  playing = 'poke'
  squash()
  for (const f of frames) {
    frame.value = f
    if (!(await wait(ms, t))) return false
  }
  frame.value = NEUTRAL
  playing = null
  scheduleIdle()
  return true
}

/**
 * GSAP 的 elastic.out(1.1, 0.45)，采样成 CSS 的 linear() 缓动。
 * 不支持 linear() 的浏览器退回一条带回弹的 cubic-bezier。
 */
const ELASTIC = (() => {
  const a = 1.1
  const w = (2 * Math.PI) / 0.45
  const shift = Math.asin(1 / a) / w
  const ease = (t: number) => (t === 1 ? 1 : a * 2 ** (-10 * t) * Math.sin((t - shift) * w) + 1)
  const pts = Array.from({ length: 41 }, (_, i) => +ease(i / 40).toFixed(4))
  const linear = `linear(${pts.join(', ')})`
  return typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', linear)
    ? linear
    : 'cubic-bezier(0.34, 1.56, 0.64, 1)'
})()
let squashAnims: Animation[] = []
/**
 * 切帧时的挤压回弹，把帧与帧之间的跳变藏进一个弹性动作里。
 * 用 Web Animations，不用 GSAP：空闲时每次眨眼都会回弹一下，用 GSAP 的话 ticker 每次要多空转约 120 帧才休眠，
 * 空闲时主线程就一直有帧。平时用 replace 模式（把 GSAP 留下的内联 transform 拼进关键帧），能放到合成器上跑；
 * 探身、缩回时 GSAP 正在改这个元素的位移，才改用 composite: add 叠在上面（这时在主线程上跑）。
 * 扒着圆环的手那一层平时是隐藏的，只在探出来时才一起回弹。
 */
function squash(strength = 1) {
  if (prefersReducedMotion() || !body.value) return
  for (const a of squashAnims) a.cancel()
  const from = `scale(${1 + 0.05 * strength}, ${1 - 0.06 * strength})`
  const targets = popped.value ? [body.value, hands.value] : [body.value]
  squashAnims = targets
    .filter((el): el is HTMLElement => !!el)
    .map((el) => {
      const timing: KeyframeAnimationOptions = { duration: 550, easing: ELASTIC }
      if (gsap.isTweening(el)) {
        return el.animate([{ transform: from }, { transform: 'scale(1, 1)' }], { ...timing, composite: 'add' })
      }
      const base = el.style.transform && el.style.transform !== 'none' ? `${el.style.transform} ` : ''
      return el.animate([{ transform: `${base}${from}` }, { transform: `${base}scale(1, 1)` }], timing)
    })
}

// ---------- 空闲 ----------
let idleTimer: ReturnType<typeof setTimeout> | undefined
let peekAt = 0
let lookDir = 0
const rnd = (a: number, b: number) => a + Math.random() * (b - a)

function scheduleIdle() {
  clearTimeout(idleTimer)
  if (prefersReducedMotion()) return
  idleTimer = setTimeout(idle, rnd(2400, 5600))
}
async function idle() {
  if (playing || !ready.value || document.hidden) return scheduleIdle()
  if (interactive.value && !hovered && Date.now() - lastActive > SLEEP_AFTER) return void sleep()
  if (interactive.value && !hovered && Date.now() > peekAt) return void peek()
  const r = Math.random()
  if (r < 0.12 && interactive.value) await play('cat-ear')
  else await play('blink')
  if (lookDir && !playing) frame.value = clips.look.frames[lookDir]
}

// ---------- 打瞌睡 ----------
const SLEEP_AFTER = 180_000
let lastActive = Date.now()
let sleeping = false
/** 很久没有操作：闭眼点头，直到鼠标移到头像上或被点到时惊醒 */
async function sleep() {
  const clip = clips.sleep
  if (!ready.value || playing || prefersReducedMotion()) return
  const t = ++token
  clearTimeout(timer)
  playing = 'sleep'
  sleeping = true
  if (!(await run(clip.in, 3, t))) return void (sleeping = false)
  while (sleeping) if (!(await run(clip.loop, 0.9, t))) return void (sleeping = false)
  squash(1.6)
  if (!(await run(clip.out.slice(0, -1), 1.4, t))) return
  frame.value = NEUTRAL
  playing = null
  scheduleIdle()
}
/** 惊醒：打断当前的等待，直接播「出」 */
function wake() {
  if (!sleeping) return false
  sleeping = false
  lastActive = Date.now()
  const t = ++token
  clearTimeout(timer)
  squash(1.6)
  void run(clips.sleep.out.slice(0, -1), 1.4, t).then((ok) => {
    if (!ok) return
    frame.value = NEUTRAL
    playing = null
    scheduleIdle()
  })
  return true
}
function onActivity() {
  lastActive = Date.now()
}

// ---------- 探身张望 ----------
function setPop(to: number, duration: number, ease: string) {
  gsap.killTweensOf(pop)
  return gsap.to(pop, { v: to, duration, ease, onUpdate: applyClip })
}
async function peek() {
  if (!ready.value || playing || prefersReducedMotion()) return
  peekAt = Date.now() + rnd(45_000, 90_000)
  const s = props.size
  const t = ++token
  clearTimeout(timer)
  playing = 'peek'
  // replace 模式的回弹会盖住 GSAP 写的位移，探身前先停掉
  for (const a of squashAnims) a.cancel()
  popped.value = true
  const clip = clips.peek
  frame.value = clip.in[1] ?? clip.in[0]
  setPop(1, 0.5, 'power3.out')
  gsap.set(band.value!, { opacity: 1 })
  gsap.fromTo(
    [body.value!, hands.value!],
    { y: s * 0.12, scale: 0.9 },
    { y: -s * 0.07, scale: 1, duration: 0.6, ease: 'back.out(1.6)', overwrite: true },
  )
  const done = async () => {
    if (!(await wait(520, t))) return false
    for (let i = 0; i < 2; i++) if (!(await run(clip.loop, 3.2, t))) return false
    frame.value = clip.out[0]
    return wait(700, t)
  }
  const ok = await done()
  // 被打断（点击）时 react 已经让她缩回去了
  if (!ok) return retract()
  retract(0.32, () => {
    if (t !== token) return
    frame.value = NEUTRAL
    playing = null
    scheduleIdle()
  })
}
/**
 * 缩回圆环：先整个人沉到圆环下沿后面，裁剪圆同步收回（同一条缓动，帽子不会被收拢的圆切到），
 * 完全藏住之后再换帧、从下面冒回原位。扒着圆环的手先淡出，不跟着露到圆环下面。
 */
function retract(duration = 0.2, hidden?: () => void) {
  if (!popped.value) return
  const s = props.size
  const parts = [body.value!, hands.value!]
  gsap.killTweensOf(pop)
  gsap.to(pop, { v: 0, duration, ease: 'power2.in', onUpdate: applyClip })
  gsap.to(band.value!, { opacity: 0, duration: 0.1, overwrite: 'auto' })
  gsap.to(parts, {
    y: s,
    duration,
    ease: 'power2.in',
    overwrite: true,
    onComplete: () => {
      popped.value = false
      gsap.set(band.value!, { opacity: 1 })
      gsap.set(parts, { scale: 1 })
      hidden?.()
      gsap.fromTo(parts, { y: s * 0.45 }, { y: 0, duration: 0.45, ease: 'back.out(1.4)', overwrite: true })
    },
  })
}

// ---------- 互动 ----------
let hovered = false
let pokes: number[] = []
let clicks: number[] = []
let rubbing = false
let rubDist = 0

type Zone = 'head' | 'face-l' | 'face-r' | 'cat' | 'body'
function zoneAt(e: PointerEvent): Zone {
  const b = root.value!.getBoundingClientRect()
  const x = (e.clientX - b.left) / b.width
  const y = (e.clientY - b.top) / b.height
  if (y < 0.4) return 'head'
  if (x < 0.36 && y > 0.56 && y < 0.82) return 'cat'
  if (y < 0.74) return x < 0.52 ? 'face-l' : 'face-r'
  return 'body'
}

function particles(kind: 'heart' | 'steam', n: number) {
  if (prefersReducedMotion() || !fx.value) return
  const s = props.size
  for (let i = 0; i < n; i++) {
    const el = document.createElement('span')
    el.className = `p ${kind}`
    fx.value.appendChild(el)
    const x = s * rnd(0.22, 0.78)
    gsap.fromTo(
      el,
      { x, y: s * rnd(0.1, 0.3), scale: 0.3, opacity: 0, rotate: rnd(-20, 20) },
      {
        y: `-=${s * rnd(0.2, 0.36)}`,
        x: x + s * rnd(-0.12, 0.12),
        scale: rnd(0.8, 1.2),
        opacity: 1,
        duration: rnd(0.8, 1.2),
        delay: i * 0.09,
        ease: 'power2.out',
        onComplete: () => void gsap.to(el, { opacity: 0, duration: 0.25, onComplete: () => el.remove() }),
      },
    )
  }
}

function react(zone: Zone) {
  const now = Date.now()
  lastActive = now
  peekAt = Math.max(peekAt, now + 20_000)
  if (wake()) return
  retract()
  if (!ready.value) return squash(1.4)

  if (prefersReducedMotion()) {
    // 只换表情，不位移、不出粒子
    const f = zone === 'head' ? clips.pat.frames[2] : zone === 'cat' ? clips['cat-hide'].frames[3] : clips.shy.frames[2]
    return void flash([f], 700)
  }

  // 正在生气：不理人
  if (playing === 'pout') return squash(0.5)
  clicks = clicks.filter((t) => now - t < 5000)
  clicks.push(now)
  if (clicks.length >= 8) {
    clicks = []
    pokes = []
    return void play('pout', 3, 0, 2.6)
  }

  if (zone === 'head') {
    particles('heart', 3)
    if (playing === 'pat') {
      extend++
      return squash(0.8)
    }
    return void play('pat', 2)
  }
  if (zone === 'cat') {
    if (playing === 'cat-hide') return
    return void play('cat-hide', 1, 900)
  }
  if (playing === 'shy') {
    extend++
    return squash(0.6)
  }
  if (zone === 'body') {
    particles('steam', 2)
    return void play('shy', 2)
  }

  // 戳脸：第一次愣住，8 秒内再戳就害羞
  pokes = pokes.filter((t) => now - t < 8000)
  pokes.push(now)
  const side = clips.poke.frames[zone === 'face-l' ? 1 : 2]
  const stunned = clips.poke.frames[3]
  if (pokes.length >= 2 || clicks.length >= 4) {
    pokes = []
    void flash([side], 220).then((ok) => {
      if (!ok) return
      particles('steam', 3)
      void play('shy', 3)
    })
  } else void flash([side, stunned], 320)
}

function onDown(e: PointerEvent) {
  if (!interactive.value) return
  const zone = zoneAt(e)
  rubbing = zone === 'head'
  rubDist = 0
  react(zone)
}
function onMove(e: PointerEvent) {
  if (!rubbing || !(e.buttons & 1 || e.pointerType === 'touch')) return
  rubDist += Math.abs(e.movementX) + Math.abs(e.movementY)
  if (rubDist > props.size * 0.35) {
    rubDist = 0
    react('head')
  }
}
function onUp() {
  rubbing = false
}
function onEnter() {
  hovered = true
  wake()
}
function onLeave() {
  hovered = false
  rubbing = false
}

/** 鼠标在附近时，眼睛看向鼠标 */
function onWindowMove(e: PointerEvent) {
  lastActive = Date.now()
  if (!interactive.value || !ready.value || e.pointerType !== 'mouse' || prefersReducedMotion()) return
  const b = root.value?.getBoundingClientRect()
  if (!b) return
  const dx = e.clientX - (b.left + b.width / 2)
  const dy = e.clientY - (b.top + b.height * 0.45)
  const d = Math.hypot(dx, dy)
  let dir = 0
  if (d > b.width * 0.42 && d < b.width * 2.4) dir = dy < -Math.abs(dx) ? 3 : dx < 0 ? 1 : 2
  if (dir === lookDir) return
  lookDir = dir
  if (!playing) frame.value = dir ? clips.look.frames[dir] : NEUTRAL
}

onMounted(() => {
  applyClip()
  // 图集空闲时再加载；没到之前只显示中立帧
  const img = new Image()
  img.onload = () => {
    ready.value = true
    peekAt = Date.now() + rnd(20_000, 40_000)
    scheduleIdle()
  }
  const load = () => (img.src = atlasUrl)
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 2500 })
  else setTimeout(load, 600)
  window.addEventListener('pointermove', onWindowMove, { passive: true })
  window.addEventListener('keydown', onActivity, { passive: true })
  window.addEventListener('pointerdown', onActivity, { passive: true })
  // 开发时从控制台触发：__mascot.peek()、__mascot.play('shy', 2)
  if (import.meta.env.DEV) Object.assign(window, { __mascot: { peek, play, sleep } })
})
watch(() => props.size, applyClip, { flush: 'post' })
// 呼吸漂浮是 CSS 动画（.float），减少动效时去掉这个类即停
watch(reducedMotion, (r) => {
  if (r) {
    clearTimeout(idleTimer)
    retract()
  } else scheduleIdle()
})
onBeforeUnmount(() => {
  token++
  clearTimeout(timer)
  clearTimeout(idleTimer)
  for (const a of squashAnims) a.cancel()
  gsap.killTweensOf([pop, body.value, hands.value, band.value])
  window.removeEventListener('pointermove', onWindowMove)
  window.removeEventListener('keydown', onActivity)
  window.removeEventListener('pointerdown', onActivity)
})
</script>

<template>
  <div
    ref="root"
    class="avatar"
    :class="{ interactive, popped, float: !reducedMotion }"
    :style="{ width: `${size}px`, height: `${size}px` }"
    role="img"
    :aria-label="$t('layout.mascot')"
    @pointerenter="onEnter"
    @pointerleave="onLeave"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  >
    <div class="disc" />
    <div ref="stage" class="stage" :style="box">
      <div ref="body" class="sprite" :style="spriteStyle" />
    </div>
    <div class="ring" />
    <div ref="band" class="stage band" :style="box">
      <div ref="hands" class="sprite" :style="spriteStyle" />
    </div>
    <div ref="fx" class="fx" />
  </div>
</template>

<style scoped>
.avatar {
  position: relative;
  border-radius: 50%;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  user-select: none;
}
.avatar.interactive {
  cursor: pointer;
}
.disc,
.ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  transition: border-color 0.5s, box-shadow 0.5s, background 0.5s;
}
.disc {
  background: var(--avatar-bg);
  box-shadow: var(--avatar-glow);
}
/* 圆环单独一层：平时盖住角色的边缘，探身时角色的上半身在它上面 */
.ring {
  border: 3px solid var(--avatar-ring);
  pointer-events: none;
  z-index: 2;
}
.stage {
  position: absolute;
  pointer-events: none;
  z-index: 1;
  will-change: clip-path;
}
.popped .stage {
  z-index: 3;
}
/*
 * 空闲时的呼吸漂浮：圆环里的角色和扒着圆环的手一起上下浮动 3px。
 * 用合成器上跑的 CSS 动画，不用 GSAP 逐帧写 style.transform，空闲时主线程不出帧。
 */
.float .stage {
  animation: mascot-float 4.8s ease-in-out infinite;
}
@keyframes mascot-float {
  0%, 100% { transform: translate3d(0, 0, 0); }
  50% { transform: translate3d(0, -3px, 0); }
}
.band {
  z-index: 4;
  visibility: hidden;
}
.popped .band {
  visibility: visible;
}
.sprite {
  width: 100%;
  height: 100%;
  background-repeat: no-repeat;
  transform-origin: 50% 97%;
}
.fx {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}
.fx :deep(.p) {
  position: absolute;
  left: 0;
  top: 0;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  background: var(--red);
  -webkit-mask: var(--shape) center / contain no-repeat;
  mask: var(--shape) center / contain no-repeat;
}
.fx :deep(.heart) {
  --shape: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 21s-7.5-4.6-10-9.3C.3 8.300 2 4.500 5.600 4.500c2 0 3.400 1 4.400 2.400 1-1.400 2.400-2.400 4.400-2.400C18 4.500 19.700 8.300 18 11.700 15.500 16.400 12 21 12 21z'/%3E%3C/svg%3E");
}
.fx :deep(.steam) {
  --shape: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='8' cy='14' r='6'/%3E%3Ccircle cx='15' cy='10' r='7'/%3E%3C/svg%3E");
  background: #ff9aa6;
  opacity: 0.8;
}
</style>
