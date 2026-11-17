import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { afterLoad } from '@/composables/lazy'
import { LazyLoginDialog } from '@/components/lazy'

/** 登录弹窗的全局状态：任何地方都可以 openLogin(平台, 账号) */
export const useLoginStore = defineStore('login', () => {
  const dialog = reactive({ open: false, platform: '', account: '' })

  function open(platform: string, account?: string | null) {
    dialog.platform = platform
    dialog.account = account ?? ''
    afterLoad(LazyLoginDialog, () => (dialog.open = true))
  }

  return { dialog, open, close: () => (dialog.open = false) }
})

export const openLogin = (platform: string, account?: string | null) => useLoginStore().open(platform, account)
