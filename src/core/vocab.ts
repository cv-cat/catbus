import { z } from 'zod'
import { DOWNLOAD, PUBLISH, STREAM } from './options.js'

export type Auth = 'required' | 'optional'

export interface ArgSpec {
  name: string
  summary: string
  optional?: boolean
  /** 省略时的取值，例如 `me`。 */
  default?: string
}

export type Args = Record<string, string | undefined>
export type Options = Record<string, unknown>

export interface CommandSpec {
  /** `{item}` 替换成平台的 item 叫法。 */
  summary: string
  args: ArgSpec[]
  options: Record<string, z.ZodType>
  auth: Auth
  /** 输出类型名（AGENTS 6.3），用于帮助和文档。 */
  output: string
  paged?: boolean
  stream?: boolean
  confirm?: boolean | ((options: Options) => boolean)
  /** 跨参数的约束，返回错误信息表示不通过（USAGE）。 */
  check?: (args: Args, options: Options) => string | undefined
}

const arg = {
  user: { name: 'user', summary: '用户：ID、主页 URL、用户名或 me' },
  userOrMe: { name: 'user', summary: '用户，省略时为 me', optional: true, default: 'me' },
  item: { name: 'item', summary: '{item}：ID 或 URL' },
  keyword: { name: 'keyword', summary: '关键词' },
  comment: { name: 'comment', summary: '评论 ID' },
  room: { name: 'room', summary: '直播间：ID 或 URL' },
  conversation: { name: 'conversation', summary: '会话 ID' },
} satisfies Record<string, ArgSpec>

type Extra = Partial<Omit<CommandSpec, 'summary' | 'args' | 'output'>>

function read(summary: string, args: ArgSpec[], output: string, extra: Extra = {}): CommandSpec {
  return { summary, args, output, options: {}, auth: 'optional', ...extra }
}

function list(summary: string, args: ArgSpec[], output: string, extra: Extra = {}): CommandSpec {
  return read(summary, args, output, { paged: true, ...extra })
}

function write(summary: string, args: ArgSpec[], output = '{id}', extra: Extra = {}): CommandSpec {
  return read(summary, args, output, { auth: 'required', ...extra })
}

function given(options: Options, keys: string[]): string[] {
  return keys.filter((k) => options[k] != null)
}

const flags = (keys: string[]) => keys.map((k) => (k === 'text' ? '<text>' : `--${k}`)).join('、')

/**
 * `msg send` 的参数约束（AGENTS 4.8）：--to、--conversation、--item 用一个，只有 --to 与 --item 可以同时用；
 * 要有消息内容。平台可以追加目标（京东的 --order）和内容（抖音的 --file、--share）。
 * 某个平台不支持 --to 与 --item 同时用时，由 handler 报 UNSUPPORTED。
 */
export function checkMsgSend(a: Args, o: Options, extra: { targets?: string[]; content?: string[] } = {}): string | undefined {
  const targets = given(o, ['to', 'conversation', 'item'])
  const extraTargets = given(o, extra.targets ?? [])
  if ((targets.length === 0 && extraTargets.length === 0) || (targets.length > 1 && targets.includes('conversation'))) {
    return `${flags(['to', 'conversation', 'item', ...(extra.targets ?? [])])} 需要用一个，只有 --to 与 --item 可以同时用`
  }
  const content = ['image', 'video', ...(extra.content ?? [])]
  if (a.text == null && given(o, content).length === 0) {
    const all = flags(['text', ...content]).split('、')
    return `需要 ${all.slice(0, -1).join('、')} 或 ${all.at(-1)}`
  }
}

/** 通用词表（AGENTS 4.5、4.8、6.3）。平台只声明与默认不同的部分。 */
export const VOCAB: Record<string, CommandSpec> = {
  'auth login': read('登录', [], 'Account', {
    options: {
      phone: z.string().optional().describe('手机号（sms）'),
      code: z.string().optional().describe('短信验证码（sms）'),
      username: z.string().optional().describe('用户名（password）'),
      passwordStdin: z.boolean().optional().describe('从 stdin 读取密码（password）'),
      cookie: z.string().optional().describe('cookie 字符串、@文件，或 - 表示从 stdin 读取（cookie）'),
    },
  }),
  'auth status': read('在线校验登录态', [], 'AuthStatus'),
  'auth logout': read('登出并删除本地凭证', [], 'Account'),
  'auth list': read('本平台、本端的账号', [], 'Account[]'),
  'auth use': read('切换当前账号', [{ name: 'account', summary: '账号名' }], 'Account'),

  'user get': read('用户资料', [arg.user], 'User'),
  'user search': list('搜索用户', [arg.keyword], 'User[]'),
  'user items': list('用户发布的{item}', [arg.user], 'Item[]'),
  'user likes': list('用户点赞的{item}', [arg.userOrMe], 'Item[]'),
  'user collects': list('用户收藏的{item}', [arg.userOrMe], 'Item[]'),
  'user reposts': list('用户转发的{item}', [arg.userOrMe], 'Item[]'),
  'user followers': list('粉丝列表', [arg.userOrMe], 'User[]'),
  'user following': list('关注列表', [arg.userOrMe], 'User[]'),
  'user follow': write('关注', [arg.user]),
  'user unfollow': write('取消关注', [arg.user]),

  'item get': read('{item}详情', [arg.item], 'Item'),
  'item search': list('搜索{item}', [arg.keyword], 'Item[]'),
  'item related': list('相关推荐', [arg.item], 'Item[]'),
  'item list': list('我发布的{item}，带审核状态', [], 'Item[]', { auth: 'required' }),
  'item media': read('{item}的媒体地址', [arg.item], 'Media[]'),
  'item download': read('下载{item}的媒体', [arg.item], 'File[]', { options: DOWNLOAD }),
  'item like': write('点赞', [arg.item]),
  'item unlike': write('取消点赞', [arg.item]),
  'item collect': write('收藏', [arg.item]),
  'item uncollect': write('取消收藏', [arg.item]),
  'item repost': write('转发', [arg.item]),
  'item unrepost': write('取消转发', [arg.item]),
  'item publish': write('发布{item}', [], 'Item', { options: PUBLISH }),
  'item delete': write('删除{item}', [arg.item], '{id}', { confirm: true }),
  'item categories': read('{item}分类，即 --category 的取值', [], 'Category[]'),

  'product get': read('商品详情', [{ name: 'product', summary: '商品：ID 或 URL' }], 'Item'),

  'comment list': list('评论列表，也用于商品评价', [arg.item], 'Comment[]'),
  'comment replies': list('评论的回复', [arg.item, arg.comment], 'Comment[]'),
  'comment add': write('发表评论', [arg.item, { name: 'text', summary: '评论内容' }], 'Comment', {
    options: { replyTo: z.string().optional().describe('回复某条评论（评论 ID）') },
  }),
  'comment delete': write('删除评论', [arg.item, arg.comment], '{id}', { confirm: true }),
  'comment like': write('点赞评论', [arg.item, arg.comment]),
  'comment unlike': write('取消点赞评论', [arg.item, arg.comment]),

  'feed list': list('推荐 / 热门 / 关注流', [], 'Item[]'),
  'feed categories': read('推荐流分类', [], 'Category[]'),

  'live get': read('直播间信息', [arg.room], 'Live'),
  'live list': list('直播列表', [], 'Live[]'),
  'live search': list('搜索直播', [arg.keyword], 'Live[]'),
  'live categories': read('直播分类', [], 'Category[]'),
  'live listen': read('监听弹幕、礼物、进场等事件', [arg.room], 'Event', { stream: true, options: STREAM }),
  'live history': read('最近的弹幕', [arg.room], 'Event[]'),
  'live send': write('发弹幕，或用 --gift 送礼', [arg.room, { name: 'text', summary: '弹幕内容', optional: true }], '{id}', {
    options: {
      gift: z.string().optional().describe('礼物 id，取值来自 live gifts'),
      count: z.number().int().positive().optional().describe('礼物数量'),
    },
    confirm: (o) => o.gift != null,
    check: (a, o) => {
      if ((a.text == null) === (o.gift == null)) return '需要 <text> 或 --gift，二选一'
      if (o.count != null && o.gift == null) return '--count 只能和 --gift 一起用'
    },
  }),
  'live like': write('直播间点赞', [arg.room]),
  'live rank': read('直播间排行榜', [arg.room], 'Rank[]'),
  'live gifts': read('礼物列表', [arg.room], 'Gift[]'),
  'live products': read('直播间商品', [arg.room], 'Item[]'),
  'live media': read('直播流地址', [arg.room], 'Media[]'),
  'live replays': list('直播回放', [arg.user], 'Item[]'),
  'live start': write('开播', [], '{id push{url key}}'),
  'live stop': write('下播', []),

  'keyword suggest': read('搜索联想词', [{ name: 'prefix', summary: '输入的前缀' }], 'Keyword[]'),
  'keyword hot': read('热搜词', [], 'Keyword[]'),

  'notice list': list('通知列表', [], 'Notice[]', { auth: 'required' }),
  'notice count': read('未读通知数', [], 'NoticeCount', { auth: 'required' }),

  'msg list': list('会话列表', [], 'Conversation[]', { auth: 'required' }),
  'msg history': list('会话的消息记录', [arg.conversation], 'Message[]', { auth: 'required' }),
  'msg send': write('发私信；--item 表示联系商品的卖家或客服', [{ name: 'text', summary: '消息内容', optional: true }], 'Message', {
    options: {
      to: z.string().optional().describe('收信用户'),
      conversation: z.string().optional().describe('会话 ID'),
      item: z.string().optional().describe('商品：ID 或 URL'),
      image: PUBLISH.image,
      video: PUBLISH.video,
    },
    check: (a, o) => checkMsgSend(a, o),
  }),
  'msg listen': read('监听新消息', [], 'Message', { auth: 'required', stream: true, options: STREAM }),
  'msg read': write('标记会话已读', [arg.conversation]),
  'msg revoke': write('撤回消息', [arg.conversation, { name: 'message', summary: '消息 ID' }], '{id}', { confirm: true }),
  'msg delete': write('删除会话', [arg.conversation], '{id}', { confirm: true }),

  'media upload': write('上传媒体', [{ name: 'file', summary: '本地文件路径' }], 'Media'),

  'folder list': list('收藏夹列表', [arg.userOrMe], 'Folder[]'),
  'folder items': list('收藏夹里的{item}', [{ name: 'folder', summary: '收藏夹 ID' }], 'Item[]'),
  'folder create': write('新建收藏夹', [{ name: 'name', summary: '收藏夹名字' }], 'Folder'),
  'folder update': write('修改收藏夹', [{ name: 'folder', summary: '收藏夹 ID' }], 'Folder', {
    options: { name: z.string().describe('新名字') },
  }),
  'folder delete': write('删除收藏夹', [{ name: 'folder', summary: '收藏夹 ID' }], '{id}', { confirm: true }),

  'series list': list('合集列表', [arg.userOrMe], 'Series[]'),
  'series items': list('合集里的{item}', [{ name: 'series', summary: '合集 ID' }], 'Item[]'),

  'history list': list('浏览历史', [], 'Item[]', { auth: 'required' }),
  'topic search': list('搜索话题', [arg.keyword], 'Topic[]'),
  'poi search': list('搜索地点', [arg.keyword], 'Poi[]'),
}

/** 词表里的 resource，按 4.5 的顺序。 */
export const RESOURCES = [...new Set(Object.keys(VOCAB).map((k) => k.split(' ')[0]!))]

/** 由 core 实现、自动注册到每个可用端的命令。 */
export const CORE_COMMANDS = ['auth list', 'auth use', 'auth logout']
