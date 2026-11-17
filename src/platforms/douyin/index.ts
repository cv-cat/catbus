import { z } from 'zod'
import { CATEGORY, filter, PRODUCT } from '../../core/options.js'
import { definePlatform, type Handler, handlers } from '../../core/registry.js'
import { type Args, checkMsgSend, type Options } from '../../core/vocab.js'

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const load = () => import('./web/commands.js')

/** 读取类命令：缺 UIFID 时自动补上，整条命令重跑一次（commands.retryWithUifid）。 */
const { impl: read } = handlers(load, (m, handler) => m.retryWithUifid(handler) as Handler)

/**
 * 登录与写操作不整条重跑：重跑会把已经做完的步骤再做一遍，例如私信的文字已经发出、之后取分享卡片时撞上
 * "Uifid Not Found"，重跑就会把文字再发一次；登录重跑会再出一次二维码。缺 UIFID 时照常报 RISK_CONTROL。
 */
const { impl: write } = handlers(load)

/** 平台私有选项（AGENTS 4.7 的 douyin 行）。 */
const folder = (summary: string) => ({ folder: z.string().optional().describe(summary) })

/** `msg send`：比词表多了 --file / --share 也算消息内容。--to 与 --item 同时用时由 handler 报 UNSUPPORTED。 */
const msgSendCheck = (a: Args, o: Options) => checkMsgSend(a, o, { content: ['file', 'share'] })

export default definePlatform({
  id: 'douyin',
  name: '抖音',
  aliases: ['dy'],
  item: '作品',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'cookie'], default: 'qrcode' },
      commands: {
        'auth login': write('full', 'authLogin', {
          options: { sso: z.boolean().optional().describe('短信登录改走 login.douyin.com 页的 SSO 链（sms）') },
        }),
        'auth status': read('full', 'authStatus'),

        'user get': read('full', 'userGet'),
        'user search': read('full', 'userSearch', {
          options: {
            fans: z.enum(['0_1k', '1k_1w', '1w_10w', '10w_100w', '100w_']).optional().describe('粉丝数区间'),
            userType: z.enum(['common', 'enterprise', 'personal']).optional().describe('用户类型：普通 / 企业 / 个人认证'),
          },
        }),
        'user items': read('full', 'userItems'),
        'user likes': read('full', 'userLikes'),
        // 上游没有收藏作品列表（get_collect_list 返回的是收藏夹）
        'user collects': 'none',
        'user followers': read('full', 'userFollowers'),
        'user following': read('full', 'userFollowing'),
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': read('full', 'itemGet'),
        'item search': read('full', 'itemSearch', {
          // 综合频道（上游 search_general_work）的筛选值放在 filter_selected 里，--type image 是它的 content_type 2（图文）
          note: '--type video 走视频频道搜索，其余走综合频道；--type image 只要图文',
          options: {
            sort: filter.sort('general', 'popular', 'latest'),
            time: filter.time('all', 'day', 'week', 'half_year'),
            type: filter.type('all', 'video', 'image'),
            length: z.enum(['all', 'short', 'medium', 'long']).optional().describe('视频时长：1 分钟内 / 1–5 分钟 / 5 分钟以上'),
            range: z.enum(['all', 'seen', 'unseen', 'following']).optional().describe('搜索范围：看过 / 没看过 / 关注的人'),
          },
        }),
        'item related': 'none',
        'item list': read('partial', 'itemList', { note: '取发布页的作品预览（work_list）；定时未发布的作品 status 为 draft' }),
        'item media': read('full', 'itemMedia'),
        'item download': read('full', 'itemDownload'),
        'item like': write('full', 'itemLike'),
        'item unlike': write('full', 'itemUnlike'),
        'item collect': write('full', 'itemCollect', { options: folder('收藏后移进这个收藏夹（ID 或名字）') }),
        'item uncollect': write('full', 'itemUncollect', { options: folder('只从这个收藏夹移出，仍保留收藏（ID 或名字）') }),
        'item publish': write('full', 'itemPublish', {
          supports: ['title', 'text', 'image', 'video', 'cover', 'tag', 'topic', 'mention', 'poi', 'visibility', 'schedule'],
          options: {
            poiName: z.string().optional().describe('地点名称，配合 --poi'),
            series: z.string().optional().describe('加入合集（合集 ID）'),
            hotspot: z.string().optional().describe('关联热点（热点词）'),
            noDownload: z.boolean().optional().describe('不允许别人下载'),
          },
        }),
        'item delete': 'none',

        'product get': read('partial', 'productGet', { note: '上游的商品接口只给详情图、规格和跳转链接：只有标题、图片和价格，其余字段为空' }),

        'comment list': read('full', 'commentList', {
          options: { product: PRODUCT, label: z.string().optional().describe('商品评价按标签筛选（标签名或 id，如 好评、有图）') },
        }),
        'comment replies': read('full', 'commentReplies'),
        'comment add': write('full', 'commentAdd'),
        'comment delete': 'none',
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': read('partial', 'feedList', {
          note: 'hot、following 规划中',
          options: { kind: filter.kind('recommend', 'hot', 'following') },
        }),

        'live get': read('full', 'liveGet'),
        'live list': read('partial', 'liveList', {
          note: '非上游：请求按直播网页版补的（webcast/feed、webcast/web/partition/detail/room/v2），没有对拍；不带 --category 是首页推荐流，带 --category 是分区页（取值为 live categories 的 id、分区名或分区页链接）',
          options: { category: CATEGORY },
        }),
        'live search': read('full', 'liveSearch'),
        'live categories': read('partial', 'liveCategories', { note: '非上游：取自直播网页版首页 HTML 里的分区栏，没有对拍；网页版只给出部分分区的子分区' }),
        'live listen': read('full', 'liveListen'),
        'live history': read('partial', 'liveHistory', { note: '只有进房时 im/fetch 带回的最近 15 条' }),
        'live send': write('partial', 'liveSend', { note: '--gift 规划中' }),
        'live like': write('full', 'liveLike', { options: { count: z.number().int().positive().optional().describe('一次点赞的次数，默认 1') } }),
        'live rank': read('full', 'liveRank', {
          options: { ranking: z.enum(['contribution', 'thousand']).default('contribution').describe('榜单：贡献榜 / 千票榜') },
        }),
        'live gifts': 'none',
        'live products': read('full', 'liveProducts'),
        'live media': read('partial', 'liveMedia', { note: '拉流地址取自房间资料（room/web/enter）' }),
        'live replays': 'none',
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': 'none',
        'keyword hot': read('partial', 'keywordHot', {
          note: '非上游：上游没有热搜接口，请求按网页端热榜页补的（aweme/v1/web/hot/search/list），没有对拍；不含置顶词和实时上升热点',
        }),

        'notice list': read('full', 'noticeList', {
          options: { group: z.enum(['all', 'fans', 'mention', 'comment', 'like', 'danmaku']).optional().describe('通知分组，不带时为默认分组') },
        }),
        'notice count': 'none',

        'msg list': 'none',
        'msg history': 'none',
        'msg send': write('full', 'msgSend', {
          options: {
            file: z.string().optional().describe('发文件（路径或 URL，≤10MB）'),
            share: z.string().optional().describe('分享作品 / 用户名片 / 网页卡片（ID 或 URL）'),
          },
          check: msgSendCheck,
        }),
        'msg listen': read('full', 'msgListen'),
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'media upload': write('full', 'mediaUpload'),

        'folder list': read('full', 'folderList'),
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
