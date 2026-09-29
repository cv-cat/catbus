import { z } from 'zod'
import { CATEGORY, filter, PUBLISH, visibility } from '../../core/options.js'
import { type CommandDecl, definePlatform, handlers } from '../../core/registry.js'
import { type Args, type Options, VOCAB } from '../../core/vocab.js'

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const { h, impl } = handlers(() => import('./web/commands.js'))

const item = { name: 'item', summary: '稿件：BV 号、av 号或 URL' }
/** 评论区可以是稿件、专栏或动态，按参数形态识别（AGENTS 4.8：参数由平台归一化）。 */
const replyTarget = { name: 'item', summary: '稿件（BV 号、av 号、视频链接）、专栏（cv 号、专栏链接）或动态（动态链接、动态 ID；只支持纯文字和转发动态）' }
/** 动态的评论区（type 17）只对纯文字和转发动态成立，图文动态挂在相簿上，上游没有查相簿 ID 的接口。 */
const DYNAMIC_REPLY_NOTE = '动态只支持纯文字和转发：图文动态（带图）的评论区挂在相簿上，上游没有查相簿 ID 的接口；稿件、专栏不受影响'
/** 直播间参数也接受主播，按 get_room_by_mid 换成房间号。 */
const room = { name: 'room', summary: '直播间：房间号或 URL；也可以传主播（空间链接、uid:<mid>、me）' }
const draftId = { name: 'id', summary: '草稿 ID（article publish 返回的 id）' }
const FOLDER = z
  .string()
  .regex(/^\d+(,\d+)*$/, '收藏夹 id 是数字，多个用逗号分隔')
  .optional()
  .describe('收藏夹 id，多个用逗号分隔；取值来自 folder list')
const withRoom = (rest: CommandDecl['args'] = []) => ({ args: [room, ...(rest ?? [])] })

/** 弹幕样式（上游 send_danmaku 的 color / fontsize / mode），视频弹幕和直播弹幕共用。 */
const DANMAKU_STYLE = {
  color: z
    .string()
    .regex(/^(#[0-9a-fA-F]{6}|\d+)$/, '格式为 #RRGGBB 或十进制数')
    .optional()
    .describe('颜色：#RRGGBB 或十进制，默认白色'),
  fontSize: z.number().int().positive().optional().describe('字号：18 小、25 标准（默认）'),
  position: z.enum(['scroll', 'top', 'bottom']).optional().describe('位置：scroll 滚动（默认）、top 顶部、bottom 底部'),
}

const LIVE_STYLE_KEYS = ['color', 'fontSize', 'position', 'replyUser'] as const

function liveSendCheck(a: Args, o: Options): string | undefined {
  const base = VOCAB['live send']!.check?.(a, o)
  if (base) return base
  if (o.gift != null && LIVE_STYLE_KEYS.some((k) => o[k] != null)) return '--color、--font-size、--position、--reply-user 只用于发弹幕，不能和 --gift 一起用'
}

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
        'user items': impl('full', 'userItems', {
          options: { sort: filter.sort('latest', 'views', 'collects'), keyword: z.string().optional().describe('只看投稿里匹配关键词的') },
        }),
        'user collects': 'none',
        'user followers': 'none',
        'user following': 'none',
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': impl('full', 'itemGet'),
        'item search': impl('full', 'itemSearch', {
          options: { sort: filter.sort('general', 'views', 'latest', 'collects'), type: filter.type('video', 'article') },
        }),
        'item related': impl('full', 'itemRelated'),
        'item list': impl('full', 'itemList'),
        'item media': impl('full', 'itemMedia'),
        'item download': impl('full', 'itemDownload'),
        'item like': impl('full', 'itemLike'),
        'item unlike': impl('full', 'itemUnlike'),
        'item collect': impl('full', 'itemCollect', { options: { folder: FOLDER } }),
        'item uncollect': impl('full', 'itemUncollect', { options: { folder: FOLDER } }),
        'item publish': impl('full', 'itemPublish', {
          supports: ['title', 'text', 'video', 'cover', 'tag', 'category', 'visibility'],
          options: {
            visibility: visibility('public', 'private'),
            source: z.string().optional().describe('转载来源；给出时按转载投稿，不给为自制'),
            dynamic: z.string().optional().describe('同步到动态的文案'),
            allowReprint: z.boolean().optional().describe('允许转载，默认禁止'),
          },
        }),
        'item delete': impl('partial', 'itemDelete', { note: '需要人机验证（极验点选），catbus 还不能自动通过，会报 RISK_CONTROL' }),
        'item categories': impl('full', 'itemCategories'),

        'comment list': impl('partial', 'commentList', { note: DYNAMIC_REPLY_NOTE, args: [replyTarget], options: { sort: filter.sort('popular', 'latest') } }),
        'comment replies': 'none',
        'comment add': impl('partial', 'commentAdd', {
          note: DYNAMIC_REPLY_NOTE,
          args: [replyTarget, { name: 'text', summary: '评论内容' }],
          options: { root: z.string().regex(/^\d+$/, '评论 ID 是数字').optional().describe('根评论 ID：回复楼中楼时用，--reply-to 给被回复的那条') },
          check: (_a, o) => (o.root != null && o.replyTo == null ? '--root 要和 --reply-to 一起用' : undefined),
        }),
        'comment delete': impl('partial', 'commentDelete', { note: DYNAMIC_REPLY_NOTE, args: [replyTarget, { name: 'comment', summary: '评论 ID' }] }),
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': impl('partial', 'feedList', {
          note: 'following 规划中',
          options: { kind: filter.kind('recommend', 'hot', 'following') },
        }),

        'live get': impl('full', 'liveGet', withRoom()),
        'live list': 'none',
        'live search': impl('full', 'liveSearch'),
        'live categories': impl('full', 'liveCategories'),
        'live listen': impl('full', 'liveListen', withRoom()),
        'live history': impl('full', 'liveHistory', withRoom()),
        'live send': impl('full', 'liveSend', {
          ...withRoom([{ name: 'text', summary: '弹幕内容', optional: true }]),
          options: { ...DANMAKU_STYLE, replyUser: z.string().optional().describe('回复的观众：UID 或空间链接') },
          check: liveSendCheck,
        }),
        'live like': 'none',
        'live rank': 'none',
        'live gifts': impl('full', 'liveGifts', withRoom()),
        'live media': impl('full', 'liveMedia', withRoom()),
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

        'folder list': impl('partial', 'folderList', { note: '只列用户自己创建的收藏夹，一次返回全部' }),
        'folder items': impl('partial', 'folderItems', {
          note: '非上游：上游没有收藏夹内容接口，请求按网页端收藏夹页补的（x/v3/fav/resource/list），没有对拍；只列出稿件',
          args: [{ name: 'folder', summary: '收藏夹：ID 或 folder list 输出的 url' }],
        }),
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
          options: {
            count: z.number().int().min(1).max(2).default(1).describe('投币数量，1 或 2'),
            like: z.boolean().optional().describe('同时点赞'),
          },
          auth: 'required',
          confirm: true,
          output: '{id}',
          handler: h('itemCoin'),
        },
        'item triple': { upstream: 'full', summary: '一键三连', args: [item], auth: 'required', confirm: true, output: '{id}', handler: h('itemTriple') },
        'item subtitles': { upstream: 'full', summary: '字幕', args: [item], auth: 'required', output: 'Subtitle[]', handler: h('itemSubtitles') },
        'danmaku list': { upstream: 'full', summary: '视频弹幕', args: [item], auth: 'required', output: 'Danmaku[]', handler: h('danmakuList') },
        'danmaku send': {
          upstream: 'full',
          summary: '发视频弹幕',
          args: [item, { name: 'text', summary: '弹幕内容' }],
          options: { offset: z.number().nonnegative().describe('出现在视频的第几秒'), ...DANMAKU_STYLE },
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
          args: [{ name: 'id', summary: '动态：ID 或链接（dynamic publish 输出的 id、url）' }],
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
            category: z.string().regex(/^\d+$/, '专栏分区 ID 是数字').optional().describe('专栏分区 ID（数字），默认 0；catbus 没有专栏分区列表命令'),
            tag: PUBLISH.tag,
            summary: z.string().optional().describe('摘要'),
            draft: z.boolean().optional().describe('只存草稿，不提交'),
          },
          auth: 'required',
          output: '{id url}',
          handler: h('articlePublish'),
        },
        'draft get': { upstream: 'full', summary: '专栏草稿', args: [draftId], auth: 'required', output: 'Item', handler: h('draftGet') },
        'draft delete': {
          upstream: 'full',
          summary: '删专栏草稿',
          args: [draftId],
          auth: 'required',
          confirm: true,
          output: '{id}',
          handler: h('draftDelete'),
        },
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
