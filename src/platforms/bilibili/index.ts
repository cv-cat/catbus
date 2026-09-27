import { z } from 'zod'
import { CATEGORY, filter, PUBLISH } from '../../core/options.js'
import { type CommandDecl, definePlatform, type Handler, type Upstream } from '../../core/registry.js'

type Commands = typeof import('./web/commands.js')

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const h =
  (name: keyof Commands) =>
  (): Promise<Handler> =>
    import('./web/commands.js').then((m) => m[name] as Handler)

const impl = (upstream: Upstream, name: keyof Commands, extra: Partial<CommandDecl> = {}): CommandDecl => ({ upstream, handler: h(name), ...extra })

const item = { name: 'item', summary: '稿件：BV 号、av 号或 URL' }

export default definePlatform({
  id: 'bilibili',
  name: 'B 站',
  aliases: ['bili', 'b'],
  item: '稿件',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'password', 'cookie'], default: 'qrcode' },
      logout: h('serverLogout'),
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('full', 'userGet'),
        'user search': impl('full', 'userSearch'),
        'user items': impl('full', 'userItems', { options: { sort: filter.sort('latest', 'views', 'collects') } }),
        'user collects': 'none',
        'user followers': 'none',
        'user following': 'none',
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': impl('full', 'itemGet'),
        'item search': impl('full', 'itemSearch', { options: { sort: filter.sort('general', 'views', 'latest', 'collects') } }),
        'item related': 'none',
        'item list': impl('full', 'itemList'),
        'item media': impl('full', 'itemMedia'),
        'item download': impl('full', 'itemDownload'),
        'item like': impl('full', 'itemLike'),
        'item unlike': impl('full', 'itemUnlike'),
        'item collect': impl('full', 'itemCollect'),
        'item uncollect': impl('full', 'itemUncollect'),
        'item publish': impl('full', 'itemPublish'),
        'item delete': impl('full', 'itemDelete'),
        'item categories': impl('full', 'itemCategories'),

        'comment list': impl('full', 'commentList'),
        'comment replies': 'none',
        'comment add': impl('full', 'commentAdd'),
        'comment delete': impl('full', 'commentDelete'),
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': impl('partial', 'feedList', {
          note: 'following 规划中',
          options: { kind: filter.kind('recommend', 'hot', 'following') },
        }),

        'live get': impl('full', 'liveGet'),
        'live list': 'none',
        'live search': impl('full', 'liveSearch'),
        'live categories': impl('full', 'liveCategories'),
        'live listen': impl('full', 'liveListen'),
        'live history': impl('full', 'liveHistory'),
        'live send': impl('full', 'liveSend'),
        'live like': 'none',
        'live rank': 'none',
        'live gifts': impl('full', 'liveGifts'),
        'live media': impl('full', 'liveMedia'),
        'live replays': 'none',
        'live start': impl('full', 'liveStart', { options: { category: CATEGORY } }),
        'live stop': impl('full', 'liveStop'),

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

        'folder list': impl('partial', 'folderList'),
        'folder items': impl('partial', 'folderItems'),
        'folder create': 'none',
        'folder update': 'none',
        'folder delete': 'none',

        'series list': 'none',
        'series items': 'none',

        'history list': 'none',
        'topic search': 'none',

        // 平台扩展（AGENTS 4.7）
        'item coin': {
          upstream: 'full',
          summary: '投币',
          args: [item],
          options: { count: z.number().int().min(1).max(2).default(1).describe('投币数量，1 或 2') },
          auth: 'required',
          confirm: true,
          output: '{id}',
          handler: h('itemCoin'),
        },
        'item triple': { upstream: 'full', summary: '一键三连', args: [item], auth: 'required', confirm: true, output: '{id}', handler: h('itemTriple') },
        'item subtitles': { upstream: 'full', summary: '字幕', args: [item], auth: 'optional', output: 'Subtitle[]', handler: h('itemSubtitles') },
        'danmaku list': { upstream: 'full', summary: '视频弹幕', args: [item], auth: 'optional', output: 'Danmaku[]', handler: h('danmakuList') },
        'danmaku send': {
          upstream: 'full',
          summary: '发视频弹幕',
          args: [item, { name: 'text', summary: '弹幕内容' }],
          options: { offset: z.number().nonnegative().describe('出现在视频的第几秒') },
          auth: 'required',
          output: '{id}',
          handler: h('danmakuSend'),
        },
        'dynamic publish': {
          upstream: 'full',
          summary: '发动态',
          args: [],
          options: { text: z.string().describe('正文，@file 表示从文件读取'), image: PUBLISH.image },
          auth: 'required',
          output: '{id url}',
          handler: h('dynamicPublish'),
        },
        'dynamic delete': {
          upstream: 'full',
          summary: '删动态',
          args: [{ name: 'id', summary: '动态 ID' }],
          auth: 'required',
          confirm: true,
          output: '{id}',
          handler: h('dynamicDelete'),
        },
        'article publish': {
          upstream: 'full',
          summary: '发专栏：先存草稿，再提交',
          args: [],
          options: {
            title: z.string().describe('标题'),
            text: z.string().describe('正文（HTML），@file 表示从文件读取'),
            cover: PUBLISH.cover,
            category: CATEGORY,
          },
          auth: 'required',
          output: '{id url}',
          handler: h('articlePublish'),
        },
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
