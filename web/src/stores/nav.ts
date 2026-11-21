import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 侧栏在窄屏上的展开状态（全局共享）。
 * 手机：抽屉是否打开；平板：图标窄栏是否展开成完整侧栏。桌面上忽略。
 * 发现页顶栏的菜单按钮调用 openNav()，侧栏自己负责遮罩、Esc、滑动关闭。
 */
export const useNavStore = defineStore('nav', () => {
  const navOpen = ref(false)
  return {
    navOpen,
    openNav: () => (navOpen.value = true),
    closeNav: () => (navOpen.value = false),
    toggleNav: () => (navOpen.value = !navOpen.value),
  }
})
