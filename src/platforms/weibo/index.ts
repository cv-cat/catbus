import { z } from 'zod'
import { filter, visibility } from '../../core/options.js'
import { definePlatform, handlers } from '../../core/registry.js'

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const { h, impl } = handlers(() => import('./web/commands.js'))

export default definePlatform({
  id: 'weibo',
  name: '微博',
  aliases: ['wb'],
  item: '微博',
  endpoints: {
    web: {
      login: { methods: ['cookie'], default: 'cookie' },
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('full', 'userGet'),
        'user search': 'none',
        'user items': impl('full', 'userItems'),
        'user likes': 'none',
        'user collects': 'none',
        'user reposts': 'none',
        'user followers': 'none',
        'user following': 'none',
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': impl('full', 'itemGet'),
        'item search': impl('partial', 'itemSearch', { note: '只能取第一页' }),
        'item list': 'none',
        'item media': 'none',
        'item download': 'none',
        'item like': 'none',
        'item unlike': 'none',
        'item collect': 'none',
        'item uncollect': 'none',
        'item repost': 'none',
        'item unrepost': 'none',
        // post_weibo 的 visible：0 公开、1 仅自己、6 朋友圈（互相关注）、10 粉丝
        'item publish': impl('full', 'itemPublish', {
          supports: ['text', 'image', 'video', 'topic', 'visibility'],
          options: {
            visibility: visibility('public', 'private', 'friends', 'fans'),
            poiName: z.string().optional().describe('地点名称，发成「#名称[地点]#」的地点标签'),
          },
        }),
        'item delete': 'none',

        'comment list': impl('partial', 'commentList', { note: '只有一级评论' }),
        'comment replies': 'none',
        'comment add': 'none',
        'comment delete': 'none',
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': { upstream: 'none', options: { kind: filter.kind('recommend', 'hot', 'following') } },

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
        'keyword hot': 'none',

        'notice list': 'none',
        'notice count': 'none',

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

        'history list': 'none',
        'topic search': 'none',
        'poi search': 'none',
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
