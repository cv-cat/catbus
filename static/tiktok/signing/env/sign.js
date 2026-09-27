/*
 * Pure TikTok Web signing bridge.
 *
 * The downloaded SDK under source/ is never edited.  This process supplies a
 * small browser-shaped environment, initializes the SDK, and captures the URL
 * passed to the native fetch.  No captured signature is accepted as input.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const readline = require('readline');
const env = require('./env_core');
const _process = process;

const nativeCrypto = require('crypto').webcrypto;
const nativeFetch = typeof global.fetch === 'function' ? global.fetch.bind(global) : null;
const sourcePath = path.join(__dirname, '../source/webmssdk.js');
const legacySourcePath = path.join(__dirname, '../source/webmssdk_legacy.js');
const exPath = path.join(__dirname, '../source/webmssdk_ex.js');
const cachePath = path.join(__dirname, '../sdk_config.json');
const defaultConfig = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, 'utf8'))
  : {
      aid: 1988, dfp: false, boe: false, intercept: true,
      enablePathList: ['/webcast.*', '/api/post/item_list/', '/api/comment/list/'],
      region: 'sg-tiktok', apiHost: '', mode: 513, isSDK: false,
      custom: { ttwid: '' },
    };
// Creator Studio project-post paths are signed by WebMssdk.  Upload
// authorization is a separate unsigned GET and is deliberately not enabled
// here; adding signatures to it would diverge from Chrome's request.
const signingPaths = [
  ...(defaultConfig.enablePathList || ['/webcast.*']),
  '/tiktok/web/project/post/v1/',
  '/tiktok/web/project/post_retry/v1/',
];
const runtimeConfig = { ...defaultConfig, enablePathList: signingPaths };

function makeStorage(initial = {}) {
  const values = new Map();
  for (const [key, value] of Object.entries(initial || {})) values.set(String(key), String(value));
  return {
    get length() { return values.size; },
    key(i) { return Array.from(values.keys())[i] ?? null; },
    getItem(k) { return values.has(String(k)) ? values.get(String(k)) : null; },
    setItem(k, v) { values.set(String(k), String(v)); },
    removeItem(k) { values.delete(String(k)); },
    clear() { values.clear(); },
  };
}

function buildRuntime(input) {
  const listeners = new Map();
  const referer = String(input.referer || 'https://www.tiktok.com/');
  const requestUrl = new URL(String(input.url));
  const metrics = input.metrics || {};
  const screenWidth = Number(metrics.screen_width || 2560);
  const screenHeight = Number(metrics.screen_height || 1440);
  const availWidth = Number(metrics.avail_width || screenWidth);
  const availHeight = Number(metrics.avail_height || 1392);
  const innerWidth = Number(metrics.inner_width || 1297);
  const innerHeight = Number(metrics.inner_height || 800);
  const outerWidth = Number(metrics.outer_width || 1313);
  const outerHeight = Number(metrics.outer_height || 985);
  const webglExtensions = [
    'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_clip_control',
    'EXT_color_buffer_half_float', 'EXT_depth_clamp', 'EXT_disjoint_timer_query',
    'EXT_float_blend', 'EXT_frag_depth', 'EXT_polygon_offset_clamp',
    'EXT_shader_texture_lod', 'EXT_texture_compression_bptc',
    'EXT_texture_compression_rgtc', 'EXT_texture_filter_anisotropic',
    'EXT_texture_mirror_clamp_to_edge', 'EXT_sRGB', 'KHR_parallel_shader_compile',
    'OES_element_index_uint', 'OES_fbo_render_mipmap', 'OES_standard_derivatives',
    'OES_texture_float', 'OES_texture_float_linear', 'OES_texture_half_float',
    'OES_texture_half_float_linear', 'OES_vertex_array_object',
    'WEBGL_blend_func_extended', 'WEBGL_color_buffer_float',
    'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb',
    'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_depth_texture',
    'WEBGL_draw_buffers', 'WEBGL_lose_context', 'WEBGL_multi_draw', 'WEBGL_polygon_mode',
  ];
  const webglValues = new Map([
    [0x0D52, 8], [0x0D56, 24], [0x0D53, 8], [0x8B4D, 32], [0x851C, 16384],
    [0x8DFD, 1024], [0x84E8, 16384], [0x8872, 16], [0x0D33, 16384],
    [0x8DFC, 30], [0x8869, 16], [0x8B4C, 16], [0x8DFB, 4095],
    [0x8B8C, 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)'],
    [0x0D57, 0], [0x1F02, 'WebGL 1.0 (OpenGL ES 2.0 Chromium)'],
    [0x9245, 'Google Inc. (NVIDIA)'],
    [0x9246, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    [0x84FF, 16],
  ]);
  const webglDebugInfo = { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 };
  const anisotropyInfo = { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF };
  const fakePerformance = {
    timeOrigin: Date.now() - 1000,
    now: () => Date.now() - (Date.now() - 1000),
  };
  fakePerformance.timing = {
    navigationStart: fakePerformance.timeOrigin,
    unloadEventStart: 0, unloadEventEnd: 0,
    redirectStart: 0, redirectEnd: 0,
    fetchStart: fakePerformance.timeOrigin + 1,
    domainLookupStart: fakePerformance.timeOrigin + 2,
    domainLookupEnd: fakePerformance.timeOrigin + 3,
    connectStart: fakePerformance.timeOrigin + 3,
    secureConnectionStart: fakePerformance.timeOrigin + 4,
    connectEnd: fakePerformance.timeOrigin + 5,
    requestStart: fakePerformance.timeOrigin + 6,
    responseStart: fakePerformance.timeOrigin + 7,
    responseEnd: fakePerformance.timeOrigin + 8,
    domLoading: fakePerformance.timeOrigin + 9,
    domInteractive: fakePerformance.timeOrigin + 10,
    domContentLoadedEventStart: fakePerformance.timeOrigin + 11,
    domContentLoadedEventEnd: fakePerformance.timeOrigin + 12,
    domComplete: fakePerformance.timeOrigin + 13,
    loadEventStart: fakePerformance.timeOrigin + 14,
    loadEventEnd: fakePerformance.timeOrigin + 15,
  };
  fakePerformance.navigation = { type: 0, redirectCount: 0 };
  fakePerformance.getEntriesByType = fakePerformance.getEntriesByType || (() => []);
  fakePerformance.getEntriesByName = fakePerformance.getEntriesByName || (() => []);
  const fakeWebGL = {
    BLUE_BITS: 0x0D52, DEPTH_BITS: 0x0D56, GREEN_BITS: 0x0D53,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D, MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C,
    MAX_FRAGMENT_UNIFORM_VECTORS: 0x8DFD, MAX_RENDERBUFFER_SIZE: 0x84E8,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872, MAX_TEXTURE_SIZE: 0x0D33,
    MAX_VARYING_VECTORS: 0x8DFC, MAX_VERTEX_ATTRIBS: 0x8869,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C, MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB,
    SHADING_LANGUAGE_VERSION: 0x8B8C, STENCIL_BITS: 0x0D57, VERSION: 0x1F02,
    getSupportedExtensions() { return webglExtensions.slice(); },
    getContextAttributes() { return { alpha: true, antialias: true, depth: true, desynchronized: false, failIfMajorPerformanceCaveat: false, powerPreference: 'default', premultipliedAlpha: true, preserveDrawingBuffer: false, stencil: false, xrCompatible: false }; },
    getParameter(key) { return webglValues.get(key); },
    getExtension(name) { if (name === 'WEBGL_debug_renderer_info') return webglDebugInfo; if (name === 'EXT_texture_filter_anisotropic') return anisotropyInfo; return {}; },
  };
  const userAgent = String(input.user_agent || input.userAgent ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36');
  const cookie = String(input.cookie || '');
  const cookieTtwid = (cookie.match(/(?:^|;\s*)ttwid=([^;]*)/) || [])[1] || '';
  const fakeDocument = {
    cookie,
    referrer: referer,
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    documentElement: { dataset: {}, classList: { contains() { return false; } } },
    head: { appendChild() {}, removeChild() {} },
    body: { appendChild() {}, removeChild() {} },
    createElement(tag) {
      const element = {
        tagName: String(tag).toUpperCase(), style: {}, dataset: {},
        setAttribute() {}, getAttribute() { return null; },
        appendChild() {}, remove() {}, addEventListener() {},
        getContext(type) { return /webgl|experimental-webgl/i.test(String(type)) ? fakeWebGL : null; },
        canPlayType() { return ''; },
        pathname: '', protocol: '', host: '', hostname: '', port: '', search: '', hash: '', href: '',
      };
      return element;
    },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    dispatchEvent(evt) { const fn = listeners.get(evt?.type); if (fn) fn(evt); return true; },
    evaluate() { return null; },
    createEvent(type) {
      const event = { type: String(type || ''), bubbles: false, cancelable: false,
        initEvent(name, bubbles, cancelable) {
          this.type = String(name || ''); this.bubbles = Boolean(bubbles); this.cancelable = Boolean(cancelable);
        }, preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false };
      return event;
    },
    querySelector() { return null; },
  };
  const fakeNavigator = {
    userAgent,
    appCodeName: 'Mozilla', appVersion: userAgent,
    language: String(input.language || 'zh-CN'), languages: ['zh-CN', 'zh', 'en'],
    platform: 'Win32', onLine: true, cookieEnabled: true,
    hardwareConcurrency: 20, deviceMemory: 32, maxTouchPoints: Number(metrics.max_touch_points ?? 10), webdriver: false,
    doNotTrack: null,
    permissions: { query: async () => ({ state: 'prompt', onchange: null }) },
    userAgentData: {
      brands: [
        { brand: 'Google Chrome', version: '153' },
        { brand: 'Not_A Brand', version: '8' },
        { brand: 'Chromium', version: '153' },
      ], mobile: false, platform: 'Windows',
      getHighEntropyValues: async () => ({
        platform: 'Windows',
        platformVersion: String(input.platform_version || '19.0.0'),
        architecture: 'x86', bitness: '64', model: '',
        uaFullVersion: String(input.ua_full_version || '153.0.8010.50'),
        fullVersionList: [
          { brand: 'Google Chrome', version: String(input.ua_full_version || '153.0.8010.50') },
          { brand: 'Not_A Brand', version: '8.0.0.0' },
          { brand: 'Chromium', version: String(input.ua_full_version || '153.0.8010.50') },
        ],
      }),
    },
    plugins: [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 2 },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 2 },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 2 },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 2 },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 2 },
    ],
    mimeTypes: [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ],
    getBattery: async () => ({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1 }),
    connection: { effectiveType: '4g', rtt: 50, downlink: 10 },
  };
  const fakeLocation = {
    href: referer, origin: requestUrl.origin, protocol: requestUrl.protocol,
    host: requestUrl.host, hostname: requestUrl.hostname,
    pathname: requestUrl.pathname, search: requestUrl.search, hash: '',
    assign() {}, replace() {}, reload() {}, toString() { return this.href; },
  };
  class FakeXHR {
    open(method, url) { this.method = method; this.url = String(url); this.readyState = 1; }
    setRequestHeader() {}
    addEventListener(type, fn) { this[`on${type}`] = fn; }
    getAllResponseHeaders() { return ''; }
    async send(body) {
      if (nativeFetch && /https:\/\/(?:mssdk|mon)\-[^/]+\.tiktok\.com\//i.test(this.url)) {
        try {
          const response = await nativeFetch(this.url, { method: this.method || 'GET', body });
          this.status = response.status;
          this.responseText = await response.text();
          this.readyState = 4;
          this.onload?.(); this.onreadystatechange?.(); this.onloadend?.();
          return;
        } catch (_) {}
      }
      this.status = 200; this.responseText = '{}'; this.readyState = 4;
      this.onload?.(); this.onreadystatechange?.(); this.onloadend?.();
    }
  }
  class FakeWebSocket { addEventListener() {} send() {} close() {} }
  const fakeWindow = {
    document: fakeDocument, navigator: fakeNavigator, location: fakeLocation,
    screen: { width: screenWidth, height: screenHeight, availWidth, availHeight, colorDepth: 24, pixelDepth: 24 },
    innerWidth, innerHeight, outerWidth, outerHeight,
    devicePixelRatio: Number(metrics.device_pixel_ratio || 1), history: { length: Number(metrics.history_length || 7) },
    localStorage: makeStorage(input.local_storage), sessionStorage: makeStorage(input.session_storage),
    performance: fakePerformance, crypto: nativeCrypto,
    ArrayBuffer, Uint8Array, Uint16Array, Uint32Array,
    Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, DataView,
    atob(value) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      const input = String(value).replace(/[\t\n\f\r ]/g, '');
      let output = '';
      for (let i = 0; i < input.length;) {
        const c1 = alphabet.indexOf(input.charAt(i++));
        const c2 = alphabet.indexOf(input.charAt(i++));
        const c3 = alphabet.indexOf(input.charAt(i++));
        const c4 = alphabet.indexOf(input.charAt(i++));
        if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0) break;
        const b1 = (c1 << 2) | (c2 >> 4);
        output += String.fromCharCode(b1 & 255);
        if (c3 === 64) continue;
        output += String.fromCharCode(((c2 & 15) << 4) | (c3 >> 2));
        if (c4 === 64) continue;
        output += String.fromCharCode(((c3 & 3) << 6) | c4);
      }
      return output;
    },
    btoa(value) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const input = String(value);
      let output = '';
      for (let i = 0; i < input.length; i += 3) {
        const a = input.charCodeAt(i), b = input.charCodeAt(i + 1), c = input.charCodeAt(i + 2);
        output += alphabet[a >> 2];
        output += alphabet[((a & 3) << 4) | (b >> 4)];
        output += Number.isNaN(b) ? '=' : alphabet[((b & 15) << 2) | (c >> 6)];
        output += Number.isNaN(b) ? '=' : (Number.isNaN(c) ? '=' : alphabet[c & 63]);
      }
      return output;
    },
    Request: global.Request, Headers: global.Headers, URL: global.URL, URLSearchParams: global.URLSearchParams,
    TextEncoder: global.TextEncoder, TextDecoder: global.TextDecoder,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: fn => setTimeout(fn, 16),
    matchMedia: () => ({ matches: false, media: '', addListener() {}, removeListener() {} }),
    addEventListener(type, fn) { listeners.set(`window:${type}`, fn); },
    removeEventListener(type) { listeners.delete(`window:${type}`); },
    dispatchEvent(evt) { const fn = listeners.get(`window:${evt?.type}`); if (fn) fn(evt); return true; },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    console, XMLHttpRequest: FakeXHR, WebSocket: FakeWebSocket,
    Event: class Event { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
    Element: class Element {}, HTMLElement: class HTMLElement {},
    HTMLCanvasElement: class HTMLCanvasElement {},
  };
  fakeWindow.CustomEvent = class CustomEvent extends fakeWindow.Event { constructor(type, init = {}) { super(type, init); this.detail = init.detail; } };
  fakeWindow.MouseEvent = fakeWindow.Event;
  fakeWindow.TouchEvent = fakeWindow.Event;
  fakeWindow.window = fakeWindow; fakeWindow.self = fakeWindow; fakeWindow.top = fakeWindow;
  fakeWindow.parent = fakeWindow; fakeWindow.globalThis = fakeWindow; fakeWindow.dwInfl = {};
  fakeWindow._mssdk = {
    _sharedCache: input.shared_cache || { slardarErrs: [], ttwid: cookieTtwid, tt_webid: '', tt_webid_v2: '', msNewTokenList: [], coreTiming: [] },
    _enablePathList: signingPaths,
    _enablePathListRegex: signingPaths.map(x => new RegExp(x)),
    cacheOpts: {}, opts: [], umode: 513, _loaderInit: true,
    _urlRewriteRules: [], pppt: 2, ets: -1,
  };
  env.init({ window: fakeWindow, document: fakeDocument, navigator: fakeNavigator, location: fakeLocation });
  for (const [key, value] of Object.entries({
    crypto: nativeCrypto, performance: fakePerformance, Request: global.Request, Headers: global.Headers,
    URL: global.URL, URLSearchParams: global.URLSearchParams, TextEncoder: global.TextEncoder,
    TextDecoder: global.TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: fakeWindow.requestAnimationFrame,
  })) Object.defineProperty(global, key, { value, configurable: true, writable: true });
  const sdkPath = requiredSignatureKeys(input.url).includes('X-Dynosaur') && fs.existsSync(legacySourcePath)
    ? legacySourcePath : sourcePath;
  let sdkSource = fs.readFileSync(sdkPath, 'utf8');
  vm.runInNewContext(sdkSource, fakeWindow, { filename: path.basename(sdkPath) });
  // webmssdk_ex is optional for read-only signing, but loading it keeps the
  // runtime aligned with the browser page when the bundle exposes extensions.
  if (fs.existsSync(exPath)) {
    try { vm.runInNewContext(fs.readFileSync(exPath, 'utf8'), fakeWindow, { filename: 'webmssdk_ex.js' }); }
    catch (_) { /* The extension bundle is optional for this endpoint. */ }
  }
  fakeWindow._mssdk = fakeWindow._mssdk || [];
  fakeWindow._mssdk.cacheOpts = fakeWindow._mssdk.cacheOpts || {};
  fakeWindow._mssdk.cacheOpts[String(runtimeConfig.aid)] = runtimeConfig;
  return { fakeWindow, fakeDocument, requestUrl, userAgent };
}

function assertUnsigned(url) {
  const parsed = new URL(url);
  for (const key of ['X-Dynosaur', 'X-Gnarly', 'X-Bogus']) {
    if (parsed.searchParams.has(key)) throw new Error(`输入 URL 不允许携带静态 ${key}`);
  }
}

function requiredSignatureKeys(url) {
  const pathname = new URL(String(url)).pathname;
  // Creator Studio upload authorization is unsigned; project-post requests
  // carry only msToken/X-Bogus/X-Gnarly. The legacy web API paths additionally
  // carry X-Dynosaur. Never invent a missing field just to satisfy a generic
  // four-field schema.
  if (/\/api\/v1\/video\/upload\/auth\//.test(pathname)) return [];
  if (/\/tiktok\/web\/project\/post(?:_retry)?\/v1\//.test(pathname)) {
    return ['msToken', 'X-Bogus', 'X-Gnarly'];
  }
  return ['X-Dynosaur', 'msToken', 'X-Bogus', 'X-Gnarly'];
}

async function sign(input) {
  if (!input || !input.url) throw new Error('signer 需要完整 url');
  const frontierOnly = input.mode === 'frontier_sign';
  if (!frontierOnly && (!input.headers || !Object.keys(input.headers).length)) throw new Error('signer 需要完整 headers');
  const method = String(input.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH'].includes(method) && (input.body === undefined || input.body === null)) throw new Error('signer 需要完整 body');
  assertUnsigned(input.url);
  const { fakeWindow, fakeDocument, requestUrl, userAgent } = buildRuntime(input);
  let captured;
  fakeWindow.fetch = async (...args) => {
    const requested = String(args[0] && args[0].url || args[0]);
    // WebMssdk obtains a public, short-lived rule/config response before it
    // signs the first API request.  Let that response be fetched normally;
    // only the target TikTok API call is captured and kept offline.
    if (nativeFetch && /https:\/\/(?:mssdk|mon)\-[^/]+\.tiktok\.com\//i.test(requested)) {
      const opts = args[1] || {};
      return nativeFetch(requested, { method: opts.method || 'GET', headers: opts.headers || {} });
    }
    captured = { url: requested, options: args[1] || {} };
    return { status: 200, headers: { get() { return 'application/json'; }, has() { return false; } }, json: async () => ({ status_code: 0 }), text: async () => '{}' };
  };
  if (!fakeWindow.byted_acrawler || typeof fakeWindow.byted_acrawler.init !== 'function') throw new Error('webmssdk 未导出 byted_acrawler');
  await fakeWindow.byted_acrawler.init(runtimeConfig);
  // The real page may initialize the SDK before these lifecycle events.  Our
  // VM starts from an already-complete document, so replay the events once to
  // let the SDK collect DOM, screen, WebGL and timing signals.
  for (const type of ['readystatechange', 'DOMContentLoaded', 'load']) {
    fakeDocument.dispatchEvent(new fakeWindow.Event(type));
    fakeWindow.dispatchEvent(new fakeWindow.Event(type));
  }
  // The browser collects the same asynchronous SDK signals before issuing
  // the first API call.  Give the local VM one turn to finish those tasks.
  await new Promise(resolve => setTimeout(resolve, 300));
  if (frontierOnly) {
    if (typeof fakeWindow.byted_acrawler.frontierSign !== 'function') throw new Error('SDK 未导出 frontierSign');
    if (input.stub && !/^[0-9a-f]{32}$/.test(String(input.stub))) throw new Error('IM X-MS-STUB 必须为 32 位小写 MD5');
    const result = fakeWindow.byted_acrawler.frontierSign(
      input.stub ? { 'X-MS-STUB': String(input.stub) } : { 'X-MS-PAYLOAD': '' }
    );
    const marker = result && result['X-Bogus'];
    if (typeof marker !== 'string' || marker.length !== 16) throw new Error('frontierSign 未产生浏览器长度 16 的 X-Bogus');
    return { values: { 'X-Bogus': marker }, lengths: { 'X-Bogus': marker.length } };
  }
  const headers = { ...(input.headers || {}) };
  const options = { method, credentials: 'include', headers };
  if (input.body !== undefined && input.body !== null && method !== 'GET' && method !== 'HEAD') options.body = String(input.body);
  await fakeWindow.fetch(String(input.url), options);
  if (!captured?.url) throw new Error('SDK 未产生 native fetch URL');
  // The SDK keeps an internal msToken slot.  When the caller already placed
  // the browser cookie token in the unsigned URL, this VM slot is empty and
  // the wrapper appends a second `msToken=` marker.  Drop only that empty
  // marker; the non-empty browser token and all calculated fields stay intact.
  const inputToken = new URL(String(input.url)).searchParams.get('msToken') || '';
  let normalizedUrl = String(captured.url).replace(/&msToken=(?=&(?:X-Bogus|X-Gnarly)=)/g, '');
  // Some browser storage snapshots expose an old msToken to the SDK in
  // addition to the fresh token in the unsigned URL.  Keep exactly one
  // caller-supplied token while retaining the SDK's calculated signatures.
  let seenMsToken = 0;
  normalizedUrl = normalizedUrl.replace(/([?&])msToken=[^&]*/g, (match, prefix) => {
    if (seenMsToken++ > 0) return '';
    return `${prefix}msToken=${encodeURIComponent(inputToken)}`;
  });
  // Match Chrome's query insertion order when the caller supplied the
  // cookie token before the SDK fields: X-Dynosaur, msToken, X-Bogus,
  // X-Gnarly.  This is ordering only; the value is still the caller's token.
  const tokenMatch = normalizedUrl.match(/&msToken=([^&]*)/);
  const dynMatch = normalizedUrl.match(/&X-Dynosaur=[^&]*/);
  if (tokenMatch && dynMatch && tokenMatch.index < dynMatch.index) {
    const tokenPart = tokenMatch[0];
    normalizedUrl = normalizedUrl.replace(tokenPart, '');
    const newDyn = normalizedUrl.match(/&X-Dynosaur=[^&]*/);
    if (newDyn) normalizedUrl = normalizedUrl.slice(0, newDyn.index + newDyn[0].length) + tokenPart + normalizedUrl.slice(newDyn.index + newDyn[0].length);
  }
  const signed = new URL(normalizedUrl);
  const allKeys = ['X-Dynosaur', 'msToken', 'X-Bogus', 'X-Gnarly'];
  const requiredKeys = requiredSignatureKeys(input.url);
  const values = Object.fromEntries(allKeys.map(key => [key, signed.searchParams.get(key) || '']));
  if (requiredKeys.includes('msToken') && signed.searchParams.getAll('msToken').length !== 1) {
    throw new Error('SDK 结果中的 msToken 字段数量不对齐');
  }
  if (inputToken && values.msToken !== inputToken) throw new Error('SDK 结果的 msToken 未与 unsigned 请求对齐');
  const missing = requiredKeys.filter(key => !values[key]);
  if (missing.length) throw new Error(`SDK 纯计算后仍缺少字段: ${missing.join(', ')}`);
  const lengths = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.length]));
  if (input.expected_lengths) {
    for (const [key, expected] of Object.entries(input.expected_lengths)) {
      if (lengths[key] !== Number(expected)) throw new Error(`${key} 长度 ${lengths[key]} != 浏览器证据 ${expected}`);
    }
  }
  return { url: normalizedUrl, values, lengths, method, body: options.body || '', user_agent: userAgent, origin: requestUrl.origin };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
// Do not call process.exit from the close event before the async signer has
// handled the final line.  The browser SDK schedules background timers, so we
// serialize input lines and explicitly terminate only after the queue drains.
let pending = Promise.resolve();
rl.on('line', line => {
  if (!line.trim()) return;
  pending = pending.then(async () => {
    try { _process.stdout.write(JSON.stringify({ ok: true, result: await sign(JSON.parse(line)) }) + '\n'); }
    catch (err) { _process.stdout.write(JSON.stringify({ ok: false, error: String(err && err.message || err), stack: String(err && err.stack || '') }) + '\n'); }
  });
});
rl.on('close', async () => {
  await pending;
  _process.exit(0);
});
