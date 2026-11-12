import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueI18n from '@intlify/unplugin-vue-i18n/vite'
import { catbusBridge } from './server/bridge.ts'

export default defineConfig({
  plugins: [
    vue(),
    // 多语言（AGENTS.md 7.9「多语言」）：文案在构建时预编译，运行时不编译、不用 eval
    VueI18n({
      include: fileURLToPath(new URL('./src/locales/**/*.json', import.meta.url)),
      runtimeOnly: true,
      compositionOnly: true,
      fullInstall: true,
      strictMessage: false,
    }),
    catbusBridge(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // 随 catbus-cli 发布：构建到根目录的 dist/webui/app/，由 `catbus web` 提供（AGENTS.md 7.9）
  build: {
    outDir: fileURLToPath(new URL('../dist/webui/app', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    // 平台图标直接取仓库里 scripts/assets/logos/ 的原图
    fs: { allow: ['..'] },
  },
})
