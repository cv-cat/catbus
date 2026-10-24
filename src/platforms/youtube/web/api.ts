import { playerBody, type YtClient } from './client.js'

/** 一个函数对应一个 InnerTube 接口（见 UPSTREAM）。 */

export function search(c: YtClient, query: string, params?: string) {
  return c.innertube('search', { query, ...(params ? { params } : {}) })
}

export function searchMore(c: YtClient, continuation: string) {
  return c.innertube('search', { continuation })
}

/** watch 页：推荐、评论入口、直播聊天入口。 */
export function next(c: YtClient, videoId: string) {
  return c.innertube('next', { videoId })
}

/** watch 页的翻页：评论、回复、推荐。 */
export function nextMore(c: YtClient, continuation: string) {
  return c.innertube('next', { continuation })
}

export function player(c: YtClient, videoId: string) {
  return c.innertube('player', playerBody(videoId))
}

export function browse(c: YtClient, browseId: string, params?: string) {
  return c.innertube('browse', { browseId, ...(params ? { params } : {}) })
}

export function browseMore(c: YtClient, continuation: string) {
  return c.innertube('browse', { continuation })
}

export function liveChat(c: YtClient, continuation: string) {
  return c.innertube('live_chat/get_live_chat', { continuation })
}

/** 头像菜单：登录后带当前账号的名字、@handle 和「你的频道」入口。 */
export function accountMenu(c: YtClient) {
  return c.innertube('account/account_menu', {})
}

/** 账号切换列表：每个账号带 obfuscatedGaiaId、是否有频道。 */
export function accountsList(c: YtClient) {
  return c.innertube('account/accounts_list', {})
}

// ---------------------------------------------------------------- 写操作（需要登录）

/** kind：like 点赞、removelike 取消点赞或点踩。 */
export function like(c: YtClient, kind: 'like' | 'removelike', videoId: string) {
  return c.innertube(`like/${kind}`, { target: { videoId } })
}

export function subscribe(c: YtClient, channelId: string) {
  return c.innertube('subscription/subscribe', { channelIds: [channelId] })
}

export function unsubscribe(c: YtClient, channelId: string) {
  return c.innertube('subscription/unsubscribe', { channelIds: [channelId] })
}

/** 播放列表增删视频：action 为 ACTION_ADD_VIDEO（addedVideoId）或 ACTION_REMOVE_VIDEO_BY_VIDEO_ID（removedVideoId）。 */
export function editPlaylist(c: YtClient, playlistId: string, actions: Record<string, string>[]) {
  return c.innertube('browse/edit_playlist', { playlistId, actions })
}

export function createComment(c: YtClient, commentText: string, createCommentParams: string) {
  return c.innertube('comment/create_comment', { commentText, createCommentParams })
}

export function createReply(c: YtClient, commentText: string, createReplyParams: string) {
  return c.innertube('comment/create_comment_reply', { commentText, createReplyParams })
}

export function commentAction(c: YtClient, actions: string[]) {
  return c.innertube('comment/perform_comment_action', { actions })
}
