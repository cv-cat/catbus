import { z } from 'zod'
import { definePlatform, handlers } from '../../core/registry.js'

const { impl } = handlers(() => import('./web/commands.js'))
const modeOption = z.enum(['normal', 'movie', 'tvshow', 'music', 'anime', 'adult']).default('normal').describe('分区，默认综合区')
const searchOptions = {
  mode: modeOption,
  category: z.string().regex(/^\d+(,\d+)*$/, '分类须为数字 ID，多个用逗号分隔').optional().describe('分类 ID，来自 item categories，多个用逗号分隔'),
  free: z.boolean().optional().describe('只看免费资源'),
  orderBy: z.enum(['date', 'size', 'seeders', 'leechers', 'name']).optional().describe('排序字段：date 发布时间、size 大小、seeders 做种数、leechers 下载数、name 名称；默认按站点置顶与发布时间'),
  asc: z.boolean().optional().describe('配合 --order-by 升序排列，默认降序'),
}

export default definePlatform({
  id: 'mteam',
  name: 'M-Team',
  aliases: ['mt', 'm-team', 'mantou'],
  item: '种子资源',
  pageInterval: 2500,
  endpoints: {
    web: {
      login: { methods: ['apikey', 'password'], default: 'apikey' },
      commands: {
        'auth login': impl('full', 'authLogin', {
          supports: ['username', 'passwordStdin', 'code'],
          note: 'password：网页账密登录，新设备需要两步验证（--email 发邮箱验证码，或 TOTP），再用 --code 完成；站内信只支持这种登录',
          options: {
            apiKeyFile: z.string().optional().describe('读取保存 API Key 的本地文件（apikey）'),
            apiKeyStdin: z.boolean().optional().describe('从 stdin 读取 API Key（apikey）'),
            email: z.string().regex(/^[^\s@]+@[^\s@]+$/, '邮箱格式不对').optional().describe('账号绑定的邮箱，用于接收两步验证码（password）'),
          },
          check: (_a, o) => o.apiKeyFile != null && o.apiKeyStdin === true ? '--api-key-file 与 --api-key-stdin 只能用一个' : undefined,
        }),
        'auth status': impl('full', 'authStatus'),
        'user get': impl('partial', 'userGet', { note: '只支持 me；PT 上传量、下载量等账号字段可用 --raw 查看' }),
        'user collects': impl('partial', 'userCollects', { options: { mode: modeOption }, output: 'Torrent[]', note: '只支持 me；按分区列出（--mode）' }),
        'item get': impl('full', 'itemGet', { output: 'Torrent' }),
        'item search': impl('full', 'itemSearch', { options: searchOptions, output: 'Torrent[]' }),
        'item categories': impl('full', 'itemCategories'),
        'item download': impl('full', 'itemDownload', {
          summary: '下载种子文件（.torrent），可选推送到 qBittorrent',
          note: '种子文件含个人 passkey，权限 0600，临时下载链接不输出；--qbit 推送到本机 qBittorrent Web UI（CATBUS_MTEAM_QBIT_URL，默认 http://127.0.0.1:25254）',
          options: {
            qbit: z.boolean().optional().describe('下载后推送到 qBittorrent'),
            qbitCategory: z.string().optional().describe('qBittorrent 分类，默认 mteam'),
            qbitPaused: z.boolean().optional().describe('推送后先暂停'),
          },
        }),
        'item collect': impl('full', 'itemCollect'),
        'item uncollect': impl('full', 'itemUncollect'),
        'feed list': impl('full', 'feedList', { summary: '浏览最新种子资源', options: searchOptions, output: 'Torrent[]' }),
        'msg list': impl('partial', 'msgList', {
          summary: '站内信列表（每条站内信一项）',
          note: '只读，需要账密登录；--box 选收件箱 / 系统通知 / 发件箱',
          options: { box: z.enum(['inbox', 'system', 'sent']).default('inbox').describe('信箱：inbox 收件箱（默认）、system 系统通知、sent 发件箱') },
        }),
        'msg history': impl('partial', 'msgHistory', { summary: '读取一条站内信', note: '<conversation> 为 msg list 输出的 id；不会标记为已读' }),
        'seed list': impl('full', 'seedList', {
          summary: '我的做种 / 下载中 / 已完成 / 未完成 / 已发布列表',
          args: [],
          options: {
            status: z.enum(['seeding', 'leeching', 'completed', 'incomplete', 'uploaded']).default('seeding').describe('列表类型，默认 seeding'),
          },
          auth: 'required',
          paged: true,
          output: 'Torrent[]',
        }),
        'seed stats': impl('full', 'seedStats', {
          summary: 'tracker 上当前的做种数和下载数',
          args: [],
          auth: 'required',
          output: '{seeding leeching}',
        }),
        'exam get': impl('full', 'examGet', {
          summary: '进行中的考核（新人考核等）的进度',
          note: 'items 依次为 download / upload（字节）和 bonus（魔力值），各带 current、target、done；没有进行中的考核时返回空数组',
          args: [],
          auth: 'required',
          output: '{id title status start_at end_at note items[{name current target done}]}[]',
        }),
        'bonus get': impl('full', 'bonusGet', {
          summary: '时魔：每小时魔力值、A 值、计入时魔的做种数和体积',
          args: [],
          auth: 'required',
          output: '{per_hour a seeding_count seeding_size_gb two_factor}',
        }),
        'bonus history': impl('full', 'bonusHistory', {
          summary: '魔力值、上传量、下载量的变动记录',
          args: [],
          auth: 'required',
          paged: true,
          output: 'BonusRecord[]',
        }),
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
