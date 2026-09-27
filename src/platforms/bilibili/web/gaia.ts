import { quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { PROFILE } from './profile.js'

/**
 * 风控指纹（上游 apis/bili_gaia_apis.py）。只移植明文上报 `ExClimbWuzhi` 这一路：
 * 加密上报依赖 CDN 上的第三方 SDK，上游也默认不发，已实证写接口不受影响。
 */

const PLUGINS = [
  'PDF Viewer',
  'Chrome PDF Viewer',
  'Chromium PDF Viewer',
  'Microsoft Edge PDF Viewer',
  'WebKit built-in PDF',
].map((name) => [name, 'Portable Document Format', [['application/pdf', 'pdf'], ['text/pdf', 'pdf']]])

/** canvas 指纹尾串，同时是 qrcode/poll 的 b_ret。 */
export const CANVAS_1 = 'mW9qAAAAAElFTkSuQmCC'
const CANVAS_2 = '//TgNIfAAAAAZJREFUAwBde+3wgcxEHQAAAABJRU5ErkJggg=='
const AUDIO_FP = '124.04347527516074'

const PRECISIONS = ['vertex', 'fragment'].flatMap((shader) =>
  ['high', 'medium', 'low'].flatMap((p) => [
    `webgl ${shader} shader ${p} float precision:23`,
    `webgl ${shader} shader ${p} float precision rangeMin:127`,
    `webgl ${shader} shader ${p} float precision rangeMax:127`,
  ]),
)
const INT_PRECISIONS = ['vertex', 'fragment'].flatMap((shader) =>
  ['high', 'medium', 'low'].flatMap((p) => [
    `webgl ${shader} shader ${p} int precision:0`,
    `webgl ${shader} shader ${p} int precision rangeMin:31`,
    `webgl ${shader} shader ${p} int precision rangeMax:30`,
  ]),
)

const WEBGL_PARAMS = [
  'extensions:ANGLE_instanced_arrays;EXT_blend_minmax;EXT_clip_control;' +
    'EXT_color_buffer_half_float;EXT_depth_clamp;EXT_disjoint_timer_query;' +
    'EXT_float_blend;EXT_frag_depth;EXT_polygon_offset_clamp;' +
    'EXT_shader_texture_lod;EXT_texture_compression_bptc;' +
    'EXT_texture_compression_rgtc;EXT_texture_filter_anisotropic;' +
    'EXT_texture_mirror_clamp_to_edge;EXT_sRGB;KHR_parallel_shader_compile;' +
    'OES_element_index_uint;OES_fbo_render_mipmap;OES_standard_derivatives;' +
    'OES_texture_float;OES_texture_float_linear;OES_texture_half_float;' +
    'OES_texture_half_float_linear;OES_vertex_array_object;' +
    'WEBGL_blend_func_extended;WEBGL_color_buffer_float;' +
    'WEBGL_compressed_texture_s3tc;WEBGL_compressed_texture_s3tc_srgb;' +
    'WEBGL_debug_renderer_info;WEBGL_debug_shaders;WEBGL_depth_texture;' +
    'WEBGL_draw_buffers;WEBGL_lose_context;WEBGL_multi_draw;' +
    'WEBGL_polygon_mode',
  'webgl aliased line width range:[1, 1]',
  'webgl aliased point size range:[1, 1024]',
  'webgl alpha bits:8',
  'webgl antialiasing:yes',
  'webgl blue bits:8',
  'webgl depth bits:24',
  'webgl green bits:8',
  'webgl max anisotropy:16',
  'webgl max combined texture image units:32',
  'webgl max cube map texture size:16384',
  'webgl max fragment uniform vectors:1024',
  'webgl max render buffer size:16384',
  'webgl max texture image units:16',
  'webgl max texture size:16384',
  'webgl max varying vectors:30',
  'webgl max vertex attribs:16',
  'webgl max vertex texture image units:16',
  'webgl max vertex uniform vectors:4095',
  'webgl max viewport dims:[32767, 32767]',
  'webgl red bits:8',
  'webgl renderer:WebKit WebGL',
  'webgl shading language version:WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
  'webgl stencil bits:0',
  'webgl vendor:WebKit',
  'webgl version:WebGL 1.0 (OpenGL ES 2.0 Chromium)',
  'webgl unmasked vendor:Google Inc. (NVIDIA)',
  'webgl unmasked renderer:ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  ...PRECISIONS,
  ...INT_PRECISIONS,
]

/** `3c43` 指纹主体，也是 buvid_fp 的 murmur3 输入。键序照抄实抓。 */
export function fingerCore(): Map<string, unknown> {
  const w = PROFILE.screenWidth
  const h = PROFILE.screenHeight
  return new Map<string, unknown>([
    ['2673', 0],
    ['5766', PROFILE.colorDepth],
    ['6527', 0],
    ['7003', 1],
    ['807e', 1],
    ['b8ce', PROFILE.ua],
    ['641c', 0],
    ['07a4', 'zh-CN'],
    ['1c57', 32],
    ['0bd0', PROFILE.hardwareConcurrency],
    ['748e', [w, h]],
    ['d61f', [w, h - 48]],
    ['fc9d', -480],
    ['6aa9', PROFILE.timezone],
    ['75b8', 1],
    ['3b21', 1],
    ['8a1c', 0],
    ['d52f', 'not available'],
    ['adca', 'Win32'],
    ['80c9', PLUGINS],
    ['13ab', CANVAS_1],
    ['bfe9', CANVAS_2],
    ['a3c1', WEBGL_PARAMS],
    ['6bc5', `${PROFILE.webglVendor}~${PROFILE.webglRenderer}`],
    ['ed31', 0],
    ['72bd', 0],
    ['097b', 0],
    ['52cd', [10, 0, 0]],
    ['a658', []],
    ['d02f', AUDIO_FP],
  ])
}

/** ExClimbWuzhi 的 payload 对象。 */
export function fingerPayload(uuid: string, referer = 'https://www.bilibili.com/', correspondUrl = ''): Map<string, unknown> {
  return new Map<string, unknown>([
    ['3064', 1],
    ['5062', String(rand.now())],
    ['03bf', quote(correspondUrl, '')],
    ['39c8', '333.1193.fp.risk'],
    ['34f1', ''],
    ['d402', ''],
    ['654a', ''],
    ['6e7c', '0x0'],
    ['3c43', fingerCore()],
    ['54ef', '{}'],
    ['8b94', quote(referer, '')],
    ['df35', uuid],
    ['07a4', 'zh-CN'],
    ['5f45', null],
    ['db46', 0],
  ])
}
