/**
 * kwf 预言机：在 Node 里跑真实的 kwf 脚本，拿到 window.kwpsec.getData()
 * 的 218 字符指纹，并记录它到底读了哪些环境属性。
 *
 * 用途：给纯 Python 移植做对拍基准，同时摸清必须自造的环境面。
 *
 * 用法:
 *   node reverse/tools/kwf_oracle.js            出指纹 + 打印访问过的属性
 *   node reverse/tools/kwf_oracle.js quiet      只出指纹
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let createCanvas = null;
try { ({ createCanvas } = require('@napi-rs/canvas')); } catch (_) {}

const defaultScript = path.join(__dirname, '..', 'bundles', 'weapon',
  'kwf-0.0.2.2cee19b4b7dec496.js');
const requestedScript = process.env.KS_KWF_SCRIPT || '';
const SCRIPT = requestedScript
  ? (path.isAbsolute(requestedScript) ? requestedScript
    : path.join(__dirname, '..', '..', requestedScript))
  : defaultScript;

const touched = [];
const caughtErrors = [];
const recentVmSteps = [];
const badReferences = [];
const missingProperties = [];
const jsonCalls = [];
const cookieRegexCalls = [];
const cookieWrites = [];
const propertyAssignments = [];
const propertyReads = [];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

// 记录属性访问的 Proxy。深度包一层，未知属性返回 undefined 而不是抛错。
function watch(target, label) {
  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === 'string') touched.push(`${label}.${prop}`);
      const v = obj[prop];
      if (v && typeof v === 'object' && !Array.isArray(v)
          && !(v instanceof Date) && label.split('.').length < 3) {
        return watch(v, `${label}.${String(prop)}`);
      }
      return v;
    },
    has(obj, prop) {
      if (typeof prop === 'string') touched.push(`${label} in:${prop}`);
      return prop in obj;
    },
  });
}

// 一套自洽的固定环境（纯算的目标就是把这套值喂进去而不依赖真浏览器）
// localStorage is persistent browser state. The old oracle recreated it for
// every Node process, silently resetting kwfcv1 to null and therefore always
// producing the 174-character branch. Accept and return both values so the
// Python session can carry the same state across calls.
const store = {
  kwfv1: process.env.KS_KWFV1 || null,
  kwfcv1: process.env.KS_KWFCV1 || null,
};
const requestedHref = process.env.KS_HREF || 'https://www.kuaishou.com/new-reco';
const requestedHost = process.env.KS_HOSTNAME || 'www.kuaishou.com';
const requestedCookie = process.env.KS_COOKIE || '';
const requestedHardwareConcurrency = Number(process.env.KS_HARDWARE_CONCURRENCY || 20);
const cookieJar = new Map();
for (const part of requestedCookie.split(';')) {
  const item = part.trim();
  if (!item) continue;
  const equal = item.indexOf('=');
  if (equal <= 0) continue;
  cookieJar.set(item.slice(0, equal).trim(), item.slice(equal + 1));
}

// Chrome 151 / Windows WebGL values observed on the same CP page that emitted
// the authoritative /s/w/p request.  Keep this deliberately narrow: unknown
// parameters are recorded and return null instead of being invented.
function WebGLRenderingContext() {}
Object.defineProperty(WebGLRenderingContext.prototype, Symbol.toStringTag, {
  value: 'WebGLRenderingContext', configurable: true,
});
const WEBGL_PARAMETER_VALUES = new Map([
  [3379, 16384],
  [3386, [32767, 32767]],
  [7936, 'WebKit'],
  [7937, 'WebKit WebGL'],
  [7938, 'WebGL 1.0 (OpenGL ES 2.0 Chromium)'],
  [34024, 16384],
  [34076, 16384],
  [34921, 16],
  [34930, 16],
  [35660, 16],
  [35661, 32],
  [35724, 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)'],
  [36183, null],
  [36347, 4095],
  [36348, 30],
  [36349, 1024],
  [37445, 'Google Inc. (NVIDIA)'],
  [37446, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
]);
const WEBGL_EXTENSIONS = [
  'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_clip_control',
  'EXT_color_buffer_half_float', 'EXT_depth_clamp',
  'EXT_disjoint_timer_query', 'EXT_float_blend', 'EXT_frag_depth',
  'EXT_polygon_offset_clamp', 'EXT_shader_texture_lod',
  'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc',
  'EXT_texture_filter_anisotropic', 'EXT_texture_mirror_clamp_to_edge',
  'EXT_sRGB', 'KHR_parallel_shader_compile', 'OES_element_index_uint',
  'OES_fbo_render_mipmap', 'OES_standard_derivatives', 'OES_texture_float',
  'OES_texture_float_linear', 'OES_texture_half_float',
  'OES_texture_half_float_linear', 'OES_vertex_array_object',
  'WEBGL_blend_func_extended', 'WEBGL_color_buffer_float',
  'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb',
  'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_depth_texture',
  'WEBGL_draw_buffers', 'WEBGL_lose_context', 'WEBGL_multi_draw',
  'WEBGL_polygon_mode',
];
function makeWebGLContext() {
  const gl = Object.create(WebGLRenderingContext.prototype);
  Object.assign(gl, {
    MAX_TEXTURE_SIZE: 3379,
    MAX_VIEWPORT_DIMS: 3386,
    VENDOR: 7936,
    RENDERER: 7937,
    VERSION: 7938,
    MAX_RENDERBUFFER_SIZE: 34024,
    MAX_CUBE_MAP_TEXTURE_SIZE: 34076,
    MAX_VERTEX_ATTRIBS: 34921,
    MAX_TEXTURE_IMAGE_UNITS: 34930,
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661,
    SHADING_LANGUAGE_VERSION: 35724,
    MAX_SAMPLES: 36183,
    LOW_FLOAT: 36336,
    MEDIUM_FLOAT: 36337,
    HIGH_FLOAT: 36338,
    LOW_INT: 36339,
    MEDIUM_INT: 36340,
    HIGH_INT: 36341,
    MAX_VERTEX_UNIFORM_VECTORS: 36347,
    MAX_VARYING_VECTORS: 36348,
    MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
  });
  gl.getParameter = (parameter) => {
    const p = Number(parameter);
    touched.push(`webgl.getParameter:${p}`);
    if (!WEBGL_PARAMETER_VALUES.has(p)) {
      touched.push(`webgl.getParameter.unobserved:${p}`);
      return null;
    }
    const value = WEBGL_PARAMETER_VALUES.get(p);
    return Array.isArray(value) ? new Int32Array(value) : value;
  };
  gl.getSupportedExtensions = () => {
    touched.push('webgl.getSupportedExtensions');
    return WEBGL_EXTENSIONS.slice();
  };
  gl.getExtension = (name) => {
    const extension = String(name || '');
    touched.push(`webgl.getExtension:${extension}`);
    if (!WEBGL_EXTENSIONS.includes(extension)) return null;
    if (extension === 'WEBGL_debug_renderer_info') {
      return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
    }
    if (extension === 'WEBGL_lose_context') {
      const lose = {
        loseContext() { touched.push('webgl.WEBGL_lose_context.loseContext'); },
        restoreContext() { touched.push('webgl.WEBGL_lose_context.restoreContext'); },
      };
      try { Object.defineProperty(lose, Symbol.toStringTag, {
        value: 'WebGLLoseContext', configurable: true,
      }); } catch (_) {}
      return lose;
    }
    return {};
  };
  gl.getContextAttributes = () => {
    touched.push('webgl.getContextAttributes');
    return {
      alpha: true, antialias: true, depth: true, desynchronized: false,
      failIfMajorPerformanceCaveat: false, powerPreference: 'default',
      premultipliedAlpha: true, preserveDrawingBuffer: false,
      stencil: false, xrCompatible: false,
    };
  };
  gl.getShaderPrecisionFormat = (shaderType, precisionType) => {
    const p = Number(precisionType);
    touched.push(`webgl.getShaderPrecisionFormat:${Number(shaderType)}:${p}`);
    const isFloat = p === 36336 || p === 36337 || p === 36338;
    const isInt = p === 36339 || p === 36340 || p === 36341;
    if (!isFloat && !isInt) return null;
    const value = isFloat
      ? { rangeMin: 127, rangeMax: 127, precision: 23 }
      : { rangeMin: 31, rangeMax: 30, precision: 0 };
    try { Object.defineProperty(value, Symbol.toStringTag, {
      value: 'WebGLShaderPrecisionFormat', configurable: true,
    }); } catch (_) {}
    return value;
  };
  return gl;
}
function MimeType(type, plugin) {
  this.type = type;
  this.suffixes = 'pdf';
  this.description = 'Portable Document Format';
  this.enabledPlugin = plugin;
}
Object.defineProperty(MimeType.prototype, Symbol.toStringTag, {
  value: 'MimeType', configurable: true,
});
function Plugin(name) {
  this.name = name;
  this.filename = 'internal-pdf-viewer';
  this.description = 'Portable Document Format';
  this[0] = new MimeType('application/pdf', this);
  this[1] = new MimeType('text/pdf', this);
  this.length = 2;
}
Object.defineProperty(Plugin.prototype, Symbol.toStringTag, {
  value: 'Plugin', configurable: true,
});
const pdfPlugins = [
  'PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer',
  'Microsoft Edge PDF Viewer', 'WebKit built-in PDF',
].map((name) => new Plugin(name));
const pluginArray = Object.assign({}, pdfPlugins, { length: pdfPlugins.length });
Object.defineProperty(pluginArray, Symbol.toStringTag, {
  value: 'PluginArray', configurable: true,
});
const mimeTypeArray = Object.assign({}, {
  0: pdfPlugins[0][0], 1: pdfPlugins[0][1], length: 2,
});
Object.defineProperty(mimeTypeArray, Symbol.toStringTag, {
  value: 'MimeTypeArray', configurable: true,
});
const navigatorPrototype = {};
Object.defineProperty(navigatorPrototype, Symbol.toStringTag, {
  value: 'Navigator', configurable: true,
});
Object.defineProperty(navigatorPrototype, 'webdriver', {
  get() { return false; }, configurable: true,
});
function Navigator() {}
Navigator.prototype = navigatorPrototype;
Object.defineProperty(navigatorPrototype, 'constructor', {
  value: Navigator, writable: true, configurable: true,
});
const navigator = Object.assign(Object.create(navigatorPrototype), {
  userAgent: UA,
  appVersion: UA.slice('Mozilla/'.length),
  platform: 'Win32',
  language: 'zh-CN',
  languages: ['zh-CN', 'zh', 'en', 'zh-TW', 'ja'],
  vendor: 'Google Inc.',
  hardwareConcurrency: requestedHardwareConcurrency,
  deviceMemory: 8,
  maxTouchPoints: 0,
  cookieEnabled: true,
  doNotTrack: null,
  pdfViewerEnabled: true,
  plugins: pluginArray,
  mimeTypes: mimeTypeArray,
  product: 'Gecko',
  productSub: '20030107',
  appName: 'Netscape',
  appCodeName: 'Mozilla',
  onLine: true,
  vibrate() { return true; },
});
function Screen() {}
Object.defineProperty(Screen.prototype, Symbol.toStringTag, {
  value: 'Screen', configurable: true,
});
const screenObj = {
  width: 1920, height: 1080, availWidth: 1920, availHeight: 1032,
  colorDepth: 24, pixelDepth: 24, availLeft: 0, availTop: 0,
};
Object.setPrototypeOf(screenObj, Screen.prototype);
const bodyChildren = [];
function markMounted(el, mounted) {
  if (!el) return;
  el.__mounted = mounted;
  for (const child of el.children || []) markMounted(child, mounted);
}
const bodyObj = {
  clientWidth: 1920, clientHeight: 947,
  appendChild(el) { touched.push('body.appendChild'); if (el) { markMounted(el, true); bodyChildren.push(el); } return el; },
  removeChild(el) { touched.push('body.removeChild'); const i = bodyChildren.indexOf(el); if (i >= 0) bodyChildren.splice(i, 1); markMounted(el, false); return el; },
};
const documentObj = {
  get cookie() {
    touched.push('document.cookie');
    return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  },
  set cookie(raw) {
    touched.push('document.cookie=');
    const parts = String(raw || '').split(';').map((item) => item.trim());
    const pair = parts[0] || '';
    const equal = pair.indexOf('=');
    if (equal <= 0) return;
    const name = pair.slice(0, equal).trim();
    const value = pair.slice(equal + 1);
    cookieWrites.push({
      name,
      valueLength: value.length,
      attributes: parts.slice(1).map((attr) => attr.split('=', 1)[0].toLowerCase()),
    });
    const expired = parts.slice(1).some((attr) => {
      const lower = attr.toLowerCase();
      if (lower.startsWith('max-age=')) return Number(lower.slice(8)) <= 0;
      if (!lower.startsWith('expires=')) return false;
      const when = Date.parse(attr.slice(attr.indexOf('=') + 1));
      return Number.isFinite(when) && when <= Date.now();
    });
    if (expired) cookieJar.delete(name);
    else cookieJar.set(name, value);
  },
  referrer: '',
  title: '快手',
  characterSet: 'UTF-8',
  // getAttribute 必须有：脚本会查 documentElement 上的 webdriver/selenium 标记，
  // 缺了它调用直接抛异常，getData() 就返回 null。
  documentElement: {
    clientWidth: 1920, clientHeight: 947, lang: 'zh-CN',
    getAttribute() { return null; },
    hasAttribute() { return false; },
  },
  body: bodyObj,
  scripts: { length: 12 },
  createElement(tag) {
    if (String(tag || '').toLowerCase() === 'canvas' && createCanvas) {
      touched.push('document.createElement:canvas:napi');
      const canvas = createCanvas(300, 150);
      try { Object.defineProperty(canvas, Symbol.toStringTag, { value: 'HTMLCanvasElement', configurable: true }); } catch (_) {}
      canvas.style = {};
      canvas.setAttribute = () => {};
      canvas.appendChild = () => {};
      canvas.getBoundingClientRect = () => ({ width: canvas.width, height: canvas.height, top: 0, left: 0 });
      const rawGetContext = canvas.getContext.bind(canvas);
      canvas.getContext = (...args) => {
        touched.push(`canvas.getContext:${args[0]}`);
        if (/^(experimental-)?webgl$/i.test(String(args[0] || ''))) {
          return makeWebGLContext();
        }
        let ctx;
        try { ctx = rawGetContext(...args); } catch (err) {
          touched.push(`canvas.getContext.error:${err}`);
          throw err;
        }
        try { Object.defineProperty(ctx, Symbol.toStringTag, { value: 'CanvasRenderingContext2D', configurable: true }); } catch (_) {}
        return ctx;
      };
      const rawToDataURL = canvas.toDataURL.bind(canvas);
      canvas.toDataURL = (...args) => {
        touched.push(`canvas.toDataURL:${args.join(':')}`);
        try { const out = rawToDataURL(...args); touched.push(`canvas.toDataURL.length:${String(out).length}`); return out; }
        catch (err) { touched.push(`canvas.toDataURL.error:${err}`); throw err; }
      };
      return canvas;
    }
    const tagName = String(tag || '').toLowerCase();
    const children = [];
    const el = {
      tagName: tagName.toUpperCase(), nodeName: tagName.toUpperCase(),
      getContext() { return null; },
      style: {}, setAttribute() {},
      appendChild(child) { children.push(child); if (child) child.__parent = el; return child; },
      removeChild(child) { const i = children.indexOf(child); if (i >= 0) children.splice(i, 1); return child; },
      children, childNodes: children,
      getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0 }; },
    };
    if (tagName === 'iframe') {
      el.srcdoc = '';
      Object.defineProperty(el, 'contentWindow', {
        value: null, enumerable: true, configurable: true,
      });
      Object.defineProperty(el, 'contentDocument', {
        value: null, enumerable: true, configurable: true,
      });
      try { Object.defineProperty(el, Symbol.toStringTag, {
        value: 'HTMLIFrameElement', configurable: true,
      }); } catch (_) {}
    }
    const fontDimensions = () => {
      const family = String(el.style.fontFamily || '');
      if (/Microsoft YaHei/i.test(family)) return { width: 732, height: 105 };
      if (/^(Helvetica|Arial)(,|$)/i.test(family)) return { width: 648, height: 105 };
      if (/monospace/i.test(family)) return { width: 468, height: 82 };
      if (/sans-serif/i.test(family)) return { width: 727, height: 105 };
      if (/serif/i.test(family)) return { width: 773, height: 104 };
      return { width: 0, height: 0 };
    };
    Object.defineProperty(el, 'offsetHeight', {
      get() {
        touched.push(`element.${tagName}.offsetHeight`);
        if (!el.__mounted) return 0;
        if (el.style.height === '20px') return 20;
        return tagName === 'span' ? fontDimensions().height : 0;
      },
    });
    Object.defineProperty(el, 'offsetWidth', {
      get() {
        touched.push(`element.${tagName}.offsetWidth`);
        return el.__mounted && tagName === 'span' ? fontDimensions().width : 0;
      },
    });
    if (process.env.KS_KWF_TRACE_ERRORS !== '1') return el;
    return new Proxy(el, {
      get(target, prop) {
        if (typeof prop === 'string') {
          touched.push(`element.${tagName}.get:${prop}${prop in target ? '' : ':undefined'}`);
        }
        return target[prop];
      },
      set(target, prop, value) {
        if (typeof prop === 'string') touched.push(`element.${tagName}.set:${prop}`);
        target[prop] = value;
        return true;
      },
    });
  },
  getElementsByTagName(tag) {
    touched.push(`document.getElementsByTagName:${tag}`);
    return String(tag).toLowerCase() === 'body' ? [bodyObj] : { length: 0 };
  },
  getElementById(id) {
    touched.push(`document.getElementById:${String(id || '')}`);
    return null;
  },
  createEvent(type) {
    touched.push(`document.createEvent:${type}`);
    // Current Chrome 151 on this Windows page throws for legacy TouchEvent;
    // the SDK uses that exception as the feature-detection result.
    if (String(type) === 'TouchEvent') {
      const err = new Error("The provided event type ('TouchEvent') is invalid.");
      err.name = 'NotSupportedError';
      throw err;
    }
    return {
      type: String(type || ''),
      initEvent(name) { touched.push(`event.initEvent:${name}`); this.type = String(name || ''); },
      preventDefault() {}, stopPropagation() {},
    };
  },
  addEventListener() {},
  querySelector() { return null; },
};
const documentAll = {
  length: 337,
  item() { return null; },
  namedItem() { return null; },
};
Object.defineProperty(documentAll, Symbol.toStringTag, {
  value: 'HTMLAllCollection', configurable: true,
});
documentObj.all = documentAll;
let parsedLocation;
try { parsedLocation = new URL(requestedHref); } catch (_) {
  parsedLocation = new URL(`https://${requestedHost}/`);
}
const locationObj = {
  href: requestedHref,
  origin: parsedLocation.origin,
  protocol: parsedLocation.protocol,
  host: parsedLocation.host,
  hostname: parsedLocation.hostname,
  pathname: parsedLocation.pathname,
  search: parsedLocation.search,
  hash: parsedLocation.hash,
};

const sandbox = {};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.navigator = watch(navigator, 'navigator');
sandbox.screen = watch(screenObj, 'screen');
sandbox.document = watch(documentObj, 'document');
sandbox.location = watch(locationObj, 'location');
sandbox.localStorage = {
  getItem(k) { touched.push(`localStorage.getItem:${k}`); return store[k] ?? null; },
  setItem(k, v) { touched.push(`localStorage.setItem:${k}`); store[k] = String(v); },
  removeItem(k) { delete store[k]; },
};
sandbox.sessionStorage = sandbox.localStorage;
sandbox.console = { log() {}, warn() {}, error() {}, debug() {}, info() {} };
sandbox.performance = {
  now: () => 1234.5,
  timeOrigin: 1786867000000,
  getEntriesByType(type) {
    if (String(type) !== 'navigation') return [];
    return [{
      name: requestedHref, entryType: 'navigation', startTime: 0,
      duration: 292.39999997615814, initiatorType: 'navigation',
      nextHopProtocol: 'http/1.1',
    }];
  },
};
sandbox.chrome = { runtime: {} };
sandbox.history = {
  length: Number(process.env.KS_HISTORY_LENGTH || 5),
  state: { key: '208.700' },
  scrollRestoration: 'manual',
  back() {}, forward() {}, go() {}, pushState() {}, replaceState() {},
};
try { Object.defineProperty(sandbox.history, Symbol.toStringTag, {
  value: 'History', configurable: true,
}); } catch (_) {}
sandbox.matchMedia = (query) => {
  const media = String(query || '');
  const result = {
    media,
    matches: media !== '(-webkit-min-device-pixel-ratio: 2), (min-device-pixel-ratio: 2), (min-resolution: 192dpi)',
    onchange: null,
    addListener() {}, removeListener() {},
  };
  try { Object.defineProperty(result, Symbol.toStringTag, {
    value: 'MediaQueryList', configurable: true,
  }); } catch (_) {}
  return result;
};
function Element() {}
function Window() {}
function MouseEvent() {}
function XPathResult() {}
function RTCPeerConnection() {}
for (const [ctor, tag] of [
  [Element, 'Element'], [Window, 'Window'], [MouseEvent, 'MouseEvent'],
  [XPathResult, 'XPathResult'], [RTCPeerConnection, 'RTCPeerConnection'],
]) {
  try { Object.defineProperty(ctor.prototype, Symbol.toStringTag, {
    value: tag, configurable: true,
  }); } catch (_) {}
}
function Image(width, height) {
  const image = documentObj.createElement('img');
  if (width !== undefined) image.width = Number(width);
  if (height !== undefined) image.height = Number(height);
  return image;
}
const indexedDB = {};
Object.defineProperty(indexedDB, Symbol.toStringTag, {
  value: 'IDBFactory', configurable: true,
});
const external = {};
Object.defineProperty(external, Symbol.toStringTag, {
  value: 'External', configurable: true,
});
sandbox.Element = Element;
sandbox.Image = Image;
sandbox.MouseEvent = MouseEvent;
sandbox.Navigator = Navigator;
sandbox.Screen = Screen;
sandbox.Window = Window;
sandbox.XPathResult = XPathResult;
sandbox.webkitRTCPeerConnection = RTCPeerConnection;
sandbox.indexedDB = indexedDB;
sandbox.external = external;
sandbox.top = sandbox;
sandbox.WebGLRenderingContext = WebGLRenderingContext;
sandbox.devicePixelRatio = 1;
sandbox.innerWidth = 1920;
sandbox.innerHeight = 947;
sandbox.outerWidth = 1920;
sandbox.outerHeight = 1032;
sandbox.screenX = 0;
sandbox.screenY = 0;
sandbox.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 0; };
sandbox.setInterval = () => 0;
sandbox.clearTimeout = () => {};
sandbox.clearInterval = () => {};
sandbox.addEventListener = () => {};
sandbox.atob = (s) => Buffer.from(s, 'base64').toString('binary');
sandbox.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
sandbox.__kwfCaught = (err) => {
  caughtErrors.push({
    name: String(err && err.name || ''),
    message: String(err && err.message || err || ''),
    stack: String(err && err.stack || '').split('\n').slice(0, 4).join('\n'),
    recentTouches: touched.slice(-18),
    recentVmSteps: recentVmSteps.slice(-12),
  });
};
sandbox.__kwfStep = (pc, instruction, stack) => {
  const unwrap = (wrapped) => {
    if (!wrapped || typeof wrapped !== 'object') return wrapped;
    try {
      return wrapped._sabo_85623
        ? wrapped._sabo_83517[wrapped._sabo_8226a]
        : wrapped._sabo_8961;
    } catch (_) { return '[unreadable]'; }
  };
  const preview = (value) => {
    if (value === undefined) return { type: 'undefined' };
    if (value === null) return { type: 'null' };
    const type = typeof value;
    if (type === 'string') return { type, length: value.length, value: value.slice(0, 80) };
    if (type === 'number' || type === 'boolean') return { type, value };
    if (type === 'function') return { type, name: String(value.name || '') };
    let tag = '';
    let keys = [];
    try { tag = Object.prototype.toString.call(value); } catch (_) {}
    try { keys = Object.keys(value).slice(0, 12); } catch (_) {}
    return { type, tag, keys };
  };
  recentVmSteps.push({
    pc: Number(pc),
    instruction: Array.isArray(instruction) ? instruction.slice() : instruction,
    stackDepth: Array.isArray(stack) ? stack.length : -1,
    stackTop: Array.isArray(stack) ? stack.slice(-5).map((item) => preview(unwrap(item))) : [],
  });
  if (recentVmSteps.length > 16) recentVmSteps.shift();
};
sandbox.__kwfBadRef = (key) => {
  badReferences.push({ key: String(key), recentVmSteps: recentVmSteps.slice(-12), recentTouches: touched.slice(-18) });
};
sandbox.__kwfRefBase = (base, key) => {
  let value;
  try { value = base == null ? undefined : base[key]; } catch (_) { return base; }
  let tag = '';
  try { tag = Object.prototype.toString.call(base); } catch (_) {}
  propertyReads.push({
    key: String(key),
    baseType: base === null ? 'null' : typeof base,
    baseTag: tag,
    valueType: value === null ? 'null' : typeof value,
    valueLength: typeof value === 'string' ? value.length : undefined,
    equalsDid: value === process.env.KS_DID,
  });
  if (propertyReads.length > 80) propertyReads.shift();
  if (value === undefined) {
    let keys = [];
    try { keys = Object.keys(base).slice(0, 20); } catch (_) {}
    missingProperties.push({
      key: String(key), baseType: base === null ? 'null' : typeof base,
      baseTag: tag, baseKeys: keys, recentTouches: touched.slice(-12),
    });
    if (missingProperties.length > 500) missingProperties.shift();
  }
  return base;
};
sandbox.__kwfAssigned = (base, key, value) => {
  const name = String(key);
  if (/^k(?:1|2|34|60)$/.test(name)) {
    propertyAssignments.push({
      key: name,
      valueType: value === null ? 'null' : typeof value,
      valueLength: typeof value === 'string' ? value.length : undefined,
      equalsDid: name === 'k1' ? value === process.env.KS_DID : undefined,
      recentTouches: touched.slice(-20),
      recentVmSteps: recentVmSteps.slice(-12),
      recentPropertyReads: propertyReads.slice(-30),
    });
  }
  return value;
};

const ctx = vm.createContext(sandbox);
if (process.env.KS_KWF_TRACE_JSON === '1') {
  sandbox.__kwfJsonCapture = (value) => {
    let serialized = '';
    let keys = [];
    let fieldLengths = {};
    try {
      serialized = JSON.stringify(value);
      if (value && typeof value === 'object') {
        keys = Object.keys(value);
        for (const key of keys) {
          try { fieldLengths[key] = JSON.stringify(value[key]).length; } catch (_) {}
        }
      }
    } catch (_) {}
    jsonCalls.push({
      length: serialized.length, keys, fieldLengths,
      identityChecks: value && typeof value === 'object' ? {
        k1EqualsDid: value.k1 === process.env.KS_DID,
        k2EqualsCpProduct: value.k2 === 'onvideo-cp',
        k1Type: typeof value.k1,
        k2Type: typeof value.k2,
      } : {},
    });
  };
  vm.runInContext(`
    (() => {
      const rawStringify = JSON.stringify;
      JSON.stringify = function(value, ...args) {
        try { __kwfJsonCapture(value); } catch (_) {}
        return rawStringify.call(JSON, value, ...args);
      };
    })();
  `, ctx);
}
if (process.env.KS_KWF_TRACE_COOKIE === '1') {
  sandbox.__kwfCookieRegexCapture = (source, input, result) => {
    cookieRegexCalls.push({
      source: String(source),
      inputLength: String(input || '').length,
      matched: !!result,
      groupLengths: result ? Array.from(result).map((item) => String(item == null ? '' : item).length) : [],
    });
  };
  vm.runInContext(`
    (() => {
      const rawExec = RegExp.prototype.exec;
      RegExp.prototype.exec = function(input) {
        const result = rawExec.call(this, input);
        try {
          if (String(input).includes('did=')) __kwfCookieRegexCapture(this.source, input, result);
        } catch (_) {}
        return result;
      };
    })();
  `, ctx);
}
let src = fs.readFileSync(SCRIPT, 'utf8');
if (process.env.KS_KWF_TRACE_ERRORS === '1') {
  const catchNeedle = '} catch (e) {';
  const catchReplacement = '} catch (e) { try { __kwfCaught(e); } catch (_) {} ';
  if (src.includes(catchNeedle)) src = src.replace(catchNeedle, catchReplacement);
  const stepNeedle = 'var _sabo_2618c = _sabo_9d187[x[_sabo_29074]];_sabo_9e222 = _sabo_2618c';
  const stepReplacement = 'var _sabo_2618c = _sabo_9d187[x[_sabo_29074]];try { __kwfStep(_sabo_9e222, x, _sabo_16c96); } catch (_) {} _sabo_9e222 = _sabo_2618c';
  if (src.includes(stepNeedle)) src = src.replace(stepNeedle, stepReplacement);
  const topStepNeedle = 'var _sabo_2618c = _sabo_9d187[_sabo_c4071[_sabo_29074]];_sabo_e4807 = _sabo_2618c';
  const topStepReplacement = 'var _sabo_2618c = _sabo_9d187[_sabo_c4071[_sabo_29074]];try { __kwfStep(_sabo_e4807, _sabo_c4071, _sabo_16c96); } catch (_) {} _sabo_e4807 = _sabo_2618c';
  if (src.includes(topStepNeedle)) src = src.replace(topStepNeedle, topStepReplacement);
  const unwrapNeedle = '_sabo_aa8a7 = function (_sabo_7d331) {return _sabo_7d331._sabo_85623 ?';
  const unwrapReplacement = '_sabo_aa8a7 = function (_sabo_7d331) {if (_sabo_7d331 && _sabo_7d331._sabo_85623 && _sabo_7d331._sabo_83517 == null) { try { __kwfBadRef(_sabo_7d331._sabo_8226a); } catch (_) {} } return _sabo_7d331._sabo_85623 ?';
  if (src.includes(unwrapNeedle)) src = src.replace(unwrapNeedle, unwrapReplacement);
  const refNeedle = '_sabo_e0404(0, _sabo_aa8a7(_sabo_40893(p0, p1)), _sabo_eb693(p2, p3), 1);return ++p4;';
  const refReplacement = '_sabo_e0404(0, __kwfRefBase(_sabo_aa8a7(_sabo_40893(p0, p1)), _sabo_eb693(p2, p3)), _sabo_eb693(p2, p3), 1);return ++p4;';
  if (src.includes(refNeedle)) src = src.replace(refNeedle, refReplacement);
  const setNeedle = '_sabo_eb003._sabo_83517[_sabo_eb003._sabo_8226a] = _sabo_0dbe7';
  const setReplacement = '_sabo_eb003._sabo_83517[_sabo_eb003._sabo_8226a] = __kwfAssigned(_sabo_eb003._sabo_83517, _sabo_eb003._sabo_8226a, _sabo_0dbe7)';
  src = src.split(setNeedle).join(setReplacement);
}
try {
  vm.runInContext(src, ctx, { timeout: 20000 });
} catch (err) {
  console.error('脚本执行出错:', err && err.message);
  console.error((err && err.stack || '').split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

const quiet = process.argv[2] === 'quiet';
const jsonMode = process.argv[2] === '--json';
const kwpsec = sandbox.kwpsec;
if (!kwpsec) {
  console.error('脚本跑完了但没挂出 window.kwpsec；已访问的属性:');
  console.error([...new Set(touched)].slice(0, 60).join('\n'));
  process.exit(2);
}

let out;
try {
  const reportMode = process.env.KS_KWF_REPORT_MODE;
  out = reportMode === undefined ? kwpsec.getData() : kwpsec.getData(Number(reportMode));
} catch (err) {
  console.error('getData() 出错:', err && err.message);
  process.exit(3);
}

if (jsonMode) {
  console.log(JSON.stringify({
    value: out, kwfv1: store.kwfv1, kwfcv1: store.kwfcv1,
    caughtErrors: process.env.KS_KWF_TRACE_ERRORS === '1' ? caughtErrors : undefined,
    badReferences: process.env.KS_KWF_TRACE_ERRORS === '1' ? badReferences : undefined,
    missingProperties: process.env.KS_KWF_TRACE_ERRORS === '1' ? missingProperties : undefined,
    jsonCalls: process.env.KS_KWF_TRACE_JSON === '1' ? jsonCalls : undefined,
    cookieRegexCalls: process.env.KS_KWF_TRACE_COOKIE === '1' ? cookieRegexCalls : undefined,
    cookieWrites: process.env.KS_KWF_TRACE_COOKIE === '1' ? cookieWrites : undefined,
    propertyAssignments: process.env.KS_KWF_TRACE_ERRORS === '1' ? propertyAssignments : undefined,
  }));
} else if (quiet) {
  console.log(out);
} else {
  console.log('=== window.kwpsec 的形态 ===');
  console.log('  键:', Object.keys(kwpsec).join(', ') || '(无自有键)');
  console.log('  方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(kwpsec) || {})
    .join(', ') || '(直接挂在对象上)');
  console.log('\n=== getData() 输出 ===');
  console.log(`  长度 ${String(out).length}`);
  console.log(`  值   ${out}`);
  console.log(`  字符集 ${[...new Set(String(out))].sort().join('')}`);
  console.log('\n=== 写进 localStorage 的东西 ===');
  console.log('  ' + JSON.stringify(store, null, 2).replace(/\n/g, '\n  '));
  console.log('\n=== 访问过的环境属性（去重）===');
  for (const k of [...new Set(touched)]) console.log('  ' + k);
  console.log('\n=== 连续两次调用是否相同（看有没有随机/时间成分）===');
  const a = kwpsec.getData();
  const b = kwpsec.getData();
  console.log(`  两次等长: ${a.length === b.length}   逐字符相同: ${a === b}`);
}
