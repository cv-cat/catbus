import { fileURLToPath } from 'node:url'

/** 本包的 CLI 入口：dist/webui/cli.js → dist/cli/main.js */
export const CLI_MAIN = fileURLToPath(new URL('../cli/main.js', import.meta.url))

/** bridge 运行的 catbus：默认就是本包（同一个 Node、同一份 dist），开发时可用 CATBUS_BIN 覆盖 */
export function resolveCli(): { file: string; prefix: string[] } {
  const bin = process.env.CATBUS_BIN
  if (bin) return { file: bin, prefix: [] }
  return { file: process.execPath, prefix: [CLI_MAIN] }
}
