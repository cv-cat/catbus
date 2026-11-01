import type { Command } from '../../src/core/registry.js'

export type Obj = Record<string, any>

/** 前面命令拿到的对象，供后面的在线命令继续使用。纯逻辑，可离线回归。 */
export interface Pool {
  items: Obj[]
  products: Obj[]
  users: Obj[]
  lives: Obj[]
  comments: { comment: Obj; item: string }[]
  conversations: Obj[]
  folders: Obj[]
  series: Obj[]
}

export function createPool(): Pool {
  return { items: [], products: [], users: [], lives: [], comments: [], conversations: [], folders: [], series: [] }
}

const KEYWORD: Record<string, string> = { tiktok: 'cat', x: 'cat', xianyu: '键盘', taobao: '键盘', jd: '键盘' }
const ref = (o: Obj): string => o.url ?? o.id
const first = <T>(list: T[], prefer: (x: T) => boolean): T | undefined => list.find(prefer) ?? list[0]

/** 按参数名取值；缺少前置对象时返回 undefined（跳过这条命令）。 */
function argValue(p: string, cmd: Command, name: string, pool: Pool, commentItem: string | undefined): string | undefined {
  switch (name) {
    case 'keyword':
    case 'prefix':
      return KEYWORD[p] ?? '猫'
    case 'item': {
      if (commentItem) return commentItem
      const o = cmd.resource === 'comment' ? first(pool.items, (x) => x.stats?.comments > 0) : pool.items[0]
      return o && ref(o)
    }
    case 'product': {
      const o = pool.products[0]
      return o && ref(o)
    }
    case 'user': {
      // 直播间的主播优先；快手的主播 id 和主页 id 是两套，用主页用户。
      if (cmd.resource === 'live' && p !== 'kuaishou') {
        const host = pool.lives.find((l) => l.host)?.host
        if (host) return ref(host)
      }
      const o = pool.users[0]
      return o && ref(o)
    }
    case 'room': {
      const o = first(pool.lives, (x) => x.status === 'live')
      return o && ref(o)
    }
    case 'conversation':
      return pool.conversations[0]?.id
    case 'folder':
      return first(pool.folders, (x) => x.count > 0)?.id
    case 'series':
      return first(pool.series, (x) => x.count > 0)?.id
  }
  return undefined
}

/** 命令行参数；缺少前置对象时返回缺的参数名。 */
export function buildArgv(p: string, cmd: Command, pool: Pool): string[] | { missing: string } {
  const argv: string[] = []
  const needsComment = cmd.args.some((a) => a.name === 'comment')
  const c = needsComment ? first(pool.comments, (x) => x.comment.stats?.replies > 0) : undefined
  if (needsComment && !c) return { missing: 'comment' }
  for (const a of cmd.args) {
    if (a.optional) continue
    const v = a.name === 'comment' ? c!.comment.id : argValue(p, cmd, a.name, pool, c?.item)
    if (v == null) return { missing: a.name }
    argv.push(v)
  }
  return argv
}

/** 按注册表的输出类型，把结果收进可供后续命令使用的对象池。 */
export function harvest(pool: Pool, cmd: Command, argv: string[], data: unknown): void {
  const type = cmd.output.replace(/\[\]$/, '')
  const list = (Array.isArray(data) ? data : [data]).filter((x): x is Obj => x != null && typeof x === 'object')
  for (const o of list) {
    switch (type) {
      case 'Torrent':
      case 'Item':
        if (cmd.key === 'live products' || cmd.key === 'product get') pool.products.push(o)
        else pool.items.push(o)
        if (o.author) pool.users.push(o.author)
        break
      case 'User':
        if (cmd.key !== 'user get' || argv[0] !== 'me') pool.users.push(o)
        break
      case 'Live':
        pool.lives.push(o)
        break
      case 'Comment':
        if (cmd.key === 'comment list') pool.comments.push({ comment: o, item: argv[0]! })
        break
      case 'Conversation':
        pool.conversations.push(o)
        break
      case 'Folder':
        pool.folders.push(o)
        break
      case 'Series':
        pool.series.push(o)
        break
    }
  }
}
