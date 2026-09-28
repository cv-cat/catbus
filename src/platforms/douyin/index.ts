import { z } from 'zod'
import { filter, PRODUCT } from '../../core/options.js'
import { type CommandDecl, definePlatform, type Handler, type Upstream } from '../../core/registry.js'

type Commands = typeof import('./web/commands.js')

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。缺 UIFID 时自动补上重试（commands.withUifid）。 */
const h =
  (name: keyof Commands) =>
  (): Promise<Handler> =>
    import('./web/commands.js').then((m) => m.withUifid(m[name] as Handler) as Handler)

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
        'user search': impl('full', 'userSearch', {
          options: {
            fans: z.enum(['0_1k', '1k_1w', '1w_10w', '10w_100w', '100w_']).optional().describe('粉丝数区间'),
            userType: z.enum(['common', 'enterprise', 'personal']).optional().describe('用户类型：普通 / 企业 / 个人认证'),
          },
        }),
        'user items': impl('full', 'userItems'),
        'user likes': impl('full', 'userLikes'),
        // 上游没有收藏作品列表（get_collect_list 返回的是收藏夹）
        'user collects': 'none',
        'user followers': impl('full', 'userFollowers'),
        'user following': impl('full', 'userFollowing'),
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': impl('full', 'itemGet'),
        'item search': impl('full', 'itemSearch', {
          note: '--type video 走视频频道搜索',
          options: {
            sort: filter.sort('general', 'popular', 'latest'),
            time: filter.time('all', 'day', 'week', 'half_year'),
            type: filter.type('all', 'video', 'image'),
            length: z.enum(['all', 'short', 'medium', 'long']).optional().describe('视频时长：1 分钟内 / 1–5 分钟 / 5 分钟以上'),
            range: z.enum(['all', 'seen', 'unseen', 'following']).optional().describe('搜索范围：看过 / 没看过 / 关注的人'),
          },
        }),
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

        'comment list': impl('full', 'commentList', {
          options: { product: PRODUCT, label: z.string().optional().describe('商品评价按标签筛选（标签名或 id，如 好评、有图）') },
        }),
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
        'live history': impl('partial', 'liveHistory', { note: '只有进房时 im/fetch 带回的最近 15 条' }),
        'live send': impl('partial', 'liveSend', { note: '--gift 规划中' }),
        'live like': impl('full', 'liveLike'),
        'live rank': impl('full', 'liveRank', {
          options: { ranking: z.enum(['contribution', 'thousand']).default('contribution').describe('榜单：贡献榜 / 千票榜') },
        }),
        'live gifts': 'none',
        'live products': impl('full', 'liveProducts'),
        'live media': impl('partial', 'liveMedia', { note: '拉流地址取自房间资料（room/web/enter）' }),
        'live replays': 'none',
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': 'none',
        'keyword hot': 'none',

        'notice list': impl('full', 'noticeList', {
          options: { group: z.enum(['all', 'fans', 'mention', 'comment', 'like', 'danmaku']).optional().describe('通知分组，不带时为默认分组') },
        }),
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
