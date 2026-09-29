import { z } from 'zod'
import { filter } from '../../core/options.js'
import { definePlatform, handlers } from '../../core/registry.js'

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const { h, impl } = handlers(() => import('./web/commands.js'))

// 私有选项（AGENTS 4.7 的 jd 行）

/** 收货地区（上游各接口的 area 参数）：影响价格和库存。 */
const area = { area: z.string().regex(/^\d+([_-]\d+){3}$/, '格式为 省_市_区_镇 的地区编码，例如 1_2800_55812_0').optional().describe('收货地区编码，例如 1_2800_55812_0；默认取 ipLoc-djd cookie') }

/** 订单时间范围（get_order_list 的 date_range）。 */
const range = { range: z.string().regex(/^(3m|this_year|\d{4})$/, '取值为 3m、this_year 或四位年份').default('3m').describe('时间范围：3m 近三个月、this_year 今年内、2025 等四位年份') }

/** 按订单咨询（get_chat_info / send_hello / send_text 的 order_id）。 */
const order = { order: z.string().optional().describe('订单号或订单详情页 URL：按订单咨询客服') }

/**
 * msg send：通用规则（AGENTS 4.8：--conversation 不与其他目标并用，--to 与 --item 可以同时用），
 * 再加上 --order：可与 --item 或 --conversation 之一合用，只有 --order 时联系京东自营客服。
 * --to 在 handler 里报 UNSUPPORTED（京东只能联系商家客服）。
 */
function msgSendCheck(args: Record<string, string | undefined>, o: Record<string, unknown>): string | undefined {
  const targets = ['to', 'conversation', 'item'].filter((k) => o[k] != null)
  if (targets.length > 1 && targets.includes('conversation')) return '--to、--conversation、--item 需要用一个，只有 --to 与 --item 可以同时用'
  if (!targets.length && o.order == null) return '需要 --conversation、--item 或 --order'
  if (args.text == null && o.image == null && o.video == null) return '需要 <text>、--image 或 --video'
}

export default definePlatform({
  id: 'jd',
  name: '京东',
  aliases: ['jingdong'],
  item: '商品 SKU',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'cookie'], default: 'qrcode' },
      commands: {
        'auth login': impl('full', 'authLogin', { note: 'sms 的 --phone 可以带国际前缀，例如 +85291234567' }),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('partial', 'userGet', { note: '只支持 me' }),
        'user collects': impl('full', 'userCollects', { options: area }),

        'item get': impl('full', 'itemGet', { options: area }),
        'item search': impl('full', 'itemSearch', { options: { sort: filter.sort('general', 'sales', 'price_asc', 'price_desc', 'comments'), ...area } }),
        'item related': impl('partial', 'itemRelated', { note: '用第一个相关搜索词的搜索结果', options: area }),
        'item collect': 'none',
        'item uncollect': 'none',

        'comment list': impl('partial', 'commentList', { note: '只有第一页；--limit N 在一次请求里取 N 条' }),

        'feed list': { upstream: 'none', options: { kind: filter.kind('recommend') } },

        'keyword suggest': impl('full', 'keywordSuggest'),
        'keyword hot': impl('full', 'keywordHot'),

        'msg list': impl('full', 'msgList'),
        'msg history': impl('full', 'msgHistory'),
        'msg send': impl('full', 'msgSend', { options: order, check: msgSendCheck }),
        'msg listen': impl('full', 'msgListen'),
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'history list': impl('full', 'historyList', { options: area }),

        // 平台扩展（AGENTS 4.7）
        'order list': { upstream: 'full', summary: '订单列表', args: [], options: range, auth: 'required', paged: true, output: 'Order[]', handler: h('orderList') },
        'cart count': { upstream: 'full', summary: '购物车商品数量', args: [], options: area, auth: 'required', output: '{count}', handler: h('cartCount') },
        'coupon list': {
          upstream: 'full',
          summary: '商品可用的优惠券',
          args: [{ name: 'item', summary: '商品 SKU：ID 或 URL' }],
          options: area,
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
