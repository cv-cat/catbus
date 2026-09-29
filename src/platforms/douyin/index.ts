import { z } from 'zod'
import { filter, PRODUCT } from '../../core/options.js'
import { definePlatform, type Handler, handlers } from '../../core/registry.js'
import type { Args, Options } from '../../core/vocab.js'

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。缺 UIFID 时自动补上重试（commands.withUifid）。 */
const { h, impl } = handlers(
  () => import('./web/commands.js'),
  (m, handler) => m.withUifid(handler) as Handler,
)

/** 平台私有选项（AGENTS 4.7 的 douyin 行）。 */
const folder = (summary: string) => ({ folder: z.string().optional().describe(summary) })

/** `msg send`：比词表多了 --file / --share 也算消息内容。 */
function msgSendCheck(a: Args, o: Options): string | undefined {
  if (['to', 'conversation', 'item'].filter((k) => o[k] != null).length !== 1) return '--to、--conversation、--item 需要且只能用一个'
  if (a.text == null && o.image == null && o.video == null && o.file == null && o.share == null) return '需要 <text>、--image、--video、--file 或 --share'
}

export default definePlatform({
  id: 'douyin',
  name: '抖音',
  aliases: ['dy'],
  item: '作品',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'cookie'], default: 'qrcode' },
      commands: {
        'auth login': impl('full', 'authLogin', {
          options: { sso: z.boolean().optional().describe('短信登录改走 login.douyin.com 页的 SSO 链（sms）') },
        }),
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
        'item list': impl('partial', 'itemList', { note: '取发布页的作品预览（work_list）；定时未发布的作品 status 为 draft' }),
        'item media': impl('full', 'itemMedia'),
        'item download': impl('full', 'itemDownload'),
        'item like': impl('full', 'itemLike'),
        'item unlike': impl('full', 'itemUnlike'),
        'item collect': impl('full', 'itemCollect', { options: folder('收藏后移进这个收藏夹（ID 或名字）') }),
        'item uncollect': impl('full', 'itemUncollect', { options: folder('只从这个收藏夹移出，仍保留收藏（ID 或名字）') }),
        'item publish': impl('full', 'itemPublish', {
          supports: ['title', 'text', 'image', 'video', 'cover', 'tag', 'topic', 'mention', 'poi', 'visibility', 'schedule'],
          options: {
            poiName: z.string().optional().describe('地点名称，配合 --poi'),
            series: z.string().optional().describe('加入合集（合集 ID）'),
            hotspot: z.string().optional().describe('关联热点（热点词）'),
            noDownload: z.boolean().optional().describe('不允许别人下载'),
          },
        }),
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
        'live like': impl('full', 'liveLike', { options: { count: z.number().int().positive().optional().describe('一次点赞的次数，默认 1') } }),
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
        'msg send': impl('full', 'msgSend', {
          options: {
            file: z.string().optional().describe('发文件（路径或 URL，≤10MB）'),
            share: z.string().optional().describe('分享作品 / 用户名片 / 网页卡片（ID 或 URL）'),
          },
          check: msgSendCheck,
        }),
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
