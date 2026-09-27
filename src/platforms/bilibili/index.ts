import { z } from 'zod'
import { CATEGORY, filter, PUBLISH } from '../../core/options.js'
import { definePlatform } from '../../core/registry.js'

const item = { name: 'item', summary: '稿件：BV 号、av 号或 URL' }

export default definePlatform({
  id: 'bilibili',
  name: 'B 站',
  aliases: ['bili', 'b'],
  item: '稿件',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'password', 'cookie'], default: 'qrcode' },
      commands: {
        'auth login': 'full',
        'auth status': 'full',

        'user get': 'full',
        'user search': 'full',
        'user items': 'full',
        'user collects': 'none',
        'user followers': 'none',
        'user following': 'none',
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': 'full',
        'item search': 'full',
        'item related': 'none',
        'item list': 'full',
        'item media': 'full',
        'item download': 'full',
        'item like': 'full',
        'item unlike': 'full',
        'item collect': 'full',
        'item uncollect': 'full',
        'item publish': 'full',
        'item delete': 'full',
        'item categories': 'full',

        'comment list': 'full',
        'comment replies': 'none',
        'comment add': 'full',
        'comment delete': 'full',
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': {
          upstream: 'partial',
          note: 'following 规划中',
          options: { kind: filter.kind('recommend', 'hot', 'following') },
        },

        'live get': 'full',
        'live list': 'none',
        'live search': 'full',
        'live categories': 'full',
        'live listen': 'full',
        'live history': 'full',
        'live send': 'full',
        'live like': 'none',
        'live rank': 'none',
        'live gifts': 'full',
        'live media': 'full',
        'live replays': 'none',
        'live start': 'full',
        'live stop': 'full',

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

        'media upload': 'full',

        'folder list': 'partial',
        'folder items': 'partial',
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
        },
        'item triple': { upstream: 'full', summary: '一键三连', args: [item], auth: 'required', confirm: true, output: '{id}' },
        'item subtitles': { upstream: 'full', summary: '字幕', args: [item], auth: 'optional', output: 'Subtitle[]' },
        'danmaku list': { upstream: 'full', summary: '视频弹幕', args: [item], auth: 'optional', output: 'Danmaku[]' },
        'danmaku send': {
          upstream: 'full',
          summary: '发视频弹幕',
          args: [item, { name: 'text', summary: '弹幕内容' }],
          options: { offset: z.number().nonnegative().describe('出现在视频的第几秒') },
          auth: 'required',
          output: '{id}',
        },
        'dynamic publish': {
          upstream: 'full',
          summary: '发动态',
          args: [],
          options: { text: z.string().describe('正文，@file 表示从文件读取'), image: PUBLISH.image },
          auth: 'required',
          output: '{id url}',
        },
        'dynamic delete': {
          upstream: 'full',
          summary: '删动态',
          args: [{ name: 'id', summary: '动态 ID' }],
          auth: 'required',
          confirm: true,
          output: '{id}',
        },
        'article publish': {
          upstream: 'full',
          summary: '发专栏：先存草稿，再提交',
          args: [],
          options: {
            title: z.string().describe('标题'),
            text: z.string().describe('正文，@file 表示从文件读取'),
            cover: PUBLISH.cover,
            category: CATEGORY,
          },
          auth: 'required',
          output: '{id url}',
        },
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
