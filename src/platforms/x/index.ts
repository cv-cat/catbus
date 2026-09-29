import { z } from 'zod'
import { filter, PUBLISH, QUOTE, visibility } from '../../core/options.js'
import { definePlatform, handlers } from '../../core/registry.js'

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const { h, impl } = handlers(() => import('./web/commands.js'))

export default definePlatform({
  id: 'x',
  name: 'X',
  aliases: ['twitter'],
  item: '推文',
  endpoints: {
    web: {
      // 上游的账密登录依赖 Castle token，不移植：只支持从浏览器导入 cookie
      login: { methods: ['cookie'], default: 'cookie' },
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('full', 'userGet'),
        'user search': impl('full', 'userSearch'),
        'user items': impl('full', 'userItems'),
        'user likes': 'none',
        'user collects': 'none',
        'user reposts': 'none',
        'user followers': 'none',
        'user following': 'none',
        'user follow': impl('full', 'userFollow'),
        'user unfollow': impl('full', 'userUnfollow'),

        'item get': impl('full', 'itemGet'),
        'item search': impl('full', 'itemSearch', {
          note: '--type video / image 走媒体搜索，按类型过滤，不能和 --sort latest 一起用',
          options: { sort: filter.sort('general', 'latest'), type: filter.type('all', 'video', 'image') },
        }),
        'item media': impl('full', 'itemMedia'),
        'item download': impl('full', 'itemDownload'),
        'item like': impl('full', 'itemLike'),
        'item unlike': impl('full', 'itemUnlike'),
        'item collect': impl('full', 'itemCollect'),
        'item uncollect': impl('full', 'itemUncollect'),
        'item repost': impl('full', 'itemRepost'),
        'item unrepost': impl('full', 'itemUnrepost'),
        'item publish': impl('full', 'itemPublish', {
          note: '正文超过 280 权重时自动按长推发（需要 Premium）；--thread 发 thread',
          supports: ['text', 'image', 'video', 'visibility'],
          options: {
            visibility: visibility('public'),
            quote: QUOTE,
            thread: z.array(z.string()).optional().describe('thread 的后续各条，依次回复上一条'),
          },
        }),
        'item delete': impl('full', 'itemDelete'),

        'comment list': impl('full', 'commentList'),
        'comment replies': 'none',
        'comment add': impl('full', 'commentAdd'),
        'comment delete': impl('full', 'commentDelete'),
        'comment like': impl('full', 'commentLike'),
        'comment unlike': impl('full', 'commentUnlike'),

        'feed list': impl('partial', 'feedList', {
          note: 'following 规划中',
          options: { kind: filter.kind('recommend', 'following') },
        }),

        'keyword suggest': 'none',
        'keyword hot': 'none',

        'notice list': 'none',
        'notice count': 'none',

        'msg list': impl('partial', 'msgList', { note: '只取收件箱首页（最近 20 个会话），上游没有翻页' }),
        'msg history': impl('partial', 'msgHistory', { note: '消息端到端加密，只给出占位消息' }),
        // 上游的 send_message 只是占位：X Chat 端到端加密，要先在网页设 passcode、再逆向加密后的发送请求
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

        // 平台扩展（AGENTS 4.7）
        'article publish': {
          upstream: 'full',
          summary: '发文章（Premium 长文）：建草稿，写标题、正文、封面，再发布',
          args: [],
          options: {
            title: z.string().optional().describe('标题，不给时取正文第一行的 # 标题'),
            text: z.string().describe('正文（Markdown），@file 表示从文件读取；独占一行的 ![](图片) 会上传成插图，相对路径按该文件所在目录解析'),
            cover: PUBLISH.cover,
          },
          auth: 'required',
          output: '{id url}',
          handler: h('articlePublish'),
        },
        'article delete': {
          upstream: 'full',
          summary: '删文章（草稿或已发布的）',
          args: [{ name: 'article', summary: '文章：ID 或 URL' }],
          auth: 'required',
          confirm: true,
          output: '{id}',
          handler: h('articleDelete'),
        },
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
