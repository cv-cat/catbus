import { defineStore } from 'pinia'
import { ref } from 'vue'

export type Source = 'live' | 'demo'

/** 当前数据源：能跑起 catbus 时为 live，否则退回演示数据（启动时由 api/client 的 detectSource 探测） */
export const useSourceStore = defineStore('source', () => {
  const source = ref<Source>('demo')
  const demo = () => source.value === 'demo'
  return { source, demo }
})

/** 给 api 层用：在函数体里取 store，调用时 pinia 已激活 */
export const isDemo = () => useSourceStore().demo()
