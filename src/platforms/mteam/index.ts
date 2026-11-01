import { z } from 'zod'
import { definePlatform, handlers } from '../../core/registry.js'

const { impl } = handlers(() => import('./web/commands.js'))
const searchOptions = {
  mode: z.enum(['normal', 'movie', 'tvshow', 'music', 'anime', 'adult']).default('normal').describe('分区，默认综合区'),
  category: z.string().regex(/^\d+(,\d+)*$/, '分类须为数字 ID，多个用逗号分隔').optional().describe('分类 ID，来自 item categories，多个用逗号分隔'),
  free: z.boolean().optional().describe('只看免费资源'),
}

export default definePlatform({
  id: 'mteam',
  name: 'M-Team',
  aliases: ['mt', 'm-team', 'mantou'],
  item: '种子资源',
  pageInterval: 2500,
  endpoints: {
    web: {
      login: { methods: ['apikey'], default: 'apikey' },
      commands: {
        'auth login': impl('full', 'authLogin', {
          supports: [],
          options: {
            apiKeyFile: z.string().optional().describe('读取保存 API Key 的本地文件'),
            apiKeyStdin: z.boolean().optional().describe('从 stdin 读取 API Key'),
          },
          check: (_a, o) => o.apiKeyFile != null && o.apiKeyStdin === true ? '--api-key-file 与 --api-key-stdin 只能用一个' : undefined,
        }),
        'auth status': impl('full', 'authStatus'),
        'user get': impl('partial', 'userGet', { note: '只支持 me；PT 上传量、下载量等账号字段可用 --raw 查看' }),
        'item get': impl('full', 'itemGet', { output: 'Torrent' }),
        'item search': impl('full', 'itemSearch', { options: searchOptions, output: 'Torrent[]' }),
        'item categories': impl('full', 'itemCategories'),
        'item download': impl('full', 'itemDownload', { summary: '下载种子文件（.torrent）', note: '只保存种子文件；不启动 BT 下载。临时下载链接不输出' }),
        'feed list': impl('full', 'feedList', { summary: '浏览最新种子资源', options: searchOptions, output: 'Torrent[]' }),
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
