import { z } from 'zod'
import { filter, PRODUCT } from '../../core/options.js'
import { definePlatform, handlers } from '../../core/registry.js'

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const { h, impl } = handlers(() => import('./web/commands.js'))

/** 发布的互动开关（AGENTS 4.7）。不给时用上游的默认值，视频与图文不同。 */
const toggle = (what: string, dflt: string) => z.enum(['on', 'off']).optional().describe(`允许${what}，默认 ${dflt}`)
const PUBLISH_TOGGLES = {
  allowComment: toggle('评论', 'on'),
  allowDuet: toggle('合拍（Duet）', '视频 off、图文 on'),
  allowStitch: toggle('拼接（Stitch）', '视频 off、图文 on'),
  allowContentReuse: toggle('他人复用内容', 'on'),
  allowAiRemix: toggle('AI 改编', 'on'),
}

/** 收藏夹的公开 / 私密：沿用标准选项 --visibility 的名字与取值（AGENTS 4.9），没有 friends。 */
const FOLDER_VISIBILITY = z.enum(['public', 'private']).optional().describe('公开或私密；新建默认 private，修改时不给则不变')

export default definePlatform({
  id: 'tiktok',
  name: 'TikTok',
  aliases: ['tt'],
  item: '视频',
  endpoints: {
    web: {
      login: { methods: ['cookie'], default: 'cookie' },
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('partial', 'userGet', { note: 'me 部分支持' }),
        'user search': 'none',
        'user items': impl('full', 'userItems'),
        'user likes': 'none',
        'user collects': impl('full', 'userCollects'),
        'user reposts': impl('full', 'userReposts'),
        'user followers': impl('full', 'userFollowers'),
        'user following': impl('full', 'userFollowing'),
        'user follow': impl('full', 'userFollow'),
        'user unfollow': impl('full', 'userUnfollow'),

        'item get': impl('full', 'itemGet'),
        'item search': impl('full', 'itemSearch'),
        'item related': impl('full', 'itemRelated'),
        'item list': impl('full', 'itemList'),
        'item media': impl('partial', 'itemMedia'),
        'item download': impl('partial', 'itemDownload'),
        'item like': impl('full', 'itemLike'),
        'item unlike': impl('full', 'itemUnlike'),
        'item collect': impl('full', 'itemCollect'),
        'item uncollect': impl('full', 'itemUncollect'),
        'item repost': 'none',
        'item unrepost': 'none',
        'item publish': impl('full', 'itemPublish', {
          supports: ['text', 'image', 'video', 'cover', 'tag', 'topic', 'mention', 'visibility'],
          options: PUBLISH_TOGGLES,
        }),
        'item delete': 'none',

        'product get': impl('full', 'productGet'),

        'comment list': impl('full', 'commentList', { options: { product: PRODUCT } }),
        'comment replies': impl('full', 'commentReplies'),
        'comment add': impl('full', 'commentAdd'),
        'comment delete': 'none',
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': impl('full', 'feedList', { options: { kind: filter.kind('recommend', 'following') } }),
        // 上游没有推荐流分类接口
        'feed categories': 'none',

        'live get': impl('full', 'liveGet'),
        'live list': impl('full', 'liveList', { note: '只有关注的人里正在直播的（上游 get_webcast_feed 是直播页侧栏的关注列表）；没关注的人在播时为空' }),
        'live search': impl('full', 'liveSearch'),
        'live categories': impl('full', 'liveCategories'),
        'live listen': impl('full', 'liveListen'),
        'live history': impl('partial', 'liveHistory'),
        'live send': impl('partial', 'liveSend', { note: '--gift 规划中' }),
        'live like': impl('full', 'liveLike'),
        'live rank': impl('full', 'liveRank'),
        'live gifts': impl('full', 'liveGifts'),
        'live products': 'none',
        'live media': impl('partial', 'liveMedia', { note: '上游没有解析拉流地址：取自 /api-live/user/room 的 liveRoom.streamData，或 room/enter 的 stream_url' }),
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': impl('full', 'keywordSuggest'),
        'keyword hot': 'none',

        'notice list': impl('full', 'noticeList'),
        'notice count': impl('full', 'noticeCount'),

        'msg list': impl('full', 'msgList'),
        'msg history': impl('full', 'msgHistory'),
        'msg send': impl('partial', 'msgSend'),
        'msg listen': impl('full', 'msgListen'),
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'media upload': impl('full', 'mediaUpload'),

        'folder list': impl('full', 'folderList'),
        'folder items': impl('full', 'folderItems'),
        'folder create': impl('full', 'folderCreate', { options: { visibility: FOLDER_VISIBILITY } }),
        'folder update': impl('full', 'folderUpdate', {
          options: { name: z.string().optional().describe('新名字'), visibility: FOLDER_VISIBILITY },
          check: (_a, o) => (o.name == null && o.visibility == null ? '需要 --name 或 --visibility' : undefined),
        }),
        // 上游没有删除收藏夹的接口
        'folder delete': 'none',

        'folder add': impl('full', 'folderAdd', {
          summary: '把{item}加入收藏夹（只能加已收藏的{item}）',
          args: [
            { name: 'folder', summary: '收藏夹 ID' },
            { name: 'item', summary: '{item}：ID 或 URL' },
          ],
          output: '{id}',
          auth: 'required',
        }),

        'series list': impl('full', 'seriesList'),
        // 上游只有合集列表，没有合集内容接口
        'series items': 'none',

        'history list': 'none',
        'topic search': 'none',
        'poi search': impl('partial', 'poiSearch', { note: '在推荐地点里按关键词筛选' }),
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
