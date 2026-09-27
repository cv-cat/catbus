/**
 * kws 预言机：在 Node 里跑真实的 kws 脚本，拿到 window.kwscb(code) 交出的 kwscode。
 *
 * 背景（utils/sign/webweapon_boot.py 的 handleSignature）：
 *
 *     window.kwscb = t => { setCookie("kwssectoken", secToken, {expires: 6/1440});
 *                           setCookie("kwscode",     t,        {expires: 6/1440}); };
 *     loadScript(cfg.signUrl);       // kws 脚本跑完回调 kwscb 交出 kwscode
 *
 * 所以 kwscode **不是**服务端下发的，是 kws 脚本本地算的 —— 和 kwfv1 同理。
 * 换票 /s/w/c 每次随机发不同变体（kws-3/11/13/15/16），同一套 Brook 引擎、
 * 不同混淆种子，本预言机对五个变体通用。
 *
 * 用法:
 *   node reverse/tools/kws_oracle.js                        用默认环境跑 kws-13
 *   node reverse/tools/kws_oracle.js <script.js>            指定变体
 *   node reverse/tools/kws_oracle.js <script.js> --json     出 JSON（给 Python 调）
 *   node reverse/tools/kws_oracle.js <script.js> --trace    打印读过的环境属性
 *
 * 环境参数走环境变量，便于 Python 侧注入真实会话值：
 *   KS_DID / KS_PRODUCT / KS_HREF / KS_COOKIE / KS_SECTOKEN
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEAPON_DIR = path.join(__dirname, '..', 'bundles', 'weapon');
const DEFAULT_SCRIPT = 'kws-13-0.0.1-obfuscated.6b74e9640ff18648.js';

// 标签名 -> DOM 接口名。真实浏览器里
// Object.prototype.toString.call(document.createElement("div"))
// 返回 "[object HTMLDivElement]"，脚本用它验元素是不是真的。
const ELEMENT_INTERFACE = {
  div: 'HTMLDivElement',
  a: 'HTMLAnchorElement',
  p: 'HTMLParagraphElement',
  h1: 'HTMLHeadingElement',
  h2: 'HTMLHeadingElement',
  h3: 'HTMLHeadingElement',
  h4: 'HTMLHeadingElement',
  h5: 'HTMLHeadingElement',
  h6: 'HTMLHeadingElement',
  span: 'HTMLSpanElement',
  ul: 'HTMLUListElement',
  ol: 'HTMLOListElement',
  li: 'HTMLLIElement',
  iframe: 'HTMLIFrameElement',
  canvas: 'HTMLCanvasElement',
  script: 'HTMLScriptElement',
  img: 'HTMLImageElement',
  input: 'HTMLInputElement',
  form: 'HTMLFormElement',
  table: 'HTMLTableElement',
  body: 'HTMLBodyElement',
  head: 'HTMLHeadElement',
  style: 'HTMLStyleElement',
  link: 'HTMLLinkElement',
  button: 'HTMLButtonElement',
  select: 'HTMLSelectElement',
  textarea: 'HTMLTextAreaElement',
  video: 'HTMLVideoElement',
  audio: 'HTMLAudioElement',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

/**
 * 造一个够 kws 跑的浏览器环境。
 *
 * 采集面与 kwf 基本重合（同一套 SDK），所以直接沿用 kwf_env 摸出来的那套：
 * navigator 的 language/languages/webdriver/pdfViewerEnabled/onLine/platform/
 * vendor/productSub/appName/doNotTrack/cookieEnabled，加 document.cookie、
 * documentElement 上的 webdriver 标记探测、createElement("iframe") 的
 * contentWindow，以及 location.hostname。
 */
function buildEnv(opts) {
  const o = Object.assign({
    language: 'zh-CN',
    languages: ['zh-CN', 'zh', 'en', 'zh-TW', 'ja'],
    pdfViewerEnabled: true,
    onLine: true,
    webdriver: false,
    cookie: process.env.KS_COOKIE || '',
    hostname: 'www.kuaishou.com',
    href: process.env.KS_HREF || 'https://www.kuaishou.com/new-reco',
    secToken: process.env.KS_SECTOKEN || '',
    scriptUrl: process.env.KS_KWS_SCRIPT_URL || '',
    trace: false,
    // Browser contracts proven against three character-for-character Chrome
    // oracles are enabled by default.  A few switches remain only for
    // reversible negative-control diagnostics.
    elementTypeTag: process.env.KS_KWS_ELEMENT_TAG !== '0',
    nativeToStringPatch: process.env.KS_KWS_NATIVE_TOSTRING !== '0',
    pcTrace: process.env.KS_KWS_TRACE_PC === '1',
    builtinTrace: process.env.KS_KWS_TRACE_BUILTINS === '1',
    propertyTrace: process.env.KS_KWS_TRACE_PROPERTIES === '1',
    functionTrace: process.env.KS_KWS_TRACE_FUNCTIONS === '1',
    navigatorPrototypeChain: process.env.KS_KWS_NAVIGATOR_PROTO !== '0',
    documentPrototypeChain: process.env.KS_KWS_DOCUMENT_PROTO === '1'
      || process.env.KS_KWS_BROWSER_PROTOS === '1',
    documentCookieOnPrototype: process.env.KS_KWS_COOKIE_PROTO === '1',
    documentCreateElementOnPrototype: process.env.KS_KWS_CREATE_ELEMENT_PROTO === '1',
    navigatorWritable: process.env.KS_KWS_NAVIGATOR_WRITABLE === '1',
    elementPrototypeChains: process.env.KS_KWS_ELEMENT_PROTOS === '1',
    elementInterfaces: process.env.KS_KWS_ELEMENT_INTERFACES === '1',
    domPropertiesOnPrototype: process.env.KS_KWS_DOM_PROTO_PROPS === '1',
    layoutAttachedHeight: process.env.KS_KWS_LAYOUT_HEIGHT !== '0',
    webdriverMarker: process.env.KS_KWS_WEBDRIVER_MARKER === '1',
    domHierarchyErrors: process.env.KS_KWS_DOM_HIERARCHY !== '0',
    domExceptionInterface: process.env.KS_KWS_DOM_EXCEPTION === '1',
    navigatorInterfaces: process.env.KS_KWS_NAVIGATOR_INTERFACES === '1',
    navigatorDirectObjectPrototype: process.env.KS_KWS_NAVIGATOR_DIRECT_OBJECT === '1',
    locationPrototypeChain: process.env.KS_KWS_LOCATION_PROTO === '1',
    windowPrototypeChain: process.env.KS_KWS_WINDOW_PROTO !== '0',
    windowPropertiesPrototype: process.env.KS_KWS_WINDOW_PROPERTIES === '1',
    windowAccessorProperties: process.env.KS_KWS_WINDOW_ACCESSORS === '1',
    vmUriIntrinsics: process.env.KS_KWS_VM_URI_INTRINSICS === '1',
  }, opts || {});

  const touched = [];
  let currentPc = null;
  let nextElementId = 1;
  const elementIds = new WeakMap();
  const record = (entry) => {
    touched.push(o.pcTrace && currentPc !== null ? `pc=${currentPc} ${entry}` : entry);
  };
  const describe = (value) => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'object') {
      return value.tagName
        ? `<${value.tagName}#${elementIds.get(value) || '?'}>` : '{object}';
    }
    return `${typeof value}:${String(value).slice(0, 40)}`;
  };
  const store = {};
  const hostLabels = new WeakMap();
  const browserInterfaces = {};
  if (o.domExceptionInterface && typeof DOMException === 'function') {
    browserInterfaces.DOMException = DOMException;
  }
  const interfacePrototypes = {};
  const elementTags = new WeakMap();
  const ensureElementInterfaces = () => {
    if (interfacePrototypes.HTMLElement) return;
    const defineInterface = (name, parentName) => {
      const parentProto = parentName ? interfacePrototypes[parentName] : Object.prototype;
      const proto = Object.create(parentProto);
      const Ctor = { [name]: function () {} }[name];
      Object.defineProperty(proto, 'constructor', {
        value: Ctor, writable: true, configurable: true,
      });
      Object.defineProperty(proto, Symbol.toStringTag, {
        value: name, configurable: true,
      });
      Ctor.prototype = proto;
      interfacePrototypes[name] = proto;
      browserInterfaces[name] = Ctor;
    };
    defineInterface('EventTarget');
    defineInterface('Node', 'EventTarget');
    defineInterface('Element', 'Node');
    defineInterface('HTMLElement', 'Element');
    if (o.domPropertiesOnPrototype) {
      Object.defineProperty(interfacePrototypes.Node, 'nodeName', {
        get() { return String(elementTags.get(this) || '').toUpperCase(); },
        enumerable: true, configurable: true,
      });
      Object.defineProperty(interfacePrototypes.Element, 'tagName', {
        get() { return String(elementTags.get(this) || '').toUpperCase(); },
        enumerable: true, configurable: true,
      });
    }
    for (const name of new Set(Object.values(ELEMENT_INTERFACE).concat('HTMLUnknownElement'))) {
      defineInterface(name, 'HTMLElement');
    }
  };

  // WeakSet：追踪已被 append 进 DOM 的元素（body/head.appendChild 都记）
  const attached = new WeakSet();
  const parentNode = new WeakMap();
  const childNodes = new WeakMap();
  const appendNode = (parent, child, connected) => {
    if (!child || typeof child !== 'object') {
      throw new TypeError("Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'.");
    }
    if (o.domHierarchyErrors) {
      for (let cursor = parent; cursor; cursor = parentNode.get(cursor)) {
        if (cursor === child) {
          throw new DOMException(
            "Failed to execute 'appendChild' on 'Node': The new child element contains the parent.",
            'HierarchyRequestError');
        }
      }
    }
    const oldParent = parentNode.get(child);
    if (oldParent) {
      const oldChildren = childNodes.get(oldParent) || [];
      const oldIndex = oldChildren.indexOf(child);
      if (oldIndex >= 0) oldChildren.splice(oldIndex, 1);
    }
    parentNode.set(child, parent);
    const children = childNodes.get(parent) || [];
    children.push(child);
    childNodes.set(parent, children);
    if (connected) attached.add(child);
    return child;
  };

  // ------------------------------------------------------------------ //
  // navigator 必须是**只读**的                                          //
  // ------------------------------------------------------------------ //
  // kws 的 Brook VM 有一个 canary 注入检测：它往 navigator.platform /
  // appCodeName / userAgent 里写一个标记串（实测是 "ctrip.com"），再读回来
  // 比对。真实浏览器里这些都是 Navigator.prototype 上的 **getter-only**
  // 访问器，非严格模式下赋值静默失败，读回来仍是原值；
  // 而普通对象字面量会被真的写进去 —— VM 一看值变了就判定环境被 hook，
  // 转去走另一条代码路径，产出的 kwscode 里会出现 nibble > 15
  // （表现为 g/h/i 这种非 hex 字符，浏览器真实值是纯 hex）。
  //
  // 所以这里用 defineProperty 定义成只有 getter 的属性，
  // 复刻浏览器「可读、写不进去」的语义。
  const navigator = {};
  hostLabels.set(navigator, 'navigator');
  const navigatorTarget = o.navigatorPrototypeChain ? {} : navigator;
  const NAV_VALUES = {
    userAgent: UA,
    appVersion: UA.slice('Mozilla/'.length),
    platform: 'Win32',
    language: o.language,
    languages: o.languages,
    vendor: 'Google Inc.',
    hardwareConcurrency: 20,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webdriver: o.webdriver,
    pdfViewerEnabled: o.pdfViewerEnabled,
    cookieEnabled: true,
    doNotTrack: null,
    onLine: o.onLine,
    plugins: { length: 5 },
    mimeTypes: { length: 2 },
    product: 'Gecko',
    productSub: '20030107',
    appName: 'Netscape',
    appCodeName: 'Mozilla',
  };
  // Chrome 的只读字段位于 Navigator.prototype，实例本身没有这些数据属性。
  // KWS 同时观察可写语义和原型身份；因此正式环境使用完整
  // navigator -> Navigator.prototype -> EventTarget.prototype -> Object.prototype
  // 链，并在 Navigator.prototype 上保留 getter-only/configurable:true 描述符。
  for (const [key, value] of Object.entries(NAV_VALUES)) {
    Object.defineProperty(navigatorTarget, key, o.navigatorWritable ? {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    } : {
      get() { record('navigator.' + key); return value; },
      // 只给 getter、不给 setter：真实浏览器里这些就是 getter-only 访问器，
      // 非严格模式下赋值静默失败。加空 setter 会被识破（异常计数器多涨一处）。
      enumerable: true,
      // configurable 必须是 true —— CDP 实测 Navigator.prototype 的 platform
      // 描述符就是 {get: fn, configurable: true}。
      configurable: true,
    });
  }
  if (o.navigatorPrototypeChain) {
    const eventTargetProto = Object.create(Object.prototype);
    const navigatorProto = Object.create(
      o.navigatorDirectObjectPrototype ? Object.prototype : eventTargetProto);
    if (o.navigatorInterfaces) {
      const EventTarget = function EventTarget() {};
      const Navigator = function Navigator() {};
      Object.defineProperty(eventTargetProto, 'constructor', {
        value: EventTarget, writable: true, configurable: true,
      });
      Object.defineProperty(navigatorProto, 'constructor', {
        value: Navigator, writable: true, configurable: true,
      });
      EventTarget.prototype = eventTargetProto;
      Navigator.prototype = navigatorProto;
      browserInterfaces.EventTarget = EventTarget;
      browserInterfaces.Navigator = Navigator;
    }
    for (const key of Object.getOwnPropertyNames(navigatorTarget)) {
      Object.defineProperty(navigatorProto, key,
        Object.getOwnPropertyDescriptor(navigatorTarget, key));
    }
    Object.defineProperty(navigatorProto, Symbol.toStringTag, {
      value: 'Navigator', configurable: true,
    });
    Object.setPrototypeOf(navigator, navigatorProto);
  }

  let cookieJar = o.cookie;
  const locationObj = {
    href: o.href,
    origin: 'https://' + o.hostname,
    protocol: 'https:',
    host: o.hostname,
    hostname: o.hostname,
    pathname: (() => { try { return new URL(o.href).pathname; } catch (e) { return '/'; } })(),
    search: '',
    hash: '',
  };
  hostLabels.set(locationObj, 'location');
  if (o.locationPrototypeChain) {
    const locationProto = Object.create(Object.prototype);
    const Location = function Location() {};
    Object.defineProperty(locationProto, 'constructor', {
      value: Location, writable: true, configurable: true,
    });
    Object.defineProperty(locationProto, Symbol.toStringTag, {
      value: 'Location', configurable: true,
    });
    Location.prototype = locationProto;
    Object.setPrototypeOf(locationObj, locationProto);
    browserInterfaces.Location = Location;
  }

  const documentObj = {
    get cookie() { record('document.cookie'); return cookieJar; },
    set cookie(v) { record('document.cookie=' + String(v).slice(0, 60)); cookieJar = v; },
    referrer: '',
    title: '快手',
    characterSet: 'UTF-8',
    documentElement: {
      clientWidth: 1920, clientHeight: 947, lang: 'zh-CN',
      getAttribute(name) { record(`documentElement.getAttribute(${describe(name)})`); return null; },
      hasAttribute(name) { record(`documentElement.hasAttribute(${describe(name)})`); return false; },
    },
    body: {
      clientWidth: 1920, clientHeight: 947,
      appendChild(child) {
        record(`body.appendChild(${describe(child)})`);
        return appendNode(documentObj.body, child, true);
      },
      removeChild(child) { record(`body.removeChild(${describe(child)})`); attached.delete(child); return child; },
    },
    head: {
      appendChild(child) { attached.add(child); return child; },
      removeChild(child) { attached.delete(child); return child; },
    },
    scripts: { length: 27 },
    createElement(tag) {
      record('createElement:' + tag);
      if (tag === 'iframe') {
        // 与 kwf 同样的反 hook 比对：需要一个可用的 contentWindow
        const inner = {};
        inner.window = inner;
        inner.self = inner;
        inner.navigator = navigator;
        inner.document = documentObj;
        inner.location = locationObj;
        return {
          style: {}, setAttribute() {}, appendChild() {}, remove() {},
          get contentWindow() { return inner; },
          get contentDocument() { return documentObj; },
        };
      }
      // ---------------------------------------------------------------- //
      // div canary（所有 kws 变体都做）                                   //
      // ---------------------------------------------------------------- //
      // 脚本的动作是：createElement("div") -> style.height = "20px"
      //            -> document.body.appendChild(div) -> 读 offsetHeight
      //            -> div.remove()
      // 真实浏览器实测（CDP 在 www.kuaishou.com 上取的权威值）：
      //     未挂载时 offsetHeight = 0；挂到 body 上之后 = 20；remove 后又变 0。
      // 之前恒返回 0，VM 认为「设了高度却量不到」= 环境是假的，
      // 于是走异常分支，产出的 kwscode 出现 nibble > 15 的非 hex 字符。
      const style = {};
      const el = {
        style,
        className: '',
        id: '',
        innerHTML: '',
        get parentNode() { record(`el<${tag}>.parentNode`); return parentNode.get(el) || null; },
        get parentElement() { record(`el<${tag}>.parentElement`); return parentNode.get(el) || null; },
        get childNodes() { record(`el<${tag}>.childNodes`); return childNodes.get(el) || []; },
        get children() { record(`el<${tag}>.children`); return childNodes.get(el) || []; },
        get firstChild() { return (childNodes.get(el) || [])[0] || null; },
        get lastChild() {
          const children = childNodes.get(el) || [];
          return children.length ? children[children.length - 1] : null;
        },
        get childElementCount() { return (childNodes.get(el) || []).length; },
        get offsetHeight() {
          const value = o.layoutAttachedHeight && attached.has(el)
            ? parseInt(style.height, 10) || 0 : 0;
          record(`el<${tag}>.offsetHeight=${value}`);
          return value;
        },
        get clientHeight() { return attached.has(el) ? parseInt(style.height, 10) || 0 : 0; },
        get offsetWidth() { return attached.has(el) ? parseInt(style.width, 10) || 0 : 0; },
        get clientWidth() { return attached.has(el) ? parseInt(style.width, 10) || 0 : 0; },
        setAttribute() {}, getAttribute() { return null; },
        hasAttribute() { return false; },
        appendChild(child) {
          record(`el<${tag}#${elementIds.get(el) || '?'}>.appendChild(${describe(child)})`);
          return appendNode(el, child, attached.has(el));
        },
        removeChild(child) {
          record(`el<${tag}#${elementIds.get(el) || '?'}>.removeChild(${describe(child)})`);
          attached.delete(child); return child;
        },
        remove() {
          record(`el<${tag}#${elementIds.get(el) || '?'}>.remove`); attached.delete(el);
        },
        contains(other) {
          record(`el<${tag}>.contains(${describe(other)})`);
          for (let cursor = other; cursor; cursor = parentNode.get(cursor)) {
            if (cursor === el) return true;
          }
          return false;
        },
        getContext() { return null; },
        toDataURL() { return 'data:image/png;base64,'; },
        getBoundingClientRect() {
          const h = attached.has(el) ? parseInt(style.height, 10) || 0 : 0;
          const w = attached.has(el) ? parseInt(style.width, 10) || 0 : 0;
          return { width: w, height: h, top: 0, left: 0, right: w, bottom: h };
        },
        addEventListener() {},
      };
      hostLabels.set(el, `el<${tag}#${nextElementId}>`);
      if (!o.domPropertiesOnPrototype) {
        el.tagName = String(tag).toUpperCase();
        el.nodeName = String(tag).toUpperCase();
      }
      elementTags.set(el, String(tag));
      elementIds.set(el, nextElementId++);
      // Object.prototype.toString.call(el) 在真实浏览器里是
      // "[object HTMLDivElement]" 这类**具体接口名**，普通对象字面量只会给
      // "[object Object]"。脚本批量建 div/a/p/h1..h4/span/ul/li 再读 tagName，
      // 就是在验这个。Symbol.toStringTag 可以让 Object.prototype.toString
      // 返回指定的名字。
      if (o.elementTypeTag) {
        Object.defineProperty(el, Symbol.toStringTag, {
          get() { return ELEMENT_INTERFACE[String(tag).toLowerCase()] || 'HTMLUnknownElement'; },
          configurable: true,
        });
      }
      if (o.elementInterfaces) {
        ensureElementInterfaces();
        const interfaceName = ELEMENT_INTERFACE[String(tag).toLowerCase()] || 'HTMLUnknownElement';
        Object.setPrototypeOf(el, interfacePrototypes[interfaceName]);
      } else if (o.elementPrototypeChains) {
        const eventTargetProto = Object.create(Object.prototype);
        const nodeProto = Object.create(eventTargetProto);
        const elementProto = Object.create(nodeProto);
        const htmlElementProto = Object.create(elementProto);
        Object.setPrototypeOf(el, htmlElementProto);
      }
      return el;
    },
    getElementsByTagName() { return { length: 0 }; },
    querySelector() { return null; },
    addEventListener() {},
  };
  hostLabels.set(documentObj, 'document');
  hostLabels.set(documentObj.documentElement, 'documentElement');
  hostLabels.set(documentObj.body, 'body');
  hostLabels.set(documentObj.head, 'head');
  if (o.webdriverMarker) documentObj.__webdriver_evaluate = true;
  if (o.documentCookieOnPrototype) {
    const cookieDescriptor = Object.getOwnPropertyDescriptor(documentObj, 'cookie');
    const cookieProto = Object.create(Object.getPrototypeOf(documentObj));
    Object.defineProperty(cookieProto, 'cookie', cookieDescriptor);
    delete documentObj.cookie;
    Object.setPrototypeOf(documentObj, cookieProto);
  }
  if (o.documentCreateElementOnPrototype) {
    const createElementDescriptor = Object.getOwnPropertyDescriptor(documentObj, 'createElement');
    const documentMethodProto = Object.create(Object.getPrototypeOf(documentObj));
    Object.defineProperty(documentMethodProto, 'createElement', createElementDescriptor);
    delete documentObj.createElement;
    Object.setPrototypeOf(documentObj, documentMethodProto);
  }
  if (o.documentPrototypeChain) {
    const eventTargetProto = Object.create(Object.prototype);
    const nodeProto = Object.create(eventTargetProto);
    const documentProto = Object.create(nodeProto);
    Object.defineProperty(documentProto, Symbol.toStringTag, {
      value: 'HTMLDocument', configurable: true,
    });
    Object.setPrototypeOf(documentObj, documentProto);
  }

  if (o.elementInterfaces) ensureElementInterfaces();
  const sandbox = {};
  hostLabels.set(sandbox, 'window');
  if (o.windowPrototypeChain) {
    const eventTargetProto = Object.create(Object.prototype);
    const windowPropertiesProto = o.windowPropertiesPrototype
      ? Object.create(eventTargetProto) : eventTargetProto;
    const windowProto = Object.create(windowPropertiesProto);
    const EventTarget = browserInterfaces.EventTarget || function EventTarget() {};
    const Window = function Window() {};
    Object.defineProperty(eventTargetProto, 'constructor', {
      value: EventTarget, writable: true, configurable: true,
    });
    Object.defineProperty(windowProto, 'constructor', {
      value: Window, writable: true, configurable: true,
    });
    Object.defineProperty(windowProto, Symbol.toStringTag, {
      value: 'Window', configurable: true,
    });
    EventTarget.prototype = eventTargetProto;
    Window.prototype = windowProto;
    Object.setPrototypeOf(sandbox, windowProto);
    browserInterfaces.EventTarget = EventTarget;
    browserInterfaces.Window = Window;
  }
  if (o.windowAccessorProperties) {
    for (const key of ['window', 'self', 'globalThis', 'top', 'parent']) {
      Object.defineProperty(sandbox, key, {
        get() { return sandbox; }, enumerable: true, configurable: true,
      });
    }
    Object.defineProperties(sandbox, {
      navigator: {
        get() { return navigator; }, enumerable: true, configurable: true,
      },
      document: {
        get() { return documentObj; }, enumerable: true, configurable: true,
      },
      location: {
        get() { return locationObj; }, set() {}, enumerable: true, configurable: true,
      },
    });
  } else {
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.top = sandbox;
    sandbox.parent = sandbox;
    sandbox.navigator = navigator;
    sandbox.document = documentObj;
    sandbox.location = locationObj;
  }
  Object.assign(sandbox, browserInterfaces);
  sandbox.screen = {
    width: 1920, height: 1080, availWidth: 1920, availHeight: 1032,
    colorDepth: 24, pixelDepth: 24, availLeft: 0, availTop: 0,
  };
  sandbox.localStorage = {
    getItem(k) { record('ls.get:' + k); return k in store ? store[k] : null; },
    setItem(k, v) { record('ls.set:' + k); store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };
  sandbox.sessionStorage = sandbox.localStorage;
  sandbox.console = { log() {}, warn() {}, error() {}, debug() {}, info() {} };
  sandbox.performance = { now: () => Date.now() % 100000, timeOrigin: Date.now() };
  sandbox.chrome = { runtime: {} };
  sandbox.devicePixelRatio = 1;
  sandbox.innerWidth = 1920;
  sandbox.innerHeight = 947;
  sandbox.outerWidth = 1920;
  sandbox.outerHeight = 1032;
  sandbox.screenX = 0;
  sandbox.screenY = 0;
  sandbox.setTimeout = (fn) => { if (typeof fn === 'function') { try { fn(); } catch (e) {} } return 0; };
  sandbox.setInterval = () => 0;
  sandbox.clearTimeout = () => {};
  sandbox.clearInterval = () => {};
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.atob = (s) => Buffer.from(s, 'base64').toString('binary');
  sandbox.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
  if (!o.vmUriIntrinsics) {
    sandbox.encodeURI = encodeURI;
    sandbox.encodeURIComponent = encodeURIComponent;
    sandbox.decodeURIComponent = decodeURIComponent;
  }

  // 关键：SDK 在加载 kws 脚本前就挂好 kwscb，脚本算完回调它交出 kwscode
  const captured = { kwscode: null, calls: [], pcAtCall: null, pcTailAtCall: [] };
  const pcHistory = [];
  const functionIds = new WeakMap();
  const functionStack = [];
  let nextFunctionId = 1;
  sandbox.__kwsStep = function (pc, instruction) {
    if (!o.pcTrace) return;
    currentPc = pc;
    pcHistory.push({ pc, instruction: Array.from(instruction || []) });
    if (pcHistory.length > 256) pcHistory.shift();
  };
  sandbox.__kwsHostLabel = function (value) {
    return value && (typeof value === 'object' || typeof value === 'function')
      ? hostLabels.get(value) || '' : '';
  };
  sandbox.__kwsBuiltin = function (name, label, detail) {
    if (o.builtinTrace && label) record(`builtin ${name} ${label} ${detail || ''}`.trim());
  };
  sandbox.__kwsPropertyRead = function (base, key, value) {
    if (!o.propertyTrace) return value;
    let label = base && (typeof base === 'object' || typeof base === 'function')
      ? hostLabels.get(base) || '' : '';
    // vm contextifies the global object, so the value received back by a host
    // callback is not guaranteed to retain the original sandbox identity.
    if (!label && base && typeof base === 'object') {
      try {
        if (base.document === documentObj && base.navigator === navigator) label = 'window';
      } catch (e) { /* not the context global */ }
    }
    if (label) {
      record(`property ${label}.${String(key)} -> ${describe(value)}`);
      if (value && (typeof value === 'object' || typeof value === 'function')
          && !hostLabels.has(value)) {
        hostLabels.set(value, `${label}.${String(key)}`);
      }
    } else if (String(key) === 'stack') {
      record(`property <error>.stack -> ${String(value).replace(/\s+/g, ' ').slice(0, 500)}`);
    }
    return value;
  };
  sandbox.__kwsFunctionEnter = function (program, args) {
    if (!o.functionTrace) return;
    let id = functionIds.get(program);
    if (!id) {
      id = nextFunctionId++;
      functionIds.set(program, id);
    }
    functionStack.push(id);
    let argsText = '';
    try { argsText = ` args=${JSON.stringify(Array.from(args || []))}`; } catch (e) {}
    record(`fn-enter ${id} len=${program.length} first=${JSON.stringify(program[0])}`
      + ` last=${JSON.stringify(program[program.length - 1])}${argsText}`);
  };
  sandbox.__kwsFunctionExit = function (program, value) {
    const id = functionIds.get(program) || '?';
    if (o.functionTrace) {
      record(`fn-exit ${id} -> ${describe(value)}`);
      functionStack.pop();
    }
    return value;
  };
  sandbox.kwscb = function (code) {
    captured.calls.push(code);
    if (captured.kwscode === null) captured.kwscode = code;
    if (o.pcTrace && captured.pcAtCall === null) {
      captured.pcAtCall = pcHistory.length ? pcHistory[pcHistory.length - 1].pc : null;
      captured.pcTailAtCall = pcHistory.slice(-48);
    }
    record('kwscb(' + String(code).slice(0, 24) + '…)');
    return true;
  };

  if (typeof o.mutateEnv === 'function') {
    o.mutateEnv({ sandbox, navigator, document: documentObj, location: locationObj });
  }

  return { sandbox, store, touched, captured, pcHistory, options: o,
    getCookie: () => cookieJar };
}

/** 跑一次 kws 脚本，返回 kwscode。 */
function run(scriptFile, opts) {
  const env = buildEnv(opts);
  const file = path.isAbsolute(scriptFile) ? scriptFile : path.join(WEAPON_DIR, scriptFile);
  let src = fs.readFileSync(file, 'utf8');
  if (env.options.functionTrace) {
    const factory = src.match(/var ([\w$]+) = [\w$]+\.slice\([^;]+?\),[\w$]+ = [\w$]+;[\w$]+\(function \(\) \{[\s\S]*?\};([\w$]+)\(\1\);[\s\S]*?return ([\w$]+)\(([\w$]+)\[0\]\);\},/);
    if (!factory) throw new Error('未能定位 Brook 函数工厂');
    const [, program, execute, dereferenceValue, returnSlots] = factory;
    const executeNeedle = `;${execute}(${program});`;
    const returnNeedle = `return ${dereferenceValue}(${returnSlots}[0]);`;
    src = src.replace(executeNeedle,
      `;__kwsFunctionEnter(${program},arguments);${execute}(${program});`);
    src = src.replace(returnNeedle,
      `var __kwsRet=${dereferenceValue}(${returnSlots}[0]);`
      + `__kwsRet=__kwsFunctionExit(${program},__kwsRet);return __kwsRet;`);
    if (!src.includes('__kwsFunctionEnter(') || !src.includes('__kwsFunctionExit(')) {
      throw new Error('未能注入 Brook 函数调用诊断钩子');
    }
  }
  if (env.options.propertyTrace) {
    // Every Brook value is represented as either a direct value or an
    // object/key reference.  Patch the single reference dereference helper so
    // direct VM property reads from window/document/navigator/DOM are visible;
    // wrapping Object.* alone misses these accesses entirely.
    const dereference = /var ([\w$]+) = function \(([\w$]+)\) \{return \2\.([\w$]+) \? \2\.([\w$]+)\[\2\.([\w$]+)\] : \2\.([\w$]+);\};/;
    src = src.replace(dereference, (all, fn, ref, isReference, base, key, direct) =>
      `var ${fn} = function (${ref}) {return ${ref}.${isReference} ? `
      + `__kwsPropertyRead(${ref}.${base}, ${ref}.${key}, ${ref}.${base}[${ref}.${key}]) `
      + `: ${ref}.${direct};};`);
    if (!src.includes('__kwsPropertyRead(')) {
      throw new Error('未能注入 Brook 属性读取诊断钩子');
    }
  }
  if (env.options.pcTrace) {
    // Both Brook execution loops have the same compact shape despite their
    // randomized identifier prefixes.  Inject a read-only PC tap immediately
    // before each opcode dispatch; the captured official script itself stays
    // immutable on disk.
    const dispatch = /(var ([\w$]+) = ([\w$]+)\[([\w$]+)\[([\w$]+)\]\];)([\w$]+) = \2\(/g;
    src = src.replace(dispatch, (all, declaration, handler, table, instruction,
      zero, pc) => `${declaration}try { __kwsStep(${pc}, ${instruction}); } catch (_) {} ${pc} = ${handler}(`);
  }
  const ctx = vm.createContext(env.sandbox);

  // 把 sandbox 里所有函数收集进一个 WeakSet，供下面的 toString 补丁识别。
  // 递归遍历（含 getter 取到的对象），深度够覆盖 document.body.appendChild 这种。
  vm.runInContext('globalThis.__stubFns = new WeakSet();', ctx);
  const stubSet = env.sandbox.__stubFns;
  const seen = new Set();
  (function collect(obj, depth) {
    if (!obj || depth > 4) return;
    if (typeof obj !== 'object' && typeof obj !== 'function') return;
    if (seen.has(obj)) return;
    seen.add(obj);
    let keys = [];
    try { keys = Object.getOwnPropertyNames(obj); } catch (e) { return; }
    for (const key of keys) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(obj, key);
        if (descriptor) {
          if (typeof descriptor.get === 'function') stubSet.add(descriptor.get);
          if (typeof descriptor.set === 'function') stubSet.add(descriptor.set);
        }
      } catch (e) { /* host descriptor lookup can throw */ }
      let value;
      try { value = obj[key]; } catch (e) { continue; }   // getter 可能抛
      if (typeof value === 'function') {
        try { stubSet.add(value); } catch (e) { /* 跨 realm 的忽略 */ }
        collect(value, depth + 1);
      } else if (value && typeof value === 'object') {
        collect(value, depth + 1);
      }
    }
  })(env.sandbox, 0);

  // ------------------------------------------------------------------ //
  // 让所有桩函数伪装成原生实现                                            //
  // ------------------------------------------------------------------ //
  // 真实浏览器里 document.createElement / appendChild / getAttribute 这些
  // 都是宿主对象方法，Function.prototype.toString 会给
  // "function createElement() { [native code] }"。
  // 我们的桩是普通 JS 函数，toString 会把源码原样吐出来 —— 脚本一验就穿。
  //
  // 注意 **必须在 vm 内部打这个补丁**：vm.createContext 有自己独立的
  // intrinsics，宿主 realm 的 Function.prototype 补丁在里面完全不生效
  // （实测 vm 的 Function.prototype.toString !== 宿主的）。
  //
  // 判据用 WeakSet 白名单：只有我们造的桩才伪装成原生，
  // kws 脚本自己的函数仍返回真实源码（浏览器里也是这样）。
  if (env.options.nativeToStringPatch) {
    vm.runInContext(`
      (function () {
        var origToString = Function.prototype.toString;
        var isStub = globalThis.__stubFns;          // 由宿主塞进来的 WeakSet
        function fakeToString() {
          if (isStub && isStub.has(this)) {
            return 'function ' + (this.name || '') + '() { [native code] }';
          }
          return origToString.call(this);
        }
        Function.prototype.toString = fakeToString;
        // toString 自己也得像原生的，否则一验 toString.toString() 就露馅
        isStub.add(fakeToString);
        isStub.add(Function.prototype.toString);
        delete globalThis.__stubFns;
      })();
  `, ctx);
  }
  if (env.options.builtinTrace) {
    vm.runInContext(`
      (function () {
        var label = globalThis.__kwsHostLabel;
        var report = globalThis.__kwsBuiltin;
        var gp = Object.getPrototypeOf;
        Object.getPrototypeOf = function (value) {
          var out = gp(value); var l = label(value);
          if (l) report('getPrototypeOf', l, label(out) || Object.prototype.toString.call(out));
          return out;
        };
        var gd = Object.getOwnPropertyDescriptor;
        Object.getOwnPropertyDescriptor = function (value, key) {
          var out = gd(value, key); var l = label(value);
          if (l) report('getOwnPropertyDescriptor', l, String(key) + ':' + (out ? Object.keys(out).join(',') : 'missing'));
          return out;
        };
        var gn = Object.getOwnPropertyNames;
        Object.getOwnPropertyNames = function (value) {
          var out = gn(value); var l = label(value);
          if (l) report('getOwnPropertyNames', l, out.join(','));
          return out;
        };
        var hop = Object.prototype.hasOwnProperty;
        Object.prototype.hasOwnProperty = function (key) {
          var l = label(this); var out = hop.call(this, key);
          if (l) report('hasOwnProperty', l, String(key) + ':' + out);
          return out;
        };
        var ots = Object.prototype.toString;
        Object.prototype.toString = function () {
          var out = ots.call(this); var l = label(this);
          if (l) report('toString', l, out);
          return out;
        };
      })();
    `, ctx);
  }
  // A browser compiles an external KWS bundle with its HTTPS script URL as the
  // source name.  Leaving Node's default ``evalmachine.<anonymous>`` leaks the
  // vm host through Error.stack; the official payload explicitly checks for
  // that marker.  The exact signUrl is supplied by Python in production.
  const sourceName = env.options.scriptUrl
    || `https://static.yximgs.com/${path.basename(file)}`;
  vm.runInContext(src, ctx, { timeout: 30000, filename: sourceName });

  // 有的变体是异步交付（挂在 setTimeout 里），我们的 setTimeout 是同步跑的，
  // 所以这里通常已经拿到了。若还没有，再尝试主动触发常见入口。
  if (env.captured.kwscode === null) {
    for (const name of ['kwpsec', 'kws', 'kwsign']) {
      const obj = env.sandbox[name];
      if (obj && typeof obj.getData === 'function') {
        try { env.captured.kwscode = obj.getData(); } catch (e) {}
      }
    }
  }
  return env;
}

function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const script = args.find((a) => !a.startsWith('--')) || DEFAULT_SCRIPT;
  const asJson = flags.includes('--json');
  const trace = flags.includes('--trace');
  const pcTrace = flags.includes('--pc-trace');
  const builtinTrace = flags.includes('--builtin-trace');
  const propertyTrace = flags.includes('--property-trace');
  const functionTrace = flags.includes('--function-trace');

  let env;
  try {
    env = run(script, { trace, pcTrace, builtinTrace, propertyTrace, functionTrace });
  } catch (e) {
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      process.exit(1);
    }
    console.error('跑 kws 失败:', e && e.message || e);
    process.exit(1);
  }

  const code = env.captured.kwscode;
  if (asJson) {
    console.log(JSON.stringify({
      ok: code != null,
      script,
      kwscode: code,
      length: code == null ? 0 : String(code).length,
      calls: env.captured.calls.length,
      cookie: env.getCookie(),
      pcHistory: pcTrace ? env.pcHistory : undefined,
      pcAtCall: pcTrace ? env.captured.pcAtCall : undefined,
      pcTailAtCall: pcTrace ? env.captured.pcTailAtCall : undefined,
    }));
    return;
  }

  console.log('脚本   :', script);
  console.log('kwscode:', code);
  console.log('长度   :', code == null ? 0 : String(code).length);
  console.log('回调次数:', env.captured.calls.length);
  const ck = env.getCookie();
  if (ck) console.log('脚本写的 cookie:', String(ck).slice(0, 160));
  if (trace) {
    console.log('\n=== 读过的环境属性（去重连续项）===');
    let prev = null; let n = 0;
    for (const t of env.touched) {
      if (t === prev) continue;
      prev = t;
      console.log('  ' + String(++n).padStart(3) + '  ' + t);
    }
  }
}

if (require.main === module) main();

module.exports = { run, buildEnv, WEAPON_DIR, DEFAULT_SCRIPT };
