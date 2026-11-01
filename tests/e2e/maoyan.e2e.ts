import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, test } from 'vitest'
import { cli } from '../helpers.js'
import { shapeOf } from './shapes.js'

/**
 * 猫眼演出在线 E2E 测试（AGENTS 7.5）：免登录公开接口，按用户链路串联：
 * 城市检索 -> 城市热门演出 -> 演出详情（mtgsig 出签）。
 */

function ok(env: any, skip: (msg: string) => void) {
  expect(env).toBeTruthy()
  if (env.error?.code === 'RISK_CONTROL') skip(`平台风控：${env.error.message}`)
  expect(env.ok, JSON.stringify(env.error)).toBe(true)
  expect(env.platform).toBe('maoyan')
}

function shape(type: string, data: unknown) {
  const parsed = shapeOf(type).safeParse(data)
  expect(parsed.success, parsed.error ? JSON.stringify(parsed.error.issues.slice(0, 5)) : '').toBe(true)
}

describe('maoyan', () => {
  let sample: any = null

  test('poi search', async (ctx) => {
    const r = await cli('maoyan', 'poi', 'search', '上海', '-q')
    ok(r.env, ctx.skip)
    shape('Poi[]', r.env.data)
    expect(r.env.data[0]).toMatchObject({ id: '1', name: '上海' })
  })

  test('feed list', async (ctx) => {
    await sleep(1500)
    const r = await cli('maoyan', 'feed', 'list', '--city', '上海', '-q')
    ok(r.env, ctx.skip)
    shape('Item[]', r.env.data)
    expect(r.env.data.length).toBeGreaterThan(0)
    sample = r.env.data[0]
    expect(sample.url).toContain('/detail/')
  })

  test('item get', async (ctx) => {
    if (!sample) ctx.skip('feed list 没有返回演出')
    await sleep(1500)
    const r = await cli('maoyan', 'item', 'get', sample.url, '-q')
    ok(r.env, ctx.skip)
    shape('Item', r.env.data)
    expect(r.env.data.id).toBe(sample.id)
    expect(r.env.data.text).toContain('时间：')
  })
})
