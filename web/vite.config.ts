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
      // 文案全部是构建时预编译好的，运行时用不到消息编译器，不打进包
      dropMessageCompiler: true,
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
    rolldownOptions: {
      output: {
        // 框架和动效库单独成稳定的 vendor chunk：业务代码改了，这几块的文件名不变，浏览器缓存照常命中。
        // 页面、浮层按需加载（src/components/lazy/），不在这里分。
        codeSplitting: {
          groups: [
            { name: 'vendor-vue', test: /[\/]node_modules[\/](@vue|vue|pinia|vue-i18n|@intlify)[\/]/, priority: 20 },
            { name: 'vendor-gsap', test: /[\/]node_modules[\/]gsap[\/]/, priority: 20 },
          ],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    // 平台图标直接取仓库里 scripts/assets/logos/ 的原图
    fs: { allow: ['..'] },
  },
})
