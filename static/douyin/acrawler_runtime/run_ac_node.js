const fs = require('fs');
const vm = require('vm');

const nativeSourceMap = new WeakMap();
const originalFunctionToString = Function.prototype.toString;
const rawObjectToString = Object.prototype.toString;
const functionTrace = [];
Function.prototype.toString = function() {
  const mapped = nativeSourceMap.get(this);
  if (process.env.AC_TRACE && functionTrace.length < 100) {
    functionTrace.push({name:this && this.name, len:this && this.length, mapped:!!mapped, src:(mapped || originalFunctionToString.call(this)).slice(0,120)});
  }
  return mapped || originalFunctionToString.call(this);
};

const cookieStore = {
  // Production callers pass the complete Cookie header through AC_COOKIE_ONLY.
  // Keep standalone defaults deliberately empty; never ship captured session
  // material in the runtime bundle.
  __ac_nonce: process.env.AC_NONCE || '00000000000000000000',
  UIFID_TEMP: process.env.AC_UIFID_TEMP || '',
  bit_env: process.env.AC_BIT_ENV || '',
};
if (String(process.env.AC_VARIANT || '').split(',').includes('cookie-extra')) cookieStore.foo = 'bar';
if (String(process.env.AC_VARIANT || '').split(',').includes('cookie-ui-bit-nonce')) {
  const vals = {UIFID_TEMP: cookieStore.UIFID_TEMP, bit_env: cookieStore.bit_env,
    __ac_nonce: cookieStore.__ac_nonce};
  delete cookieStore.__ac_nonce; delete cookieStore.UIFID_TEMP; delete cookieStore.bit_env;
  Object.assign(cookieStore, vals);
}
if (process.env.AC_COOKIE_EXTRA) {
  for (const part of String(process.env.AC_COOKIE_EXTRA).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) cookieStore[part.slice(0, i)] = part.slice(i + 1);
  }
}
// Preserve an exact browser cookie serialization when supplied. This avoids
// normalizing flag-like entries or changing the original cookie order.
const rawCookieOverride = process.env.AC_COOKIE_ONLY ? String(process.env.AC_COOKIE_ONLY) : null;
const signNonce = process.env.AC_SIGN_NONCE || cookieStore.__ac_nonce || '';
const storage = new Map();
const sessionStorage = {
  getItem(k){ return storage.has('s:'+k) ? storage.get('s:'+k) : null; },
  setItem(k,v){ storage.set('s:'+k, String(v)); },
  removeItem(k){ storage.delete('s:'+k); },
};
const localStorage = {
  getItem(k){ return storage.has('l:'+k) ? storage.get('l:'+k) : null; },
  setItem(k,v){ storage.set('l:'+k, String(v)); },
  removeItem(k){ storage.delete('l:'+k); },
};
const FONT_BASE_WIDTHS = {monospace:468, 'sans-serif':727, serif:773};
const FONT_INSTALLED_WIDTHS = {
  'Trebuchet MS': 661,
  'Wingdings': 850,
  'Sylfaen': 653,
  'Segoe UI': 672,
  'Constantia': 685,
};
function makeSpan() {
  const style = {fontSize:'', fontFamily:'', position:'', left:''};
  const span = {
    style,
    innerHTML:'',
    get offsetWidth() {
      const family = String(style.fontFamily || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      if (Object.prototype.hasOwnProperty.call(FONT_INSTALLED_WIDTHS, family)) return FONT_INSTALLED_WIDTHS[family];
      if (Object.prototype.hasOwnProperty.call(FONT_BASE_WIDTHS, family)) return FONT_BASE_WIDTHS[family];
      const base = String(style.fontFamily || '').split(',').slice(-1)[0].trim().replace(/^['"]|['"]$/g, '');
      return FONT_BASE_WIDTHS[base] || 0;
    },
    get offsetHeight() { return 83; },
    remove() {},
  };
  return span;
}
const document = {
  referrer: process.env.AC_REFERRER || '',
  documentMode: undefined,
  characterSet: 'UTF-8',
  compatMode: 'CSS1Compat',
  cookie: '',
  body: {appendChild(){}, removeChild(){}},
  head: {appendChild(){}, removeChild(){}},
  // Chrome page 11 evidence: document.images.length === 81.
  images: Array.from({length:81}, (_, i) => ({__index:i})),
  getElementsByTagName(tag){
    if (String(tag).toLowerCase() === 'body') return [this.body];
    if (String(tag).toLowerCase() === 'head') return [this.head];
    return [];
  },
  createElement(tag){
    if (tag === 'canvas') return {
      width: 300, height: 150,
      getContext(type){
        if (type === 'webgl' || type === 'experimental-webgl') return makeWebGLContext();
        if (type === '2d') return {
          font:'', shadowBlur:0, shadowOffsetX:0, shadowColor:'', showOffsetX:0, showColor:'', fillStyle:'',
          fillText(_text, _x, _y){}, arc(_x, _y, _radius, _startAngle, _endAngle){}, stroke(){},
          // Chrome probe captured the deterministic prefix and total length.
          toDataURL: makeNativeFunction('toDataURL', 0, () => CANVAS_DATA_URL),
        };
        return null;
      },
      toDataURL: makeNativeFunction('toDataURL', 0, () => CANVAS_DATA_URL),
    };
    if (tag === 'span') return makeSpan();
    if (tag === 'script') return {src:'', async:false};
    return {style:{}, appendChild(){}, removeChild(){}};
  },
  createEvent(type){
    if (String(type) === 'TouchEvent') {
      const err = new Error("Failed to execute 'createEvent' on 'Document': The provided event type ('TouchEvent') is invalid.");
      err.name = 'NotSupportedError';
      throw err;
    }
    return {initEvent(){}};
  },
};

// Values captured from the real Chrome WebGL context (page 12 canvas probe).
const WEBGL_VENDOR = 'Google Inc. (NVIDIA)';
const WEBGL_RENDERER = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const WEBGL_VERSION = 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';
const WEBGL_SHADING_LANGUAGE_VERSION = 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)';
const WEBGL_EXTENSIONS = [
  'ANGLE_instanced_arrays','EXT_blend_minmax','EXT_clip_control','EXT_color_buffer_half_float',
  'EXT_depth_clamp','EXT_disjoint_timer_query','EXT_float_blend','EXT_frag_depth',
  'EXT_polygon_offset_clamp','EXT_shader_texture_lod','EXT_texture_compression_bptc',
  'EXT_texture_compression_rgtc','EXT_texture_filter_anisotropic','EXT_texture_mirror_clamp_to_edge',
  'EXT_sRGB','KHR_parallel_shader_compile','OES_element_index_uint','OES_fbo_render_mipmap',
  'OES_standard_derivatives','OES_texture_float','OES_texture_float_linear','OES_texture_half_float',
  'OES_texture_half_float_linear','OES_vertex_array_object','WEBGL_blend_func_extended',
  'WEBGL_color_buffer_float','WEBGL_compressed_texture_s3tc','WEBGL_compressed_texture_s3tc_srgb',
  'WEBGL_debug_renderer_info','WEBGL_debug_shaders','WEBGL_depth_texture','WEBGL_draw_buffers',
  'WEBGL_lose_context','WEBGL_multi_draw','WEBGL_polygon_mode'
];
const CANVAS_DATA_URL = process.env.AC_CANVAS_DATA_URL || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAQCAYAAABQrvyxAAADbklEQVR4AcSWWahNYRSAjzljN2TMrJRIhkxJZAgZywOhW7yZC3kglBdESZIXD5cyZbhI8iZDmTM9GB+QeeiaMg/fd+7Zu/9sm/t07tH67lr/+v/977X+tf591Mz8/a8errUwCupACQwHfQ3QSkP+tIRiSl9eXh4mYHBzcR4E7eno47AcOucYh54Kq8GkaqELIa3Z9CH8TnCKcSOIJUygCd7ncBd+QAXcgBYwAj5D2xwd0Y5/ogshz9i0A9QImIhtUh/RsYQJGPxXZsbCAOgDY+AV3IJIamPoO4OuLvHUl/Cyk2AVrMxl7JIwAcYZx3UxvuSwEuewPenB6CngSVitb9ieECpjm3k6Exg8AvsTlfX7sjIHAc5/YuycGJRB4kqVeXjdfzd6GPjefugKA0bnyXlGO+AI3IZIDNjEbB0TW8SEF9yg12G3B09pJ3oT+KJBaO+KGDTDjP19CGMaGEhjtGKQ6iQejl3hvM+aiEmnVsAgj7LDYfAkvQ+XsE3qAtrEtF9jXwPXd0cbtJUx8HaMlcX8cf0HdCienMn6HitjT59ggUGGVYiCdX8Pw3Xh3XCfvAo0Z5MhMBPcfCnaVtmMHg1dwFNwQ09tFuOmYPC+YCu24ldqL4bV8ZQw8+QYI1/+GL0F0sTEPKiBTJbCPyVsITN8wMr7cBb8ChnoPeyLYCW8uC+w74D3Yhl6BvjFEMyM1VFbak9MO0kbHLbBU3SaGLT7+bytF94Xn5ORPDg5TKA+Dh/yC9MM+xe8AVunB9pWMCE/q86bqGW21ZjOE/v7QJ6ncmCLeGGtcKXn/3+9X96XrizzvkQYhy1XFibwnUW2SSv0S3gPXlgT0ie2jD5P32rZOn6lWBqL/d2JUVr7dMN/E7wvqCrFdpzPKiuBisVu8YPRK0wgns0ZXtC32P3B6qCyYvD+Zng6V/A8gaR4ysmXusbW64lhBbah09bgjsUqep9so9iJYSX9YFxPJmA7GLQ9ZgK2Sm8eMIGr6HdgP3qpPcVyxqF4QS2zPRz5TdKqqD05q+aa9dECtLJ5xnG4n5DGZ0GY4qwnU2gNEzAh1eycA1sgAWwCmbDHNgFC2Ej+Klcgd4OhRYT9z+PJh1ictlf3mQAYVLRnD9gto6JWIk9TJgIqriSFux4QvLi7kf7Cyv7sPVNQjtv+TCLL38AAAD//0WvmE8AAAAGSURBVAMACkfOk5B1KHEAAAAASUVORK5CYII=';
function makeWebGLContext() {
  const debugInfo = {UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246};
  const constants = {
    VERSION: 0x1F02, SHADING_LANGUAGE_VERSION: 0x8B8C,
    MAX_TEXTURE_SIZE: 0x0D33, MAX_VERTEX_ATTRIBS: 0x8869,
    BLUE_BITS: 0x0D54, GREEN_BITS: 0x0D53, DEPTH_BITS: 0x0D56,
  };
  return {
    getExtension(name){ return name === 'WEBGL_debug_renderer_info' ? debugInfo : (WEBGL_EXTENSIONS.includes(name) ? {} : null); },
    getParameter(p){
      if (p === debugInfo.UNMASKED_VENDOR_WEBGL) return WEBGL_VENDOR;
      if (p === debugInfo.UNMASKED_RENDERER_WEBGL) return WEBGL_RENDERER;
      if (p === constants.VERSION) return WEBGL_VERSION;
      if (p === constants.SHADING_LANGUAGE_VERSION) return WEBGL_SHADING_LANGUAGE_VERSION;
      if (p === constants.MAX_TEXTURE_SIZE) return 16384;
      if (p === constants.MAX_VERTEX_ATTRIBS) return 16;
      if (p === constants.BLUE_BITS || p === constants.GREEN_BITS) return 8;
      if (p === constants.DEPTH_BITS) return 24;
      return 0;
    },
    getSupportedExtensions(){ return WEBGL_EXTENSIONS.slice(); },
    getContextAttributes(){ return {alpha:true,antialias:true,depth:true,desynchronized:false,failIfMajorPerformanceCaveat:false,powerPreference:'default',premultipliedAlpha:true,preserveDrawingBuffer:false,stencil:false,xrCompatible:false}; },
  };
}
Object.defineProperty(document, 'cookie', {
  get(){ return rawCookieOverride !== null ? rawCookieOverride : Object.entries(cookieStore).map(([k,v])=>`${k}=${v}`).join('; '); },
  set(v){ const first=String(v).split(';',1)[0]; const i=first.indexOf('='); if(i<0)return; const k=first.slice(0,i).trim(); const val=first.slice(i+1); if(/expires=Mon, 20 Sep 2010|expires=Thu, 01-Jan-1970/i.test(v)) delete cookieStore[k]; else cookieStore[k]=val; },
});

function defineTag(obj, tag) {
  Object.defineProperty(obj, Symbol.toStringTag, {value: tag, enumerable: false, configurable: true});
  return obj;
}
function makeMimeType(type, suffixes, description) {
  const proto = Object.create(Object.prototype);
  defineTag(proto, 'MimeType');
  Object.defineProperties(proto, {
    type: {value:type, writable:true, enumerable:true, configurable:true},
    suffixes: {value:suffixes, writable:true, enumerable:true, configurable:true},
    description: {value:description, writable:true, enumerable:true, configurable:true},
    enabledPlugin: {value:null, writable:true, enumerable:true, configurable:true},
    constructor: {value:makeNativeFunction('MimeType', 0, () => {}), writable:true, enumerable:true, configurable:true},
  });
  return Object.create(proto);
}
function makeNativeItem(handler) {
  const nativeBase = Array.prototype.find;
  const fn = new Proxy(nativeBase, {apply(_target, _thisArg, args) { return handler(...args); }});
  try { Object.defineProperty(fn, 'name', {value:'item', configurable:true}); } catch (_) {}
  nativeSourceMap.set(fn, 'function item() { [native code] }');
  return fn;
}
function makeNativeFunction(name, length, handler) {
  const nativeBase = Array.prototype.find;
  const fn = new Proxy(nativeBase, {apply(_target, _thisArg, args) { return handler(...args); }});
  try {
    Object.defineProperty(fn, 'name', {value:name, configurable:true});
    Object.defineProperty(fn, 'length', {value:length, configurable:true});
  } catch (_) {}
  nativeSourceMap.set(fn, `function ${name}() { [native code] }`);
  return fn;
}
if (String(process.env.AC_VARIANT || '').split(',').includes('native-doc-fns')) {
  const oldGet = document.getElementsByTagName;
  const oldCreate = document.createElement;
  const oldEvent = document.createEvent;
  document.getElementsByTagName = makeNativeFunction('getElementsByTagName', 1, tag => oldGet.call(document, tag));
  document.createElement = makeNativeFunction('createElement', 1, tag => oldCreate.call(document, tag));
  document.createEvent = makeNativeFunction('createEvent', 1, type => oldEvent.call(document, type));
}
function makeNativeConstructor(name, length) {
  function C() {}
  try {
    Object.defineProperty(C, 'name', {value:name, configurable:true});
    Object.defineProperty(C, 'length', {value:length, configurable:true});
  } catch (_) {}
  nativeSourceMap.set(C, `function ${name}() { [native code] }`);
  return C;
}
function makePlugin(name) {
  const m0 = makeMimeType('application/pdf', 'pdf', 'Portable Document Format');
  const m1 = makeMimeType('text/pdf', 'pdf', 'Portable Document Format');
  const itemFn = String(process.env.AC_VARIANT || '').split(',').includes('plain-item')
    ? function item(i) { return (i === 0 ? m0 : i === 1 ? m1 : null); }
    : makeNativeItem(i => (i === 0 ? m0 : i === 1 ? m1 : null));
  const proto = Object.create(Object.prototype);
  defineTag(proto, 'Plugin');
  Object.defineProperties(proto, {
    name: {value:name, writable:true, enumerable:true, configurable:true},
    filename: {value:'internal-pdf-viewer', writable:true, enumerable:true, configurable:true},
    description: {value:'Portable Document Format', writable:true, enumerable:true, configurable:true},
    length: {value:2, writable:true, enumerable:true, configurable:true},
    item: {value:itemFn, writable:true, enumerable:true, configurable:true},
    namedItem: {value:makeNativeFunction('namedItem', 1, type => type === 'application/pdf' ? m0 : type === 'text/pdf' ? m1 : null), writable:true, enumerable:true, configurable:true},
    constructor: {value:makeNativeFunction('Plugin', 0, () => {}), writable:true, enumerable:true, configurable:true},
    forEach: {value:makeNativeFunction('forEach', 1, () => {}), writable:true, enumerable:true, configurable:true},
  });
  const p = Object.create(proto);
  Object.defineProperties(p, {
    0: {value:m0, writable:true, enumerable:true, configurable:true},
    1: {value:m1, writable:true, enumerable:true, configurable:true},
    'application/pdf': {value:m0, writable:true, enumerable:true, configurable:true},
    'text/pdf': {value:m1, writable:true, enumerable:true, configurable:true},
  });
  m0.__proto__.enabledPlugin = p;
  m1.__proto__.enabledPlugin = p;
  return p;
}
const pluginNames = ['PDF Viewer','Chrome PDF Viewer','Chromium PDF Viewer','Microsoft Edge PDF Viewer','WebKit built-in PDF'];
const pluginItems = pluginNames.map(makePlugin);
const pluginsProto = Object.create(Object.prototype);
defineTag(pluginsProto, 'PluginArray');
Object.defineProperties(pluginsProto, {
  length: {value:pluginItems.length, writable:true, enumerable:true, configurable:true},
  item: {value:makeNativeFunction('item', 1, i => (i >= 0 && i < pluginItems.length) ? pluginItems[i] : null), writable:true, enumerable:true, configurable:true},
  namedItem: {value:makeNativeFunction('namedItem', 1, name => pluginItems.find(p => p.name === name) || null), writable:true, enumerable:true, configurable:true},
  refresh: {value:makeNativeFunction('refresh', 0, () => {}), writable:true, enumerable:true, configurable:true},
  constructor: {value:makeNativeFunction('PluginArray', 0, () => {}), writable:true, enumerable:true, configurable:true},
  forEach: {value:makeNativeFunction('forEach', 1, () => {}), writable:true, enumerable:true, configurable:true},
});
const plugins = Object.create(pluginsProto);
for (let i = 0; i < pluginItems.length; i++) Object.defineProperty(plugins, String(i), {value:pluginItems[i], writable:true, enumerable:true, configurable:true});
for (const p of pluginItems) Object.defineProperty(plugins, p.name, {value:p, writable:true, enumerable:true, configurable:true});
const pluginVariantSet = new Set(String(process.env.AC_VARIANT || '').split(',').map(s => s.trim()));
if (pluginVariantSet.has('plugin-empty')) {
  for (const p of pluginItems) {
    const pp = Object.getPrototypeOf(p);
    pp.name = ''; pp.filename = ''; pp.description = '';
  }
}
if (pluginVariantSet.has('mime-empty')) {
  for (const p of pluginItems) {
    const mp = Object.getPrototypeOf(p[0]);
    mp.type = ''; mp.suffixes = ''; mp.description = '';
  }
}

// Optional exact Chromium shape used for one-cause experiments.  The normal
// runner keeps the smaller hand-written objects; this branch mirrors the
// descriptors observed from a clean Chrome page (native getters, readonly
// indexed entries, non-enumerable named entries and MimeTypeArray).
const exactNativePlugins = pluginVariantSet.has('native-plugins');
const withMimeTypes = pluginVariantSet.has('native-plugins') || pluginVariantSet.has('with-mime') || pluginVariantSet.has('mime-empty');
if (exactNativePlugins) {
  const nativeGetter = (name, value) => {
    const fn = makeNativeFunction(`get ${name}`, 0, () => value);
    return fn;
  };
  for (const p of pluginItems) {
    const pp = Object.getPrototypeOf(p);
    for (const [name, value] of [['name', pp.name], ['filename', pp.filename], ['description', pp.description], ['length', pp.length]]) {
      Object.defineProperty(pp, name, {get: nativeGetter(name, value), enumerable:true, configurable:true});
    }
    Object.defineProperty(pp, 'constructor', {value:makeNativeFunction('Plugin', 0, () => {}), writable:true, enumerable:false, configurable:true});
    Object.defineProperty(pp, 'forEach', {value:makeNativeFunction('forEach', 1, () => {}), writable:true, enumerable:false, configurable:true});
    Object.defineProperty(pp, Symbol.toStringTag, {value:'Plugin', writable:true, enumerable:false, configurable:true});
    Object.defineProperty(pp, Symbol.iterator, {value:makeNativeFunction('values', 0, function*(){yield* [this[0], this[1]]}), writable:true, enumerable:false, configurable:true});
    for (const k of ['0','1']) Object.defineProperty(p, k, {value:p[k], writable:false, enumerable:true, configurable:true});
    for (const k of ['application/pdf','text/pdf']) Object.defineProperty(p, k, {value:p[k], writable:false, enumerable:false, configurable:true});
  }
  Object.defineProperty(pluginsProto, 'length', {get:nativeGetter('length', pluginItems.length), enumerable:true, configurable:true});
  Object.defineProperty(pluginsProto, 'constructor', {value:makeNativeFunction('PluginArray', 0, () => {}), writable:true, enumerable:false, configurable:true});
  Object.defineProperty(pluginsProto, 'forEach', {value:makeNativeFunction('forEach', 1, () => {}), writable:true, enumerable:false, configurable:true});
  Object.defineProperty(pluginsProto, Symbol.toStringTag, {value:'PluginArray', writable:true, enumerable:false, configurable:true});
  Object.defineProperty(pluginsProto, Symbol.iterator, {value:makeNativeFunction('values', 0, function*(){yield* pluginItems}), writable:true, enumerable:false, configurable:true});
}

const mimeItems = pluginItems.slice(0, 2).map((p, i) => {
  const m = p[i];
  if (exactNativePlugins) {
    const mp = Object.getPrototypeOf(m);
    for (const [name, value] of [['type', m.type], ['suffixes', m.suffixes], ['description', m.description], ['enabledPlugin', p]]) {
      Object.defineProperty(mp, name, {get: makeNativeFunction(`get ${name}`, 0, () => value), enumerable:true, configurable:true});
    }
    Object.defineProperty(mp, 'constructor', {value:makeNativeFunction('MimeType', 0, () => {}), writable:true, enumerable:false, configurable:true});
    Object.defineProperty(mp, Symbol.toStringTag, {value:'MimeType', writable:false, enumerable:false, configurable:true});
    for (const k of ['type','suffixes','description','enabledPlugin']) { try { delete m[k]; } catch (_) {} }
  }
  return m;
});
const mimeTypesProto = Object.create(Object.prototype);
defineTag(mimeTypesProto, 'MimeTypeArray');
Object.defineProperties(mimeTypesProto, {
  item: {value:makeNativeFunction('item', 1, i => (i >= 0 && i < mimeItems.length) ? mimeItems[i] : null), writable:true, enumerable:true, configurable:true},
  namedItem: {value:makeNativeFunction('namedItem', 1, name => name === 'application/pdf' ? mimeItems[0] : name === 'text/pdf' ? mimeItems[1] : null), writable:true, enumerable:true, configurable:true},
  constructor: {value:makeNativeFunction('MimeTypeArray', 0, () => {}), writable:true, enumerable:false, configurable:true},
  forEach: {value:makeNativeFunction('forEach', 1, () => {}), writable:true, enumerable:false, configurable:true},
  [Symbol.toStringTag]: {value:'MimeTypeArray', writable:true, enumerable:false, configurable:true},
  [Symbol.iterator]: {value:makeNativeFunction('values', 0, function*(){yield* mimeItems}), writable:true, enumerable:false, configurable:true},
});
if (exactNativePlugins) Object.defineProperty(mimeTypesProto, 'length', {get:makeNativeFunction('get length', 0, () => mimeItems.length), enumerable:true, configurable:true});
else Object.defineProperty(mimeTypesProto, 'length', {value:mimeItems.length, writable:true, enumerable:true, configurable:true});
const mimeTypes = Object.create(mimeTypesProto);
for (let i=0; i<mimeItems.length;i++) Object.defineProperty(mimeTypes, String(i), {value:mimeItems[i], writable:false, enumerable:true, configurable:true});
for (const [k,m] of [['application/pdf',mimeItems[0]],['text/pdf',mimeItems[1]]]) Object.defineProperty(mimeTypes,k,{value:m,writable:false,enumerable:false,configurable:true});

const navigatorValues = {
  userAgent: process.env.AC_UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  appVersion: process.env.AC_APP_VERSION || ('5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'),
  productSub: '20030107', cookieEnabled: true, onLine: true,
  platform: 'Win32', appCodeName:'Mozilla', appName:'Netscape', product:'Gecko',
  vendor:'Google Inc.', vendorSub:'', doNotTrack:null, language:'zh-CN', languages:['zh-CN','zh'],
  hardwareConcurrency:20, deviceMemory:32, maxTouchPoints:10, webdriver:false,
  plugins,
  connection:{rtt:0,downlink:10,effectiveType:'4g'},
  getBattery: async()=>({charging:true,chargingTime:0,dischargingTime:Infinity,level:1}),
  vibrate: function(){return false}, credentials:{}, storage:{},
  requestMediaKeySystemAccess: function(){return Promise.reject(new Error('Not supported'))},
  bluetooth:{},
  vendorSubs:{ink:1787444753999},
};
if (withMimeTypes) navigatorValues.mimeTypes = mimeTypes;
if (String(process.env.AC_VARIANT || '').split(',').includes('ua-data')) navigatorValues.userAgentData = {brands:[{brand:'Chromium',version:'151'},{brand:'Google Chrome',version:'151'},{brand:'Not_A Brand',version:'99'}],mobile:false,platform:'Windows',getHighEntropyValues:async()=>({})};
if (String(process.env.AC_VARIANT || '').split(',').includes('ua-data-empty')) navigatorValues.userAgentData = {};
const navigatorProto = Object.create(Object.prototype);
for (const [key, value] of Object.entries(navigatorValues)) {
  Object.defineProperty(navigatorProto, key, {value, writable:true, configurable:true, enumerable:false});
}
if (String(process.env.AC_VARIANT || '').split(',').includes('nav-constructor')) {
  Object.defineProperty(navigatorProto, 'constructor', {value:function Navigator(){}, writable:true, configurable:true, enumerable:false});
}
let navigator = Object.create(navigatorProto);
// Chrome exposes this misspelled own property in the current profile.
navigator.pemrissions = {microphone:'granted'};
if (String(process.env.AC_VARIANT || '').split(',').includes('no-permissions')) delete navigator.pemrissions;
if (String(process.env.AC_VARIANT || '').split(',').includes('permissions-proto')) {
  const p = Object.getPrototypeOf(navigator);
  const d = Object.getOwnPropertyDescriptor(navigator, 'pemrissions');
  if (d) { Object.defineProperty(p, 'pemrissions', d); delete navigator.pemrissions; }
}
if (String(process.env.AC_VARIANT || '').split(',').includes('permissions-empty')) navigator.pemrissions = {};
if (String(process.env.AC_VARIANT || '').split(',').includes('permissions-null')) navigator.pemrissions = null;
const navTagVariants = new Set(String(process.env.AC_VARIANT || '').split(',').map(s => s.trim()));
if (!navTagVariants.has('no-navtag')) {
  if (navTagVariants.has('navtag-proto')) defineTag(navigatorProto, 'Navigator');
  else defineTag(navigator, 'Navigator');
}
if (navTagVariants.has('nav-constructor-native')) {
  Object.defineProperty(navigatorProto, 'constructor', {value:makeNativeConstructor('Navigator', 0), writable:true, configurable:true, enumerable:false});
}
if (navTagVariants.has('nav-proxy')) {
  const navTarget = navigator;
  navigator = new Proxy(navTarget, {
    get(t, p) { return Reflect.get(t, p, t); },
    has(t, p) { return Reflect.has(t, p); },
    ownKeys(t) { return Reflect.ownKeys(t); },
  });
}
if (navTagVariants.has('nav-tostring-object')) {
  Object.defineProperty(navigatorProto, 'toString', {value: makeNativeFunction('toString', 0, () => '[object Object]'), writable:true, configurable:true, enumerable:false});
}
if (navTagVariants.has('nav-tostring-native')) {
  Object.defineProperty(navigatorProto, 'toString', {value: makeNativeFunction('toString', 0, () => '[object Navigator]'), writable:true, configurable:true, enumerable:false});
}
if (navTagVariants.has('nav-getters')) {
  for (const key of ['userAgent','platform','plugins','webdriver','language','languages','hardwareConcurrency','deviceMemory','maxTouchPoints','vendor','vendorSub','appCodeName','appName','product']) {
    const value = navigatorValues[key];
    Object.defineProperty(navigatorProto, key, {get: () => value, configurable:true, enumerable:true});
  }
}
if (navTagVariants.has('nav-native-getters')) {
  for (const key of ['userAgent','platform','plugins','webdriver','language','languages','hardwareConcurrency','deviceMemory','maxTouchPoints','vendor','vendorSub','appCodeName','appName','product','connection']) {
    const value = navigatorValues[key];
    Object.defineProperty(navigatorProto, key, {get:makeNativeFunction(`get ${key}`,0,()=>value), configurable:true, enumerable:true});
  }
}
if (navTagVariants.has('chrome-nav')) {
  // Clean Chromium navigator: the misspelled `pemrissions` is the only own
  // string key; Navigator tag/constructor are inherited from its prototype.
  try { delete navigator[Symbol.toStringTag]; } catch (_) {}
  const p = Object.getPrototypeOf(navigator);
  defineTag(p, 'Navigator');
  Object.defineProperty(p, 'constructor', {
    value: makeNativeConstructor('Navigator', 0),
    writable: true, configurable: true, enumerable: false,
  });
}
if (String(process.env.AC_VARIANT || '').split(',').includes('emptyplugins')) {
  navigatorProto.plugins = defineTag({length:0, item(){return null}, namedItem(){return null}}, 'PluginArray');
}
const variantSet = new Set(String(process.env.AC_VARIANT || '').split(',').map(s => s.trim()));
if (variantSet.has('ua-empty')) navigatorProto.userAgent = '';
if (variantSet.has('platform-empty')) navigatorProto.platform = '';
if (variantSet.has('webdriver-true')) navigatorProto.webdriver = true;
if (variantSet.has('touch-zero')) navigatorProto.maxTouchPoints = 0;
if (variantSet.has('rtt-50')) navigatorProto.connection = {rtt:50, downlink:10, effectiveType:'4g'};
if (variantSet.has('images-zero')) document.images = [];
const screen = {width:2560,height:1440,availWidth:2560,availHeight:1392,colorDepth:24,pixelDepth:24};
const location = {
  valueOf: makeNativeFunction('valueOf', 0, () => location),
  ancestorOrigins: [],
  href:process.env.AC_HREF || 'https://www.douyin.com/jingxuan', origin:'https://www.douyin.com',
  protocol:'https:', host:'www.douyin.com', hostname:'www.douyin.com', port:'',
  pathname:'/jingxuan', search:'', hash:'', username:'', password:'',
  assign: makeNativeFunction('assign', 1, () => undefined),
  reload: makeNativeFunction('reload', 0, () => undefined),
  replace: makeNativeFunction('replace', 1, () => undefined),
  toString: makeNativeFunction('toString', 0, () => location.href),
};
// Keep URL-derived location fields coherent when the production helper signs
// a request other than the historical /jingxuan fixture.
try {
  const parsedLocation = new URL(location.href);
  location.origin = parsedLocation.origin;
  location.protocol = parsedLocation.protocol;
  location.host = parsedLocation.host;
  location.hostname = parsedLocation.hostname;
  location.port = parsedLocation.port;
  location.pathname = parsedLocation.pathname;
  location.search = parsedLocation.search;
  location.hash = parsedLocation.hash;
  location.username = parsedLocation.username;
  location.password = parsedLocation.password;
} catch (_) {}
const docVariants = new Set(String(process.env.AC_VARIANT || '').split(',').map(s => s.trim()));
if (docVariants.has('doc-methods-proto') || docVariants.has('doc-clean') || docVariants.has('doc-empty')) {
  const proto = Object.create(Object.prototype);
  for (const key of ['getElementsByTagName','createElement','createEvent']) {
    const d = Object.getOwnPropertyDescriptor(document, key);
    if (d) { Object.defineProperty(proto, key, d); delete document[key]; }
  }
  Object.setPrototypeOf(document, proto);
}
if (docVariants.has('doc-values-proto') || docVariants.has('doc-clean') || docVariants.has('doc-empty')) {
  const proto = Object.getPrototypeOf(document);
  for (const key of ['referrer','documentMode','characterSet','compatMode','body','head','images']) {
    const d = Object.getOwnPropertyDescriptor(document, key);
    if (d) { Object.defineProperty(proto, key, d); delete document[key]; }
  }
}
if (docVariants.has('doc-location') || docVariants.has('doc-clean')) {
  Object.defineProperty(document, 'location', {value:location, enumerable:true, configurable:false, writable:false});
}
if (docVariants.has('doc-empty')) {
  try { delete document.cookie; } catch (_) {}
}
if (docVariants.has('real-shape')) {
  // Chromium Document exposes most DOM values through its prototype. Keep only
  // the own keys observed in the clean browser probe before acrawler runs.
  const proto = Object.create(Object.prototype);
  for (const key of ['referrer','documentMode','characterSet','compatMode','body','head','images']) {
    const d = Object.getOwnPropertyDescriptor(document, key);
    if (d) { Object.defineProperty(proto, key, d); delete document[key]; }
  }
  defineTag(proto, 'HTMLDocument');
  Object.setPrototypeOf(document, proto);
  Object.defineProperty(document, 'location', {value: location, enumerable:true, configurable:false, writable:false});
  Object.defineProperty(document, 'execCommand', {value: makeNativeFunction('execCommand', 1, () => false), enumerable:true, configurable:true, writable:true});
  if (docVariants.has('react-marker')) Object.defineProperty(document, '_reactListeningt7i2k1m2vkn', {value:true, enumerable:true, configurable:true, writable:true});
}
if (docVariants.has('chrome-doc')) {
  // Exact clean-Chromium Document contract observed on the HTTPS parity page:
  // only `location` is an own key; values and DOM methods live on the
  // HTMLDocument prototype and the toStringTag is inherited.
  const proto = Object.create(Object.prototype);
  for (const key of ['referrer','documentMode','characterSet','compatMode',
                     'cookie','body','head','images','getElementsByTagName',
                     'createElement','createEvent']) {
    const d = Object.getOwnPropertyDescriptor(document, key);
    if (d) { Object.defineProperty(proto, key, d); delete document[key]; }
  }
  defineTag(proto, 'HTMLDocument');
  Object.defineProperty(proto, 'constructor', {
    value: makeNativeConstructor('HTMLDocument', 0),
    writable: true, configurable: true, enumerable: false,
  });
  Object.setPrototypeOf(document, proto);
  if (docVariants.has('doc-location-accessor')) {
    Object.defineProperty(document, 'location', {
      get: makeNativeFunction('get location', 0, () => location),
      set: makeNativeFunction('set location', 1, () => undefined),
      enumerable: true, configurable: false,
    });
  } else {
    Object.defineProperty(document, 'location', {
      value: location, enumerable: true, configurable: false, writable: false,
    });
  }
  if (docVariants.has('chrome-doc-native-proto')) {
    const p = Object.getPrototypeOf(document);
    const vals = {referrer:'', characterSet:'UTF-8', compatMode:'CSS1Compat', body:document.body, head:document.head, images:document.images};
    for (const [key, value] of Object.entries(vals)) Object.defineProperty(p, key, {get:makeNativeFunction(`get ${key}`,0,()=>value), enumerable:true, configurable:true});
    Object.defineProperty(p, 'documentMode', {get:makeNativeFunction('get documentMode',0,()=>undefined), enumerable:true, configurable:true});
    for (const key of ['getElementsByTagName','createElement','createEvent']) {
      const fn = document[key];
      Object.defineProperty(p, key, {value:makeNativeFunction(key,1, (...args)=>fn.apply(document,args)), writable:true, enumerable:true, configurable:true});
    }
  }
}
if (docVariants.has('doc-location-accessor')) {
  // Chromium's own Document.location descriptor is a non-configurable native
  // accessor (not a data property). This shape is probed by acrawler.
  if (!Object.prototype.hasOwnProperty.call(document, 'location')) {
    Object.defineProperty(document, 'location', {
      get: makeNativeFunction('get location', 0, () => location),
      set: makeNativeFunction('set location', 1, () => undefined),
      enumerable: true, configurable: false,
    });
  }
}
if (docVariants.has('doc-constructor-native')) {
  Object.defineProperty(Object.getPrototypeOf(document), 'constructor', {value:makeNativeConstructor('HTMLDocument', 0), writable:true, configurable:true, enumerable:false});
}
if (String(process.env.AC_VARIANT || '').split(',').includes('location-localhost')) {
  location.href = 'http://localhost'; location.protocol = 'http:'; location.host = 'localhost'; location.hostname = 'localhost';
}
const performance = {now:()=>0, timing:{navigationStart:1787443280000}};
if (String(process.env.AC_VARIANT || '').split(',').includes('object-tags')) {
  defineTag(location, 'Location');
  Object.defineProperty(location, Symbol.toPrimitive, {value: makeNativeFunction('toPrimitive', 1, hint => hint === 'string' ? location.href : location.href), configurable:true});
  defineTag(screen, 'Screen');
  defineTag(performance, 'Performance');
  defineTag(sessionStorage, 'Storage');
  defineTag(localStorage, 'Storage');
}
const history = {};
if (!String(process.env.AC_VARIANT || '').split(',').includes('no-histtag')) defineTag(history, 'History');
const window = {
  document, navigator, location, screen, performance, history, sessionStorage, localStorage,
  innerWidth:2560, outerWidth:2560, innerHeight:1215, outerHeight:1392,
  screenX:0, screenY:0, devicePixelRatio:1, isSecureContext:true,
  addEventListener(){}, removeEventListener(){}, postMessage(){},
  setTimeout, clearTimeout, setInterval, clearInterval,
};
if (String(process.env.AC_VARIANT || '').split(',').includes('browser-window-keys-undefined')) {
  try {
    const browserShape = JSON.parse(fs.readFileSync(__dirname + '/browser_window_shape.json', 'utf8'));
    for (const k of browserShape.keys) if (!Object.prototype.hasOwnProperty.call(window, k)) Object.defineProperty(window, k, {value:undefined, writable:true, enumerable:true, configurable:true});
  } catch (_) {}
}
if (String(process.env.AC_VARIANT || '').split(',').includes('window-constructor-native')) {
  Object.defineProperty(window, 'constructor', {value:makeNativeConstructor('Window', 0), writable:true, configurable:true, enumerable:false});
}
if (String(process.env.AC_VARIANT || '').split(',').includes('window-proto-native')) {
  const wp = Object.create(Object.prototype);
  defineTag(wp, 'Window');
  Object.defineProperty(wp, 'constructor', {value:makeNativeConstructor('Window', 0), writable:true, configurable:true, enumerable:false});
  Object.setPrototypeOf(window, wp);
}
const accessTrace = [];
function traceValue(v) {
  if (v === undefined) return {type:'undefined'};
  if (v === null) return {type:'null'};
  const t = typeof v;
  if (t === 'function') return {type:'function', name:v.name, length:v.length, str:(()=>{try{return String(v).slice(0,120)}catch(_){return '<err>'}})()};
  if (t !== 'object') return {type:t, value:v};
  let tag; try { tag = rawObjectToString.call(v); } catch (_) { tag = '<err>'; }
  let keys; try { keys = Reflect.ownKeys(v).map(String).slice(0,30); } catch (_) { keys = ['<err>']; }
  return {type:'object', tag, keys};
}
function traceTop(target, label) {
  if (!process.env.AC_ACCESS_TRACE || !target || (typeof target !== 'object' && typeof target !== 'function')) return target;
  return new Proxy(target, {
    get(t, p, r) {
      if (accessTrace.length < 5000) accessTrace.push({op:'get', label, p:String(p)});
      const value = Reflect.get(t, p, r);
      if (process.env.AC_ACCESS_VALUE_TRACE && accessTrace.length <= 5000) accessTrace[accessTrace.length - 1].value = traceValue(value);
      return value;
    },
    has(t, p) {
      if (accessTrace.length < 5000) accessTrace.push({op:'has', label, p:String(p)});
      const value = Reflect.has(t, p);
      if (process.env.AC_ACCESS_VALUE_TRACE && accessTrace.length <= 5000) accessTrace[accessTrace.length - 1].value = value;
      return value;
    },
    ownKeys(t) {
      if (accessTrace.length < 5000) accessTrace.push({op:'ownKeys', label});
      const value = Reflect.ownKeys(t);
      if (process.env.AC_ACCESS_VALUE_TRACE && accessTrace.length <= 5000) accessTrace[accessTrace.length - 1].value = value.map(String);
      return value;
    },
    getOwnPropertyDescriptor(t, p) {
      if (accessTrace.length < 5000) accessTrace.push({op:'getOwnPropertyDescriptor', label, p:String(p)});
      const value = Reflect.getOwnPropertyDescriptor(t, p);
      if (process.env.AC_ACCESS_VALUE_TRACE && accessTrace.length <= 5000) {
        accessTrace[accessTrace.length - 1].value = value && {configurable:value.configurable, enumerable:value.enumerable, writable:value.writable, hasGet:!!value.get, hasSet:!!value.set, value:traceValue(value.value), get:traceValue(value.get), set:traceValue(value.set)};
      }
      return value;
    },
    getPrototypeOf(t) {
      if (accessTrace.length < 5000) accessTrace.push({op:'getPrototypeOf', label});
      return Reflect.getPrototypeOf(t);
    },
  });
}
const tracedDocument = traceTop(document, 'document');
const tracedNavigator = traceTop(navigator, 'navigator');
const tracedLocation = traceTop(location, 'location');
const tracedHistory = traceTop(history, 'history');
const tracedScreen = traceTop(screen, 'screen');
const tracedPerformance = traceTop(performance, 'performance');
window.document = tracedDocument; window.navigator = tracedNavigator; window.location = tracedLocation;
window.history = tracedHistory; window.screen = tracedScreen; window.performance = tracedPerformance;
const tagVariants = new Set(String(process.env.AC_VARIANT || '').split(',').map(s => s.trim()));
if (!tagVariants.has('no-doctag') && !docVariants.has('chrome-doc')) defineTag(document, 'HTMLDocument');
if (!tagVariants.has('no-wintag')) defineTag(window, 'Window');
if (tagVariants.has('doc-tag-proto')) {
  try {
    delete document[Symbol.toStringTag];
    const p = Object.create(Object.getPrototypeOf(document));
    defineTag(p, 'HTMLDocument');
    Object.setPrototypeOf(document, p);
  } catch (_) {}
}
if (tagVariants.has('tags-proto')) {
  for (const [obj, tag] of [[document,'HTMLDocument'], [window,'Window'], [history,'History']]) {
    try {
      delete obj[Symbol.toStringTag];
      const proto = Object.create(Object.getPrototypeOf(obj));
      defineTag(proto, tag);
      Object.setPrototypeOf(obj, proto);
    } catch (_) {}
  }
}
if (tagVariants.has('doc-own-shape')) {
  // Chrome's Document instance has only four own string properties in the
  // captured target page.  The rest of the small DOM surface is inherited
  // from Document/Node prototypes.  Rebuild that shape so Reflect.ownKeys /
  // getOwnPropertyDescriptor observe the same contract.
  try {
    const proto = Object.create(Object.prototype);
    const moved = ['referrer','documentMode','characterSet','compatMode','body','head','images','getElementsByTagName','createElement','createEvent'];
    for (const key of moved) {
      const d = Object.getOwnPropertyDescriptor(document, key);
      if (d) {
        try { delete document[key]; } catch (_) {}
        Object.defineProperty(proto, key, {value:d.value, writable:true, enumerable:false, configurable:true});
      }
    }
    try { delete document[Symbol.toStringTag]; } catch (_) {}
    defineTag(proto, 'HTMLDocument');
    Object.defineProperty(proto, 'constructor', {value:makeNativeConstructor('HTMLDocument', 0), writable:true, enumerable:false, configurable:true});
    Object.setPrototypeOf(document, proto);
    try { delete document.cookie; } catch (_) {}
    Object.defineProperty(document, 'location', {
      get: makeNativeFunction('get location', 0, () => location),
      set: makeNativeFunction('set location', 1, () => undefined),
      enumerable: true, configurable: false,
    });
    Object.defineProperty(document, 'cookie', {
      get: makeNativeFunction('get cookie', 0, () => Object.entries(cookieStore).map(([k,v]) => `${k}=${v}`).join('; ')),
      set: makeNativeFunction('set cookie', 1, (v) => {
        const first = String(v).split(';', 1)[0]; const i = first.indexOf('='); if (i < 0) return;
        const k = first.slice(0, i).trim(); const val = first.slice(i + 1);
        if (/expires=Mon, 20 Sep 2010|expires=Thu, 01-Jan-1970/i.test(v)) delete cookieStore[k]; else cookieStore[k] = val;
      }),
      enumerable: false, configurable: false,
    });
    Object.defineProperty(document, 'execCommand', {value:makeNativeFunction('execCommand', 3, () => true), writable:true, enumerable:true, configurable:true});
    Object.defineProperty(document, process.env.AC_REACT_KEY || '_reactListeningt7i2k1m2vkn', {value:true, writable:true, enumerable:true, configurable:true});
    if (tagVariants.has('doc-createElement-own')) {
      const fn = proto.createElement;
      Object.defineProperty(document, 'createElement', {value:fn, writable:true, enumerable:true, configurable:true});
    }
  } catch (_) {}
}
window.byted_acrawler = {};
window.window=window; window.self=window; window.top=window; window.parent=window; window.globalThis=window;
const ctx = window;
const fixedNow = Number(process.env.AC_NOW || 0);
if (fixedNow) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args){ super(...(args.length ? args : [fixedNow])); }
    static now(){ return fixedNow; }
  }
  window.Date = FixedDate;
}
let vmMath = Math;
let randomCalls = 0;
if (process.env.AC_RANDOMS) {
  const randomSequence = JSON.parse(process.env.AC_RANDOMS);
  let randomIndex = 0;
  vmMath = Object.create(Math);
  vmMath.random = () => { randomCalls++; return randomIndex < randomSequence.length ? randomSequence[randomIndex++] : 0.5; };
}
const jsonTrace = [];
const methodTrace = [];
const detectTrace = [];
if (process.env.AC_JSON_TRACE) {
  const realStringify = JSON.stringify;
  JSON.stringify = function(value, replacer, space) {
    if (jsonTrace.length < 500) {
      let safe;
      try {
        const raw = realStringify(value);
        safe = raw.length > 20000 ? {type: typeof value, len: raw.length, head: raw.slice(0, 1000), tail: raw.slice(-1000)} : JSON.parse(raw);
      } catch (_) {
        safe = {type: typeof value};
      }
      jsonTrace.push(safe);
    }
    return realStringify.call(this, value, replacer, space);
  };
}
Object.assign(ctx, {
  window, document:tracedDocument, navigator:tracedNavigator, location:tracedLocation,
  screen:tracedScreen, performance:tracedPerformance, history:tracedHistory,
  sessionStorage, localStorage, console, setTimeout, clearTimeout, setInterval, clearInterval,
  Object, Function, Reflect, Proxy, Date:window.Date, Math:vmMath, String, Array, Error, TypeError, JSON, Promise,
  RegExp, parseInt, Image:function(){}, PluginArray:function(){}, TouchEvent:function(){}, DOMException:function(){},
  HTMLElement: makeNativeConstructor('HTMLElement', 0),
  indexedDB: {}, history, WebSocket:function(){}, Request:function(){}, Headers:function(){},
  encodeURIComponent, encodeURI, decodeURIComponent, eval,
});
// Chromium's navigator.plugins is a genuine PluginArray instance.  Keeping
// only the [object PluginArray] tag is insufficient: acrawler also evaluates
// `navigator.plugins instanceof PluginArray`; a false result sets its
// phantom-browser detector bit and changes byte 28 (plus the final checksum)
// of the signature.
{
  const PluginArrayCtor = makeNativeConstructor('PluginArray', 0);
  try { PluginArrayCtor.prototype = Object.getPrototypeOf(plugins); } catch (_) {}
  try { Object.defineProperty(Object.getPrototypeOf(plugins), 'constructor', {value:PluginArrayCtor, writable:true, configurable:true, enumerable:false}); } catch (_) {}
  ctx.PluginArray = PluginArrayCtor;
  window.PluginArray = PluginArrayCtor;
}
if (process.env.AC_METHOD_TRACE) {
  const realKeys = Object.keys;
  const realOwnNames = Object.getOwnPropertyNames;
  const realOwnDesc = Object.getOwnPropertyDescriptor;
  const realToString = rawObjectToString;
  const logMethod = (name, args, value) => {
    if (methodTrace.length < 2000) methodTrace.push({name, args:args.map(traceValue), value: name === 'toString' ? value : (Array.isArray(value) ? value.map(String) : traceValue(value))});
  };
  Object.keys = function(o){ let v = realKeys(o); const vset=String(process.env.AC_VARIANT || '').split(','); if (vset.includes('keys-browser-window') || vset.includes('keys-runner-window')) { try { const tag = rawObjectToString.call(o); if (tag === '[object Window]') v = vset.includes('keys-runner-window') ? fs.readFileSync(__dirname + '/runner_window_keys_baseline.txt','utf8').split(/\r?\n/).filter(Boolean) : JSON.parse(fs.readFileSync(__dirname + '/browser_window_shape.json','utf8')).keys.slice(); } catch (_) {} } if (process.env.AC_DETECT_TRACE && v.join(',') === 'directSign,consistent,location,switch,dom,debugger,node,phantom,webdriver,incognito,hook,test') { const row={}; for (const k of v) { try { const x=o[k]; row[k]=(typeof x === 'boolean' || typeof x === 'number' || typeof x === 'string' || x == null) ? x : {type:typeof x, tag:rawObjectToString.call(x)}; } catch (e) { row[k]={error:String(e)}; } } detectTrace.push(row); } logMethod('keys',[o],v); return v; };
  Object.getOwnPropertyNames = function(o){ const v = realOwnNames(o); logMethod('getOwnPropertyNames',[o],v); return v; };
  Object.getOwnPropertyDescriptor = function(o,p){ const v = realOwnDesc(o,p); logMethod('getOwnPropertyDescriptor',[o,p],v); return v; };
  Object.prototype.toString = function(){ const v = realToString.call(this); logMethod('toString',[this],v); return v; };
}
if (!process.env.AC_METHOD_TRACE && String(process.env.AC_VARIANT || '').split(',').some(v => v === 'keys-browser-window' || v === 'keys-runner-window')) {
  const realKeysOnly = Object.keys;
  Object.keys = function(o) {
    let v = realKeysOnly(o);
    try {
      if (rawObjectToString.call(o) === '[object Window]' || v.length > 20) {
        const vset = String(process.env.AC_VARIANT || '').split(',');
        v = vset.includes('keys-runner-window') ? fs.readFileSync(__dirname + '/runner_window_keys_baseline.txt','utf8').split(/\r?\n/).filter(Boolean) : JSON.parse(fs.readFileSync(__dirname + '/browser_window_shape.json','utf8')).keys.slice();
      }
    } catch (_) {}
    return v;
  };
}
if (process.env.AC_KEYS_ONLY_TRACE) {
  const realKeysOnlyTrace = Object.keys;
  globalThis.__keysOnlyTrace = [];
  Object.keys = function(o) {
    const v = realKeysOnlyTrace(o);
    try { globalThis.__keysOnlyTrace.push({len:v.length, tag:rawObjectToString.call(o), head:v.slice(0,5)}); } catch (_) {}
    return v;
  };
}
const globalTrace = [];
if (process.env.AC_GLOBAL_TRACE) {
  const probeGlobals = [
    'process','phantom','callPhantom','_phantom','__nightmare','InstallTrigger','safari',
    'Audio','AudioContext','OfflineAudioContext','MediaRecorder','MediaSource','speechSynthesis',
    'Notification','PointerEvent','MSPointerEvent','TouchEvent','CanvasRenderingContext2D',
    'RTCPeerConnection','mozRTCPeerConnection','webkitRTCPeerConnection','BluetoothUUID',
    'webkitRequestAnimationFrame','Request','Headers','WebSocket','fetch','XMLHttpRequest',
    'CSS','CSSRuleList','CSSStyleSheet','FontFace','SVGElement','OffscreenCanvas','WebGL2RenderingContext',
    'MutationObserver','ResizeObserver','IntersectionObserver','getComputedStyle','indexedDB',
    'chrome','external','toolbar','locationbar','webkitStorageInfo','openDatabase','crypto',
    'structuredClone','BigInt','Intl',
  ];
  for (const name of probeGlobals) {
    try {
      const had = Object.prototype.hasOwnProperty.call(ctx, name);
      const original = had ? ctx[name] : undefined;
      Object.defineProperty(ctx, name, {configurable:true, enumerable:false, get(){ globalTrace.push({name, present:had, type:typeof original}); return original; }});
    } catch (_) {}
  }
}
if (String(process.env.AC_VARIANT || '').split(',').includes('dom-constructors')) {
  ctx.Document = makeNativeConstructor('Document', 0);
  ctx.HTMLDocument = makeNativeConstructor('HTMLDocument', 0);
  ctx.Navigator = makeNativeConstructor('Navigator', 0);
}
if (String(process.env.AC_VARIANT || '').split(',').includes('native-constructor-globals')) {
  for (const name of ['Image','PluginArray','TouchEvent','DOMException','WebSocket','Request','Headers','HTMLElement','Document','HTMLDocument','Navigator']) {
    if (Object.prototype.hasOwnProperty.call(ctx, name)) ctx[name] = makeNativeConstructor(name, 0);
  }
}
const variants = new Set(String(process.env.AC_VARIANT || '').split(',').map(s => s.trim()).filter(Boolean));
if (variants.has('no-bit-env')) delete cookieStore.bit_env;
if (variants.has('no-uifid')) delete cookieStore.UIFID_TEMP;
if (variants.has('no-ac-nonce')) delete cookieStore.__ac_nonce;
if (variants.has('no-touch-global')) delete ctx.TouchEvent;
if (variants.has('globals')) {
  Object.assign(ctx, {
    HTMLElement:function HTMLElement(){}, CanvasRenderingContext2D:function CanvasRenderingContext2D(){},
    PointerEvent:function PointerEvent(){}, Audio:function Audio(){},
    RTCPeerConnection:function RTCPeerConnection(){}, webkitRTCPeerConnection:function webkitRTCPeerConnection(){},
    BluetoothUUID:function BluetoothUUID(){}, webkitRequestAnimationFrame:function webkitRequestAnimationFrame(){},
    chrome: {runtime:{connect(){}}}, external: defineTag({}, 'External'),
    toolbar: defineTag({}, 'BarProp'), locationbar: defineTag({}, 'BarProp'),
  });
}
const globalVariants = {
  'g-HTMLElement': ['HTMLElement', makeNativeConstructor('HTMLElement', 0)],
  'g-CanvasRenderingContext2D': ['CanvasRenderingContext2D', makeNativeConstructor('CanvasRenderingContext2D', 0)],
  'g-PointerEvent': ['PointerEvent', makeNativeConstructor('PointerEvent', 0)],
  'g-Audio': ['Audio', makeNativeConstructor('Audio', 0)],
  'g-RTCPeerConnection': ['RTCPeerConnection', makeNativeConstructor('RTCPeerConnection', 0)],
  'g-webkitRTCPeerConnection': ['webkitRTCPeerConnection', makeNativeConstructor('webkitRTCPeerConnection', 0)],
  'g-BluetoothUUID': ['BluetoothUUID', makeNativeConstructor('BluetoothUUID', 0)],
  'g-webkitRequestAnimationFrame': ['webkitRequestAnimationFrame', makeNativeConstructor('webkitRequestAnimationFrame', 0)],
  'g-chrome': ['chrome', {runtime:{connect(){}}}],
  'g-external': ['external', defineTag({}, 'External')],
  'g-toolbar': ['toolbar', defineTag({}, 'BarProp')],
  'g-locationbar': ['locationbar', defineTag({}, 'BarProp')],
  'g-InstallTrigger': ['InstallTrigger', {}],
  'g-safari': ['safari', {}],
  'g-phantom': ['phantom', {}],
  'g-callPhantom': ['callPhantom', function(){}],
  'g-domAutomation': ['domAutomation', {}],
  'g-domAutomationController': ['domAutomationController', {}],
  'g-webdriver': ['webdriver', true],
  'g-process': ['process', {}],
  'g-define': ['define', function(){}],
  'g-module': ['module', {}],
  'g-exports': ['exports', {}],
  'g-require': ['require', function(){}],
};
for (const [flag, pair] of Object.entries(globalVariants)) if (variants.has(flag)) ctx[pair[0]] = pair[1];
if (variants.has('chrome-empty')) ctx.chrome = {};
if (variants.has('chrome-runtime-empty')) ctx.chrome = {runtime:{}};
if (variants.has('chrome-runtime-connect')) ctx.chrome = {runtime:{connect(){}}};
if (variants.has('chrome-rich')) ctx.chrome = {runtime:{connect(){},sendMessage(){}},loadTimes(){},csi(){},app:{isInstalled:false}};
if (variants.has('chrome-real')) ctx.chrome = {loadTimes:makeNativeFunction('loadTimes', 0, () => ({})), csi:makeNativeFunction('csi', 0, () => ({})), app:{}};
if (variants.has('browser-global-shape')) {
  const ctorNames = ['Audio','AudioContext','OfflineAudioContext','MediaRecorder','MediaSource','Notification','PointerEvent','TouchEvent','CanvasRenderingContext2D','RTCPeerConnection','webkitRTCPeerConnection','BluetoothUUID','webkitRequestAnimationFrame','Request','Headers','WebSocket','fetch','XMLHttpRequest','CSSRuleList','CSSStyleSheet','FontFace','SVGElement','OffscreenCanvas','WebGL2RenderingContext','MutationObserver','ResizeObserver','IntersectionObserver','getComputedStyle','structuredClone','BigInt'];
  for (const name of ctorNames) if (!(name in ctx)) ctx[name] = makeNativeConstructor(name, 0);
  ctx.speechSynthesis = defineTag({}, 'SpeechSynthesis');
  ctx.CSS = defineTag({highlights:{},Hz:1,Q:1,cap:1,ch:1,cm:1,cqb:1,cqh:1,cqi:1,cqmax:1,cqmin:1,cqw:1,deg:1}, 'CSS');
  ctx.indexedDB = defineTag({}, 'IDBFactory');
  ctx.chrome = {loadTimes:makeNativeFunction('loadTimes', 0, () => ({})), csi:makeNativeFunction('csi', 0, () => ({})), app:{}};
  ctx.external = defineTag({}, 'External');
  ctx.toolbar = defineTag({}, 'BarProp');
  ctx.locationbar = defineTag({}, 'BarProp');
  ctx.crypto = defineTag({}, 'Crypto');
  ctx.Intl = defineTag({}, 'Intl');
}
ctx.global = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
if (String(process.env.AC_VARIANT || '').split(',').includes('hide-global')) {
  // A page realm has no Node `global` binding. Remove the compatibility alias
  // only after vm context creation (the ordinary runner installs it for
  // diagnostics), immediately before evaluating the VMP.
  try { delete ctx.global; vm.runInContext('try { delete globalThis.global; } catch (_) {}', ctx, {timeout:5000}); } catch (_) {}
}
let vmKeysTraceRef = null;
if (String(process.env.AC_VARIANT || '').split(',').some(v => v === 'vm-keys-browser-window' || v === 'vm-keys-one' || v === 'vm-keys-trace')) {
  try {
    const keyFile = String(process.env.AC_VARIANT || '').split(',').includes('vm-keys-runner-window') ? 'runner_window_keys_baseline.txt' : 'browser_window_shape.json';
    const browserKeys = keyFile.endsWith('.json') ? JSON.parse(fs.readFileSync(__dirname + '/' + keyFile, 'utf8')).keys : fs.readFileSync(__dirname + '/' + keyFile, 'utf8').split(/\r?\n/).filter(Boolean);
    ctx.__acBrowserKeys = browserKeys;
    const vmKeysTraceOuter = []; vmKeysTraceRef = vmKeysTraceOuter;
    ctx.__vmKeysTraceOuter = vmKeysTraceOuter;
    vm.runInContext(`(() => { const real = Object.keys; const keys = __acBrowserKeys; const trace = __vmKeysTraceOuter; Object.keys = new Proxy(real, { apply(target, thisArg, args) { const v = Reflect.apply(target, thisArg, args); try { trace.push({len:v.length, head:v.slice(0,8), tag:Object.prototype.toString.call(args[0])}); } catch (_) {} return ${String(process.env.AC_VARIANT || '').split(',').includes('vm-keys-one') ? '["X"]' : (String(process.env.AC_VARIANT || '').split(',').includes('vm-keys-trace') ? 'v' : '(v.length > 20 ? keys.slice() : v)')}; } }); })()`, ctx, {timeout:5000});
    ctx.__vmKeysTraceOuterRef = vmKeysTraceOuter;
  } catch (_) {}
}
if (String(process.env.AC_VARIANT || '').split(',').includes('vm-global-window')) {
  // In a real browser, window/globalThis/self/top/parent are the same global
  // object. Node's vm context otherwise exposes a distinct context global.
  vm.runInContext('globalThis.window=globalThis; globalThis.self=globalThis; globalThis.top=globalThis; globalThis.parent=globalThis; globalThis.globalThis=globalThis; globalThis.global=globalThis;', ctx);
}
if (String(process.env.AC_VARIANT || '').split(',').includes('no-global')) delete ctx.global;
if (String(process.env.AC_VARIANT || '').split(',').includes('realm-nav')) {
  ctx.__hostNav = ctx.navigator;
  const realmNav = vm.runInContext(`(() => {
    const host = __hostNav;
    const p = Object.create(Object.prototype);
    for (const k of ['userAgent','platform','webdriver','plugins','hardwareConcurrency','deviceMemory','maxTouchPoints','language','languages','vendor','vendorSub','appCodeName','appName','product']) {
      Object.defineProperty(p, k, {value: host[k], writable:true, configurable:true, enumerable:false});
    }
    Object.defineProperty(p, Symbol.toStringTag, {value:'Navigator', configurable:true});
    const n = Object.create(p); n.pemrissions = {microphone:'granted'}; return n;
  })()`, ctx);
  ctx.navigator = realmNav;
  ctx.window.navigator = realmNav;
  delete ctx.__hostNav;
}
try {
  const vmTrace = [];
  ctx.__acVmTrace = vmTrace;
  if (process.env.AC_CONSTRUCTOR_TRACE) {
    ctx.__acCtorTrace = [];
    ctx.__acTraceCtor = function(value, index) {
      try {
        ctx.__acCtorTrace.push({index, type:typeof value,
          tag: rawObjectToString.call(value),
          name: value && value.name,
          str: String(value).slice(0,120)});
      } catch (_) { ctx.__acCtorTrace.push({index, type:typeof value}); }
      return value;
    };
  }
  // Production bootstrap can pass the exact VMP chunk returned by the page.
  // Keep the historical fixture as the fallback for offline parity tests.
  const acVmFile = process.env.AC_VM_FILE || (__dirname + '/ac_vm.js');
  let acSource = fs.readFileSync(acVmFile,'utf8');
  if (process.env.AC_CONSTRUCTOR_TRACE) {
    // The VMP's constructor opcode is emitted as ``new S[R]``.  Wrap the
    // selected stack value to identify the missing realm constructor without
    // changing normal execution semantics.
    acSource = acSource.replace(/new S\[R\]/g, 'new (__acTraceCtor(S[R], R))');
  }
  // The VMP file invokes _$jsvmprt in the same expression that defines it.
  // Wrap that initial invocation before evaluation so its detector result is
  // observable instead of inferring it from the final signature only.
  if (process.env.AC_VM_TRACE) {
    const marker = '}},(glb=';
    const at = acSource.lastIndexOf(marker);
    if (at >= 0) {
      const injected = `}}; (function(){ const __acOrigVm = window._$jsvmprt; window._$jsvmprt = function(){ let __acOut; try { __acOut = __acOrigVm.apply(this, arguments); } catch (__acErr) { window.__acVmTrace.push({error:String(__acErr)}); throw __acErr; } try { window.__acVmTrace.push({out:JSON.parse(JSON.stringify(__acOut))}); } catch (_) { window.__acVmTrace.push({outType:typeof __acOut}); } return __acOut; }; })(); (glb=`;
      acSource = acSource.slice(0, at) + injected + acSource.slice(at + marker.length);
    }
  }
  vm.runInContext(acSource, ctx, {filename:'ac_vm.js', timeout:5000});
  if (String(process.env.AC_VARIANT || '').split(',').includes('delete-glb-after-load')) {
    // In Chrome the classic-site bundle's `var glb` is scoped away; this local
    // standalone copy otherwise leaves an enumerable window.glb behind.
    try { vm.runInContext('delete globalThis.glb; delete window.glb;', ctx, {timeout:5000}); } catch (_) {}
  }
  if (String(process.env.AC_VARIANT || '').split(',').includes('reorder-window-keys')) {
    try {
      const browserShape = JSON.parse(fs.readFileSync(__dirname + '/browser_window_shape.json', 'utf8'));
      const code = `(function(){globalThis.window=globalThis; globalThis.self=globalThis; globalThis.top=globalThis; globalThis.parent=globalThis; globalThis.globalThis=globalThis; globalThis.global=globalThis; const order=${JSON.stringify(browserShape.keys)}; const keys=Reflect.ownKeys(globalThis).map(String); const desc={}; for(const k of keys){try{desc[k]=Object.getOwnPropertyDescriptor(globalThis,k)}catch(_){}} for(const k of order){if(!Object.prototype.hasOwnProperty.call(desc,k)) desc[k]={value:undefined,writable:true,enumerable:true,configurable:true}} const enumKeys=keys.filter(k=>desc[k]?.enumerable); const all=[...order,...enumKeys.filter(k=>!order.includes(k))]; const keep=new Set('Object Function Array Number parseFloat parseInt Infinity NaN undefined Boolean String Symbol Date Promise RegExp Error AggregateError EvalError RangeError ReferenceError SyntaxError TypeError URIError globalThis JSON Math Intl ArrayBuffer Atomics Uint8Array Int8Array Uint16Array Int16Array Uint32Array Int32Array Float32Array Float64Array Uint8ClampedArray BigUint64Array BigInt64Array DataView Map BigInt Set WeakMap WeakSet Proxy Reflect FinalizationRegistry WeakRef decodeURI decodeURIComponent encodeURI encodeURIComponent escape unescape eval isFinite isNaN console'.split(' ')); for(const k of all){try{if(desc[k]?.enumerable && desc[k]?.configurable && !keep.has(k) && !['window','self','top','parent','globalThis','global'].includes(k)) delete globalThis[k]}catch(_){}} for(const k of all){const d=desc[k]; if(!d || !d.enumerable || keep.has(k)) continue; try{Object.defineProperty(globalThis,k,d)}catch(_){}} })()`;
      vm.runInContext(code, ctx, {timeout:5000});
    } catch (_) {}
  }
  const out = vm.runInContext(`({same:this===window, vm:typeof window._$jsvmprt, keys:Object.keys(window.byted_acrawler||{}), globalKeys:Object.keys(globalThis).filter(k=>/ac|webrt|byte/i.test(k)), vmGlobalSame:(globalThis===window), vmGlobalTag:Object.prototype.toString.call(globalThis), vmWindowKeys:Object.keys(window).slice(0,200), vmGlobalKeys:Object.keys(globalThis).slice(0,200), cookie:document.cookie, sig:(window.byted_acrawler&&window.byted_acrawler.sign)?window.byted_acrawler.sign('', '${signNonce}') : null, sig2:(window.byted_acrawler&&window.byted_acrawler.sign)?window.byted_acrawler.sign('', '${signNonce}') : null})`, ctx, {timeout:5000});
  if (process.env.AC_TRACE) out.functionTrace = functionTrace;
  if (process.env.AC_ACCESS_TRACE) out.accessTrace = accessTrace;
  if (process.env.AC_VM_TRACE) out.vmTrace = vmTrace;
  if (process.env.AC_TRACE) out.randomCalls = randomCalls;
  if (process.env.AC_JSON_TRACE) out.jsonTrace = jsonTrace;
  if (process.env.AC_METHOD_TRACE) out.methodTrace = methodTrace;
  if (process.env.AC_DETECT_TRACE) out.detectTrace = detectTrace;
  if (process.env.AC_GLOBAL_TRACE) out.globalTrace = globalTrace;
  if (process.env.AC_KEYS_ONLY_TRACE) out.keysOnlyTrace = vm.runInContext('globalThis.__keysOnlyTrace || []', ctx, {timeout:5000});
  if (process.env.AC_CONSTRUCTOR_TRACE) out.constructorTrace = ctx.__acCtorTrace || [];
  if (String(process.env.AC_VARIANT || '').split(',').includes('vm-keys-trace')) out.vmKeysTrace = vmKeysTraceRef || [];
  if (process.env.AC_SHAPE_TRACE) out.shapes = {
    windowOwn: Reflect.ownKeys(window).map(String),
    globalThisSameWindow: globalThis === window,
    globalSameWindow: typeof global !== 'undefined' && global === window,
    globalThisTag: Object.prototype.toString.call(globalThis),
    globalTag: typeof global !== 'undefined' ? Object.prototype.toString.call(global) : 'undefined',
    globalThisOwn: Reflect.ownKeys(globalThis).map(String).slice(0,200),
    docOwn: Reflect.ownKeys(document).map(String),
    navOwn: Reflect.ownKeys(navigator).map(String),
    docTag: Object.prototype.toString.call(document),
    navTag: Object.prototype.toString.call(navigator),
    docCtor: document.constructor && String(document.constructor).slice(0,120),
    navCtor: navigator.constructor && String(navigator.constructor).slice(0,120),
  };
  console.log(JSON.stringify(out));
} catch (e) {
  if (process.env.AC_CONSTRUCTOR_TRACE) {
    try { console.error('CONSTRUCTOR_TRACE', JSON.stringify(ctx.__acCtorTrace || [])); } catch (_) {}
  }
  console.error(e && e.stack || e);
  process.exitCode=1;
}
