import { CATEGORY, filter, PRODUCT } from '../../core/options.js'
import { type CommandDecl, definePlatform } from '../../core/registry.js'

const kol = { name: 'kol', summary: '达人：ID 或主页 URL' }
const distributor = { name: 'distributor', summary: '分销达人 ID' }
const biz = (summary: string, args: CommandDecl['args'], output: string, extra: Partial<CommandDecl> = {}): CommandDecl => ({
  upstream: 'full',
  summary,
  args,
  output,
  auth: 'required',
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
        'auth login': 'full',
        'auth status': 'full',

        'user get': 'full',
        'user search': 'full',
        'user items': 'full',
        'user likes': 'full',
        'user collects': 'full',
        'user followers': 'none',
        'user following': 'none',
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': 'full',
        'item search': 'full',
        'item related': 'none',
        'item list': 'full',
        'item media': 'full',
        'item download': 'full',
        'item like': 'none',
        'item unlike': 'none',
        'item collect': 'none',
        'item uncollect': 'none',
        'item publish': 'full',
        'item delete': 'none',

        'product get': 'none',

        'comment list': { upstream: 'partial', note: '--product 规划中', options: { product: PRODUCT } },
        'comment replies': 'full',
        'comment add': 'none',
        'comment delete': 'none',
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': { upstream: 'partial', note: 'following 规划中', options: { kind: filter.kind('recommend', 'following') } },
        'feed categories': 'full',

        'live get': 'full',
        'live list': 'full',
        'live search': 'none',
        'live categories': 'full',
        'live listen': 'full',
        'live history': 'none',
        'live send': { upstream: 'partial', note: '--gift 规划中' },
        'live like': 'none',
        'live rank': 'none',
        'live gifts': 'full',
        'live products': 'full',
        'live media': 'none',
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': 'none',
        'keyword hot': 'full',

        'notice list': 'full',
        'notice count': 'full',

        'msg list': 'full',
        'msg history': 'full',
        'msg send': 'full',
        'msg listen': 'full',
        'msg read': 'full',
        'msg revoke': 'full',
        'msg delete': 'full',

        'media upload': 'full',

        'folder list': 'partial',
        'folder items': 'partial',
        'folder create': 'none',
        'folder update': 'none',
        'folder delete': 'none',

        'series list': 'none',
        'series items': 'none',

        'history list': 'none',
        'topic search': 'full',
        'poi search': 'full',

        // 蒲公英达人（AGENTS 4.7）
        'kol categories': biz('蒲公英达人分类', [], 'Category[]'),
        'kol list': biz('蒲公英达人列表', [], 'Kol[]', { paged: true, options: { category: CATEGORY } }),
        'kol get': biz('达人详情', [kol], 'Kol'),
        'kol fans': biz('达人粉丝数据', [kol], 'Kol'),
        'kol items': biz('达人笔记数据', [kol], 'Kol'),
        'kol invite': biz('邀约达人合作', [kol], '{id}'),

        // 千帆分销达人（AGENTS 4.7）
        'distributor categories': biz('分销达人分类', [], 'Category[]'),
        'distributor list': biz('分销达人列表', [], 'Distributor[]', { paged: true, options: { category: CATEGORY } }),
        'distributor get': biz('分销达人详情，合并合作信息和店铺', [distributor], 'Distributor'),
        'distributor items': biz('分销达人带货的商品', [distributor], 'Distributor'),
        'distributor fans': biz('分销达人粉丝数据', [distributor], 'Distributor'),
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
