import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // 对拍数据在北京时间下生成（签名里常有按本地时间格式化的时间戳，如京东 h5st），测试固定同一时区
    env: { TZ: 'Asia/Shanghai' },
  },
})
