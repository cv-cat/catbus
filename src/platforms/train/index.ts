import { z } from 'zod'
import { definePlatform, handlers } from '../../core/registry.js'

const { impl } = handlers(() => import('./web/commands.js'))

export default definePlatform({
  id: 'train',
  name: '12306 铁路',
  aliases: ['12306'],
  item: '车次',
  endpoints: {
    web: {
      guest: true,
      login: { methods: [] },
      commands: {
        'station search': impl('full', 'stationSearch', {
          summary: '车站搜索',
          args: [{ name: 'keyword', summary: '搜索关键词（站名 / 拼音 / 电报码）' }],
          auth: 'optional',
          output: 'Station[]',
        }),
        'ticket search': impl('full', 'ticketSearch', {
          summary: '直达车次与余票',
          args: [
            { name: 'from', summary: '出发地（站名 / 电报码 / 拼音 / 城市）' },
            { name: 'to', summary: '目的地（站名 / 电报码 / 拼音 / 城市）' },
          ],
          options: {
            date: z.string().optional().describe('乘车日期（YYYY-MM-DD），默认今天'),
            type: z.string().optional().describe('车型过滤（如 G,D），逗号分隔'),
            available: z.boolean().optional().describe('只看有票车次'),
          },
          auth: 'optional',
          output: 'Ticket[]',
        }),
        'ticket price': impl('full', 'ticketPrice', {
          summary: '票价详情',
          args: [{ name: 'train', summary: '车次编号（train_no，如 240000G53106）' }],
          options: {
            fromNo: z.string().describe('出发站序号（取自 ticket search 的 from.no）'),
            toNo: z.string().describe('到达站序号（取自 ticket search 的 to.no）'),
            seatTypes: z.string().describe('席别编码（取自 ticket search 的 seat_types）'),
            date: z.string().optional().describe('乘车日期（YYYY-MM-DD），默认今天'),
          },
          auth: 'optional',
          output: 'Fare',
        }),
        'route get': impl('full', 'routeGet', {
          summary: '经停站与时刻',
          args: [
            { name: 'train', summary: '车次编号（train_no，如 240000G53106）' },
            { name: 'from', summary: '出发地（站名 / 电报码 / 拼音 / 城市）' },
            { name: 'to', summary: '目的地（站名 / 电报码 / 拼音 / 城市）' },
          ],
          options: {
            date: z.string().optional().describe('乘车日期（YYYY-MM-DD），默认今天'),
          },
          auth: 'optional',
          output: 'Stop[]',
        }),
        'transfer search': impl('full', 'transferSearch', {
          summary: '中转方案搜索',
          args: [
            { name: 'from', summary: '出发地（站名 / 电报码 / 拼音 / 城市）' },
            { name: 'to', summary: '目的地（站名 / 电报码 / 拼音 / 城市）' },
          ],
          options: {
            date: z.string().optional().describe('乘车日期（YYYY-MM-DD），默认今天'),
            via: z.string().optional().describe('指定中转站'),
            limit: z.number().int().positive().optional().describe('方案数量限制'),
          },
          auth: 'optional',
          output: 'Transfer[]',
        }),
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
