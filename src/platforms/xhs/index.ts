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

const kol = { name: 'kol', summary: '达人：ID 或主页 URL' }
const distributor = { name: 'distributor', summary: '分销达人 ID' }
const biz = (summary: string, args: CommandDecl['args'], output: string, name: keyof Commands, extra: Partial<CommandDecl> = {}): CommandDecl => ({
  upstream: 'full',
  summary,
  args,
  output,
  auth: 'required',
  handler: h(name),
  ...extra,
})

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
        'user following': 'none',
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': impl('full', 'itemGet'),
        'item search': impl('full', 'itemSearch', {
          options: { sort: filter.sort('general', 'latest', 'popular', 'comments', 'collects'), type: filter.type('all', 'video', 'image') },
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

        'live get': impl('full', 'liveGet', { auth: 'required' }),
        'live list': impl('full', 'liveList', { options: { category: CATEGORY } }),
        'live search': 'none',
        'live categories': impl('full', 'liveCategories'),
        'live listen': impl('full', 'liveListen', { auth: 'required' }),
        'live history': 'none',
        'live send': impl('partial', 'liveSend', { note: '--gift 规划中' }),
        'live like': 'none',
        'live rank': 'none',
        'live gifts': impl('full', 'liveGifts', { auth: 'required' }),
        'live products': impl('full', 'liveProducts', { auth: 'required' }),
        'live media': 'none',
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': 'none',
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
        'topic search': impl('full', 'topicSearch', { auth: 'required' }),
        'poi search': impl('full', 'poiSearch', { auth: 'required' }),

        // 蒲公英达人（AGENTS 4.7）
        'kol categories': biz('蒲公英达人分类', [], 'Category[]', 'kolCategories'),
        'kol list': biz('蒲公英达人列表', [], 'Kol[]', 'kolList', { paged: true, options: { category: CATEGORY } }),
        'kol get': biz('达人详情', [kol], 'Kol', 'kolGet'),
        'kol fans': biz('达人粉丝数据', [kol], 'Kol', 'kolFans'),
        'kol items': biz('达人笔记数据', [kol], 'Kol', 'kolItems'),
        'kol invite': biz('邀约达人合作', [kol], '{id}', 'kolInvite', {
          options: {
            productName: z.string().describe('合作的产品名'),
            start: z.string().describe('期望发布的开始日期，例如 2026-10-01'),
            end: z.string().describe('期望发布的结束日期'),
            text: z.string().describe('邀约内容，@file 表示从文件读取'),
            contact: z.string().describe('联系方式'),
          },
        }),

        // 千帆分销达人（AGENTS 4.7）
        'distributor categories': biz('分销达人分类', [], 'Category[]', 'distributorCategories'),
        'distributor list': biz('分销达人列表', [], 'Distributor[]', 'distributorList', { paged: true, options: { category: CATEGORY } }),
        'distributor get': biz('分销达人详情，合并合作信息和店铺', [distributor], 'Distributor', 'distributorGet'),
        'distributor items': biz('分销达人带货的商品', [distributor], 'Distributor', 'distributorItems'),
        'distributor fans': biz('分销达人粉丝数据', [distributor], 'Distributor', 'distributorFans'),
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
