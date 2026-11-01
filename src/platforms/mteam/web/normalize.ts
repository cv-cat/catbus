import * as n from '../../../core/normalize.js'
import type { Category, Torrent, User, UserRef } from '../../../core/schemas.js'
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
