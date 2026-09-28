import { z } from 'zod'
import { CATEGORY, filter, PRODUCT } from '../../core/options.js'
import { type CommandDecl, definePlatform, type Handler, type Upstream } from '../../core/registry.js'

type Commands = typeof import('./web/commands.js')

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const h =
  (name: keyof Commands) =>
  (): Promise<Handler> =>
    import('./web/commands.js').then((m) => m[name] as Handler)

const impl = (upstream: Upstream, name: keyof Commands, extra: Partial<CommandDecl> = {}): CommandDecl => ({ upstream, handler: h(name), ...extra })

export default definePlatform({
  id: 'xhs',
  name: '小红书',
  aliases: ['xiaohongshu', 'rednote'],
  item: '笔记',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'cookie'], default: 'qrcode', scopes: ['creator'] },
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('full', 'userGet'),
        'user search': impl('full', 'userSearch'),
        'user items': impl('full', 'userItems'),
        'user likes': impl('full', 'userLikes'),
        'user collects': impl('full', 'userCollects'),
        'user followers': 'none',
        'user following': impl('partial', 'userFollowing', { note: '只支持 me' }),
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': impl('full', 'itemGet'),
        'item search': impl('full', 'itemSearch', {
          options: {
            sort: filter.sort('general', 'latest', 'popular', 'comments', 'collects'),
            type: filter.type('all', 'video', 'image'),
            time: filter.time('all', 'day', 'week', 'half_year'),
          },
        }),
        'item related': 'none',
        'item list': impl('full', 'itemList'),
        'item media': impl('full', 'itemMedia'),
        'item download': impl('full', 'itemDownload'),
        'item like': 'none',
        'item unlike': 'none',
        'item collect': 'none',
        'item uncollect': 'none',
        'item publish': impl('full', 'itemPublish'),
        'item delete': 'none',

        'product get': 'none',

        'comment list': impl('partial', 'commentList', { note: '--product 规划中', options: { product: PRODUCT } }),
        'comment replies': impl('full', 'commentReplies'),
        'comment add': 'none',
        'comment delete': 'none',
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': impl('partial', 'feedList', { note: 'following 规划中', options: { kind: filter.kind('recommend', 'following'), category: CATEGORY } }),
        'feed categories': impl('full', 'feedCategories'),

        'live get': impl('full', 'liveGet'),
        'live list': impl('full', 'liveList', { options: { category: CATEGORY } }),
        'live search': 'none',
        'live categories': impl('full', 'liveCategories'),
        'live listen': impl('full', 'liveListen'),
        'live history': 'none',
        'live send': impl('partial', 'liveSend', { note: '--gift 规划中' }),
        'live like': 'none',
        'live rank': 'none',
        'live gifts': impl('full', 'liveGifts'),
        'live products': impl('full', 'liveProducts'),
        'live media': 'none',
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': impl('full', 'keywordSuggest'),
        'keyword hot': impl('full', 'keywordHot'),

        'notice list': impl('full', 'noticeList'),
        'notice count': impl('full', 'noticeCount'),

        'msg list': impl('full', 'msgList'),
        'msg history': impl('full', 'msgHistory'),
        'msg send': impl('full', 'msgSend'),
        'msg listen': impl('full', 'msgListen'),
        'msg read': impl('full', 'msgRead'),
        'msg revoke': impl('full', 'msgRevoke'),
        'msg delete': impl('full', 'msgDelete'),

        'media upload': impl('full', 'mediaUpload'),

        'folder list': impl('partial', 'folderList'),
        // 上游只有收藏夹列表，没有收藏夹内容
        'folder items': 'none',
        'folder create': 'none',
        'folder update': 'none',
        'folder delete': 'none',

        'series list': 'none',
        'series items': 'none',

        'history list': 'none',
        'topic search': impl('full', 'topicSearch'),
        'poi search': impl('full', 'poiSearch'),
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
