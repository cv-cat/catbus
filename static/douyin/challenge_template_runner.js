// challenge template 的 Node 补环境执行器。
//
// template 是服务端每次现下发的 77KB JS（UMD 模块 __p_ch），
// 浏览器执行它得到 {p_in, e_in}，p_in 就是 cookie gulu_source_res 里那个字段
// —— 我们之前一直在用随机 hex 伪造它。
//
// 采集项 38 个（fonts/canvas/webgl/screen/navigator/matchMedia/math...），
// 是 FingerprintJS 那一套。这里按项目的设备档案补齐，
// 取值必须与 utils/fingerprint.py、dtrait 档案自洽 —— 否则几处指纹互相打架。
//
// 用法: node run_template.js <template.js> <profile.json>

const fs = require('fs');
const crypto = require('crypto');

const templatePath = process.argv[2];
const profilePath = process.argv[3];
const P = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

// ---------- 最小 DOM / BOM ----------
function makeCanvas() {
  return {
    width: 0, height: 0,
    getContext(kind) {
      if (kind === '2d') {
        return {
          canvas: this,
          fillStyle: '', font: '', textBaseline: '',
          rect() {}, fillRect() {}, fillText() {}, strokeText() {},
          beginPath() {}, arc() {}, closePath() {}, fill() {}, stroke() {},
          isPointInPath: () => true,
          measureText: (s) => ({ width: (s || '').length * 7.5 }),
          getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        };
      }
      // webgl
      const GL = {
        UNMASKED_VENDOR_WEBGL: 0x9245,
        UNMASKED_RENDERER_WEBGL: 0x9246,
      };
      return {
        canvas: this,
        ...GL,
        getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? GL : null),
        getParameter: (p) => {
          if (p === GL.UNMASKED_VENDOR_WEBGL) return P.webgl_vendor;
          if (p === GL.UNMASKED_RENDERER_WEBGL) return P.webgl_renderer;
          return null;
        },
        getSupportedExtensions: () => P.webgl_extensions || [],
        createBuffer: () => ({}), bindBuffer() {}, bufferData() {},
        createProgram: () => ({}), createShader: () => ({}),
        shaderSource() {}, compileShader() {}, attachShader() {},
        linkProgram() {}, useProgram() {},
        getAttribLocation: () => 0, getUniformLocation: () => ({}),
        enableVertexAttribArray() {}, vertexAttribPointer() {},
        uniform2f() {}, drawArrays() {}, viewport() {}, clearColor() {}, clear() {},
        readPixels: (x, y, w, h, f, t, px) => { if (px) px.fill(0); },
      };
    },
    toDataURL: () => P.canvas_data_url || 'data:image/png;base64,',
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    style: {},
  };
}

const documentStub = {
  createElement: (tag) => {
    if (tag === 'canvas') return makeCanvas();
    return {
      style: {}, appendChild() {}, removeChild() {}, setAttribute() {},
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
      offsetWidth: 0, offsetHeight: 0,
    };
  },
  documentElement: { style: {}, appendChild() {}, removeChild() {} },
  body: { appendChild() {}, removeChild() {}, style: {} },
  head: { appendChild() {}, removeChild() {} },
  cookie: '',
  fonts: { check: () => true, ready: Promise.resolve(), load: () => Promise.resolve([]) },
  write() {}, open() {}, close() {},
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
};

const navigatorStub = {
  userAgent: P.ua,
  platform: 'Win32',
  vendor: 'Google Inc.',
  vendorSub: '',
  productSub: '20030107',
  language: 'zh-CN',
  languages: P.languages || ['zh-CN', 'zh', 'en', 'zh-TW', 'ja'],
  hardwareConcurrency: P.cpu_core_num,
  deviceMemory: P.device_memory,
  maxTouchPoints: 0,
  cookieEnabled: true,
  webdriver: false,
  pdfViewerEnabled: true,
  doNotTrack: null,
  plugins: { length: 5 },
  mimeTypes: { length: 2 },
  userAgentData: {
    brands: [{ brand: 'Chromium', version: String(P.browser_major || 151) }],
    mobile: false, platform: 'Windows',
    getHighEntropyValues: () => Promise.resolve({ architecture: 'x86', bitness: '64' }),
  },
};

const screenStub = {
  width: P.screen_width, height: P.screen_height,
  availWidth: P.avail_width, availHeight: P.avail_height,
  availTop: 0, availLeft: 0,
  colorDepth: 24, pixelDepth: 24,
};

// matchMedia：colorGamut / forcedColors / monochrome / contrast / hdr / reducedMotion
function matchMedia(q) {
  const truthy = [
    '(color-gamut: srgb)',
    '(dynamic-range: standard)',
    '(prefers-reduced-motion: no-preference)',
    '(prefers-reduced-transparency: no-preference)',
    '(prefers-contrast: no-preference)',
    '(forced-colors: none)',
    '(inverted-colors: none)',
    '(min-monochrome: 0)',
  ];
  return { matches: truthy.some((t) => q.replace(/\s+/g, ' ').includes(t.replace(/\s+/g, ' '))), media: q };
}

const windowStub = {
  document: documentStub,
  navigator: navigatorStub,
  screen: screenStub,
  matchMedia,
  location: { href: 'https://www.douyin.com/', origin: 'https://www.douyin.com', protocol: 'https:', host: 'www.douyin.com' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {}, length: 0 },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {}, length: 0 },
  indexedDB: {},
  openDatabase: undefined,
  devicePixelRatio: 1,
  innerWidth: P.inner_width, innerHeight: P.inner_height,
  outerWidth: P.outer_width, outerHeight: P.outer_height,
  performance: { now: () => Date.now() % 100000, timeOrigin: Date.now() },
  crypto: { getRandomValues: (a) => crypto.randomFillSync(a), subtle: {} },
  Intl,
  addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
  Promise, Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Error, TypeError,
  Uint8Array, Uint8ClampedArray, Int32Array, Float32Array, Float64Array, ArrayBuffer,
  Map, Set, Symbol, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, btoa, atob,
};
windowStub.window = windowStub;
windowStub.self = windowStub;
windowStub.top = windowStub;
// 模块内部有 `window.console` / 裸 `console` 两种取法，两处都要有
windowStub.console = { log() {}, warn() {}, error() {}, info() {}, debug() {}, trace() {} };

// ---------- 装载 UMD 模块 ----------
const src = fs.readFileSync(templatePath, 'utf8');
const vm = require('vm');
// sandbox 用普通对象而不是 Object.create(null)：模块内部会直接引用
// console / Date 这类全局，原型链断了会 ReferenceError。
const sandbox = Object.assign({}, windowStub, {
  self: windowStub, window: windowStub, globalThis: windowStub,
  console: { log() {}, warn() {}, error() {}, info() {}, debug() {}, trace() {} },
  module: { exports: {} }, exports: {},
  TextEncoder, TextDecoder, URL, URLSearchParams,
  Function, Reflect, Proxy, WeakMap, WeakSet, BigInt,
  Uint16Array, Int8Array, Int16Array, Uint32Array, DataView,
  process: undefined, require: undefined, global: undefined, Buffer: undefined,
});
vm.createContext(sandbox);

try {
  vm.runInContext(src, sandbox, { timeout: 20000 });
} catch (e) {
  console.error(JSON.stringify({ ok: false, stage: 'load', error: String(e && e.stack || e) }));
  process.exit(2);
}

const mod = sandbox.module.exports && Object.keys(sandbox.module.exports).length
  ? sandbox.module.exports
  : (sandbox.__p_ch || windowStub.__p_ch);

if (!mod) {
  console.error(JSON.stringify({ ok: false, stage: 'export', error: '拿不到 __p_ch 导出' }));
  process.exit(3);
}

const entry = typeof mod === 'function' ? mod : (mod.default || mod.getData || mod.get || mod.rs);
if (typeof entry !== 'function') {
  // 把导出的形状打出来，方便定位真正的入口
  const shape = {};
  for (const k of Object.keys(mod)) {
    const v = mod[k];
    shape[k] = typeof v === 'function'
      ? ('function/' + v.length + 'args')
      : (v && typeof v === 'object' ? Object.keys(v).slice(0, 20) : typeof v);
  }
  console.error(JSON.stringify({
    ok: false, stage: 'entry', error: '导出不是函数', shape,
  }));
  process.exit(4);
}

Promise.resolve()
  .then(() => entry())
  .then((r) => {
    console.log(JSON.stringify({ ok: true, result: r }));
    // 模块内部还挂着定时器/未决 promise，不强制退出会打印无关的 rejection 噪音
    process.exit(0);
  })
  .catch((e) => {
    console.error(JSON.stringify({ ok: false, stage: 'run', error: String(e && e.stack || e) }));
    process.exit(5);
  });
