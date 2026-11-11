import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/**
 * 开发期的 Vite 插件：把 catbus 的 bridge（src/webui/bridge.ts）挂到 dev server 上。
 *
 * bridge 和 `catbus web` 用的是同一份代码，这里从仓库根目录编译好的 dist/webui/ 加载，
 * 所以改了 src/webui/ 之后要在根目录重新 npm run build（或 tsc -w）。
 */
const BRIDGE = fileURLToPath(new URL('../../dist/webui/bridge.js', import.meta.url))

type Handler = (req: IncomingMessage, res: ServerResponse) => boolean

export function catbusBridge(): Plugin {
  return {
    name: 'catbus-bridge',
    async configureServer(server) {
      if (!existsSync(BRIDGE)) {
        server.config.logger.warn('[catbus] 找不到编译好的 bridge（dist/webui/bridge.js），请先在仓库根目录执行 npm run build；现在只能用演示数据')
        return
      }
      const { createBridge } = (await import(BRIDGE)) as { createBridge: (o?: { demo?: boolean }) => Handler }
      const handle = createBridge()
      server.middlewares.use((req, res, next) => {
        if (!handle(req, res)) next()
      })
    },
  }
}
