import { onBeforeUnmount, watch, type Ref } from 'vue'

/** 哨兵进入视野时调用 cb（滚到底自动翻页）；root 为空时相对视口 */
export function useSentinel(el: Ref<HTMLElement | undefined | null>, cb: () => void, root?: Ref<HTMLElement | undefined | null>) {
  let io: IntersectionObserver | null = null
  const stop = watch(
    [el, () => root?.value],
    ([target, r]) => {
      io?.disconnect()
      if (!target) return
      io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && cb(), { root: r ?? null, rootMargin: '0px 0px 240px 0px' })
      io.observe(target)
    },
    { immediate: true, flush: 'post' },
  )
  onBeforeUnmount(() => {
    stop()
    io?.disconnect()
  })
  /** 内容变了但哨兵仍在视野里（一页不够一屏）：重新观察一次，再触发 */
  return () => {
    if (io && el.value) {
      io.unobserve(el.value)
      io.observe(el.value)
    }
  }
}
