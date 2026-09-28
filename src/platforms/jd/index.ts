import { filter } from '../../core/options.js'
import { type CommandDecl, definePlatform, type Handler, type Upstream } from '../../core/registry.js'

type Commands = typeof import('./web/commands.js')

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const h =
  (name: keyof Commands) =>
  (): Promise<Handler> =>
    import('./web/commands.js').then((m) => m[name] as Handler)

const impl = (upstream: Upstream, name: keyof Commands, extra: Partial<CommandDecl> = {}): CommandDecl => ({ upstream, handler: h(name), ...extra })

export default definePlatform({
  id: 'jd',
  name: '京东',
  aliases: ['jingdong'],
  item: '商品 SKU',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'cookie'], default: 'qrcode' },
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('partial', 'userGet', { note: '只支持 me' }),
        'user collects': impl('full', 'userCollects'),

        'item get': impl('full', 'itemGet'),
        'item search': impl('full', 'itemSearch', { options: { sort: filter.sort('general', 'sales', 'price_asc', 'price_desc', 'comments') } }),
        'item related': impl('partial', 'itemRelated', { note: '用第一个相关搜索词的搜索结果' }),
        'item collect': 'none',
        'item uncollect': 'none',

        'comment list': impl('partial', 'commentList', { note: '只有第一页' }),

        'feed list': { upstream: 'none', options: { kind: filter.kind('recommend') } },

        'keyword suggest': impl('full', 'keywordSuggest'),
        'keyword hot': impl('full', 'keywordHot'),

        'msg list': impl('full', 'msgList'),
        'msg history': impl('full', 'msgHistory'),
        'msg send': impl('full', 'msgSend'),
        'msg listen': impl('full', 'msgListen'),
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'history list': impl('full', 'historyList'),

        // 平台扩展（AGENTS 4.7）
        'order list': { upstream: 'full', summary: '订单列表', args: [], auth: 'required', paged: true, output: 'Order[]', handler: h('orderList') },
        'cart count': { upstream: 'full', summary: '购物车商品数量', args: [], auth: 'required', output: '{count}', handler: h('cartCount') },
        'coupon list': {
          upstream: 'full',
          summary: '商品可用的优惠券',
          args: [{ name: 'item', summary: '商品 SKU：ID 或 URL' }],
          auth: 'required',
          output: 'Coupon[]',
          handler: h('couponList'),
        },
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
