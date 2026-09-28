import { createHash } from 'node:crypto'
import { CatbusError } from '../../../core/errors.js'
import type { HeaderPairs } from '../../../core/http.js'
import { compactJson, type Pairs, quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { multipartMedia, type XClient } from './client.js'
import { API_X, fetchHeaders, PUBLIC_BEARER, UPLOAD_HOST, X_HOST } from './profile.js'
import { parseScreenName, parseTweetId } from './resolve.js'

/**
 * 上游 x_apis/*.py 的请求构造，一个函数对应一个上游方法；variables / 字段顺序照抄（对拍逐字节比较）。
 * 键序影响序列化结果，所以 variables 一律用 Map。
 */

const V = (entries: [string, unknown][]) => new Map(entries)

// ================================================================ 读接口（XAPI）

/** 推文详情，含评论区首屏；cursor 翻评论。上游 get_work_info / get_work_comments（TweetDetail）。 */
export function getWorkInfo(x: XClient, workId: string, cursor?: string, referrer?: string) {
  const tweetId = parseTweetId(workId)
  let entries: [string, unknown][] = [
    ['focalTweetId', tweetId],
    ['with_rux_injections', false],
    ['rankingMode', 'Relevance'],
    ['includePromotedContent', true],
    ['withCommunity', true],
    ['withQuickPromoteEligibilityTweetFields', true],
    ['withBirdwatchNotes', true],
    ['withVoice', true],
  ]
  // 从某个页面点进详情时，referrer 紧跟在 focalTweetId 之后
  if (referrer) entries = [entries[0]!, ['referrer', referrer], ...entries.slice(1)]
  if (cursor) entries.push(['cursor', cursor])
  return x.graphqlGet('TweetDetail', V(entries), { referer: `${X_HOST}/i/status/${tweetId}` })
}

/** 详情页伴随的补水请求，游客可用。上游 get_work_result（TweetResultByRestId）。 */
export function getWorkResult(x: XClient, workId: string) {
  const tweetId = parseTweetId(workId)
  return x.graphqlGet(
    'TweetResultByRestId',
    V([
      ['tweetId', tweetId],
      ['includePromotedContent', true],
      ['withBirdwatchNotes', true],
      ['withVoice', true],
      ['withCommunity', true],
    ]),
    { referer: `${X_HOST}/i/status/${tweetId}` },
  )
}

/** 搜索。product：Top / Latest / People / Media / Lists。上游 search_work（SearchTimeline，POST）。 */
export function searchWork(x: XClient, query: string, cursor?: string, product = 'Top', count = 20) {
  const entries: [string, unknown][] = [['rawQuery', query], ['count', count]]
  // 浏览器把 cursor 放在 count 之后、querySource 之前
  if (cursor) entries.push(['cursor', cursor])
  entries.push(['querySource', 'typed_query'], ['product', product], ['withGrokTranslatedBio', true], ['withQuickPromoteEligibilityTweetFields', false])
  return x.graphqlPostQuery('SearchTimeline', V(entries), { referer: `${X_HOST}/search?q=${quote(query)}&src=typed_query` })
}

/** 按 screen_name 取用户信息，接受主页链接、@handle 或裸用户名。上游 get_user_info（UserByScreenName）。 */
export function getUserInfo(x: XClient, userName: string) {
  const screenName = parseScreenName(userName)
  return x.graphqlGet('UserByScreenName', V([['screen_name', screenName], ['withGrokTranslatedBio', true]]), { referer: `${X_HOST}/${screenName}` })
}

/**
 * 按数字用户 ID 取用户信息（UserByRestId）。上游没有这个方法，是 catbus 为「输出的 id 可以直接作为参数」
 * 补的：走上游 graphql_get，variables 照 UserByScreenName 的形状，fieldToggles 用注册表全集。
 */
export function getUserById(x: XClient, userId: string) {
  return x.graphqlGet('UserByRestId', V([['userId', userId], ['withGrokTranslatedBio', true]]), { referer: `${X_HOST}/i/user/${userId}` })
}

/**
 * 用户发布的推文。userId 是数字 rest_id。上游 get_user_post_note：默认 UserOriginalsTimeline（登录后
 * 主页 Posts 标签），UserTweets 是老操作（未登录的主页用它）。
 */
export function getUserPostNote(x: XClient, userId: string, cursor?: string, count = 20, operation = 'UserOriginalsTimeline') {
  const entries: [string, unknown][] = [['userId', userId], ['count', count]]
  if (cursor) entries.push(['cursor', cursor])
  entries.push(['includePromotedContent', true], ['withQuickPromoteEligibilityTweetFields', true], ['withVoice', true])
  return x.graphqlGet(operation, V(entries))
}

/** 主页推荐流。冷启动 GET（没有 seenTweetIds 键），有已读记录时 POST。上游 get_home_timeline。 */
export function getHomeTimeline(x: XClient, cursor?: string, count = 20, seenTweetIds: string[] = []) {
  const entries: [string, unknown][] = [['count', count]]
  if (cursor) entries.push(['cursor', cursor])
  entries.push(['includePromotedContent', true])
  if (!cursor) entries.push(['requestContext', 'launch'])
  entries.push(['withCommunity', true])
  if (!seenTweetIds.length) return x.graphqlGet('HomeTimeline', V(entries))
  entries.push(['seenTweetIds', seenTweetIds])
  return x.graphqlPostQuery('HomeTimeline', V(entries))
}

/** 当前会话身份，用来判断 cookie 是否还活着。上游 get_viewer（Viewer）。 */
export function getViewer(x: XClient) {
  return x.graphqlGet('Viewer', V([['withCommunitiesMemberships', true]]))
}

// ================================================================ 写接口（XWriteAPI）

/** CreateTweet / CreateNoteTweet 共用的 variables，两者逐字段相同。上游 _tweet_variables。 */
function tweetVariables(text: string, mediaIds: string[], replyTo?: string, quoteUrl?: string, excludeReplyUserIds: string[] = []) {
  const entries: [string, unknown][] = [
    ['tweet_text', text],
    ['media', { media_entities: mediaIds.map((id) => ({ media_id: String(id), tagged_users: [] })), possibly_sensitive: false }],
    ['semantic_annotation_ids', []],
    ['disallowed_reply_options', null],
    ['semantic_annotation_options', { source: 'UniversalLink' }],
  ]
  if (replyTo) entries.push(['reply', { in_reply_to_tweet_id: parseTweetId(replyTo), exclude_reply_user_ids: excludeReplyUserIds }])
  if (quoteUrl) entries.push(['attachment_url', quoteUrl])
  return V(entries)
}

/** 发推；replyTo 给出即为回复，quoteUrl 给出即为引用。上游 create_tweet（CreateTweet）。 */
export function createTweet(x: XClient, text: string, mediaIds: string[] = [], replyTo?: string, quoteUrl?: string, excludeReplyUserIds: string[] = []) {
  // 浏览器打开 compose/post 后，真正提交请求的来源仍是 /home
  return x.graphqlPost('CreateTweet', tweetVariables(text, mediaIds, replyTo, quoteUrl, excludeReplyUserIds), { referer: `${X_HOST}/home` })
}

/**
 * 长推（Premium，权重 > 280）：网页端正文超长时发帖按钮提交的是 CreateNoteTweet，variables 与 CreateTweet 相同。
 * 非 Premium 账号会被服务端拒绝。上游 create_note_tweet。
 */
export function createNoteTweet(x: XClient, text: string, mediaIds: string[] = [], replyTo?: string, quoteUrl?: string, excludeReplyUserIds: string[] = []) {
  return x.graphqlPost('CreateNoteTweet', tweetVariables(text, mediaIds, replyTo, quoteUrl, excludeReplyUserIds), { referer: `${X_HOST}/home` })
}

/** 普通推的权重上限（上游 TWEET_WEIGHT_LIMIT）。 */
export const TWEET_WEIGHT_LIMIT = 280
const URL_WEIGHT = 23
const LIGHT_RANGES: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
]
/** Python `re` 的 `\s`（str.isspace 的全集），与 JS 的 `\s` 不同：多了 0x1c-0x1f、0x85，少了 0xfeff。 */
const PY_SPACE = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
/** 链接：遇到空白、CJK 标点或全角字符即结束（上游 _URL_RE，IGNORECASE）。 */
const URL_RE = new RegExp(`https?://[^${PY_SPACE}\\u3000-\\u303f\\uff00-\\uffef]+`, 'giu')
/** emoji 序列里不单独计数的码点：ZWJ、变体选择符、keycap；肤色修饰另判。 */
const EMOJI_JOINERS = new Set([0x200d, 0xfe0e, 0xfe0f, 0x20e3])

function plainWeight(text: string): number {
  let weight = 0
  let joined = false
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (EMOJI_JOINERS.has(cp) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) {
      // ZWJ 之后紧跟的码点属于同一个 emoji，不再计数
      joined = cp === 0x200d
      continue
    }
    if (joined) {
      joined = false
      continue
    }
    weight += LIGHT_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2
  }
  return weight
}

/** 按 twitter-text v3 规则计算推文权重：拉丁和常用标点算 1，其余（CJK、emoji）算 2，链接一律 23。上游 tweet_weight。 */
export function tweetWeight(text: string): number {
  const s = text ?? ''
  let weight = 0
  let cursor = 0
  for (const m of s.matchAll(URL_RE)) {
    weight += plainWeight(s.slice(cursor, m.index)) + URL_WEIGHT
    cursor = m.index + m[0].length
  }
  return weight + plainWeight(s.slice(cursor))
}

/** 发一条推：权重超过 280 自动改发长推。上游 post_tweet 的 note=None 分支（媒体已传好）。 */
export function postTweet(x: XClient, text: string, mediaIds: string[] = [], replyTo?: string, quoteUrl?: string) {
  const create = tweetWeight(text) > TWEET_WEIGHT_LIMIT ? createNoteTweet : createTweet
  return create(x, text, mediaIds, replyTo, quoteUrl)
}

/** CreateTweet 响应里的新推文对象（长推文在 notetweet_create 下）。上游 extract_tweet_id 的取值路径。 */
export function createdTweet(res: any): any {
  const data = res?.data ?? {}
  for (const key of ['create_tweet', 'notetweet_create']) {
    const result = data[key]?.tweet_results?.result
    if (result) return result
  }
  throw new CatbusError('UPSTREAM', 'CreateTweet 响应里没有新推文', { detail: res })
}

export function deleteTweet(x: XClient, workId: string) {
  return x.graphqlPost('DeleteTweet', V([['tweet_id', parseTweetId(workId)]]))
}

export function favoriteTweet(x: XClient, workId: string) {
  return x.graphqlPost('FavoriteTweet', V([['tweet_id', parseTweetId(workId)]]))
}

export function unfavoriteTweet(x: XClient, workId: string) {
  return x.graphqlPost('UnfavoriteTweet', V([['tweet_id', parseTweetId(workId)]]))
}

export function createRetweet(x: XClient, workId: string) {
  return x.graphqlPost('CreateRetweet', V([['tweet_id', parseTweetId(workId)], ['dark_request', false]]))
}

export function deleteRetweet(x: XClient, workId: string) {
  return x.graphqlPost('DeleteRetweet', V([['source_tweet_id', parseTweetId(workId)], ['dark_request', false]]))
}

export function createBookmark(x: XClient, workId: string) {
  return x.graphqlPost('CreateBookmark', V([['tweet_id', parseTweetId(workId)]]))
}

export function deleteBookmark(x: XClient, workId: string) {
  return x.graphqlPost('DeleteBookmark', V([['tweet_id', parseTweetId(workId)]]))
}

const FRIENDSHIP_FIELDS: Pairs = [
  ['include_profile_interstitial_type', '1'],
  ['include_blocking', '1'],
  ['include_blocked_by', '1'],
  ['include_followed_by', '1'],
  ['include_want_retweets', '1'],
  ['include_mute_edge', '1'],
  ['include_can_dm', '1'],
  ['include_can_media_tag', '1'],
  ['skip_status', '1'],
]

export function followUser(x: XClient, userId: string) {
  return x.restPost('/friendships/create.json', [...FRIENDSHIP_FIELDS, ['user_id', userId]])
}

export function unfollowUser(x: XClient, userId: string) {
  return x.restPost('/friendships/destroy.json', [...FRIENDSHIP_FIELDS, ['user_id', userId]])
}

// ================================================================ 媒体上传（XMediaAPI）

const UPLOAD_URL = `${UPLOAD_HOST}/i/media/upload.json`
const METADATA_PATH = '/i/api/1.1/media/metadata/create.json'
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
}
const CATEGORY_BY_MIME: Record<string, string> = { 'image/gif': 'tweet_gif', 'video/mp4': 'tweet_video', 'video/quicktime': 'tweet_video' }
/** 单片 4MB。 */
export const CHUNK_SIZE = 4 * 1024 * 1024
const PROCESSING_TIMEOUT = 180_000

/** 按扩展名猜 MIME，猜不出按 image/jpeg（上游 guess_media_type）。 */
export function guessMediaType(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return MIME_BY_EXT[dot < 0 ? '' : filename.slice(dot + 1).toLowerCase()] ?? 'image/jpeg'
}

export function guessMediaCategory(mediaType: string): string {
  return CATEGORY_BY_MIME[mediaType] ?? 'tweet_image'
}

/** upload.x.com 的头：不带 XCTID / client-language / active-user（上游 _upload_headers）。 */
function uploadHeaders(x: XClient): HeaderPairs {
  return x.buildHeaders('UPLOAD', UPLOAD_URL, { referer: `${X_HOST}/`, origin: X_HOST })
}

/** 申请 media_id，参数走 query string。上游 XMediaAPI.init。 */
export async function mediaInit(x: XClient, totalBytes: number, mediaType: string, mediaCategory?: string): Promise<string> {
  const query: Pairs = [
    ['command', 'INIT'],
    ['total_bytes', String(totalBytes)],
    ['media_type', mediaType],
    ['media_category', mediaCategory ?? guessMediaCategory(mediaType)],
  ]
  const res = await x.request({ method: 'POST', url: UPLOAD_URL, query, headers: uploadHeaders(x) })
  return (await x.checkJson<{ media_id_string: string }>(res)).media_id_string
}

/** 上传一个分片：命令走 query，分片数据走 multipart。上游 XMediaAPI.append。 */
export async function mediaAppend(x: XClient, mediaId: string, chunk: Uint8Array, segmentIndex: number): Promise<void> {
  const res = await x.request({
    method: 'POST',
    url: UPLOAD_URL,
    query: [['command', 'APPEND'], ['media_id', mediaId], ['segment_index', String(segmentIndex)]],
    headers: uploadHeaders(x),
    multipart: [multipartMedia(chunk)],
  })
  await x.checkOk(res)
}

/** 收尾，带整个文件的 md5。上游 XMediaAPI.finalize。 */
export async function mediaFinalize(x: XClient, mediaId: string, originalMd5?: string): Promise<any> {
  const query: Pairs = [['command', 'FINALIZE'], ['media_id', mediaId]]
  if (originalMd5) query.push(['original_md5', originalMd5])
  return x.checkJson(await x.request({ method: 'POST', url: UPLOAD_URL, query, headers: uploadHeaders(x) }))
}

/** 查询转码状态。上游 XMediaAPI.status。 */
export async function mediaStatus(x: XClient, mediaId: string): Promise<any> {
  const res = await x.request({ method: 'GET', url: UPLOAD_URL, query: [['command', 'STATUS'], ['media_id', mediaId]], headers: uploadHeaders(x) })
  return x.checkJson(res)
}

/** 登记媒体的下载权限元数据（FINALIZE 之后、发推之前），响应为空。上游 XMediaAPI.metadata_create。 */
export async function mediaMetadataCreate(x: XClient, mediaId: string, allowDownload = true, referer = `${X_HOST}/home`): Promise<void> {
  const url = `${X_HOST}${METADATA_PATH}`
  const res = await x.request({
    method: 'POST',
    url,
    json: new Map<string, unknown>([
      ['media_id', String(mediaId)],
      ['allow_download_status', { allow_download: allowDownload ? 'true' : 'false' }],
    ]),
    headers: x.buildHeaders('GRAPHQL', url, { xctid: x.transactionId('POST', METADATA_PATH), referer }),
  })
  await x.checkOk(res)
}

/** 视频要等服务端转码完成才能发推；图片没有 processing_info，直接返回。上游 XMediaAPI.wait_processing。 */
export async function waitProcessing(x: XClient, mediaId: string, finalizeResult: any): Promise<any> {
  let result = finalizeResult
  let info = result?.processing_info
  const deadline = rand.now() + PROCESSING_TIMEOUT
  while (info && (info.state === 'pending' || info.state === 'in_progress')) {
    if (rand.now() > deadline) throw new CatbusError('UPSTREAM', `媒体 ${mediaId} 转码超时`)
    await rand.sleep(Math.max(Number(info.check_after_secs ?? 1), 1) * 1000)
    result = await mediaStatus(x, mediaId)
    info = result?.processing_info
  }
  if (info?.state === 'failed') throw new CatbusError('UPSTREAM', `媒体 ${mediaId} 转码失败`, { detail: info.error ?? info })
  return result
}

/**
 * 完整上传一个文件，返回 media_id 和 FINALIZE / STATUS 的结果。上游 XMediaAPI.upload。
 * withMetadata 为 false 时 FINALIZE 之后就结束，不登记元数据（文章编辑器的封面 / 插图就是这样）。
 */
export async function upload(
  x: XClient,
  data: Uint8Array,
  filename: string,
  options: { mediaCategory?: string; withMetadata?: boolean } = {},
): Promise<{ mediaId: string; mediaType: string; result: any }> {
  const mediaType = guessMediaType(filename)
  const mediaId = await mediaInit(x, data.length, mediaType, options.mediaCategory)
  for (let index = 0, offset = 0; offset < data.length; index++, offset += CHUNK_SIZE) {
    await mediaAppend(x, mediaId, data.subarray(offset, offset + CHUNK_SIZE), index)
  }
  const finalized = await mediaFinalize(x, mediaId, createHash('md5').update(data).digest('hex'))
  const result = await waitProcessing(x, mediaId, finalized)
  if (options.withMetadata !== false) await mediaMetadataCreate(x, mediaId)
  return { mediaId, mediaType, result }
}

// ================================================================ 文章（XArticleAPI）

const COMPOSE_URL = `${X_HOST}/compose/articles`
/** 文章草稿的编辑页，也是这组请求的 referer。 */
export const articleEditUrl = (articleId: string) => `${COMPOSE_URL}/edit/${articleId}`

/** 新建草稿：浏览器点「新建」时发的是空标题 + 空正文。上游 create_draft（ArticleEntityDraftCreate）。 */
export function articleCreateDraft(x: XClient) {
  return x.graphqlPost('ArticleEntityDraftCreate', V([['content_state', { blocks: [], entity_map: [] }], ['title', '']]), { referer: COMPOSE_URL })
}

/**
 * 从任意 ArticleEntity* 响应里取出文章 rest_id。建草稿的结果包了一层 article_entity_results.result；
 * `id` 是 relay 全局 id：base64("ArticleEntity:<rest_id>")。上游 extract_article_id。
 */
export function extractArticleId(res: any): string {
  for (const value of Object.values(res?.data ?? {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const v = value as any
    const result = v.article_entity_results?.result ?? v
    if (result?.rest_id) return String(result.rest_id)
    if (result?.id) return Buffer.from(String(result.id), 'base64').toString('utf8').split(':').slice(1).join(':')
  }
  throw new CatbusError('UPSTREAM', '响应里没有文章 id', { detail: res })
}

/** 改标题。上游 update_title（ArticleEntityUpdateTitle）。 */
export function articleUpdateTitle(x: XClient, articleId: string, title: string) {
  return x.graphqlPost('ArticleEntityUpdateTitle', V([['articleEntityId', String(articleId)], ['title', title]]), { referer: articleEditUrl(articleId) })
}

/** 整篇覆盖正文；这里文章 id 的键名是 `article_entity`。上游 update_content（ArticleEntityUpdateContent）。 */
export function articleUpdateContent(x: XClient, articleId: string, contentState: unknown) {
  return x.graphqlPost('ArticleEntityUpdateContent', V([['content_state', contentState], ['article_entity', String(articleId)]]), {
    referer: articleEditUrl(articleId),
  })
}

/** 文章图片的 media_category（封面和正文插图都是它）。上游 MEDIA_CATEGORY。 */
export const ARTICLE_MEDIA_CATEGORY = 'DraftTweetImage'

/** 设封面，编辑器建议 5:2。上游 update_cover（ArticleEntityUpdateCoverMedia）。 */
export function articleUpdateCover(x: XClient, articleId: string, mediaId: string) {
  return x.graphqlPost(
    'ArticleEntityUpdateCoverMedia',
    V([
      ['articleEntityId', String(articleId)],
      ['coverMedia', { media_id: String(mediaId), media_category: ARTICLE_MEDIA_CATEGORY }],
    ]),
    { referer: articleEditUrl(articleId) },
  )
}

/**
 * 发布草稿，同时生成一条带文章卡片的推文。说明文字（tweetText）为空时浏览器不带这个键；
 * 谁可以回复默认所有人，也不带 conversationControl。上游 publish（ArticleEntityPublish）。
 */
export function articlePublish(x: XClient, articleId: string, visibility = 'Public') {
  return x.graphqlPost('ArticleEntityPublish', V([['articleEntityId', String(articleId)], ['visibilitySetting', visibility]]), { referer: articleEditUrl(articleId) })
}

/** 发布响应里那条文章推文的 id。上游 XArticleAPI.extract_tweet_id。 */
export function articleTweetId(res: any): string | null {
  const id = res?.data?.articleentity_publish?.article_entity_results?.result?.metadata?.tweet_results?.result?.rest_id
  return id == null ? null : String(id)
}

/** 删除草稿或已发布文章（不可撤销），已发布的连同文章推文一起消失。上游 delete（ArticleEntityDelete）。 */
export function articleDelete(x: XClient, articleId: string) {
  return x.graphqlPost('ArticleEntityDelete', V([['articleEntityId', String(articleId)]]), { referer: articleEditUrl(articleId) })
}

/** 文章封面 / 插图上传：与发推同一套分片上传，但不登记元数据。上游 upload_image。 */
export async function articleUploadImage(x: XClient, data: Uint8Array, filename: string): Promise<string> {
  return (await upload(x, data, filename, { withMetadata: false })).mediaId
}

// ================================================================ 私信（XChatAPI）

const MEMBERS_QID = '4zbPmRwsca859ORbYCLyzg'
const INITIAL_PAGE_QID = 'm1gzpOV8JFOTaFH0Xq7lMQ'
const CONVERSATION_PAGE_QID = 'GX9ZijkxG8AqRMQVD7hMnQ'
const DEFAULT_QUERY_SETTINGS = { conversation_event_limit: 200, inbox_conversation_event_limit: 5, inbox_conversation_limit: 20, user_event_limit: 500 }

/**
 * api.x.com 上 X Chat 请求的头（上游 _external_headers 的排列）：
 * authorization, x-csrf-token, referer, [apollo-require-preflight], x-client-transaction-id,
 * [x-twitter-auth-type], accept, [content-type], origin，再接浏览器 fetch 头（accept 已显式给出）。
 */
function chatHeaders(x: XClient, path: string, options: { contentType?: string; apollo?: boolean } = {}): HeaderPairs {
  const h: HeaderPairs = [
    ['authorization', PUBLIC_BEARER],
    ['x-csrf-token', x.ct0],
    ['referer', `${X_HOST}/`],
  ]
  if (options.apollo) h.push(['apollo-require-preflight', 'true'])
  h.push(['x-client-transaction-id', x.transactionId(options.contentType ? 'POST' : 'GET', path)])
  if (x.isLoggedIn) h.push(['x-twitter-auth-type', 'OAuth2Session'])
  h.push(['accept', 'application/json'])
  if (options.contentType) h.push(['content-type', options.contentType])
  h.push(['origin', X_HOST])
  return [...h, ...fetchHeaders(`${API_X}${path}`).filter(([k]) => k !== 'accept')]
}

async function chatQuery(x: XClient, path: string, variables: unknown): Promise<any> {
  const res = await x.request({ method: 'GET', url: `${API_X}${path}`, query: [['variables', compactJson(variables)]], headers: chatHeaders(x, path, { apollo: true }) })
  return x.checkJson(res)
}

/** X Chat 收件箱初始页。上游 get_initial_chat_page。 */
export function getInitialChatPage(x: XClient): Promise<any> {
  return chatQuery(x, `/graphql/${INITIAL_PAGE_QID}/GetInitialXChatPageQuery`, {
    max_local_sequence_id: null,
    query_settings: { ...DEFAULT_QUERY_SETTINGS },
    message_pull_version: null,
  })
}

/** X Chat 成员资料（名字、用户名）。上游 get_users_by_ids（GetUsersByIdsForXChat）。 */
export function getUsersByIds(x: XClient, userIds: string[]): Promise<any> {
  return chatQuery(x, `/graphql/${MEMBERS_QID}/GetUsersByIdsForXChat`, { ids: userIds.map(String), with_social_proof: false })
}

/** 单个会话页（不发送消息）。上游 get_conversation_page。 */
export function getConversationPage(x: XClient, conversationId: string): Promise<any> {
  return chatQuery(x, `/graphql/${CONVERSATION_PAGE_QID}/GetConversationPageQuery`, {
    conversation_id: String(conversationId),
    min_local_sequence_id: '9223372036854775807',
    min_conversation_key_version: '9223372036854775807',
    query_settings: { ...DEFAULT_QUERY_SETTINGS },
  })
}
