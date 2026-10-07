import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, test } from 'vitest'
import { cli } from '../helpers.js'
import { shapeOf } from './shapes.js'

/**
 * 12306 铁路平台在线 E2E 测试（AGENTS 7.5）：
 * 12306 查询为免登录公开接口，按真实用户链路串联测试：
 * 车站搜索 -> 直达余票查询 -> 票价查询 & 经停时刻 -> 中转方案搜索。
 */

function futureDate(daysAhead = 3): string {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  return d.toISOString().slice(0, 10)
}

describe('12306', () => {
  const date = futureDate(3)
  let sampleTicket: any = null

  test('station search', async (ctx) => {
    await sleep(1000)
    const r = await cli('12306', 'station', 'search', '北京', '-q')
    const env = r.env
    expect(env, r.stdout + r.stderr).toBeTruthy()
    if (env.error?.code === 'RISK_CONTROL') ctx.skip(`平台风控：${env.error.message}`)

    expect(env.ok, JSON.stringify(env.error)).toBe(true)
    expect(env.platform).toBe('12306')
    expect(Array.isArray(env.data)).toBe(true)
    expect(env.data.length).toBeGreaterThan(0)

    const parsed = shapeOf('Station[]').safeParse(env.data)
    expect(parsed.success, parsed.error ? JSON.stringify(parsed.error.issues.slice(0, 5)) : '').toBe(true)

    const names = env.data.map((s: any) => s.name)
    expect(names).toContain('北京')
    expect(names).toContain('北京南')
  })

  test('ticket search', async (ctx) => {
    await sleep(1500)
    const r = await cli('12306', 'ticket', 'search', '北京', '上海', '--date', date, '-q')
    const env = r.env
    expect(env, r.stdout + r.stderr).toBeTruthy()
    if (env.error?.code === 'RISK_CONTROL') ctx.skip(`平台风控：${env.error.message}`)

    expect(env.ok, JSON.stringify(env.error)).toBe(true)
    expect(env.platform).toBe('12306')
    expect(Array.isArray(env.data)).toBe(true)
    expect(env.data.length).toBeGreaterThan(0)

    const parsed = shapeOf('Ticket[]').safeParse(env.data)
    expect(parsed.success, parsed.error ? JSON.stringify(parsed.error.issues.slice(0, 5)) : '').toBe(true)

    // 保存一个有效车次用于后续票价和经停测试
    sampleTicket = env.data.find((t: any) => t.train_no && t.from?.no && t.to?.no && t.seat_types) ?? env.data[0]
    expect(sampleTicket).toBeTruthy()
    expect(sampleTicket.url).toContain('leftTicket/init')
  })

  test('ticket price', async (ctx) => {
    if (!sampleTicket) ctx.skip('未在前置 ticket search 中获得有效车次')
    await sleep(1500)

    const r = await cli(
      '12306',
      'ticket',
      'price',
      sampleTicket.train_no,
      '--from-no',
      sampleTicket.from.no,
      '--to-no',
      sampleTicket.to.no,
      '--seat-types',
      sampleTicket.seat_types,
      '--date',
      date,
      '-q',
    )
    const env = r.env
    expect(env, r.stdout + r.stderr).toBeTruthy()
    if (env.error?.code === 'RISK_CONTROL') ctx.skip(`平台风控：${env.error.message}`)

    expect(env.ok, JSON.stringify(env.error)).toBe(true)
    expect(env.platform).toBe('12306')
    const parsed = shapeOf('Fare').safeParse(env.data)
    expect(parsed.success, parsed.error ? JSON.stringify(parsed.error.issues.slice(0, 5)) : '').toBe(true)
  })

  test('route get', async (ctx) => {
    if (!sampleTicket) ctx.skip('未在前置 ticket search 中获得有效车次')
    await sleep(1500)

    const r = await cli(
      '12306',
      'route',
      'get',
      sampleTicket.train_no,
      sampleTicket.from.name,
      sampleTicket.to.name,
      '--date',
      date,
      '-q',
    )
    const env = r.env
    expect(env, r.stdout + r.stderr).toBeTruthy()
    if (env.error?.code === 'RISK_CONTROL') ctx.skip(`平台风控：${env.error.message}`)

    expect(env.ok, JSON.stringify(env.error)).toBe(true)
    expect(env.platform).toBe('12306')
    expect(Array.isArray(env.data)).toBe(true)
    expect(env.data.length).toBeGreaterThan(1)

    const parsed = shapeOf('Stop[]').safeParse(env.data)
    expect(parsed.success, parsed.error ? JSON.stringify(parsed.error.issues.slice(0, 5)) : '').toBe(true)
  })

  test('transfer search', async (ctx) => {
    await sleep(1500)
    const r = await cli('12306', 'transfer', 'search', '北京', '杭州', '--limit', '3', '--date', date, '-q')
    const env = r.env
    expect(env, r.stdout + r.stderr).toBeTruthy()
    if (env.error?.code === 'RISK_CONTROL') ctx.skip(`平台风控：${env.error.message}`)

    expect(env.ok, JSON.stringify(env.error)).toBe(true)
    expect(env.platform).toBe('12306')
    expect(Array.isArray(env.data)).toBe(true)

    const parsed = shapeOf('Transfer[]').safeParse(env.data)
    expect(parsed.success, parsed.error ? JSON.stringify(parsed.error.issues.slice(0, 5)) : '').toBe(true)
  })
})
