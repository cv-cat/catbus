import * as n from '../../../core/normalize.js'
import type { BonusRecord, Category, Conversation, Message, Torrent, User, UserRef } from '../../../core/schemas.js'
import { withRaw } from '../../../core/schemas.js'
import type { Row } from './api.js'
import { SITE } from './client.js'

export function userRef(raw: Row): UserRef {
  return { id: String(raw.id), name: n.str(raw.username), url: `${SITE}/profile/${raw.id}` }
}

export function user(raw: Row): User {
  return n.user({ id: String(raw.id), name: n.str(raw.username), handle: n.str(raw.username), url: `${SITE}/profile/${raw.id}`, avatar: n.url(raw.avatarUrl), bio: n.str(raw.info) }, raw)
}

export function torrent(raw: Row): Torrent {
  const status = raw.status ?? {}
  const author = !raw.anonymous && raw.author != null
    ? { id: String(raw.author), name: null, url: `${SITE}/profile/${raw.author}` } : null
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

const SYSTEM: UserRef = { id: '0', name: '系统', url: null }

function peerRef(id: unknown): UserRef | null {
  if (id == null || id === '') return null
  if (String(id) === '0') return SYSTEM
  return { id: String(id), name: null, url: `${SITE}/profile/${id}` }
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

/** credit/logs 的一行 → BonusRecord。change 是魔力值变化；上传 / 下载量的变化写进 note。 */
export function bonusRecord(raw: Row): BonusRecord {
  const extra = [
    Number(raw.uploaded) ? `上传：${sizeText(raw.uploaded)}` : null,
    Number(raw.downloaded) ? `下载：${sizeText(raw.downloaded)}` : null,
  ]
  const change = Number(raw.bonus)
  return withRaw({
    id: String(raw.id ?? `${raw.createdDate}#${raw.operation}`),
    time: n.time(raw.createdDate),
    type: n.str(raw.operation),
    before: null,
    after: null,
    change: raw.bonus == null || !Number.isFinite(change) ? null : change,
    user: null,
    note: [n.str(raw.text), ...extra].filter(Boolean).join('；') || null,
    url: raw.relatedId && /^\d+$/.test(String(raw.relatedId)) && raw.operation === 'TORRENT' ? `${SITE}/detail/${raw.relatedId}` : null,
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
