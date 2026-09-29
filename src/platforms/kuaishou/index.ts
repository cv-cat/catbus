import { filter, PRODUCT } from '../../core/options.js'
import { definePlatform, handlers } from '../../core/registry.js'

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const { h, impl } = handlers(() => import('./web/commands.js'))

export default definePlatform({
  id: 'kuaishou',
  name: '快手',
  aliases: ['ks'],
  item: '作品',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'cookie'], default: 'qrcode' },
      // 直播页的退出登录：passport logout + userLogout
      logout: h('serverLogout'),
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('full', 'userGet'),
        'user search': impl('full', 'userSearch'),
        'user items': impl('full', 'userItems'),
        'user likes': impl('full', 'userLikes', { note: '只支持 me' }),
        'user collects': impl('full', 'userCollects'),
        'user followers': impl('full', 'userFollowers', { note: '只支持 me' }),
        'user following': impl('full', 'userFollowing', { note: '只支持 me' }),
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': impl('full', 'itemGet'),
        'item search': impl('partial', 'itemSearch'),
        'item related': impl('full', 'itemRelated'),
        'item list': impl('full', 'itemList'),
        'item media': impl('full', 'itemMedia'),
        'item download': impl('full', 'itemDownload'),
        'item like': 'none',
        'item unlike': 'none',
        'item collect': 'none',
        'item uncollect': 'none',
        'item publish': impl('partial', 'itemPublish', {
          supports: ['title', 'text', 'image', 'video', 'tag', 'topic', 'visibility', 'schedule'],
        }),
        'item delete': 'none',

        'product get': 'none',

        'comment list': impl('partial', 'commentList', { note: '--product 规划中', options: { product: PRODUCT } }),
        'comment replies': impl('partial', 'commentReplies'),
        'comment add': 'none',
        'comment delete': 'none',
        'comment like': 'none',
        'comment unlike': 'none',

        // recommend 是 new-reco 推荐流（上游 get_feed_hot）；快手没有单独的热门流
        'feed list': impl('partial', 'feedList', {
          note: 'following 只有首屏',
          options: { kind: filter.kind('recommend', 'following') },
        }),

        'live get': impl('full', 'liveGet'),
        'live list': impl('full', 'liveList'),
        'live search': 'none',
        'live categories': impl('full', 'liveCategories'),
        'live listen': impl('full', 'liveListen'),
        'live history': 'none',
        // 上游没有发直播弹幕、直播间点赞的方法（README：“直播间主动发送弹幕尚未接入”）
        'live send': 'none',
        'live like': 'none',
        'live rank': 'none',
        'live gifts': impl('full', 'liveGifts'),
        'live products': 'none',
        'live media': 'none',
        'live replays': impl('full', 'liveReplays'),
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': 'none',
        'keyword hot': 'none',

        'notice list': 'none',
        'notice count': impl('full', 'noticeCount'),

        'msg list': 'none',
        'msg history': 'none',
        'msg send': 'none',
        'msg listen': 'none',
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'media upload': impl('full', 'mediaUpload'),

        'folder list': 'none',
        'folder items': 'none',
        'folder create': 'none',
        'folder update': 'none',
        'folder delete': 'none',

        'series list': 'none',
        'series items': 'none',

        // 上游 get_history_list 已下线（服务端 404，上游直接拒绝发包）
        'history list': 'none',
        'topic search': 'none',
        'poi search': 'none',
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
