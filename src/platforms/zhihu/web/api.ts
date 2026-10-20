import type { PairsInit } from '../../../core/py.js'
import { type Paging, type Zhihu } from './client.js'
import { WWW, ZHUANLAN } from './profile.js'

/**
 * 知乎 web 端的请求构造，一个函数对应网页前端的一个请求，query 的字段与顺序照前端。
 * 非上游：知乎没有上游仓库，全部请求都是按 www.zhihu.com 网页端补的，没有对拍，由 tests/zhihu.test.ts 的命令测试覆盖。
 */

export interface ListBody<T = any> {
  data?: T[]
  paging?: Paging
  [key: string]: any
}

const PAGE_SIZE = 20

/** 回答的 include（单个回答）。列表里每项前面加 `data[*].`。 */
const ANSWER_FIELDS =
  'is_normal,admin_closed_comment,reward_info,is_collapsed,annotation_action,annotation_detail,collapse_reason,collapsed_by,suggest_edit,' +
  'comment_count,can_comment,content,editable_content,attachment,voteup_count,favlists_count,reshipment_settings,comment_permission,created_time,' +
  'updated_time,review_info,relevant_info,question,excerpt,is_labeled,paid_info,paid_info_content,reaction_instruction,' +
  'relationship.is_authorized,is_author,voting,is_thanked,is_nothelp'
const ANSWER_LIST_INCLUDE = `data[*].${ANSWER_FIELDS};data[*].author.follower_count,vip_info,badge[*].topics;data[*].settings.table_of_content.enabled`
const ARTICLE_LIST_INCLUDE = 'data[*].comment_count,suggest_edit,is_normal,thumbnail_extra_info,thumbnail,can_comment,comment_permission,admin_closed_comment,content,voteup_count,favlists_count,created,updated,upvoted_followees,voting,review_info,reaction_instruction,is_labeled,label_info;data[*].vessay_info;data[*].author.badge[?(type=best_answerer)].topics;data[*].author.vip_info;'
const MEMBER_INCLUDE = 'allow_message,is_followed,is_following,is_org,is_blocking,employments,answer_count,follower_count,following_count,articles_count,voteup_count,gender,badge[?(type=best_answerer)].topics'
const MEMBER_LIST_INCLUDE = 'data[*].answer_count,articles_count,gender,follower_count,is_followed,is_following,badge[?(type=best_answerer)].topics'
const ME_INCLUDE = 'is_realname,ad_type,available_message_types,default_notifications_count,follow_notifications_count,vote_thank_notifications_count,messages_count,account_status,is_bind_phone,following_question_count,is_force_renamed,renamed_fullname'
const QUESTION_INCLUDE = 'read_count,answer_count,comment_count,follower_count,detail,excerpt,author,created,updated_time,visit_count,topics'
const COLLECTION_INCLUDE = 'data[*].updated_time,answer_count,follower_count,creator,description,is_following,comment_count,created_time'

const people = (token: string) => `${WWW}/people/${token}`

/** 列表接口：第一页用 path + query，之后用 cursor（上一页的 paging.next，带完整 query）原样请求。 */
function list(z: Zhihu, path: string, cursor: string | null, query: PairsInit, referer: string): Promise<ListBody> {
  return cursor ? z.api(cursor, { referer }) : z.api(path, { query, referer })
}

// ---------------------------------------------------------------- 账号

export interface Me {
  id: string
  url_token: string
  name: string
  [key: string]: any
}

export function me(z: Zhihu): Promise<Me> {
  return z.api('/api/v4/me', { query: { include: ME_INCLUDE } })
}

// ---------------------------------------------------------------- 用户

export function member(z: Zhihu, token: string): Promise<any> {
  return z.api(`/api/v4/members/${encodeURIComponent(token)}`, { query: { include: MEMBER_INCLUDE }, referer: people(token) })
}

export function memberAnswers(z: Zhihu, token: string, sortBy: 'created' | 'voteups', cursor: string | null): Promise<ListBody> {
  const path = `/api/v4/members/${encodeURIComponent(token)}/answers`
  return list(z, path, cursor, [['include', ANSWER_LIST_INCLUDE], ['offset', 0], ['limit', PAGE_SIZE], ['sort_by', sortBy]], `${people(token)}/answers`)
}

export function memberArticles(z: Zhihu, token: string, sortBy: 'created' | 'voteups', cursor: string | null): Promise<ListBody> {
  const path = `/api/v4/members/${encodeURIComponent(token)}/articles`
  return list(z, path, cursor, [['include', ARTICLE_LIST_INCLUDE], ['offset', 0], ['limit', PAGE_SIZE], ['sort_by', sortBy]], `${people(token)}/posts`)
}

/** 粉丝（followers）与关注（followees）。 */
export function memberRelations(z: Zhihu, token: string, kind: 'followers' | 'followees', cursor: string | null): Promise<ListBody> {
  const path = `/api/v4/members/${encodeURIComponent(token)}/${kind}`
  const page = kind === 'followers' ? 'followers' : 'following'
  return list(z, path, cursor, [['include', MEMBER_LIST_INCLUDE], ['offset', 0], ['limit', PAGE_SIZE]], `${people(token)}/${page}`)
}

/** 关注（POST）/ 取消关注（DELETE）。 */
export function follow(z: Zhihu, token: string, on: boolean): Promise<any> {
  return z.api(`/api/v4/members/${encodeURIComponent(token)}/followers`, { method: on ? 'POST' : 'DELETE', referer: people(token) })
}

// ---------------------------------------------------------------- 内容

export function answer(z: Zhihu, id: string): Promise<any> {
  return z.api(`/api/v4/answers/${id}`, { query: { include: ANSWER_FIELDS }, referer: `${WWW}/answer/${id}` })
}

export function article(z: Zhihu, id: string): Promise<any> {
  return z.api(`/api/v4/articles/${id}`, { referer: `${ZHUANLAN}/p/${id}` })
}

export function pin(z: Zhihu, id: string): Promise<any> {
  return z.api(`/api/v4/pins/${id}`, { referer: `${WWW}/pin/${id}` })
}

/** 赞同：回答是 `{type: up|neutral}`，文章是 `{voting: 1|0}`，想法见 votePin。 */
export function voteAnswer(z: Zhihu, id: string, up: boolean): Promise<any> {
  return z.api(`/api/v4/answers/${id}/voters`, { method: 'POST', json: { type: up ? 'up' : 'neutral' }, referer: `${WWW}/answer/${id}` })
}

export function voteArticle(z: Zhihu, id: string, up: boolean): Promise<any> {
  return z.api(`/api/v4/articles/${id}/voters`, { method: 'POST', json: { voting: up ? 1 : 0 }, referer: `${ZHUANLAN}/p/${id}` })
}

/** 想法的赞同：POST 赞同、DELETE 取消，请求体相同。 */
export function votePin(z: Zhihu, id: string, up: boolean): Promise<any> {
  return z.api(`/api/v4/pins/${id}/voters/up`, { method: up ? 'POST' : 'DELETE', json: { not_sync_moments: true }, referer: `${WWW}/pin/${id}` })
}

// ---------------------------------------------------------------- 问题

export function question(z: Zhihu, id: string): Promise<any> {
  return z.api(`/api/v4/questions/${id}`, { query: { include: QUESTION_INCLUDE }, referer: `${WWW}/question/${id}` })
}

/** 问题下的回答：`order` 为 default（默认排序）或 updated（按时间）。 */
export function questionFeeds(z: Zhihu, id: string, order: 'default' | 'updated', cursor: string | null): Promise<ListBody> {
  const path = `/api/v4/questions/${id}/feeds`
  return list(z, path, cursor, [['include', ANSWER_LIST_INCLUDE], ['limit', 5], ['offset', 0], ['order', order], ['platform', 'desktop']], `${WWW}/question/${id}`)
}

// ---------------------------------------------------------------- 评论

/**
 * 一级评论：`type` 为 answers / articles / pins；`order` 为 score（按热度，网页默认）或 ts（按时间）。
 * 按热度只能翻到前两百条左右，按时间可以翻到底。
 */
export function rootComments(z: Zhihu, type: string, id: string, order: 'score' | 'ts', cursor: string | null): Promise<ListBody> {
  const path = `/api/v4/comment_v5/${type}/${id}/root_comment`
  return list(z, path, cursor, [['order_by', order], ['limit', PAGE_SIZE], ['offset', '']], `${WWW}/`)
}

export function childComments(z: Zhihu, commentId: string, cursor: string | null): Promise<ListBody> {
  const path = `/api/v4/comment_v5/comment/${commentId}/child_comment`
  return list(z, path, cursor, [['order_by', 'ts'], ['limit', PAGE_SIZE], ['offset', '']], `${WWW}/`)
}

// ---------------------------------------------------------------- 搜索

export interface SearchFilter {
  sort?: string
  time?: string
  vertical?: string
}

/**
 * 综合搜索 `t=general`，用户 `t=people`，话题 `t=topic`。
 * 带筛选时前端把 search_source 换成 Filter，后面依次跟 vertical、sort、time_interval（取值见 /api/v4/search/customize）；
 * 不换的话筛选会被忽略。
 */
export function search(z: Zhihu, t: 'general' | 'people' | 'topic', q: string, cursor: string | null, filter: SearchFilter = {}): Promise<ListBody> {
  const query: [string, string | number][] = [
    ['gk_version', 'gz-gaokao'],
    ['t', t],
    ['q', q],
    ['correction', 1],
    ['offset', 0],
    ['limit', PAGE_SIZE],
    ['filter_fields', ''],
    ['lc_idx', 0],
    ['show_all_topics', 0],
  ]
  const filters: [string, string][] = (
    [
      ['vertical', filter.vertical],
      ['sort', filter.sort],
      ['time_interval', filter.time],
    ] as [string, string | undefined][]
  ).filter((f): f is [string, string] => Boolean(f[1]))
  query.push(['search_source', filters.length ? 'Filter' : 'Normal'], ...filters)
  const referer = `${WWW}/search?type=content&q=${encodeURIComponent(q)}`
  return list(z, '/api/v4/search_v3', cursor, query, referer)
}

export function suggest(z: Zhihu, q: string): Promise<{ suggest?: any[] }> {
  return z.api('/api/v4/search/suggest', { query: { q } })
}

export function topSearch(z: Zhihu): Promise<{ top_search?: { words?: any[] } }> {
  return z.api('/api/v4/search/top_search')
}

// ---------------------------------------------------------------- 首页流

export function recommend(z: Zhihu, cursor: string | null): Promise<ListBody> {
  const query: PairsInit = [['action', 'down'], ['ad_interval', -10], ['after_id', 0], ['desktop', 'true'], ['page_number', 1]]
  return list(z, '/api/v3/feed/topstory/recommend', cursor, query, `${WWW}/`)
}

export function hotList(z: Zhihu): Promise<ListBody> {
  return z.api('/api/v3/feed/topstory/hot-lists/total', { query: [['limit', 50], ['desktop', 'true']], referer: `${WWW}/hot` })
}

export function moments(z: Zhihu, cursor: string | null): Promise<ListBody> {
  return list(z, '/api/v3/moments', cursor, [['limit', 10], ['desktop', 'true']], `${WWW}/follow`)
}

// ---------------------------------------------------------------- 收藏夹

export function collections(z: Zhihu, token: string, cursor: string | null): Promise<ListBody> {
  const path = `/api/v4/people/${encodeURIComponent(token)}/collections`
  return list(z, path, cursor, [['include', COLLECTION_INCLUDE], ['offset', 0], ['limit', PAGE_SIZE]], `${people(token)}/collections`)
}

export function collectionItems(z: Zhihu, id: string, cursor: string | null): Promise<ListBody> {
  return list(z, `/api/v4/collections/${id}/items`, cursor, [['offset', 0], ['limit', PAGE_SIZE]], `${WWW}/collection/${id}`)
}
