import * as n from '../../../core/normalize.js'
import type { AccountUser, BonusRecord, Category, Conversation, Message, Torrent, User, UserRef } from '../../../core/schemas.js'
import { withRaw } from '../../../core/schemas.js'
import type { Row } from './api.js'
import { SITE } from './client.js'

export function userRef(raw: Row): UserRef {
  return { id: String(raw.id), name: n.str(raw.username), url: `${SITE}/profile/${raw.id}`, avatar: n.avatar(raw.avatarUrl) }
}

/** 当前账号（member/profile）→ AccountUser：头像与 user() 同源（avatarUrl）。 */
export function account(raw: Row): AccountUser {
  return n.accountUser(userRef(raw), raw.avatarUrl)
}

export function user(raw: Row): User {
  return n.user({ id: String(raw.id), name: n.str(raw.username), handle: n.str(raw.username), url: `${SITE}/profile/${raw.id}`, avatar: n.url(raw.avatarUrl), bio: n.str(raw.info) }, raw)
}

export function torrent(raw: Row): Torrent {
  const status = raw.status ?? {}
  const author = !raw.anonymous && raw.author != null
    ? { id: String(raw.author), name: null, url: `${SITE}/profile/${raw.author}`, avatar: null } : null
  return withRaw({
    ...n.item({
      id: String(raw.id), kind: 'torrent', url: `${SITE}/detail/${raw.id}`,
      title: n.str(raw.name), text: n.str(raw.descr) ?? n.str(raw.smallDescr), author,
      created_at: n.time(raw.createdDate) ?? n.time(status.createdDate), cover: n.url(raw.imageList?.[0]),
      stats: { views: n.count(status.views), comments: n.count(status.comments) },
    }),
    kind: 'torrent' as const,
    size: n.count(raw.size), file_count: n.count(raw.numfiles), category_id: n.idOrNull(raw.category),
    seeders: n.count(status.seeders), leechers: n.count(status.leechers), completed: n.count(status.timesCompleted),
    discount: n.str(status.discount),
  }, raw)
}

export function category(raw: Row): Category {
  return n.category({ id: String(raw.id), name: String(raw.nameChs ?? raw.nameCht ?? raw.nameEng ?? raw.id), parent_id: n.idOrNull(raw.parent) }, raw)
}

const SYSTEM: UserRef = { id: '0', name: '系统', url: null, avatar: null }

function peerRef(id: unknown): UserRef | null {
  if (id == null || id === '') return null
  if (String(id) === '0') return SYSTEM
  return { id: String(id), name: null, url: `${SITE}/profile/${id}`, avatar: null }
}

const sizeText = (bytes: unknown): string | null => {
  const v = Number(bytes)
  if (!Number.isFinite(v)) return null
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let x = Math.abs(v)
  let i = 0
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++ }
  return `${v < 0 ? '-' : ''}${i ? x.toFixed(2) : x} ${units[i]}`
}

/** getUserTorrentList 的一行 `{ torrent, peer }` → Torrent；本账号在这个种子上的上传、下载、分享率写进 text。 */
export function userTorrent(raw: Row): Torrent {
  const peer = raw.peer ?? {}
  const base = raw.torrent ? torrent(raw.torrent) : null
  const up = Number(peer.uploaded ?? 0)
  const down = Number(peer.downloaded ?? 0)
  const stats = [
    `上传：${sizeText(up) ?? '-'}`, `下载：${sizeText(down) ?? '-'}`,
    `分享率：${down > 0 ? (up / down).toFixed(3) : up > 0 ? '∞' : '-'}`,
  ].join('\n')
  if (!base) {
    const id = String(raw.torrentId ?? raw.torrent_id ?? raw.id ?? '')
    return withRaw({
      ...n.item({ id, kind: 'torrent', url: id ? `${SITE}/detail/${id}` : null, title: null, text: `（种子已删除）\n${stats}` }),
      kind: 'torrent' as const, size: null, file_count: null, category_id: null, seeders: null, leechers: null, completed: null, discount: null,
    }, raw)
  }
  return withRaw({ ...base, text: [stats, base.text].filter(Boolean).join('\n') }, raw)
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export interface ExamItem { name: 'download' | 'upload' | 'bonus'; current: number | null; target: number | null; done: boolean | null }
export interface Exam { id: string; title: string | null; status: string | null; start_at: string | null; end_at: string | null; note: string | null; items: ExamItem[] }

/** getMyActiveList 的一条 → 考核进度。下载量、上传量单位为字节。站点字段拼写是 downloaed / uploaed。 */
export function exam(raw: Row): Exam {
  const item = (name: ExamItem['name'], current: unknown, target: unknown): ExamItem => {
    const c = num(current)
    const t = num(target)
    return { name, current: c, target: t, done: c == null || t == null ? null : c >= t }
  }
  return withRaw({
    id: String(raw.id), title: n.str(raw.title), status: n.str(raw.status),
    start_at: n.time(raw.startDate), end_at: n.time(raw.endDate), note: n.str(raw.descr),
    items: [
      item('download', raw.downloaed ?? raw.downloaded, raw.downloadTarget),
      item('upload', raw.uploaed ?? raw.uploaded, raw.uploadTarget),
      item('bonus', raw.bonuses, raw.bonusTarget),
    ],
  }, raw)
}

export interface BonusRate { per_hour: number | null; a: number | null; seeding_count: number | null; seeding_size_gb: number | null; two_factor: boolean | null }

/** tracker/mybonus → 时魔。per_hour 是每小时魔力值，a 是 A 值，seeding_* 是计入时魔的做种数和体积（GB）。 */
export function bonusRate(raw: Row): BonusRate {
  const f = raw.formulaParams ?? {}
  return withRaw({
    per_hour: num(f.finalBs), a: num(f.A), seeding_count: num(f.count), seeding_size_gb: num(f.caGb),
    two_factor: typeof f.enable2fa === 'boolean' ? f.enable2fa : null,
  }, raw)
}

/** 种子促销代码（credit/logs 的 [DP=…]、Torrent.discount）→ 中文。 */
const DISCOUNTS: Record<string, string> = {
  FREE: '免费', PERCENT_50: '50%', P50: '50%', PERCENT_70: '70%', P70: '70%', PERCENT_30: '30%', P30: '30%',
  _2X: '2X 上传', _2X_FREE: '2X 免费', _2X_PERCENT_50: '2X 50%', NORMAL: '无促销',
}
/** credit/logs 的站点标签 → 中文；不在表里的 ASCII 标签原样保留。 */
const TAGS: Record<string, string> = { EXAM: '考核期间' }
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const IPV6 = /(?<![\w:])(?=[0-9a-f:.]*:[0-9a-f:.]*:)[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?:%\w+)?(?![\w:])/gi

/**
 * credit/logs 的 text → 给人看的说明与种子 ID。
 * 实测格式：`[TID=…][DP=P50][IP=…][EXAM]`、`[TID=…][IP=…][SN_DL_DIFF][EXAM]`、`[做種積分][考核期間無加成][EXAM]`。
 * TID 拆成 url，IP 去掉，DP / EXAM 转成中文，中文标签去掉方括号，其余原样；方括号外的文字保留，其中的 IP 同样去掉。
 */
export function bonusNote(text: unknown): { parts: string[]; tid: string | null } {
  const parts: string[] = []
  let tid: string | null = null
  const raw = typeof text === 'string' ? text : ''
  const rest = raw.replace(/\[([^\[\]]*)\]/g, (_m, tag: string) => {
    const eq = tag.indexOf('=')
    const key = (eq < 0 ? tag : tag.slice(0, eq)).trim().toUpperCase()
    const value = eq < 0 ? '' : tag.slice(eq + 1).trim()
    if (key === 'IP') return ''
    if (key === 'TID') { if (/^\d+$/.test(value)) tid ??= value; return '' }
    if (key === 'DP') { if (value) parts.push(`促销：${DISCOUNTS[value.toUpperCase()] ?? value}`); return '' }
    if (eq < 0 && TAGS[key]) parts.push(TAGS[key]!)
    else if (tag.trim()) parts.push(eq < 0 && /[^\x00-\x7f]/.test(tag) ? tag.trim() : `[${tag.replace(IPV4, '').replace(IPV6, '').trim()}]`)
    return ''
  })
  const plain = rest.replace(IPV4, '').replace(IPV6, '').replace(/\s+/g, ' ').trim()
  if (plain) parts.unshift(plain)
  return { parts, tid }
}

/**
 * credit/logs 的一行 → BonusRecord。change 是魔力值变化；note 是 bonusNote 处理后的说明加上传 / 下载量的变化；
 * url 是相关种子的详情页（text 里的 TID，没有时 TORRENT 记录的 relatedId）。
 */
export function bonusRecord(raw: Row): BonusRecord {
  const { parts, tid } = bonusNote(raw.text)
  const extra = [
    Number(raw.uploaded) ? `上传：${sizeText(raw.uploaded)}` : null,
    Number(raw.downloaded) ? `下载：${sizeText(raw.downloaded)}` : null,
  ]
  const related = raw.relatedId != null && /^\d+$/.test(String(raw.relatedId)) && raw.operation === 'TORRENT' ? String(raw.relatedId) : null
  const torrentId = tid ?? related
  const change = Number(raw.bonus)
  return withRaw({
    id: String(raw.id ?? `${raw.createdDate}#${raw.operation}`),
    time: n.time(raw.createdDate),
    type: n.str(raw.operation),
    before: null,
    after: null,
    change: raw.bonus == null || !Number.isFinite(change) ? null : change,
    user: null,
    note: [...parts, ...extra].filter(Boolean).join('；') || null,
    url: torrentId ? `${SITE}/detail/${torrentId}` : null,
  }, raw)
}

/** msg/search 的一行 → Conversation（每条站内信作为一个会话）。peer 是对方：收件箱为发件人，发件箱为收件人。 */
export function conversation(raw: Row, box: string): Conversation {
  return n.conversation({
    id: String(raw.id), peer: peerRef(box === '-1' ? raw.receiver : raw.sender),
    unread: raw.unread === true || raw.unread === 'true' ? 1 : 0,
    last_message: n.str(raw.title), updated_at: n.time(raw.createdDate),
  }, raw)
}

export function message(raw: Row): Message {
  const body = [n.str(raw.title), n.str(raw.context)].filter(Boolean).join('\n')
  return n.message({
    id: String(raw.id), conversation_id: String(raw.id), from: peerRef(raw.sender), type: 'text',
    text: body || null, created_at: n.time(raw.createdDate),
  }, raw)
}
