import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CatbusError } from '../../../core/errors.js'
import type { HttpClient } from '../../../core/http.js'
import { cacheDir } from '../../../core/paths.js'
import { jsonLoads } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Station } from '../../../core/schemas.js'
import { httpClient } from '../../../core/toolkit.js'
import { parseStations } from './normalize.js'

export const BASE = 'https://kyfw.12306.cn'
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
export const STATION_TTL_MS = 24 * 3600 * 1000

let leftTicketPath: string | undefined
let stationsMemo: Station[] | undefined

/** 清空会话状态（余票路径、车站缓存），测试用。 */
export function resetSession(): void {
  leftTicketPath = undefined
  stationsMemo = undefined
}

export function today(): string {
  return new Date(rand.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

export function checkDate(date?: string): string {
  const d = date ?? today()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new CatbusError('USAGE', '--date 格式是 YYYY-MM-DD')
  }
  if (d < today()) {
    throw new CatbusError('USAGE', `日期 ${d} 已过`, { hint: `从今天（${today()}）起，在 12306 预售期内` })
  }
  return d
}

export class TrainClient {
  readonly http: HttpClient

  constructor(readonly ctx: HandlerContext) {
    this.http = httpClient(ctx)
  }

  get leftTicketPath(): string | undefined {
    return leftTicketPath
  }

  set leftTicketPath(p: string | undefined) {
    leftTicketPath = p
  }

  async requestText(path: string, query?: Record<string, string>): Promise<string> {
    const url = new URL(path, BASE).toString()
    const headers: [string, string][] = [
      ['User-Agent', UA],
      ['Referer', `${BASE}/otn/leftTicket/init`],
    ]
    const res = await this.http.request({ url, query, headers, redirect: 'manual' })
    if ([301, 302, 403, 429].includes(res.status)) {
      const kind = res.status === 403 ? 'blocked' : 'rate_limit'
      throw new CatbusError('RISK_CONTROL', `12306 拒绝了请求（HTTP ${res.status}）`, {
        hint: '降低查询频率，几分钟后再试',
        detail: { kind, status: res.status },
      })
    }
    if (!res.ok) {
      throw new CatbusError('UPSTREAM', `12306 返回 HTTP ${res.status}`, {
        detail: { status: res.status },
      })
    }
    return res.text()
  }

  async requestJson<T = any>(path: string, query?: Record<string, string>): Promise<T> {
    const text = await this.requestText(path, query)
    try {
      return jsonLoads<T>(text)
    } catch {
      throw new CatbusError('UPSTREAM', '12306 返回的不是 JSON', {
        hint: '常见原因：日期超出预售期（约 15 天）、被限流或接口地址变更',
        detail: { path },
      })
    }
  }

  async ensureSession(): Promise<string> {
    if (leftTicketPath) return leftTicketPath
    const html = await this.requestText('/otn/leftTicket/init')
    leftTicketPath = `/otn/${html.match(/CLeftTicketUrl\s*=\s*'([^']+)'/)?.[1] ?? 'leftTicket/queryG'}`
    return leftTicketPath
  }

  async loadStations(): Promise<Station[]> {
    if (stationsMemo) return stationsMemo
    const file = join(cacheDir('12306'), 'stations.json')
    try {
      const cached = JSON.parse(await readFile(file, 'utf8'))
      if (rand.now() - cached.fetched_at < STATION_TTL_MS) {
        stationsMemo = cached.stations
        return cached.stations
      }
    } catch {}
    const js = await this.requestText('/otn/resources/js/framework/station_name.js')
    const stations = parseStations(js)
    if (!stations.length) {
      throw new CatbusError('UPSTREAM', '车站字典为空', { hint: '接口格式可能已变更' })
    }
    try {
      await mkdir(cacheDir('12306'), { recursive: true })
      await writeFile(file, JSON.stringify({ fetched_at: rand.now(), stations }))
    } catch {}
    stationsMemo = stations
    return stations
  }
}
