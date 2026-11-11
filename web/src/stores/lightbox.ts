import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 看大图（评论里的图片等）：全局一个，挂在 App.vue */
export const useLightboxStore = defineStore('lightbox', () => {
  const open = ref(false)
  const images = ref<string[]>([])
  const index = ref(0)

  function show(list: string[], at = 0) {
    if (!list.length) return
    images.value = list
    index.value = Math.min(Math.max(0, at), list.length - 1)
    open.value = true
  }

  function close() {
    open.value = false
  }

  return { open, images, index, show, close }
})

export const openLightbox = (images: string[], index = 0) => useLightboxStore().show(images, index)
export const closeLightbox = () => useLightboxStore().close()
