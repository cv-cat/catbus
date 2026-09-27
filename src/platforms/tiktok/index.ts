import { filter, PRODUCT } from '../../core/options.js'
import { type CommandDecl, definePlatform, type Handler, type Upstream } from '../../core/registry.js'

type Commands = typeof import('./web/commands.js')

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const h =
  (name: keyof Commands) =>
  (): Promise<Handler> =>
    import('./web/commands.js').then((m) => m[name] as Handler)

const impl = (upstream: Upstream, name: keyof Commands, extra: Partial<CommandDecl> = {}): CommandDecl => ({ upstream, handler: h(name), ...extra })

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
        'item publish': impl('full', 'itemPublish'),
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
        'live list': impl('full', 'liveList'),
        'live search': impl('full', 'liveSearch'),
        'live categories': impl('full', 'liveCategories'),
        'live listen': impl('full', 'liveListen'),
        'live history': impl('partial', 'liveHistory'),
        'live send': impl('partial', 'liveSend', { note: '--gift 规划中' }),
        'live like': impl('full', 'liveLike'),
        'live rank': impl('full', 'liveRank'),
        'live gifts': impl('full', 'liveGifts'),
        'live products': 'none',
        'live media': 'none',
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
        'folder create': impl('partial', 'folderCreate'),
        'folder update': impl('partial', 'folderUpdate'),
        // 上游没有删除收藏夹的接口
        'folder delete': 'none',

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
