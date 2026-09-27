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
  id: 'x',
  name: 'X',
  aliases: ['twitter'],
  item: '推文',
  endpoints: {
    web: {
      login: { methods: ['password', 'cookie'], default: 'cookie' },
      commands: {
        'auth login': impl('full', 'authLogin', { note: '账密登录尚未实现，用 --method cookie' }),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('full', 'userGet'),
        // 搜索、评论区、推荐流在未登录时 X 直接返回 404
        'user search': impl('full', 'userSearch', { auth: 'required' }),
        'user items': impl('full', 'userItems'),
        'user likes': 'none',
        'user collects': 'none',
        'user reposts': 'none',
        'user followers': 'none',
        'user following': 'none',
        'user follow': impl('full', 'userFollow'),
        'user unfollow': impl('full', 'userUnfollow'),

        'item get': impl('full', 'itemGet'),
        'item search': impl('full', 'itemSearch', { auth: 'required', options: { sort: filter.sort('general', 'latest') } }),
        'item media': impl('full', 'itemMedia'),
        'item download': impl('full', 'itemDownload'),
        'item like': impl('full', 'itemLike'),
        'item unlike': impl('full', 'itemUnlike'),
        'item collect': impl('full', 'itemCollect'),
        'item uncollect': impl('full', 'itemUncollect'),
        'item repost': impl('full', 'itemRepost'),
        'item unrepost': impl('full', 'itemUnrepost'),
        'item publish': impl('full', 'itemPublish'),
        'item delete': impl('full', 'itemDelete'),

        'comment list': impl('full', 'commentList', { auth: 'required' }),
        'comment replies': 'none',
        'comment add': impl('full', 'commentAdd'),
        'comment delete': impl('full', 'commentDelete'),
        'comment like': impl('full', 'commentLike'),
        'comment unlike': impl('full', 'commentUnlike'),

        'feed list': impl('partial', 'feedList', {
          note: 'following 规划中',
          auth: 'required',
          options: { kind: filter.kind('recommend', 'following') },
        }),

        'keyword suggest': 'none',
        'keyword hot': 'none',

        'notice list': 'none',
        'notice count': 'none',

        'msg list': impl('full', 'msgList'),
        'msg history': impl('partial', 'msgHistory', { note: '消息端到端加密，只给出占位消息' }),
        // 上游的 send_message 只是占位
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
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
