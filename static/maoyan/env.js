// env.js — H5guard (美团天盾 H5 端) 环境加载器
// 项目：rohr/h5guard；语境 = PC Chrome 桌面浏览器 show.maoyan.com/qqw
// catbus：在 node:vm 里依次执行 env_core.js → 本文件 → H5guard.js（见 src/platforms/maoyan/web/sign.ts）。
// 与原 run.js 的差异：不用 require / fs / process，页面 cookie 与离线响应由宿主通过 __catbus_maoyan 传入；
// 页面 cookie 只有设备数据，不含登录态；加载 H5guard 与诊断输出改由宿主负责。
const env = module.exports;
const _host = __catbus_maoyan;

// ========== 页面语境（PC 桌面 Chrome，与真浏览器抓包一致）==========
const PAGE_URL = 'https://show.maoyan.com/qqw/';
const UA_PC = _host.ua;
const COOKIE = _host.cookie;

// ========== 离线响应表（H5guard 会自己发 XHR 拉 horn 配置 + package 板块）==========
const hornBaseSec = _host.hornBaseSec;
const hornTrack = _host.hornTrack;
const packageJs = _host.packageJs;

function offlineResponse(url) {
  // 返回 {status, body} | null
  if (url.indexOf('/horn/v1/modules/H5guard_BaseSec/') !== -1) return { status: 200, body: hornBaseSec };
  if (url.indexOf('/horn/v1/modules/H5guardTrack/') !== -1) return { status: 200, body: hornTrack };
  if (url.indexOf('/h5guard-files/') !== -1) return { status: 200, body: packageJs };
  if (url.indexOf('/v1/mss_') !== -1) return { status: 200, body: packageJs };
  if (url.indexOf('web/cache-token') !== -1) return { status: 200, body: '{}' };
  return null;
}

// ========== document 存根 ==========
let _cookie = COOKIE;
const fakeDocument = {};
env.setObjNative(fakeDocument, 'HTMLDocument');
Object.defineProperties(fakeDocument, {
  cookie: { get() { return _cookie; }, set(v) { _cookie = v; }, enumerable: true, configurable: true },
  domain: { get() { return 'maoyan.com'; }, enumerable: true, configurable: true },
  URL: { get() { return PAGE_URL; }, enumerable: true, configurable: true },
  documentURI: { get() { return PAGE_URL; }, enumerable: true, configurable: true },
  referrer: { get() { return ''; }, enumerable: true, configurable: true },
  title: { get() { return '猫眼'; }, set() {}, enumerable: true, configurable: true },
  characterSet: { get() { return 'UTF-8'; }, enumerable: true, configurable: true },
  charset: { get() { return 'UTF-8'; }, enumerable: true, configurable: true },
  contentType: { get() { return 'text/html'; }, enumerable: true, configurable: true },
  readyState: { get() { return 'complete'; }, enumerable: true, configurable: true },
  hidden: { get() { return false; }, enumerable: true, configurable: true },
  visibilityState: { get() { return 'visible'; }, enumerable: true, configurable: true },
  lastModified: { get() { return ''; }, enumerable: true, configurable: true },
});
const fakeHead = { appendChild(c) { return c; }, removeChild(c) { return c; }, insertBefore(c) { return c; } };
const fakeBody = {
  appendChild(c) { return c; }, removeChild(c) { return c; }, insertBefore(c) { return c; },
  serviceWorker: undefined,
  getBoundingClientRect() { return { top: 0, left: 0, right: 1920, bottom: 1080, width: 1920, height: 1080 }; },
};
env.setObjNative(fakeHead, 'HTMLHeadElement');
env.setObjNative(fakeBody, 'HTMLBodyElement');
for (const m of ['appendChild', 'removeChild', 'insertBefore']) {
  env.setFuncNative(fakeHead[m], m, 1);
  env.setFuncNative(fakeBody[m], m, 1);
}
fakeDocument.head = fakeHead;
fakeDocument.body = fakeBody;
fakeDocument.documentElement = {
  style: {}, appendChild(c) { return c; }, removeChild(c) { return c; },
  attributes: [],
  hasAttribute() { return false; }, getAttribute() { return null; },
  setAttribute() {}, removeAttribute() {},
  scrollWidth: 1920, scrollHeight: 1080, clientWidth: 1920, clientHeight: 1080,
  scrollTop: 0, scrollLeft: 0,
};
env.setFuncNative(fakeDocument.documentElement.appendChild, 'appendChild', 1);

function makeElement(tagName) {
  const el = {
    tagName: (tagName || 'DIV').toUpperCase(), style: {}, childNodes: [], children: [],
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    hasAttribute() { return false; }, attributes: [],
    appendChild(c) { el.childNodes.push(c); return c; }, removeChild(c) { return c; },
    insertBefore(c) { return c; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 }; },
    offsetWidth: 100, offsetHeight: 20, offsetTop: 0, offsetLeft: 0,
    clientWidth: 100, clientHeight: 20, scrollWidth: 100, scrollHeight: 20, scrollTop: 0, scrollLeft: 0,
    className: '', id: '',
  };
  Object.defineProperty(el, 'innerHTML', { get() { return ''; }, set() {} });
  Object.defineProperty(el, 'innerText', { get() { return ''; }, set() {} });
  Object.defineProperty(el, 'src', { get() { return ''; }, set() {} });
  Object.defineProperty(el, 'dataset', { get() { return {}; } });
  return el;
}
fakeDocument.getElementById = env.setFuncNative(function getElementById() { return null; }, 'getElementById', 1);
fakeDocument.getElementsByTagName = env.setFuncNative(function getElementsByTagName(tag) {
  tag = (tag || '').toLowerCase();
  if (tag === 'head') return [fakeDocument.head];
  if (tag === 'body') return [fakeDocument.body];
  return [makeElement(tag)];
}, 'getElementsByTagName', 1);
fakeDocument.getElementsByClassName = env.setFuncNative(function getElementsByClassName() { return []; }, 'getElementsByClassName', 1);
fakeDocument.querySelector = env.setFuncNative(function querySelector() { return makeElement('div'); }, 'querySelector', 1);
fakeDocument.querySelectorAll = env.setFuncNative(function querySelectorAll() { return []; }, 'querySelectorAll', 1);
fakeDocument.createElement = env.setFuncNative(function createElement(tag) {
  tag = (tag || '').toUpperCase();
  if (tag === 'CANVAS') return createCanvasElement();
  const el = makeElement(tag);
  if (tag === 'SCRIPT') {
    el.async = false; el.src = '';
    Object.defineProperty(el, 'onload', { get() { return el._onload; }, set(v) { el._onload = v; } });
    Object.defineProperty(el, 'onerror', { get() { return el._onerror; }, set(v) { el._onerror = v; } });
  }
  return el;
}, 'createElement', 1);
fakeDocument.createTextNode = env.setFuncNative(function createTextNode(t) { return { textContent: t }; }, 'createTextNode', 1);
fakeDocument.createEvent = env.setFuncNative(function createEvent(type) {
  return { type, initEvent() {}, preventDefault() {}, stopPropagation() {} };
}, 'createEvent', 1);
fakeDocument.addEventListener = env.setFuncNative(function addEventListener() {}, 'addEventListener', 2);
fakeDocument.removeEventListener = env.setFuncNative(function removeEventListener() {}, 'removeEventListener', 2);
fakeDocument.attachEvent = env.setFuncNative(function attachEvent() {}, 'attachEvent', 2);
fakeDocument.execCommand = env.setFuncNative(function execCommand() { return false; }, 'execCommand', 1);

function createCanvasElement() {
  const el = makeElement('CANVAS');
  el.width = 300; el.height = 150;
  const FAKE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const ctx2d = {};
  env.setObjNative(ctx2d, 'CanvasRenderingContext2D');
  const ctx2dMethods = [
    'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText',
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo',
    'bezierCurveTo', 'quadraticCurveTo', 'fill', 'stroke', 'clip', 'rect',
    'save', 'restore', 'translate', 'rotate', 'scale',
    'drawImage', 'setTransform', 'transform', 'putImageData',
  ];
  for (const m of ctx2dMethods) ctx2d[m] = env.setFuncNative(function () {}, m, 0);
  ctx2d.measureText = env.setFuncNative(function measureText() { return { width: 10 }; }, 'measureText', 1);
  ctx2d.createLinearGradient = env.setFuncNative(function createLinearGradient() {
    return { addColorStop: env.setFuncNative(function addColorStop() {}, 'addColorStop', 2) };
  }, 'createLinearGradient', 4);
  ctx2d.createRadialGradient = env.setFuncNative(function createRadialGradient() {
    return { addColorStop: env.setFuncNative(function addColorStop() {}, 'addColorStop', 6) };
  }, 'createRadialGradient', 6);
  ctx2d.getImageData = env.setFuncNative(function getImageData() {
    return { data: new Uint8ClampedArray(0) };
  }, 'getImageData', 4);
  ctx2d.createImageData = env.setFuncNative(function createImageData() {
    return { data: new Uint8ClampedArray(0) };
  }, 'createImageData', 2);
  ctx2d.isPointInPath = env.setFuncNative(function isPointInPath() { return false; }, 'isPointInPath', 2);
  ctx2d.canvas = el; ctx2d.fillStyle = ''; ctx2d.strokeStyle = '';
  const WEBGL_PARAMS = {
    7936: 'WebKit', 7937: 'WebKit WebGL',
    7938: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
    35724: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
    3379: 16384, 3386: 32768, 34076: 16384, 34024: 16384,
    36347: 1024, 36348: 30, 34921: 16, 36349: 16,
    34930: 16, 35660: 16, 35661: 80, 36183: 4,
  };
  const ctxGL = {};
  env.setObjNative(ctxGL, 'WebGLRenderingContext');
  // 与真 PC 浏览器一致（Intel/ANGLE）—— 先用 PC 常见值，报 UNDEFINED 再对齐
  ctxGL.getParameter = env.setFuncNative(function getParameter(pname) {
    if (pname === 37445) return 'Google Inc. (Intel)';
    if (pname === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
    return WEBGL_PARAMS[pname] !== undefined ? WEBGL_PARAMS[pname] : null;
  }, 'getParameter', 1);
  ctxGL.getExtension = env.setFuncNative(function getExtension(name) {
    if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
    return null;
  }, 'getExtension', 1);
  ctxGL.getSupportedExtensions = env.setFuncNative(function getSupportedExtensions() {
    return ['WEBGL_debug_renderer_info', 'WEBGL_lose_context', 'WEBGL_compressed_texture_s3tc'];
  }, 'getSupportedExtensions', 0);
  ctxGL.canvas = el;
  el.getContext = env.setFuncNative(function getContext(type) {
    if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') return ctxGL;
    return ctx2d;
  }, 'getContext', 1);
  el.toDataURL = env.setFuncNative(function toDataURL() { return FAKE_DATA_URL; }, 'toDataURL', 0);
  el.toBlob = env.setFuncNative(function toBlob(cb) { if (cb) cb({}); }, 'toBlob', 1);
  return el;
}

// ========== navigator 存根（PC Chrome）==========
const fakeNavigator = {};
env.setObjNative(fakeNavigator, 'Navigator');
Object.defineProperties(fakeNavigator, {
  userAgent: { get() { return UA_PC; }, enumerable: true },
  appVersion: { get() { return UA_PC.replace(/^Mozilla\//, ''); }, enumerable: true },
  appCodeName: { get() { return 'Mozilla'; }, enumerable: true },
  appName: { get() { return 'Netscape'; }, enumerable: true },
  platform: { get() { return 'Win32'; }, enumerable: true },
  language: { get() { return 'zh-CN'; }, enumerable: true },
  languages: { get() { return ['zh-CN', 'zh']; }, enumerable: true },
  cookieEnabled: { get() { return true; }, enumerable: true },
  vendor: { get() { return 'Google Inc.'; }, enumerable: true },
  onLine: { get() { return true; }, enumerable: true },
  hardwareConcurrency: { get() { return 16; }, enumerable: true },
  webdriver: { get() { return false; }, enumerable: true },
  maxTouchPoints: { get() { return 0; }, enumerable: true },
  deviceMemory: { get() { return 8; }, enumerable: true },
  productSub: { get() { return '20030107'; }, enumerable: true },
  doNotTrack: { get() { return null; }, enumerable: true },
});
function makePlugin(name, description, filename, mimes) {
  const p = { name, description, filename, length: mimes.length };
  mimes.forEach((m, i) => { p[i] = { type: m[0], description: m[1], suffixes: m[2], enabledPlugin: p }; });
  p.item = env.setFuncNative(function item(i) { return p[i] || null; }, 'item', 1);
  p.namedItem = env.setFuncNative(function namedItem(n) { return p[n] || null; }, 'namedItem', 1);
  return p;
}
const fakePlugins = [
  makePlugin('PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer',
    [['application/pdf', 'Portable Document Format', 'pdf']]),
  makePlugin('Chrome PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer',
    [['application/pdf', 'Portable Document Format', 'pdf']]),
];
const fakePluginArray = { length: fakePlugins.length };
fakePlugins.forEach((p, i) => { fakePluginArray[i] = p; fakePluginArray[p.name] = p; });
fakePluginArray.item = env.setFuncNative(function item(i) { return fakePlugins[i] || null; }, 'item', 1);
fakePluginArray.namedItem = env.setFuncNative(function namedItem(n) { return fakePlugins[n] || null; }, 'namedItem', 1);
fakePluginArray.refresh = env.setFuncNative(function refresh() {}, 'refresh', 0);
env.setObjNative(fakePluginArray, 'PluginArray');
Object.defineProperty(fakeNavigator, 'plugins', { get() { return fakePluginArray; }, enumerable: true });
const fakeMimeTypes = { length: 2, 0: { type: 'application/pdf' }, 1: { type: 'application/pdf' } };
Object.defineProperty(fakeNavigator, 'mimeTypes', { get() { return fakeMimeTypes; }, enumerable: true });
const fakeConnection = {};
env.setObjNative(fakeConnection, 'NetworkInformation');
Object.defineProperties(fakeConnection, {
  effectiveType: { get() { return '4g'; }, enumerable: true },
  rtt: { get() { return 50; }, enumerable: true },
  downlink: { get() { return 10; }, enumerable: true },
  saveData: { get() { return false; }, enumerable: true },
});
Object.defineProperty(fakeNavigator, 'connection', { get() { return fakeConnection; }, enumerable: true });
// Chrome 149 实测存在件（2026-11-01 真页面探针）
Object.defineProperty(fakeNavigator, 'permissions', {
  get() { return fakePermissions; }, enumerable: true,
});
const fakePermissions = {
  query: env.setFuncNative(function query() { return Promise.resolve({ state: 'granted', name: 'notifications' }); }, 'query', 0),
};
fakePermissions.vibrate = undefined;
fakeNavigator.vibrate = env.setFuncNative(function vibrate() { return true; }, 'vibrate', 1);
fakeNavigator.javaEnabled = env.setFuncNative(function javaEnabled() { return false; }, 'javaEnabled', 0);
fakeNavigator.sendBeacon = env.setFuncNative(function sendBeacon() { return true; }, 'sendBeacon', 2);
fakeNavigator.geolocation = {
  getCurrentPosition: env.setFuncNative(function getCurrentPosition(ok, err) {
    if (ok) ok({ coords: { latitude: 31.2216, longitude: 121.4425, accuracy: 50 } });
  }, 'getCurrentPosition', 1),
  watchPosition: env.setFuncNative(function watchPosition() { return 0; }, 'watchPosition', 1),
  clearWatch: env.setFuncNative(function clearWatch() {}, 'clearWatch', 1),
};

// ========== location/history/screen/storage ==========
const fakeLocation = {};
env.setObjNative(fakeLocation, 'Location');
const _url = new URL(PAGE_URL);
Object.defineProperties(fakeLocation, {
  href: { get() { return PAGE_URL; }, set() {}, enumerable: true },
  protocol: { get() { return _url.protocol; }, enumerable: true },
  host: { get() { return _url.host; }, enumerable: true },
  hostname: { get() { return _url.hostname; }, enumerable: true },
  port: { get() { return _url.port || ''; }, enumerable: true },
  pathname: { get() { return _url.pathname; }, enumerable: true },
  search: { get() { return _url.search; }, enumerable: true },
  hash: { get() { return _url.hash; }, enumerable: true },
  origin: { get() { return _url.origin; }, enumerable: true },
});
fakeLocation.assign = env.setFuncNative(function assign() {}, 'assign', 1);
fakeLocation.replace = env.setFuncNative(function replace() {}, 'replace', 1);
fakeLocation.reload = env.setFuncNative(function reload() {}, 'reload', 0);
env.setFuncNative(Object.getOwnPropertyDescriptor(fakeLocation, 'href').get, 'href', 0);

const fakeHistory = {};
env.setObjNative(fakeHistory, 'History');
Object.defineProperties(fakeHistory, {
  length: { get() { return 3; }, enumerable: true },
  state: { get() { return null; }, enumerable: true },
  scrollRestoration: { get() { return 'auto'; }, set() {}, enumerable: true },
});
fakeHistory.pushState = env.setFuncNative(function pushState() {}, 'pushState', 3);
fakeHistory.replaceState = env.setFuncNative(function replaceState() {}, 'replaceState', 3);
fakeHistory.go = env.setFuncNative(function go() {}, 'go', 0);
fakeHistory.back = env.setFuncNative(function back() {}, 'back', 0);
fakeHistory.forward = env.setFuncNative(function forward() {}, 'forward', 0);

const [, fakeScreen] = env.getNativeProto('Screen', {});
Object.defineProperties(fakeScreen, {
  width: { get() { return 1920; }, enumerable: true },
  height: { get() { return 1080; }, enumerable: true },
  availWidth: { get() { return 1920; }, enumerable: true },
  availHeight: { get() { return 1040; }, enumerable: true },
  colorDepth: { get() { return 24; }, enumerable: true },
  pixelDepth: { get() { return 24; }, enumerable: true },
  devicePixelRatio: { get() { return 1; }, enumerable: true },
});

function createStorage(name) {
  const _data = {};
  const storage = {};
  env.setObjNative(storage, 'Storage');
  storage.getItem = env.setFuncNative(function getItem(key) {
    return _data[key] !== undefined ? _data[key] : null;
  }, 'getItem', 1);
  storage.setItem = env.setFuncNative(function setItem(key, value) {
    _data[key] = String(value);
  }, 'setItem', 2);
  storage.removeItem = env.setFuncNative(function removeItem(key) { delete _data[key]; }, 'removeItem', 1);
  storage.clear = env.setFuncNative(function clear() { for (const k in _data) delete _data[k]; }, 'clear', 0);
  storage.key = env.setFuncNative(function key(i) { return Object.keys(_data)[i] || null; }, 'key', 1);
  Object.defineProperty(storage, 'length', { get() { return Object.keys(_data).length; }, enumerable: true });
  return storage;
}
const localStorage = createStorage('localStorage');
const sessionStorage = createStorage('sessionStorage');

// ========== XMLHttpRequest 桩（H5guard 会 patch 它；底层我们离线应答）==========
const _origOpen = '_open_url';
function FakeXHR() {
  this._headers = {};
  this.readyState = 0;
  this.status = 0;
  this.responseText = '';
  this.response = '';
  this.responseType = '';
  this.onabort = null; this.onerror = null; this.onload = null;
  this.onloadend = null; this.onprogress = null; this.onreadystatechange = null;
  this.ontimeout = null;
  this.withCredentials = false;
  this.timeout = 0;
  this.upload = {};
}
FakeXHR.prototype.UNSENT = 0;
FakeXHR.prototype.OPENED = 1;
FakeXHR.prototype.HEADERS_RECEIVED = 2;
FakeXHR.prototype.LOADING = 3;
FakeXHR.prototype.DONE = 4;
FakeXHR.prototype.open = env.setFuncNative(function open(method, url, async) {
  this._method = method; this[_origOpen] = url; this._async = async !== false;
  this.readyState = 1;
  if (this.onreadystatechange) this.onreadystatechange();
}, 'open', 3);
FakeXHR.prototype.setRequestHeader = env.setFuncNative(function setRequestHeader(k, v) {
  this._headers[k] = String(v);
}, 'setRequestHeader', 2);
FakeXHR.prototype.getResponseHeader = env.setFuncNative(function getResponseHeader(k) { return null; }, 'getResponseHeader', 1);
FakeXHR.prototype.getAllResponseHeaders = env.setFuncNative(function getAllResponseHeaders() { return ''; }, 'getAllResponseHeaders', 0);
FakeXHR.prototype.abort = env.setFuncNative(function abort() { this.readyState = 0; }, 'abort', 0);
FakeXHR.prototype.overrideMimeType = env.setFuncNative(function overrideMimeType() {}, 'overrideMimeType', 1);
FakeXHR.prototype.send = env.setFuncNative(function send(body) {
  this._body = body;
  const res = offlineResponse(this[_origOpen] || '');
  if (res) {
    this.status = res.status; this.readyState = 4;
    this.responseText = res.body; this.response = res.body;
    // 异步一拍回调，模拟网络
    const self = this;
    setTimeout(function () {
      if (self.onreadystatechange) self.onreadystatechange();
      if (self.onload) self.onload();
      if (self.onloadend) self.onloadend();
    }, 5);
  } else {
    // 离线外部请求 → 网络失败
    this.status = 0; this.readyState = 4;
    const self = this;
    setTimeout(function () {
      if (self.onreadystatechange) self.onreadystatechange();
      if (self.onerror) { self.onerror({ type: 'error' }); }
      if (self.onloadend) self.onloadend();
    }, 5);
  }
  global.__mh_xhrSend.push({
    url: this[_origOpen], method: this._method, body: body === undefined ? null : String(body),
    headers: Object.assign({}, this._headers),
  });
}, 'send', 1);
env.setObjNative(FakeXHR.prototype, 'XMLHttpRequest.prototype');

// 记录 H5guard 盖章后的外发请求
const _xhrSends = [];
global.__mh_xhrSend = _xhrSends;

// fetch 桩
function FakeResponse(url, res) {
  this.url = url; this.ok = res && res.status >= 200 && res.status < 300;
  this.status = res ? res.status : 0;
  this.statusText = '';
  this.headers = { get: env.setFuncNative(function get() { return null; }, 'get', 1) };
  const body = res ? res.body : '';
  this.text = env.setFuncNative(function text() { return Promise.resolve(body); }, 'text', 0);
  this.json = env.setFuncNative(function json() { return Promise.resolve(JSON.parse(body || '{}')); }, 'json', 0);
}
function FakeFetch(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  const res = offlineResponse(url);
  global.__mh_xhrSend.push({ url: url, method: (init && init.method) || 'GET', body: init && init.body ? String(init.body) : null, headers: Object.assign({}, (init && init.headers) || {}, typeof input === 'object' && input ? input.headers || {} : {}), via: 'fetch' });
  return Promise.resolve(new FakeResponse(url, res));
}
env.setFuncNative(FakeFetch, 'fetch', 2);

// ========== window 组装 ==========
const fakeWindow = {
  document: fakeDocument, navigator: fakeNavigator, location: fakeLocation,
  history: fakeHistory, screen: fakeScreen, localStorage, sessionStorage,
  XMLHttpRequest: FakeXHR, fetch: FakeFetch,
};
fakeWindow.window = fakeWindow;
fakeWindow.self = fakeWindow;
fakeWindow.top = fakeWindow;
fakeWindow.parent = fakeWindow;
fakeWindow.frames = fakeWindow;
fakeWindow.globalThis = fakeWindow;
fakeWindow.name = '';
fakeWindow.status = '';
fakeWindow.closed = false;
fakeWindow.length = 0;
fakeWindow.origin = _url.origin;

env.setFuncNative(function addEventListener() {}, 'addEventListener', 2);
fakeWindow.addEventListener = function addEventListener(t, f) { return undefined; };
fakeWindow.removeEventListener = function removeEventListener() {};
fakeWindow.dispatchEvent = env.setFuncNative(function dispatchEvent() { return true; }, 'dispatchEvent', 1);
fakeWindow.attachEvent = function attachEvent() {};
fakeWindow.detachEvent = function detachEvent() {};
fakeWindow.setTimeout = setTimeout;
fakeWindow.setInterval = setInterval;
fakeWindow.clearTimeout = clearTimeout;
fakeWindow.clearInterval = clearInterval;
fakeWindow.requestAnimationFrame = env.setFuncNative(function requestAnimationFrame(cb) { return setTimeout(cb, 16); }, 'requestAnimationFrame', 1);
fakeWindow.cancelAnimationFrame = env.setFuncNative(function cancelAnimationFrame(id) { clearTimeout(id); }, 'cancelAnimationFrame', 1);
fakeWindow.getComputedStyle = env.setFuncNative(function getComputedStyle(el) {
  return { getPropertyValue() { return ''; }, width: '100px', height: '20px' };
}, 'getComputedStyle', 1);
fakeWindow.matchMedia = env.setFuncNative(function matchMedia(q) {
  return { matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
}, 'matchMedia', 1);
fakeWindow.open = env.setFuncNative(function open() { return null; }, 'open', 3);
fakeWindow.close = function close() {};
fakeWindow.confirm = env.setFuncNative(function confirm() { return true; }, 'confirm', 1);
fakeWindow.alert = function alert() {};
fakeWindow.prompt = env.setFuncNative(function prompt() { return null; }, 'prompt', 1);
fakeWindow.scrollTo = function scrollTo() {};
fakeWindow.scrollBy = function scrollBy() {};
fakeWindow.scroll = function scroll() {};
fakeWindow.focus = function focus() {};
fakeWindow.blur = function blur() {};
fakeWindow.postMessage = env.setFuncNative(function postMessage() {}, 'postMessage', 2);
fakeWindow.atob = env.setFuncNative(function atob(s) { return Buffer.from(s, 'base64').toString('binary'); }, 'atob', 1);
fakeWindow.btoa = env.setFuncNative(function btoa(s) { return Buffer.from(s, 'binary').toString('base64'); }, 'btoa', 1);
fakeWindow.encodeURIComponent = encodeURIComponent;
fakeWindow.decodeURIComponent = decodeURIComponent;
fakeWindow.encodeURI = encodeURI;
fakeWindow.decodeURI = decodeURI;
fakeWindow.escape = escape;
fakeWindow.unescape = unescape;
fakeWindow.parseInt = parseInt;
fakeWindow.parseFloat = parseFloat;
fakeWindow.isNaN = isNaN;
fakeWindow.isFinite = isFinite;
const std = { Math, JSON, Date, RegExp, Array, Object, String, Number, Boolean, Symbol,
  Error, TypeError, RangeError, SyntaxError, EvalError, URIError,
  Map, Set, WeakMap, WeakSet, Promise, Proxy, Reflect, Function,
  ArrayBuffer, Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
  Float32Array, Float64Array, Uint8ClampedArray, DataView, Blob: function Blob() {},
  WebSocket: function WebSocket(url) {
    this.url = url; this.readyState = 1;
    this.send = env.setFuncNative(function send() {}, 'send', 1);
    this.close = env.setFuncNative(function close() {}, 'close', 0);
  },
};
for (const k in std) fakeWindow[k] = std[k];
// --- 构造函数 new 兼容垫片（env-patch 诊断 2026-11-01）---
// env_core 的 window Proxy 把 fakeWindow 上所有 typeof function 的值包一层 wrappedFn：
//   1) 丢构造函数静态成员（Date.now 等）→ Function.prototype 静态垫片兜底（下方 _ctorStaticShim）
//   2) `new wrappedFn()` 走 [[Construct]] → wrappedFn 内部 value.apply(新对象, args) →
//      真实构造函数被无 new 调用 → "Constructor Uint8Array requires 'new'"。
// 修复：拦 Function.prototype.apply——当宿主是「按构造函数名注册的 wrapper」且 thisArg 恰是
//   wrapper.prototype 派生的新对象（[[Construct]] 特征）时，改走 Reflect.construct。
const _ctorRegistry = { Date, Promise, RegExp, Error, TypeError, RangeError, SyntaxError, EvalError, URIError,
  Map, Set, WeakMap, WeakSet, ArrayBuffer, Uint8Array, Int8Array, Uint16Array, Int16Array,
  Uint32Array, Int32Array, Float32Array, Float64Array, Uint8ClampedArray, DataView, Function, Object, Array };
const _ctorNames = new Set(Object.keys(_ctorRegistry));
const _origApply = Function.prototype.apply;
Function.prototype.apply = function h5applyShim(thisArg, args) {
  // construct 特征：thisArg 由 wrapper [[Construct]] 创建 → 其原型为 wrapper.prototype，
  // 原型上 constructor = wrapper，wrapper.name = 原构造函数名；且 this(被 apply 的值)恰为该原生构造函数。
  if (thisArg && typeof thisArg === 'object') {
    const _pc = Object.getPrototypeOf(thisArg);
    const _pcn = _pc && _pc.constructor && _pc.constructor.name;
    if (_pcn && _ctorNames.has(_pcn) && _pcn === this.name && this === _ctorRegistry[_pcn] && _pc.constructor !== _ctorRegistry[_pcn]) {
      try { return Reflect.construct(_ctorRegistry[_pcn], Array.from(args || [])); } catch (e) { /* fallthrough */ }
    }
  }
  return _origApply.call(this, thisArg, args);
};
function _ctorStaticShim(ctor, statics) {
  for (const name of statics) {
    if (name in Function.prototype) continue;
    Object.defineProperty(Function.prototype, name, {
      configurable: true, writable: true, enumerable: false,
      value: function () { return ctor[name].apply(ctor, arguments); },
    });
  }
}
_ctorStaticShim(Date, ['now', 'parse', 'UTC']);
_ctorStaticShim(Promise, ['resolve', 'reject', 'all', 'allSettled', 'race', 'any']);
_ctorStaticShim(Array, ['isArray', 'from', 'of']);
_ctorStaticShim(Object, ['keys', 'values', 'entries', 'assign', 'freeze', 'create', 'defineProperty', 'getOwnPropertyNames', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'setPrototypeOf']);
_ctorStaticShim(String, ['fromCharCode', 'fromCodePoint', 'raw']);
_ctorStaticShim(Number, ['isInteger', 'isSafeInteger', 'isFinite', 'isNaN', 'parseFloat', 'parseInt']);
_ctorStaticShim(Symbol, ['for', 'asyncIterator', 'iterator', 'toStringTag', 'toPrimitive']);
fakeWindow.WebSocket.prototype = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };
fakeWindow.Image = env.setFuncNative(function Image() { return makeElement('IMG'); }, 'Image', 0);
fakeWindow.HTMLElement = env.setFuncNative(function HTMLElement() {}, 'HTMLElement', 0);
fakeWindow.Element = env.setFuncNative(function Element() {}, 'Element', 0);
fakeWindow.Node = env.setFuncNative(function Node() {}, 'Node', 0);
fakeWindow.HTMLElement.prototype = makeElement('div');
fakeWindow.MutationObserver = env.setFuncNative(function MutationObserver(cb) {
  this.observe = env.setFuncNative(function observe() {}, 'observe', 2);
  this.disconnect = env.setFuncNative(function disconnect() {}, 'disconnect', 0);
}, 'MutationObserver', 1);
fakeWindow.Event = env.setFuncNative(function Event(t) { this.type = t; }, 'Event', 1);
fakeWindow.CustomEvent = fakeWindow.Event;
fakeWindow.FileReader = env.setFuncNative(function FileReader() {
  this.readAsText = function () { if (this.onload) this.onload({ target: { result: '' } }); };
  this.readAsDataURL = function () { if (this.onload) this.onload({ target: { result: '' } }); };
}, 'FileReader', 0);
fakeWindow.Blob = std.Blob;
fakeWindow.FormData = env.setFuncNative(function FormData() { this._d = { append() {} }; }, 'FormData', 0);

// --- performance ---
const _t0 = Date.now();
const fakePerformance = {};
env.setObjNative(fakePerformance, 'Performance');
fakePerformance.now = env.setFuncNative(function now() { return Date.now() - _t0; }, 'now', 0);
fakePerformance.timing = {
  navigationStart: _t0, fetchStart: _t0, domainLookupStart: _t0, domainLookupEnd: _t0,
  connectStart: _t0, connectEnd: _t0 + 10, requestStart: _t0 + 10, responseStart: _t0 + 50,
  responseEnd: _t0 + 60, domLoading: _t0 + 60, domInteractive: _t0 + 300,
  domContentLoadedEventStart: _t0 + 300, domContentLoadedEventEnd: _t0 + 320,
  domComplete: _t0 + 500, loadEventStart: _t0 + 500, loadEventEnd: _t0 + 600,
  redirectStart: 0, redirectEnd: 0, unloadEventStart: 0, unloadEventEnd: 0,
  secureConnectionStart: 0,
};
fakePerformance.getEntries = env.setFuncNative(function getEntries() { return []; }, 'getEntries', 0);
fakePerformance.getEntriesByType = env.setFuncNative(function getEntriesByType() { return []; }, 'getEntriesByType', 1);
fakePerformance.getEntriesByName = env.setFuncNative(function getEntriesByName() { return []; }, 'getEntriesByName', 1);
fakePerformance.mark = function mark() {};
fakePerformance.measure = function measure() {};
fakePerformance.clearMarks = function clearMarks() {};
fakePerformance.clearMeasures = function clearMeasures() {};
fakeWindow.performance = fakePerformance;

// --- chrome 对象 ---
const fakeChrome = {
  app: { isInstalled: false, getIsInstalled: env.setFuncNative(function getIsInstalled() { return false; }, 'getIsInstalled', 0) },
  runtime: {
    connect: function connect() {},
    sendMessage: function sendMessage() {},
    PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
  },
  loadTimes: env.setFuncNative(function loadTimes() { return {}; }, 'loadTimes', 0),
  csi: env.setFuncNative(function csi() { return {}; }, 'csi', 0),
};
fakeWindow.chrome = fakeChrome;

// --- 外观尺寸（PC）---
fakeWindow.innerWidth = 1920; fakeWindow.innerHeight = 1080;
fakeWindow.outerWidth = 1920; fakeWindow.outerHeight = 1120;
fakeWindow.devicePixelRatio = 1;
fakeWindow.screenX = 0; fakeWindow.screenY = 0;
fakeWindow.pageXOffset = 0; fakeWindow.pageYOffset = 0;
fakeWindow.screenTop = 0; fakeWindow.screenLeft = 0;
fakeWindow.scrollX = 0; fakeWindow.scrollY = 0;
fakeWindow.doNotTrack = null;

// knb.js 桥（美团 webview JS bridge）
// 注意：必须用普通赋值（writable/configurable），否则 H5guard 的 v$1 defineProperty
// 会以 non-configurable 写入 window 代理 target → env 代理每次 get 包装出新对象 →
// 违反 Proxy get 恒量（"did not return its actual value"）
global.__knbCallCount = { m: {}, p: {}, t: {} };
const knbNativeInvoker = function knbNativeInvoker() {
  try {
    const args = Array.prototype.slice.call(arguments);
    const name = String(args[0]);
    global.__knbCallCount[String(name)] = (global.__knbCallCount[String(name)] || 0) + 1;
    return 0;
  } catch (_e) { return 0; }
};
env.setFuncNative(knbNativeInvoker, 'knbNativeInvoker', 0);
global.knbNativeInvoker = knbNativeInvoker;
// 预占位，防 H5guard v$1 defineProperty（见上）；其余 v$1(r$1,"...") 单例同理枚举预挂
const knbSingletons = {
  knbNativeInvoker: knbNativeInvoker,
  knbInvokeKeyManager: {
    createInvokeKey: function createInvokeKey() { return 'kh' + Date.now().toString(36); },
    getInvokeKeyFromWindow: function getInvokeKeyFromWindow() { return ''; },
    getInvokeKeyFromNative: function getInvokeKeyFromNative() { return ''; },
  },
  knbSessionIdManager: {
    getSessionId: function getSessionId() { return ''; },
    createSessionId: function createSessionId() { return 'kss' + Date.now().toString(36); },
    getGlobalSessionId: function getGlobalSessionId() { return ''; },
  },
  knbUrlSetIdManager: {
    getUrlSetId: function getUrlSetId() { return ''; },
    createUrlSetId: function createUrlSetId() { return 'kus' + Date.now().toString(36); },
  },
  knbBridgeInitializer: {
    initBridge: function initBridge() { return true; },
  },
};
for (const k in knbSingletons) fakeWindow[k] = knbSingletons[k];

// 页面级 SDK 占位（真浏览器由 CDN 脚本提供）
fakeWindow.__IS_KNB_OFFLINE_HTML__ = false;
fakeWindow.__STANDARD_KNB_OFFLINE_RESOURCES_PLACEHOLDER__ = false;
// 真页面 window.Owl 是 Titan 全家桶；new Owl.OWL(pid) 返回带各 manager 的实例。
// H5guard 拿它做打点，全部 no-op 记数即可；但 Owl.OWL 必须是构造函数（真实读数 ×3）。
function FakeOwlManager() { this.tags = {}; this.kvs = {}; this.extraData = {}; this.points = []; this.cache = []; this.cacheSending = []; }
FakeOwlManager.prototype.setTags = function setTags() {}; FakeOwlManager.prototype.getTags = function getTags() { return {}; };
FakeOwlManager.prototype.setMetric = function setMetric() {}; FakeOwlManager.prototype.setExtraData = function setExtraData() {};
FakeOwlManager.prototype.getMetric = function getMetric() { return {}; }; FakeOwlManager.prototype.clearMetric = function clearMetric() {};
FakeOwlManager.prototype.report = function report() {}; FakeOwlManager.prototype.push = function push() {};
FakeOwlManager.prototype.addLog = function addLog() {}; FakeOwlManager.prototype.addCacheExtension = function addCacheExtension() {};
FakeOwlManager.prototype.get = function get(k) { return undefined; }; FakeOwlManager.prototype.set = function set() {}; FakeOwlManager.prototype.update = function update() {};
FakeOwlInstance.prototype = {
  // 真页面 H5guard 只用这些：读 cfgManager/metricManager + 调 reportPv({ctags})（浏览器实测 2026-11-01）
  reportPv: function reportPv() {},
  errManager: null, pageManager: null, resManager: null, metricManager: null,
  pvManager: null, logManager: null, cfgManager: null,
};
function FakeOwlInstance(pid) {
  this.errManager = new FakeOwlManager();
  this.pageManager = new FakeOwlManager();
  this.resManager = new FakeOwlManager();
  this.metricManager = new FakeOwlManager();
  this.pvManager = new FakeOwlManager();
  this.logManager = new FakeOwlManager();
  this.cfgManager = new FakeOwlManager();
}
fakeWindow.Owl = {
  reportError: function reportError() {}, report: function report() {},
  addPoint: function addPoint() {}, breakOnce: function breakOnce() {},
  OWL: FakeOwlInstance,
  MetricManager: FakeOwlManager,
  errorModel: {},
  start: function start() {}, isStarted: true,
  __version__: '5.0.0',
};
fakeWindow.Logan = { error: function error() {}, log: function log() {}, warning: function warning() {}, info: function info() {}, config: function config() {}, init: function init() {} };
fakeWindow.onerror = function onerror() {};

// —— Chrome 149 实测存在的 window 件（缺失会导致 H5guard env 特征位异常：a10 "41" vs 真机 "1c"）——
fakeWindow.Window = env.setFuncNative(function Window() { throw new TypeError('Illegal constructor'); }, 'Window', 0);
fakeWindow.Window.prototype = {};
const _idb = {
  open: env.setFuncNative(function open() { return {}; }, 'open', 1),
  deleteDatabase: env.setFuncNative(function deleteDatabase() {}, 'deleteDatabase', 1),
  databases: env.setFuncNative(function databases() { return Promise.resolve([]); }, 'databases', 0),
  cmp: env.setFuncNative(function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }, 'cmp', 2),
};
env.setObjNative(_idb, 'IDBFactory');
fakeWindow.indexedDB = _idb;
function AudioContext() {
  this.destination = {}; this.sampleRate = 48000; this.state = 'running'; this.currentTime = 0;
}
const _acMethods = ['createOscillator', 'createGain', 'createAnalyser', 'createBuffer', 'createBufferSource',
  'createDynamicsCompressor', 'createWaveShaper', 'createBiquadFilter', 'createDelay'];
_acMethods.forEach(function (m) { AudioContext.prototype[m] = env.setFuncNative(function () { return {}; }, m, 0); });
AudioContext.prototype.resume = env.setFuncNative(function resume() { return Promise.resolve(); }, 'resume', 0);
AudioContext.prototype.close = env.setFuncNative(function close() { return Promise.resolve(); }, 'close', 0);
AudioContext.prototype.suspend = env.setFuncNative(function suspend() { return Promise.resolve(); }, 'suspend', 0);
env.setFuncNative(AudioContext, 'AudioContext', 0);
fakeWindow.AudioContext = AudioContext;
fakeWindow.webkitAudioContext = undefined;   // Chrome 149 已无 webkit 前缀（与真机一致）
// KNB（maoyan H5 页面都会加载 k16k js bridge 对象；真页面为 object）
function _knbStub() {
  const KNB = { __version__: '4.3.0', env: {}, _isReady: true, cache: {} };
  const noop = function noop() {};
  const names = ['NOTIMPLEMENTED', 'load', '_ready', 'ready', 'use', 'config', 'isApiSupported',
    'getApisVersion', 'getUA', 'checkAuthorization', 'getFingerprint', 'getUserInfo', 'getDeviceInfo',
    'login', 'logout', 'sendSMS', 'getContactList', 'pickContact', 'getCity', 'getLocationCity',
    'getLocation', 'getNetworkType', 'pickCity', 'share', 'configShare', 'openWebview', 'closeWebview',
    'jumpWebview', 'setTitle', 'setImageTitle', 'setNavButtons', 'setNavigationBarHidden',
    'setBackgroundColor', 'setBouncesEnabled', 'setStatusBarStyle', 'setPullDown', 'stopPullDown',
    'setLLButton', 'setLRButton', 'setRRButton', 'setRLButton', 'setSearchBar', 'scanQRCode',
    'showKeyboard', 'store', 'retrieve', 'alert', 'confirm', 'prompt', 'sendLog', 'chooseImage',
    'previewImage', 'uploadImage', 'downloadImage', 'publish', 'subscribe', 'unsubscribe',
    'setResult', 'getResult', 'shareImage', 'shareMiniProgram', 'addRequestSignature',
    'stopLocating', 'setStorage', 'getStorage', 'clearStorage', 'getAppInfo', 'getWifiInfo',
    'getImageInfo', 'setupEvent', 'setTitleBar', 'resetTitleBar', 'setTitleBarAction',
    'addTitleBarElement', 'removeTitleBarElement', 'replaceTitleBarElement', 'requestPermission',
    'openPage', 'jumpPage', 'closePage', 'getServiceInfo'];
  names.forEach(function (n) { KNB[n] = env.setFuncNative(noop, n, 0); });
  KNB.getUA = env.setFuncNative(function getUA() { return UA_PC; }, 'getUA', 0);
  KNB.uaInfo = env.setFuncNative(function uaInfo() { return UA_PC; }, 'uaInfo', 0);
  KNB.getPromiseInstance = env.setFuncNative(function getPromiseInstance() { return Promise; }, 'getPromiseInstance', 0);
  KNB.Semver = { version: '4.3.0' };
  return KNB;
}
fakeWindow.KNB = _knbStub();
// 注意：真浏览器 fresh 页面里 window.H5guard 在 launcher 之前不存在；
// 预先塞 {init} 会让 H5guard 的"已存在"检测误判成立而直接调 .sign → VM 栈压 undefined 崩溃。
// 故不预挂 H5guard，与浏览器保持一致（undefined 读数可接受，见 env-patch 决策树）。

// ========== env.init ==========
env.init({
  window: env.createProxy(fakeWindow, 'window', 0),
  document: env.createProxy(fakeDocument, 'document', 0),
  navigator: env.createProxy(fakeNavigator, 'navigator', 0),
  location: env.createProxy(fakeLocation, 'location', 0),
});
global.chrome = fakeChrome;
global.screen = fakeScreen;
// 裸标识符兜底：H5guard 用 typeof XMLHttpRequest 等裸全局探测（不只 window.xxx）
global.XMLHttpRequest = fakeWindow.XMLHttpRequest;
global.fetch = fakeWindow.fetch;
global.localStorage = fakeWindow.localStorage;
global.sessionStorage = fakeWindow.sessionStorage;
global.document = fakeDocument;
global.navigator = fakeNavigator;
global.location = fakeLocation;
global.history = fakeHistory;
global.CustomEvent = fakeWindow.CustomEvent;
global.Event = fakeWindow.Event;
global.MutationObserver = fakeWindow.MutationObserver;
global.Image = fakeWindow.Image;
global.FormData = fakeWindow.FormData;
global.Blob = fakeWindow.Blob;
global.FileReader = fakeWindow.FileReader;

// ========== 出签入口（H5guard.js 由宿主随后在同一 context 里执行）==========
// 真页面 API 对齐: await window.H5guard.sign({url, method, data}) → {url, method, data, headers:{mtgsig}}
global.__catbus_mtgsig = function (url, method, data) {
  const h5 = fakeWindow.H5guard;
  if (!h5 || typeof h5.sign !== 'function') {
    return Promise.reject(new Error('window.H5guard.sign unavailable (typeof=' + typeof (h5 && h5.sign) + ')'));
  }
  return h5.sign({ url: url, method: method, data: data || '' }).then(function (res) {
    const ms = res && res.headers && res.headers.mtgsig;
    if (!ms) throw new Error('no mtgsig in result');
    return ms;
  });
};
