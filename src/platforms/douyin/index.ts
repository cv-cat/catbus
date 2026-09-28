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
  id: 'douyin',
  name: '抖音',
  aliases: ['dy'],
  item: '作品',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'cookie'], default: 'qrcode' },
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('full', 'userGet'),
        'user search': impl('full', 'userSearch'),
        'user items': impl('full', 'userItems'),
        'user likes': impl('full', 'userLikes', { note: '需要 UIFID cookie：扫码 / 短信登录拿不到，用浏览器 cookie 导入' }),
        // 上游没有收藏作品列表（get_collect_list 返回的是收藏夹）
        'user collects': 'none',
        'user followers': impl('full', 'userFollowers'),
        'user following': impl('full', 'userFollowing'),
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': impl('full', 'itemGet'),
        'item search': impl('full', 'itemSearch'),
        'item related': 'none',
        'item list': 'none',
        'item media': impl('full', 'itemMedia'),
        'item download': impl('full', 'itemDownload'),
        'item like': impl('full', 'itemLike'),
        'item unlike': impl('full', 'itemUnlike'),
        'item collect': impl('full', 'itemCollect'),
        'item uncollect': impl('full', 'itemUncollect'),
        'item publish': impl('full', 'itemPublish'),
        'item delete': 'none',

        'product get': impl('partial', 'productGet'),

        'comment list': impl('full', 'commentList', { options: { product: PRODUCT } }),
        'comment replies': impl('full', 'commentReplies'),
        'comment add': impl('full', 'commentAdd'),
        'comment delete': 'none',
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': impl('partial', 'feedList', {
          note: 'hot、following 规划中',
          options: { kind: filter.kind('recommend', 'hot', 'following') },
        }),

        'live get': impl('full', 'liveGet'),
        'live list': 'none',
        'live search': impl('full', 'liveSearch'),
        'live categories': 'none',
        'live listen': impl('full', 'liveListen'),
        'live history': 'none',
        'live send': impl('partial', 'liveSend', { note: '--gift 规划中' }),
        'live like': impl('full', 'liveLike'),
        'live rank': impl('full', 'liveRank'),
        'live gifts': 'none',
        'live products': impl('full', 'liveProducts'),
        'live media': 'none',
        'live replays': 'none',
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': 'none',
        'keyword hot': 'none',

        'notice list': impl('full', 'noticeList'),
        'notice count': 'none',

        'msg list': 'none',
        'msg history': 'none',
        'msg send': impl('full', 'msgSend'),
        'msg listen': impl('full', 'msgListen'),
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'media upload': impl('full', 'mediaUpload'),

        'folder list': impl('full', 'folderList'),
        // 上游没有收藏夹内容接口
        'folder items': 'none',
        'folder create': 'none',
        'folder update': 'none',
        'folder delete': 'none',

        'series list': 'none',
        'series items': 'none',

        'history list': 'none',
        'topic search': 'none',
        'poi search': 'none',
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
