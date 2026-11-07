import { CatbusError } from '../../../core/errors.js'
import type { HandlerContext } from '../../../core/registry.js'
import { Client } from './client.js'
import { pageNumber } from './resolve.js'

export type Row = Record<string, any>
export interface SearchPage { pageNumber: number | string; pageSize: number | string; total: number | string; totalPages: number | string; data: Row[] }

/** 每页条数（search / getUserTorrentList / credit/logs / msg/search 一致）。 */
export const PAGE_SIZE = 20

/** --order-by → 站点 sortField（前端种子列表的列排序）。 */
const SORT_FIELDS: Record<string, string> = { date: 'CREATED_DATE', size: 'SIZE', seeders: 'SEEDERS', leechers: 'LEECHERS', name: 'NAME' }

/** 站内信信箱：收件箱 1、系统通知 -2、发件箱 -1（站点前端的路由参数）。 */
export const BOXES = { inbox: '1', system: '-2', sent: '-1' } as const

/** 与官方接口对应。profile / detail / categoryList / genDlToken / collection / msg 使用表单，search / 列表类使用 JSON。 */
export class Api {
  readonly client: Client
  constructor(private readonly ctx: HandlerContext) { this.client = new Client(ctx) }

  async profile(): Promise<Row> {
    const value = await this.client.call<Row>('/member/profile')
    if (!value.id) throw new CatbusError('UPSTREAM', 'M-Team 个人资料缺少用户 ID')
    return value
  }

  async search(keyword = '', options: { onlyFav?: boolean } = {}): Promise<SearchPage> {
    const value = await this.client.call<SearchPage>('/torrent/search', { json: {
      mode: this.ctx.options.mode ?? 'normal',
      categories: this.ctx.options.category ? String(this.ctx.options.category).split(',') : [],
      keyword,
      ...(this.ctx.options.free ? { discount: 'FREE' } : {}),
      ...(options.onlyFav ? { onlyFav: 1 } : {}),
      ...(this.ctx.options.orderBy ? { sortField: SORT_FIELDS[String(this.ctx.options.orderBy)], sortDirection: this.ctx.options.asc ? 'ASC' : 'DESC' } : {}),
      pageNumber: pageNumber(this.ctx.cursor), pageSize: PAGE_SIZE,
    } })
    return checkPage(value, '搜索')
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

  /** 收藏 / 取消收藏：make 为目标状态，重复设置不报错。 */
  async collect(id: string, make: boolean): Promise<void> {
    await this.client.call<unknown>('/torrent/collection', { form: { id, make: String(make) } }, { nullable: true })
  }

  /** 用户的做种 / 下载中 / 已完成 / 未完成 / 已发布列表。每行是 `{ torrent, peer }`。 */
  async userTorrents(userId: string, type: string): Promise<SearchPage> {
    const value = await this.client.call<SearchPage>('/member/getUserTorrentList', { json: {
      userid: userId, type, pageNumber: pageNumber(this.ctx.cursor), pageSize: PAGE_SIZE,
    } })
    return checkPage(value, '种子列表')
  }

  /** 魔力值 / 上传量 / 下载量的变动记录。 */
  async creditLogs(userId: string): Promise<SearchPage> {
    const value = await this.client.call<SearchPage>('/credit/logs', { json: {
      uid: userId, pageNumber: pageNumber(this.ctx.cursor), pageSize: PAGE_SIZE, type: null,
    } })
    return checkPage(value, '魔力值记录')
  }

  /** 进行中的考核（新人考核等）。 */
  async exams(): Promise<Row[]> {
    const value = await this.client.call<Row[]>('/examine/getMyActiveList', {}, { nullable: true })
    if (value != null && !Array.isArray(value)) throw new CatbusError('UPSTREAM', 'M-Team 考核响应不是列表')
    return value ?? []
  }

  /** 时魔：每小时魔力值及计算参数。 */
  async bonusRate(): Promise<Row> {
    const value = await this.client.call<Row>('/tracker/mybonus')
    if (!value.formulaParams) throw new CatbusError('UPSTREAM', 'M-Team 时魔响应缺少 formulaParams')
    return value
  }

  /** tracker 上当前的做种 / 下载数。 */
  async peerStatus(): Promise<Row> {
    return this.client.call<Row>('/tracker/myPeerStatus')
  }

  /** 站内信列表。只有网页登录的会话能调用。 */
  async messages(box: string): Promise<SearchPage> {
    this.requireWeb('站内信')
    const value = await this.client.call<SearchPage>('/msg/search', { form: {
      box, keyword: '', pageNumber: String(pageNumber(this.ctx.cursor)), pageSize: String(PAGE_SIZE),
    } })
    return checkPage(value, '站内信列表')
  }

  /** 读取一条站内信。站点的「已读」由单独的 markRead 接口设置，这里不调用，读取后仍保持未读。 */
  async message(id: string): Promise<Row> {
    this.requireWeb('站内信')
    const value = await this.client.call<Row>('/msg/read', { form: { msgId: id } })
    if (value.id == null || String(value.id) !== id) throw new CatbusError('UPSTREAM', 'M-Team 返回的站内信与目标 ID 不匹配')
    return value
  }

  private requireWeb(what: string) {
    if (!this.client.webSession) {
      throw new CatbusError('UNSUPPORTED', `M-Team 的${what}接口不接受 API Key，需要账密登录的会话`, {
        hint: `catbus mteam auth login --method password --username <用户名> --password-stdin${this.ctx.account ? ` -a ${this.ctx.account}` : ''}`,
      })
    }
  }
}

function checkPage(value: SearchPage, what: string): SearchPage {
  if (!value || !Array.isArray(value.data) || !Number.isInteger(Number(value.totalPages)) || Number(value.totalPages) < 0) {
    throw new CatbusError('UPSTREAM', `M-Team ${what}响应的分页结构无效`)
  }
  return value
}
