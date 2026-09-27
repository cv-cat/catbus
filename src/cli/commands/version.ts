import { packageJson } from '../../core/paths.js'

export function version() {
  return { version: packageJson().version, node: process.versions.node, platform: process.platform, arch: process.arch }
}
