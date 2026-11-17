import type { Conversation, Envelope, Message, Notice, NoticeCount } from '../types'
import { demoMe } from './accounts'
import { AUTHORS, TITLES, hash } from './shared'

// 收件箱的演示数据（AGENTS.md 7.9「通知与私信」）：能力表与注册表一致

/** 平台 → [notice list, notice count, msg list + msg history] */
export const MOCK_INBOX: Record<string, { notices: boolean; count: boolean; messages: boolean }> = {
  xhs: { notices: true, count: true, messages: true },
  douyin: { notices: true, count: false, messages: false },
  tiktok: { notices: true, count: true, messages: true },
  kuaishou: { notices: false, count: true, messages: false },
  youtube: { notices: true, count: true, messages: false },
  jd: { notices: false, count: false, messages: true },
  x: { notices: false, count: false, messages: true },
  mteam: { notices: false, count: false, messages: true },
}

const DAY = 86_400_000
const MIN = 60_000
const NOTICE_TOTAL = 46
const NOTICE_TYPES: Notice['type'][] = ['comment', 'like', 'mention', 'follow', 'like', 'comment', 'system', 'like']
const COMMENTS = ['这个营地在哪呀？求定位', '同款帐篷！用了两年还很结实', '收藏了，周末就去', '太好看了吧，怎么拍的', '请问睡袋是什么牌子']
const SYSTEM = ['你的笔记已通过审核', '账号安全提醒：新设备登录', '活动邀请：秋日露营季']

const avatar = (seed: string) => `https://picsum.photos/seed/ava-${seed}/96/96`
const ref = (platform: string, id: string, name: string) => ({ id, name, url: `https://example.com/${platform}/user/${id}`, avatar: avatar(id) })

/** 演示的通知：五种类型轮流，按 offset 分页 */
export function mockNotices(platform: string, offset: number, limit = 20): Envelope<Notice[]> {
  const data: Notice[] = []
  for (let i = offset; i < Math.min(NOTICE_TOTAL, offset + limit); i++) {
    const type = NOTICE_TYPES[i % NOTICE_TYPES.length]!
    const n = hash(`${platform}:n${i}`)
    const uid = `u${n % 9000}`
    const title = TITLES[n % TITLES.length]!
    const target = type === 'follow' || type === 'system' ? null : { id: `t${i}`, url: `https://example.com/${platform}/item/t${i}` }
    const text =
      type === 'comment' ? COMMENTS[n % COMMENTS.length]!
      : type === 'mention' ? `@你 一起看看：${title}`
      : type === 'like' ? title
      : type === 'system' ? SYSTEM[n % SYSTEM.length]!
      : null
    data.push({
      id: `${platform}-n${i}`,
      type,
      // 系统通知，以及偶尔一条匿名的 @，没有用户（演示「没有用户的通知」）
      user: type === 'system' || (type === 'mention' && n % 3 === 1) ? null : ref(platform, uid, AUTHORS[n % AUTHORS.length]!),
      target,
      text,
      created_at: new Date(Date.now() - (i * 97 + (n % 50)) * MIN).toISOString(),
    })
  }
  const next = offset + data.length
  return { ok: true, data, page: { cursor: String(next), has_more: next < NOTICE_TOTAL }, error: null }
}

export function mockNoticeCount(platform: string): Envelope<NoticeCount> {
  // YouTube 只有未读总数，不分类（与注册表的说明一致）
  if (platform === 'youtube') return { ok: true, data: { total: 7, comment: null, mention: null, like: null, follow: null, system: null }, page: null, error: null }
  return { ok: true, data: { total: 12, comment: 3, mention: 1, like: 6, follow: 2, system: 0 }, page: null, error: null }
}

const PEERS = ['山野来信', '木子', 'Mia 的周末', '自驾者老周', '橘子和猫', '装备控', '去野吧', '夜行者']
const LINES = [
  '你好，请问帐篷还在吗？',
  '在的，九成新',
  '可以便宜一点吗',
  '最低 380，包邮',
  '好的，我考虑一下',
  '周末一起去露营吗？',
  '去哪个营地',
  '湖边那个，上次你推荐的',
  '可以呀，我带炉子',
  '那我带吃的',
  '图片我发你看看',
  '收到，谢谢！',
]
const CONV_TOTAL = 8
const MSG_TOTAL = 60

/** M-Team 的站内信只支持账号密码登录：演示的 API Key 账号（default）报 UNSUPPORTED */
const unsupported = <T,>(): Envelope<T> => ({
  ok: false,
  data: null,
  page: null,
  error: { code: 'UNSUPPORTED', message: '站内信只支持账号密码登录', hint: 'catbus mteam auth login --method password', detail: null },
})

/** 演示的会话：单聊若干、一个群聊（没有对方信息），最后一个没有消息 */
export function mockConversations(platform: string, account: string | null, offset: number, limit = 20): Envelope<Conversation[]> {
  if (platform === 'mteam' && (account ?? 'default') === 'default') return unsupported()
  const data: Conversation[] = []
  for (let i = offset; i < Math.min(CONV_TOTAL, offset + limit); i++) {
    const group = i === 2
    const id = group ? 'group:demo' : `c${i}`
    const empty = i === CONV_TOTAL - 1
    data.push({
      id,
      peer: group ? null : ref(platform, `p${i}`, PEERS[i % PEERS.length]!),
      unread: i < 3 ? 3 - i : 0,
      last_message: empty ? null : LINES[(i * 5) % LINES.length]!,
      updated_at: new Date(Date.now() - (i * i * 40 + 3) * MIN).toISOString(),
    })
  }
  const next = offset + data.length
  return { ok: true, data, page: { cursor: String(next), has_more: next < CONV_TOTAL }, error: null }
}

/** 演示的消息：返回最新的一页，cursor 往更早翻；自己和对方交替，偶尔有图片 */
export function mockMessages(platform: string, account: string | null, conv: string, offset: number, limit = 20): Envelope<Message[]> {
  if (platform === 'mteam' && (account ?? 'default') === 'default') return unsupported()
  const total = conv === `c${CONV_TOTAL - 1}` ? 0 : MSG_TOTAL
  const me = demoMe(platform)
  const meRef = { id: me?.id ?? '1', name: me?.name ?? 'catbus', url: null, avatar: null }
  const n = hash(`${platform}:${conv}`)
  // 与会话列表里的对方一致（c<i> 的对方是 p<i>）
  const ci = Number(conv.replace(/^c/, '')) || 0
  const data: Message[] = []
  // i = 0 是最新的一条；一页按时间从早到晚排
  for (let i = Math.min(total, offset + limit) - 1; i >= offset; i--) {
    const mine = (i + (n % 2)) % 3 === 0
    const image = i % 9 === 4
    const peer = conv.startsWith('group:') ? ref(platform, `g${i % 3}`, PEERS[(i + 3) % PEERS.length]!) : ref(platform, `p${ci}`, PEERS[ci % PEERS.length]!)
    data.push({
      id: `${conv}-m${i}`,
      conversation_id: conv,
      from: mine ? meRef : peer,
      type: image ? 'image' : 'text',
      text: image ? null : LINES[(i + n) % LINES.length]!,
      media: image ? [{ id: null, type: 'image', url: `https://picsum.photos/seed/msg-${conv}-${i}/480/360`, width: 480, height: 360, duration: null }] : [],
      // 每隔几条拉开一大段，演示时间分隔
      created_at: new Date(Date.now() - (i * 3 + Math.floor(i / 5) * 60 * 5) * MIN - (i > 30 ? DAY : 0)).toISOString(),
    })
  }
  const next = offset + Math.max(0, Math.min(total, offset + limit) - offset)
  return { ok: true, data, page: { cursor: String(next), has_more: next < total }, error: null }
}
