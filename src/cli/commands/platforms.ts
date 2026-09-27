import { ENDPOINTS, type Platform, sortCommands } from '../../core/registry.js'

/** `catbus platforms` 的一项：平台 × 端 × 命令的状态，数据来自注册表。 */
export function platformInfo(platform: Platform) {
  return {
    id: platform.id,
    name: platform.name,
    aliases: platform.aliases,
    endpoints: Object.fromEntries(ENDPOINTS.map((e) => [e, platform.endpoints[e] === 'planned' ? 'planned' : 'available'])),
    commands: ENDPOINTS.flatMap((endpoint) => {
      const ep = platform.endpoints[endpoint]
      if (ep === 'planned') return []
      return sortCommands(ep.commands.values()).map((c) => ({
        endpoint,
        resource: c.resource,
        action: c.action,
        auth: c.auth,
        status: c.status,
        upstream: c.upstream,
        note: c.note,
      }))
    }),
  }
}
