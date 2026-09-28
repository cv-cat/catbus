import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CatbusError } from '../src/core/errors.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import * as rand from '../src/core/rand.js'
import { Bili } from '../src/platforms/bilibili/web/client.js'
import { crop, decodeImage, detInput, ocrInput } from '../src/platforms/bilibili/web/ddddocr.js'
import * as geetest from '../src/platforms/bilibili/web/geetest.js'
import { serveManual } from '../src/platforms/bilibili/web/geetest-manual.js'
import * as vision from '../src/platforms/bilibili/web/geetest-vision.js'
import { expectRequests, loadCase, makeCtx, replay } from './golden.js'

/** 与 scripts/golden/bilibili/gen.py 的 COOKIES / MIXIN 一致（login_auth）。 */
const COOKIES =
  'buvid3=FAKE-BUVID3-0000infoc; b_nut=1789990000; _uuid=FAKE-UUID-0000infoc; buvid4=FAKE-BUVID4-0000; ' +
  'buvid_fp=0123456789abcdef0123456789abcdef; SESSDATA=fake-sessdata; bili_jct=fakecsrf0123456789abcdef01234567; ' +
  'DedeUserID=10001; DedeUserID__ckMd5=fakeckmd5; bili_ticket=fake.ticket; bili_ticket_expires=1790259200; rpdid=fake|rpdid'
const MIXIN = 'ea1db124af3c7062474693fa704f4ff8'
const NOW = 1790000000123

const GT = '0123456789abcdef0123456789abcdef'
const CHALLENGE = 'fedcba9876543210fedcba9876543210'
const C = [12, 58, 98, 36, 43, 95, 62, 15, 12]
const S = '3f6b2a1c'
const PIC1 = '/captcha_v3/batch/v3/0000/2026-09-28T18/word/fakepic0001.jpg'

async function logged<T>(fn: (b: Bili) => Promise<T>): Promise<T> {
  const b = new Bili(makeCtx({ platform: 'bilibili', cookies: COOKIES, cookieDomain: '.bilibili.com', extra: { wbi: { key: MIXIN, at: NOW } } }))
  await b.init()
  return fn(b)
}

const md5 = (b: Uint8Array) => createHash('md5').update(b).digest('hex')

describe('bilibili 对拍：极验 w 参数', () => {
  it('geetest_w：自定义 base64、tt 混淆、三种明文载荷、点击坐标编码、AES + RSA', () => {
    const c = loadCase('bilibili', 'geetest_w')
    const restore = rand.deterministic({ seed: c.seed, now: c.now })
    try {
      const payload = geetest.buildPayload(GT, CHALLENGE, 800, C, S)
      const click = geetest.buildClickPayload(GT, CHALLENGE, '4913_2297,1977_7558', PIC1, 3615, C, S)
      const key = geetest.genAesKey()
      expect({
        b64: [0, 1, 2, 3, 4, 5, 64].map((n) => geetest.customB64(Uint8Array.from({ length: n }, (_, i) => i))),
        tt: geetest.csCipher('M(*((1((M((', C, S),
        init_payload: geetest.buildInitPayload(GT, CHALLENGE),
        fullpage_payload: payload,
        click_payload: click,
        click_payload_no_a: geetest.buildClickPayload(GT, CHALLENGE, '', PIC1, 0),
        a: [
          geetest.encodeClickAFromRatio([
            [169 / 344, 169 / 344],
            [68 / 344, 79 / 344],
          ]),
          geetest.encodeClickAFromRatio([
            [0.00005, 0.99995],
            [0.12345, 0.5],
          ]),
          geetest.encodeClickAFromRatio([
            [1 / 3, 2 / 3],
            [0, 1],
          ]),
        ],
        key,
        w_rsa: geetest.buildW(click, key, true),
        w_plain: geetest.buildW(payload, key, false),
      }).toEqual(c.result)
    } finally {
      restore()
    }
  })

  it('RSA 段：PKCS#1 v1.5，256 位十六进制，每次填充不同', () => {
    const a = geetest.rsaEncryptKey('0123456789abcdef')
    expect(a).toMatch(/^[0-9a-f]{256}$/)
    expect(geetest.rsaEncryptKey('0123456789abcdef')).not.toBe(a)
  })
})

describe('bilibili 对拍：极验链路', () => {
  it('geetest_fullpage：无感通道直接放行', async () => {
    const c = loadCase('bilibili', 'geetest_fullpage')
    const { requests, result, error } = await replay(c, () => logged((b) => geetest.solve(b)))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toEqual({ token: c.result.token, challenge: c.result.challenge, validate: c.result.validate, seccode: c.result.seccode })
  })

  it('geetest_click：降级到点选 → 识别提交（fail）→ 换题 → 识别提交（通过）', async () => {
    const c = loadCase('bilibili', 'geetest_click')
    const { requests, result, error } = await replay(c, () => logged((b) => geetest.solve(b)))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toEqual({ token: c.result.token, challenge: c.result.challenge, validate: c.result.validate, seccode: c.result.seccode })
  }, 120_000)

  it('自动识别没通过、又不是终端：RISK_CONTROL，提示在终端里重试', async () => {
    const jsonp = (data: unknown) => `geetest_${NOW}(${JSON.stringify(data)})`
    const bodies = [
      { code: 0, data: { token: 'tk', geetest: { gt: GT, challenge: CHALLENGE } } },
      jsonp({ status: 'success', data: { type: 'fullpage' } }),
      jsonp({ status: 'success', data: { c: C, s: S } }),
      jsonp({ status: 'success', data: { result: 'forbidden' } }),
    ]
    const restoreRand = rand.deterministic({ seed: 1, now: NOW })
    const restore = mockSender(() => {
      const body = bodies.shift()
      if (body === undefined) throw new Error('多发了请求')
      return fakeResponse(typeof body === 'string' ? body : JSON.stringify(body))
    })
    try {
      const err = await logged((b) => geetest.solve(b)).catch((e) => e)
      expect(err).toBeInstanceOf(CatbusError)
      expect(err.code).toBe('RISK_CONTROL')
      expect(err.detail).toMatchObject({ kind: 'captcha', result: 'forbidden' })
      expect(err.hint).toContain('终端')
      expect(bodies).toHaveLength(0)
    } finally {
      restore()
      restoreRand()
    }
  })
})

describe('bilibili 对拍：极验点选识别（ddddocr）', () => {
  const c = loadCase('bilibili', 'geetest_vision').result

  it('合成题图：预处理逐字节一致，检测框、识别结果、点击顺序与上游一致', async () => {
    for (const s of c.sprites) {
      const bytes = Buffer.from(s.image, 'base64')
      const { puzzle, hint } = vision.splitSprite(await decodeImage(bytes))
      // 检测的输入（cv2.resize 后贴到 416×416）逐字节一致
      for (const [i, part] of [puzzle, hint].entries()) {
        const d = await detInput(part)
        expect(d.ratio).toBe(s.det_inputs[i].ratio)
        expect(md5(d.padded)).toBe(s.det_inputs[i].md5)
      }
      // 检测框：onnxruntime-web 与 CPU 版的浮点误差可能让个别坐标差 1
      const raw = await vision.detectBoxes(puzzle)
      expect(raw).toHaveLength(s.raw_puzzle_boxes.length)
      raw.forEach((b, i) => b.forEach((v, j) => expect(Math.abs(v - s.raw_puzzle_boxes[i][j])).toBeLessThanOrEqual(1)))
      // 识别的输入（PIL LANCZOS + 转灰度）逐字节一致：用上游的框来抠图
      const pad = (im: typeof puzzle, [x1, y1, x2, y2]: number[], p: number) =>
        crop(im, Math.max(0, x1! - p), Math.max(0, y1! - p), Math.min(im.width, x2! + p), Math.min(im.height, y2! + p))
      s.hint_boxes.forEach((b: number[], i: number) => {
        const o = ocrInput(pad(hint, b, 2))
        expect([o.width, o.height]).toEqual(s.hint_inputs[i].size)
        expect(md5(o.gray)).toBe(s.hint_inputs[i].md5)
      })
      s.puzzle_boxes.forEach((b: number[], i: number) => {
        const o = ocrInput(pad(puzzle, b, 4))
        expect([o.width, o.height]).toEqual(s.puzzle_inputs[i].size)
        expect(md5(o.gray)).toBe(s.puzzle_inputs[i].md5)
      })

      const r = await vision.solveClick(bytes)
      expect(r.hintBoxes).toEqual(s.hint_boxes)
      r.puzzleBoxes.forEach((b, i) => b.forEach((v, j) => expect(Math.abs(v - s.puzzle_boxes[i][j])).toBeLessThanOrEqual(1)))
      expect(r.hintText).toEqual(s.hint_text)
      expect(r.candChars).toEqual(s.cand_chars)
      r.scoreMatrix.forEach((row, i) => row.forEach((v, j) => expect(Math.abs(v - s.score_matrix[i][j])).toBeLessThan(2e-3)))
      expect(r.match.map((m) => [m.hint, m.puzzle])).toEqual(s.match.map((m: any) => [m.hint, m.puzzle]))
      expect(r.order).toEqual(s.order)
      expect(r.orderedChars).toEqual(s.ordered_chars)
      expect(r.warnings).toEqual(s.warnings)
      const [w, h] = r.puzzleSize
      expect(geetest.encodeClickAFromRatio(r.order.map(([x, y]) => [x / w, y / h]))).toBe(s.a)
    }
  }, 120_000)

  it('真实题图是 JPEG：转成 JPEG（质量 80）后仍给出同样的点击顺序', async () => {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas')
    for (const s of c.sprites) {
      const im = await loadImage(Buffer.from(s.image, 'base64'))
      const canvas = createCanvas(im.width, im.height)
      canvas.getContext('2d').drawImage(im, 0, 0)
      const r = await vision.solveClick(canvas.toBuffer('image/jpeg', 80))
      expect(r.match.map((m) => [m.hint, m.puzzle])).toEqual(s.match.map((m: any) => [m.hint, m.puzzle]))
      r.order.forEach(([x, y], i) => {
        expect(Math.abs(x - s.order[i][0])).toBeLessThanOrEqual(2)
        expect(Math.abs(y - s.order[i][1])).toBeLessThanOrEqual(2)
      })
    }
  }, 120_000)

  it('合并重叠框、切开相邻框、矩形指派（scipy 的 linear_sum_assignment）', () => {
    const boxes: vision.Box[] = [
      [10, 10, 60, 60],
      [12, 8, 58, 62],
      [100, 10, 150, 60],
      [55, 50, 90, 90],
      [200, 0, 240, 30],
      [230, 5, 280, 40],
    ]
    expect([vision.mergeDuplicateBoxes(boxes), vision.mergeDuplicateBoxes(boxes, 0.75)]).toEqual(c.merge)
    expect(
      vision.splitOverlaps([
        [5, 3, 36, 33],
        [33, 4, 63, 32],
        [60, 3, 94, 34],
        [94, 3, 124, 32],
      ]),
    ).toEqual(c.split)
    expect(c.lsa_input.map((m: number[][]) => vision.linearSumAssignment(m.map((r) => r.map(Math.fround))))).toEqual(c.lsa)
  })
})

describe('bilibili 极验：人工兜底页面', () => {
  it('本地页面加载官方控件，回传 validate 后兑现', async () => {
    const s = await serveManual(GT, CHALLENGE, { port: 0, timeout: 10 })
    try {
      const html = await (await fetch(s.url)).text()
      expect(html).toContain('static.geetest.com/static/tools/gt.js')
      expect(html).toContain(`gt: "${GT}"`)
      expect(html).toContain(`challenge: "${CHALLENGE}"`)
      expect(await (await fetch(`${s.url}/poll`)).json()).toEqual({})
      expect((await fetch(`${s.url}/result`, { method: 'POST', body: '{}' })).status).toBe(400)
      const ok = await fetch(`${s.url}/result`, { method: 'POST', body: JSON.stringify({ geetest_challenge: 'ch2', geetest_validate: 'va', geetest_seccode: 'va|jordan' }) })
      expect(await ok.json()).toEqual({ ok: true })
      expect(await s.result).toEqual({ challenge: 'ch2', validate: 'va', seccode: 'va|jordan' })
    } finally {
      await s.close()
    }
  })

  it('超时报 RISK_CONTROL', async () => {
    const s = await serveManual(GT, CHALLENGE, { port: 0, timeout: 0.05 })
    try {
      await expect(s.result).rejects.toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'captcha' } })
    } finally {
      await s.close()
    }
  })
})
