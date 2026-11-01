import { CatbusError } from '../../../core/errors.js'
import type { HandlerContext } from '../../../core/registry.js'
import { Client } from './client.js'
import { pageNumber } from './resolve.js'

export type Row = Record<string, any>
export interface SearchPage { pageNumber: number | string; pageSize: number | string; total: number | string; totalPages: number | string; data: Row[] }

/** 与官方接口对应。profile / detail / categoryList / genDlToken 使用表单，search 使用 JSON。 */
export class Api {
  readonly client: Client
  constructor(private readonly ctx: HandlerContext) { this.client = new Client(ctx) }

  async profile(): Promise<Row> {
    const value = await this.client.call<Row>('/member/profile')
    if (!value.id) throw new CatbusError('UPSTREAM', 'M-Team 个人资料缺少用户 ID')
    return value
  }

  async search(keyword = ''): Promise<SearchPage> {
    const value = await this.client.call<SearchPage>('/torrent/search', { json: {
      mode: this.ctx.options.mode ?? 'normal',
      categories: this.ctx.options.category ? String(this.ctx.options.category).split(',') : [],
      keyword,
      ...(this.ctx.options.free ? { discount: 'FREE' } : {}),
      pageNumber: pageNumber(this.ctx.cursor), pageSize: 20,
    } })
    if (!Array.isArray(value.data) || !Number.isInteger(Number(value.totalPages)) || Number(value.totalPages) < 0) {
      throw new CatbusError('UPSTREAM', 'M-Team 搜索响应的分页结构无效')
    }
    return value
  }

  async detail(id: string): Promise<Row> {
    const value = await this.client.call<Row>('/torrent/detail', { form: { id } })
    if (value.id == null || String(value.id) !== id) throw new CatbusError('UPSTREAM', 'M-Team 返回的种子详情与目标 ID 不匹配')
    return value
  }

  async categories(): Promise<Row[]> {
    const value = await this.client.call<{ list: Row[] }>('/torrent/categoryList')
    if (!Array.isArray(value.list)) throw new CatbusError('UPSTREAM', 'M-Team 分类响应缺少 list')
    return value.list
  }

  downloadUrl(id: string): Promise<string> {
    return this.client.call<string>('/torrent/genDlToken', { form: { id } })
  }
}
