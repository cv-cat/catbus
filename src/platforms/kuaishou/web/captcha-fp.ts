import { compactJson } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { UA } from './profile.js'

/**
 * 滑块验证码提交时的浏览器指纹块（上游 utils/captcha_fp.py）：`gpuInfo`（4 键）与 `captchaExtraParam`（65 键）。
 * 默认值是上游在验证码 iframe 里用 CDP 取回的真值，键序即 JSON.stringify 的输出顺序，不能重排。
 * 事件耗时、鼠标轨迹与两个会话哈希每次现算（原样重放会被判成回放，服务端回 350014）。
 */

export const GPU_INFO: Record<string, string> = {
  glRenderer: 'WebKit WebGL',
  glVendor: 'WebKit',
  unmaskRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  unmaskVendor: 'Google Inc. (NVIDIA)',
}

/** Ga() 的完整产物。没有形如整数的键，普通对象的插入顺序就是输出顺序。 */
export const CAPTCHA_EXTRA_PARAM: Record<string, unknown> = {
  ua: UA,
  userAgent: UA,
  timeZone: 'UTC+8',
  language: 'zh-CN',
  cpuCoreCnt: '20',
  platform: 'Win32',
  riskBrowser: 'false',
  webDriver: 'false',
  exactRiskBrowser: 'false',
  webDriverDeep: 'false',
  exactRiskBrowser2: 'false',
  webDriverDeep2: 'false',
  battery: '1',
  plugins: '1a68ba429dd293b14e41a28b6535aa590',
  resolution: '2560x1440',
  pixelDepth: '24',
  colorDepth: '24',
  canvasGraphFingerPrint: '1109b083cc4701a442fe7846d074394f1',
  canvasGraph: '1109b083cc4701a442fe7846d074394f1',
  canvasTextFingerPrintEn: '12e6f0f06266fb6bc7b5ddb5be6c0be3e',
  canvasTextEn: '12e6f0f06266fb6bc7b5ddb5be6c0be3e',
  canvasTextFingerPrintZh: '1cfe96b611a4ada0f3ed6c5d9da0eb406',
  canvasTextZh: '1cfe96b611a4ada0f3ed6c5d9da0eb406',
  webglGraphFingerPrint: '1537e3a006691fc8474abd41438c08a5d',
  webglGraph: '1537e3a006691fc8474abd41438c08a5d',
  webglGPUFingerPrint: '1192e522040bbe560567d4321fed3c16a',
  webglGpu: '1192e522040bbe560567d4321fed3c16a',
  cssFontFingerPrintEn: '1e4c353075d9fe0c911b00a7f7dba2f26',
  fontListEn: '1e4c353075d9fe0c911b00a7f7dba2f26',
  cssFontFingerPrintZh: '154ef9bb94c26d3f7b091868f7a41c387',
  fontListZh: '154ef9bb94c26d3f7b091868f7a41c387',
  voiceFingerPrint: '1dd96cac4e826abdbbe261dc4f3a08292',
  audioTriangle: '1dd96cac4e826abdbbe261dc4f3a08292',
  nativeFunc: '1973dcbb27a04c3a2ee240d9d2549e105',
  // 占位；每次请求都换成会话的 did
  key1: 'web_' + '0'.repeat(32),
  key2: 1786880034017,
  key3: UA,
  key4: '20030107',
  key5: 'zh-CN',
  key6: 'Gecko',
  key7: 2560,
  key8: 1440,
  key9: 2560,
  key10: 1392,
  key11: 1215,
  key12: 2560,
  key13: 1392,
  key14: 2560,
  key15: '00000111',
  key16: 1,
  key17: 1,
  key18: ['0,103,-1,-1,-1,prepare1'],
  key19: { prepare1: '0,103,-1,-1,-1' },
  key20: ['0,102,-1,-1,-1,prepare1'],
  key21: { prepare1: '0,102,-1,-1,-1' },
  key22: ['0,102,-1,-1,-1,prepare1'],
  key23: { prepare1: '0,102,-1,-1,-1' },
  key24: ['0,102,-1,-1,-1,prepare1'],
  key25: { prepare1: '0,102,-1,-1,-1' },
  key26: {
    key27: [
      '0,1,40012,1310,169,prepare1',
      '1,1,40015,1305,153,prepare1',
      '2,1,40017,1301,140,prepare1',
      '3,1,40022,1293,119,prepare1',
      '4,1,40026,1284,93,prepare1',
      '5,1,40030,1278,75,prepare1',
      '6,1,40033,1275,66,prepare1',
      '7,1,41016,-1,-1,prepare1',
      '8,1,41017,-1,-1,prepare1',
      '9,1,41022,1385,2,prepare1',
    ],
    key28: [],
    key29: [],
    key30: [],
    key31: { prepare1: '9,1,41022,1385,2' },
    key32: {},
    key33: {},
    key34: {},
  },
  key35: '53b4153471329902b90af6e81a017253',
  key36: 'f22a94013fc94e90e2af2798023a1985',
  key37: 1,
  key38: 'not support',
  key39: 20,
}

const HEX = '0123456789abcdef'

/**
 * _session_fields：每次验证都现算的事件耗时、鼠标轨迹与会话哈希。
 * 上游用 `random.Random(now_ms ^ random.getrandbits(32))` 新建一个生成器；这里直接用全局随机数，
 * 先消耗一次对应 getrandbits(32) 的那个数，后续调用顺序与上游相同。
 */
export function sessionFields(_nowMs: number): Record<string, unknown> {
  void rand.random()
  const hex32 = () => rand.string(32, HEX)
  const timing = (): [string[], Record<string, string>] => {
    const s = `0,${rand.randint(88, 132)},-1,-1,-1`
    return [[`${s},prepare1`], { prepare1: s }]
  }
  const [k18, k19] = timing()
  const [k20, k21] = timing()
  const [k22, k23] = timing()
  const [k24, k25] = timing()
  let t = rand.randint(38000, 46000)
  let x = rand.randint(1240, 1400)
  let y = rand.randint(120, 210)
  const track: string[] = []
  const n = rand.randint(8, 14)
  for (let i = 0; i < n; i++) {
    t += rand.randint(2, 9)
    x += rand.randint(-9, 3)
    y += rand.randint(-22, 6)
    // 真实样本里后面几条的 x/y 是 -1（元素外 / 未捕获）
    if (i >= 7 && rand.random() < 0.4) track.push(`${i},1,${t},-1,-1,prepare1`)
    else track.push(`${i},1,${t},${x},${y},prepare1`)
  }
  const tail = track.at(-1)!
  const last = tail.slice(0, tail.lastIndexOf(','))
  return {
    key18: k18,
    key19: k19,
    key20: k20,
    key21: k21,
    key22: k22,
    key23: k23,
    key24: k24,
    key25: k25,
    key26: { key27: track, key28: [], key29: [], key30: [], key31: { prepare1: last }, key32: {}, key33: {}, key34: {} },
    key35: hex32(),
    key36: hex32(),
  }
}

/** `gpuInfo` 字段的值（JSON 字符串，四个已知键在前）。 */
export function gpuInfoJson(overrides: Record<string, string> = {}): string {
  const info: Record<string, string> = { ...GPU_INFO, ...overrides }
  const ordered: Record<string, string> = {}
  for (const k of ['glRenderer', 'glVendor', 'unmaskRenderer', 'unmaskVendor']) if (k in info) ordered[k] = info[k]!
  for (const [k, v] of Object.entries(info)) if (!(k in ordered)) ordered[k] = v
  return compactJson(ordered)
}

/** `captchaExtraParam` 字段的值（JSON 字符串）：key1 = did，key2 = 当前毫秒，会话字段现算。 */
export function captchaExtraParamJson(o: { overrides?: Record<string, unknown>; did?: string; nowMs?: number; freshSession?: boolean } = {}): string {
  const data: Record<string, unknown> = { ...CAPTCHA_EXTRA_PARAM }
  const stamp = o.nowMs ?? rand.now()
  if (o.did) data.key1 = o.did
  data.key2 = stamp
  if (o.freshSession ?? true) Object.assign(data, sessionFields(stamp))
  Object.assign(data, o.overrides ?? {})
  return compactJson(data)
}
