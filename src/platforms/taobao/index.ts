import { filter } from '../../core/options.js'
import { definePlatform, handlers } from '../../core/registry.js'

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const { h, impl } = handlers(() => import('./web/commands.js'))

export default definePlatform({
  id: 'taobao',
  name: '淘宝',
  aliases: ['tb'],
  item: '商品',
  endpoints: {
    web: {
      login: { methods: ['cookie'], default: 'cookie' },
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('partial', 'authStatus', { note: '上游没有取当前用户的接口：换一次私信 token 校验，账号信息取自 cookie 里的 unb 和昵称' }),

        'user get': impl('partial', 'userGet', { note: '参数只接受商品链接（淘宝 / 天猫商品页或 m.tb.cn 分享短链），返回这件商品的卖家；me 规划中' }),
        'user items': 'none',
        'user collects': 'none',

        'item get': 'none',
        'item search': 'none',
        'item related': 'none',
        'item collect': 'none',
        'item uncollect': 'none',

        'comment list': 'none',

        'feed list': { upstream: 'none', options: { kind: filter.kind('recommend') } },

        'live get': 'none',
        'live list': 'none',
        'live search': 'none',
        'live categories': 'none',
        'live listen': 'none',
        'live history': 'none',
        'live send': 'none',
        'live like': 'none',
        'live rank': 'none',
        'live gifts': 'none',
        'live products': 'none',
        'live media': 'none',
        'live replays': 'none',
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': 'none',

        'msg list': 'none',
        'msg history': impl('full', 'msgHistory'),
        'msg send': impl('full', 'msgSend', { note: '--item 联系商品卖家，--conversation 回复已有会话；不支持 --to（没有按用户发起会话的接口）' }),
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
