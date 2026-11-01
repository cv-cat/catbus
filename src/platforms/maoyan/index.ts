import { z } from 'zod'
import { CATEGORY, filter } from '../../core/options.js'
import { definePlatform, handlers } from '../../core/registry.js'

const { impl } = handlers(() => import('./web/commands.js'))

export default definePlatform({
  id: 'maoyan',
  name: '猫眼演出',
  aliases: [],
  item: '演出',
  endpoints: {
    web: {
      guest: true,
      login: { methods: [] },
      commands: {
        'item get': impl('full', 'itemGet', { note: '场次时间、场馆、票价档、售卖状态写在 text 里；场次 / 票档 / 余票要 App 登录态，不提供' }),
        'item search': 'none',
        'feed list': impl('full', 'feedList', {
          summary: '城市热门演出（在售 / 预售）',
          note: '一次返回该城市的全部热门演出，没有分页；--category 在本地筛选',
          options: {
            kind: filter.kind('recommend'),
            category: CATEGORY,
            city: z.string().default('北京').describe('城市：城市名或演出城市 ID，取值见 poi search'),
          },
        }),
        'feed categories': impl('full', 'feedCategories', { summary: '演出分类，即 feed list --category 的取值' }),
        'poi search': impl('partial', 'poiSearch', {
          summary: '搜索演出城市',
          note: '只搜演出城市（内置城市表），id 即 feed list --city 的取值',
        }),
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
