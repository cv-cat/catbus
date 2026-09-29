import { z } from 'zod'
import { filter, visibility } from '../../core/options.js'
import { definePlatform, handlers } from '../../core/registry.js'

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const { h, impl } = handlers(() => import('./web/commands.js'))

export default definePlatform({
  id: 'xianyu',
  name: '闲鱼',
  aliases: ['goofish', 'xy'],
  item: '闲置商品',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'cookie'], default: 'qrcode' },
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('partial', 'userGet', { note: '只支持 me；查询他人规划中' }),
        'user items': 'none',
        'user collects': 'none',
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': impl('full', 'itemGet'),
        'item search': 'none',
        'item related': 'none',
        'item list': 'none',
        'item collect': 'none',
        'item uncollect': 'none',
        'item publish': impl('full', 'itemPublish', {
          supports: ['title', 'text', 'image', 'visibility', 'price'],
          options: {
            // 商品发布即上架，没有「仅自己可见」
            visibility: visibility('public'),
            shipping: z.enum(['free', 'distance', 'fixed', 'none']).default('free').describe('运费：free 包邮、distance 按距离计费、fixed 一口价、none 无需邮寄'),
            postage: z.number().nonnegative().optional().describe('一口价运费（元），配合 --shipping fixed'),
            pickup: z.boolean().optional().describe('支持自提'),
            originalPrice: z.number().positive().optional().describe('原价（元），配合 --price'),
          },
        }),
        'item delete': 'none',
        'item categories': 'none',

        'feed list': { upstream: 'none', options: { kind: filter.kind('recommend') } },

        'keyword suggest': 'none',

        'msg list': 'none',
        'msg history': impl('full', 'msgHistory'),
        'msg send': impl('full', 'msgSend', {
          note: '--to 不带 --item 时按上游的默认商品建会话；--to 加 --item 就这件商品联系对方（卖家可以联系买家）',
        }),
        'msg listen': impl('full', 'msgListen'),
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'media upload': impl('full', 'mediaUpload'),

        'history list': 'none',
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
