import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import VueI18n from '@intlify/unplugin-vue-i18n/vite'

/**
 * 前端单元测试：纯函数和 store 的关键逻辑，不需要浏览器（jsdom 提供 location / history / localStorage）。
 * 插件和别名与 vite.config.ts 相同（文案在构建时预编译），不挂 bridge。
 */
export default defineConfig({
  plugins: [
    vue(),
    VueI18n({
      include: fileURLToPath(new URL('./src/locales/**/*.json', import.meta.url)),
      runtimeOnly: true,
      compositionOnly: true,
      fullInstall: true,
      strictMessage: false,
      // 文案全部是构建时预编译好的，运行时用不到消息编译器，不打进包
      dropMessageCompiler: true,
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://127.0.0.1/' } },
    // 与根目录一致：固定北京时间
    env: { TZ: 'Asia/Shanghai' },
  },
})
