import { filter } from '../../core/options.js'
import { definePlatform } from '../../core/registry.js'

export default definePlatform({
  id: 'jd',
  name: '京东',
  aliases: ['jingdong'],
  item: '商品 SKU',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'cookie'], default: 'qrcode' },
      commands: {
        'auth login': 'full',
        'auth status': 'full',

        'user get': { upstream: 'partial', note: '只支持 me' },
        'user collects': 'full',

        'item get': 'full',
        'item search': 'full',
        'item related': 'full',
        'item collect': 'none',
        'item uncollect': 'none',

        'comment list': 'partial',

        'feed list': { upstream: 'none', options: { kind: filter.kind('recommend') } },

        'keyword suggest': 'full',
        'keyword hot': 'full',

        'msg list': 'full',
        'msg history': 'full',
        'msg send': 'full',
        'msg listen': 'full',
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'history list': 'full',

        // 平台扩展（AGENTS 4.7）
        'order list': { upstream: 'full', summary: '订单列表', args: [], auth: 'required', paged: true, output: 'Order[]' },
        'cart count': { upstream: 'full', summary: '购物车商品数量', args: [], auth: 'required', output: '{count}' },
        'coupon list': {
          upstream: 'full',
          summary: '商品可用的优惠券',
          args: [{ name: 'item', summary: '商品 SKU：ID 或 URL' }],
          auth: 'optional',
          output: 'Coupon[]',
        },
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
