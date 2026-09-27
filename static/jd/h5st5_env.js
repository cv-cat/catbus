// h5st 5.3 运行时的浏览器环境引导。
// js_security_v3 会读 DOM / navigator / screen / canvas 做指纹，缺一个全局就抛
// ReferenceError，所以这里把 jsdom 的常用构造函数和对象整体提升到全局。
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

const resourceLoader = new jsdom.ResourceLoader({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
});

// 页面 URL 直接进环境采集（location.href / origin / document.referrer 都是采集项），
// 用裸域名会和真实页面对不上，这里对齐成真实的搜索结果页。
const PAGE_URL = process.env.JD_PAGE_URL
    || "https://search.jd.com/Search?keyword=%E7%AC%94%E8%AE%B0%E6%9C%AC%E7%94%B5%E8%84%91&enc=utf-8";

const domOptions = {
    url: PAGE_URL,
    contentType: "text/html",
    resources: resourceLoader,
    pretendToBeVisual: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
};
// jsdom 不接受空字符串 referrer，真实搜索页的 document.referrer 恰好就是空
if (process.env.JD_REFERRER) domOptions.referrer = process.env.JD_REFERRER;

const dom = new JSDOM("<!DOCTYPE html><html><head></head><body><p></p></body></html>",
                      domOptions);

window = dom.window;
document = window.document;
self = window;
globalThis.window = window;
globalThis.document = document;
globalThis.self = window;

// 把 jsdom window 上的所有属性挂到全局，缺失的构造函数（Element/Node/Event/…）一次补齐
for (const key of Object.getOwnPropertyNames(window)) {
    if (key in globalThis) continue;
    try {
        const value = window[key];
        if (value !== undefined) globalThis[key] = value;
    } catch (e) { /* 某些属性访问即抛，跳过 */ }
}

navigator = window.navigator;
location = window.location;
localStorage = window.localStorage;
sessionStorage = window.sessionStorage;
screen = window.screen;
history = window.history;

// jsdom 不实现 canvas，指纹代码会调这两个方法
try {
    window.HTMLCanvasElement.prototype.getContext = function () {
        return {
            fillRect() {}, fillText() {}, getImageData() { return { data: [] }; },
            measureText() { return { width: 0 }; }, arc() {}, beginPath() {},
            stroke() {}, fill() {}, closePath() {}, rect() {}, save() {},
            restore() {}, translate() {}, rotate() {}, scale() {},
            createLinearGradient() { return { addColorStop() {} }; },
        };
    };
    window.HTMLCanvasElement.prototype.toDataURL = function () {
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";
    };
} catch (e) { /* ignore */ }

// ---------- 指纹面补全 ----------
// h5st 的 token 要向 cactus 换，请求体里的 expandParams 是一整包环境采集。
// jsdom 裸环境采出来只有 ~1600 字符，真浏览器约 2900，服务端据此判定 token 可信度：
// 薄环境照发 token，但用它签的业务请求会被边缘层 403。下面按真实 Chrome 补齐各面。
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

function defineAll(target, props) {
    for (const [k, v] of Object.entries(props)) {
        try {
            Object.defineProperty(target, k, {
                get: () => v, configurable: true, enumerable: true,
            });
        } catch (e) { /* 只读属性跳过 */ }
    }
}

// navigator：jsdom 默认报自己的 UA/平台，会被指纹逻辑识别
defineAll(window.navigator, {
    userAgent: CHROME_UA,
    appVersion: CHROME_UA.replace("Mozilla/", ""),
    platform: "Win32",
    vendor: "Google Inc.",
    language: "zh-CN",
    languages: ["zh-CN", "zh", "en", "zh-TW", "ja"],
    // Keep the device surface identical to WebM and JCAP.  These three
    // independent risk collectors are correlated by the same JD session.
    hardwareConcurrency: 32,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webdriver: false,
    doNotTrack: null,
    cookieEnabled: true,
    pdfViewerEnabled: true,
    userAgentData: {
        brands: [
            { brand: "Chromium", version: "152" },
            { brand: "Not?A_Brand", version: "24" },
            { brand: "Google Chrome", version: "152" },
        ],
        mobile: false,
        platform: "Windows",
    },
    connection: { effectiveType: "4g", rtt: 50, downlink: 10, saveData: false },
});

// 插件与 mimeTypes：Chrome 固定五个内置 PDF 插件
const PLUGIN_DEFS = [
    ["PDF Viewer", "internal-pdf-viewer"],
    ["Chrome PDF Viewer", "internal-pdf-viewer"],
    ["Chromium PDF Viewer", "internal-pdf-viewer"],
    ["Microsoft Edge PDF Viewer", "internal-pdf-viewer"],
    ["WebKit built-in PDF", "internal-pdf-viewer"],
];
const plugins = PLUGIN_DEFS.map(([name, filename]) => ({
    name, filename, description: "Portable Document Format", length: 2,
}));
plugins.item = (i) => plugins[i];
plugins.namedItem = (n) => plugins.find((p) => p.name === n);
const mimeTypes = [
    { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
    { type: "text/pdf", suffixes: "pdf", description: "Portable Document Format" },
];
mimeTypes.item = (i) => mimeTypes[i];
mimeTypes.namedItem = (n) => mimeTypes.find((m) => m.type === n);
defineAll(window.navigator, { plugins, mimeTypes });

defineAll(window.screen, {
    width: 2560, height: 1440, availWidth: 2560, availHeight: 1392,
    colorDepth: 24, pixelDepth: 24, availLeft: 0, availTop: 0,
});
defineAll(window, { devicePixelRatio: 1, outerWidth: 2560, outerHeight: 1392,
                    innerWidth: 2560, innerHeight: 1297 });

// WebGL：jsdom 完全没有，而指纹会读 VENDOR / RENDERER / 扩展列表
const GL_PARAMS = {
    7936: "WebKit", 7937: "WebKit WebGL", 7938: "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
    35724: "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)",
    37445: "Google Inc. (NVIDIA)",
    37446: "ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) " +
           "Direct3D11 vs_5_0 ps_5_0, D3D11)",
    3379: 16384, 34930: 16, 35660: 16, 34076: 16384, 36349: 1024, 34024: 16384,
};
const GL_EXTENSIONS = [
    "ANGLE_instanced_arrays", "EXT_blend_minmax", "EXT_color_buffer_half_float",
    "EXT_float_blend", "EXT_frag_depth", "EXT_shader_texture_lod",
    "EXT_texture_compression_bptc", "EXT_texture_compression_rgtc",
    "EXT_texture_filter_anisotropic", "EXT_sRGB", "OES_element_index_uint",
    "OES_fbo_render_mipmap", "OES_standard_derivatives", "OES_texture_float",
    "OES_texture_float_linear", "OES_texture_half_float",
    "OES_texture_half_float_linear", "OES_vertex_array_object",
    "WEBGL_color_buffer_float", "WEBGL_compressed_texture_s3tc",
    "WEBGL_debug_renderer_info", "WEBGL_debug_shaders", "WEBGL_depth_texture",
    "WEBGL_draw_buffers", "WEBGL_lose_context", "WEBGL_multi_draw",
];

function makeWebGLContext() {
    return {
        getParameter: (p) => (p in GL_PARAMS ? GL_PARAMS[p] : 0),
        getSupportedExtensions: () => GL_EXTENSIONS.slice(),
        getExtension: (name) => (name === "WEBGL_debug_renderer_info"
            ? { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 }
            : (GL_EXTENSIONS.includes(name) ? {} : null)),
        getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
        getContextAttributes: () => ({ alpha: true, antialias: true, depth: true }),
        canvas: null,
        drawingBufferWidth: 300, drawingBufferHeight: 150,
    };
}

// 字体探测：指纹库靠 canvas measureText 逐个字体量宽度，宽度不同才算「已安装」。
// 桩若对所有字体返回同一宽度，等于报告一个字体都没有，采集体积会小很多。
const INSTALLED_FONTS = [
    "Arial", "Arial Black", "Arial Narrow", "Calibri", "Cambria", "Candara",
    "Comic Sans MS", "Consolas", "Constantia", "Corbel", "Courier New",
    "Ebrima", "Franklin Gothic", "Gabriola", "Georgia", "Impact",
    "Lucida Console", "Lucida Sans Unicode", "Malgun Gothic", "Marlett",
    "Microsoft Himalaya", "Microsoft JhengHei", "Microsoft YaHei",
    "Microsoft Sans Serif", "MingLiU", "Mongolian Baiti", "MS Gothic",
    "MV Boli", "Myanmar Text", "Nirmala UI", "Palatino Linotype",
    "Segoe Print", "Segoe Script", "Segoe UI", "SimHei", "SimSun",
    "Sitka", "Sylfaen", "Symbol", "Tahoma", "Times New Roman",
    "Trebuchet MS", "Verdana", "Webdings", "Wingdings", "Yu Gothic",
    "KaiTi", "FangSong", "NSimSun", "DengXian",
];

function fontWidthFactor(fontSpec) {
    const spec = String(fontSpec || "");
    let hit = null;
    for (const f of INSTALLED_FONTS) {
        if (spec.indexOf(f) !== -1) { hit = f; break; }
    }
    if (!hit) return 7.0;  // 未安装 → 回落到默认字体宽度
    let h = 0;
    for (let i = 0; i < hit.length; i++) h = (h * 31 + hit.charCodeAt(i)) % 997;
    return 6.2 + (h % 220) / 100;
}
const CANVAS_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAYAAABkW7XSAAAAAXNSR0IArs4c6QAAIABJREFUeF7tnQeYFEX6h7/ZnGCXHCXnnBEUFAOKgg";
try {
    window.HTMLCanvasElement.prototype.getContext = function (type) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
            const ctx = makeWebGLContext();
            ctx.canvas = this;
            return ctx;
        }
        return {
            canvas: this,
            font: "10px sans-serif",
            fillRect() {}, clearRect() {}, fillText() {}, strokeText() {},
            beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {},
            rect() {}, stroke() {}, fill() {}, save() {}, restore() {},
            translate() {}, rotate() {}, scale() {}, transform() {}, setTransform() {},
            drawImage() {}, putImageData() {}, bezierCurveTo() {}, quadraticCurveTo() {},
            createLinearGradient: () => ({ addColorStop() {} }),
            createRadialGradient: () => ({ addColorStop() {} }),
            createPattern: () => ({}),
            measureText(txt) {
                const s = String(txt || "");
                const w = s.length * fontWidthFactor(this.font);
                return {
                    width: w,
                    actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2,
                    actualBoundingBoxLeft: 0, actualBoundingBoxRight: w,
                    fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3,
                };
            },
            getImageData: (x, y, w, h) => ({
                width: w, height: h,
                data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)),
            }),
            isPointInPath: () => false,
        };
    };
    window.HTMLCanvasElement.prototype.toDataURL = () => CANVAS_DATA_URL;
    window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb && cb(null); };
} catch (e) { /* ignore */ }

// AudioContext：指纹常用 OfflineAudioContext 跑一段振荡器取哈希
class FakeAudioParam { constructor(v) { this.value = v; } setValueAtTime() {} }
class FakeAudioNode {
    connect() { return this; }
    disconnect() {}
    start() {}
    stop() {}
}
class FakeAudioContext {
    constructor() {
        this.sampleRate = 48000;
        this.state = "suspended";
        this.destination = new FakeAudioNode();
        this.currentTime = 0;
    }
    createOscillator() {
        const n = new FakeAudioNode();
        n.frequency = new FakeAudioParam(440);
        n.type = "sine";
        return n;
    }
    createGain() {
        const n = new FakeAudioNode();
        n.gain = new FakeAudioParam(1);
        return n;
    }
    createAnalyser() {
        const n = new FakeAudioNode();
        n.frequencyBinCount = 1024;
        n.getFloatFrequencyData = (arr) => arr.fill(-100);
        n.getByteFrequencyData = (arr) => arr.fill(0);
        return n;
    }
    createDynamicsCompressor() {
        const n = new FakeAudioNode();
        for (const k of ["threshold", "knee", "ratio", "attack", "release"]) {
            n[k] = new FakeAudioParam(0);
        }
        return n;
    }
    createScriptProcessor() { return new FakeAudioNode(); }
    createBuffer() { return { getChannelData: () => new Float32Array(128) }; }
    createBufferSource() { return new FakeAudioNode(); }
    startRendering() { return Promise.resolve({ getChannelData: () => new Float32Array(128) }); }
    close() { return Promise.resolve(); }
    resume() { return Promise.resolve(); }
}
globalThis.AudioContext = FakeAudioContext;
globalThis.webkitAudioContext = FakeAudioContext;
globalThis.OfflineAudioContext = FakeAudioContext;
window.AudioContext = FakeAudioContext;
window.OfflineAudioContext = FakeAudioContext;

// 其它零散面
window.chrome = { runtime: {}, app: { isInstalled: false },
                  csi: () => ({}), loadTimes: () => ({}) };
globalThis.chrome = window.chrome;
if (!window.navigator.permissions) {
    window.navigator.permissions = {
        query: () => Promise.resolve({ state: "prompt", onchange: null }),
    };
}
if (!window.matchMedia) {
    window.matchMedia = (q) => ({ matches: false, media: q,
                                  addListener() {}, removeListener() {},
                                  addEventListener() {}, removeEventListener() {} });
}
try {
    window.Intl.DateTimeFormat.prototype.resolvedOptions = function () {
        return { timeZone: "Asia/Shanghai", locale: "zh-CN",
                 calendar: "gregory", numberingSystem: "latn" };
    };
} catch (e) { /* ignore */ }
try { Date.prototype.getTimezoneOffset = function () { return -480; }; } catch (e) {}

// DOM 侧字体探测：另一种常见做法是往 span 上套字体再读 offsetWidth。
// jsdom 不做布局，一律返回 0，同样会被判成「无字体」。
try {
    const proto = window.HTMLElement.prototype;
    Object.defineProperty(proto, "offsetWidth", {
        configurable: true,
        get() {
            const text = this.textContent || "";
            const font = (this.style && this.style.fontFamily) || "";
            return Math.round(text.length * fontWidthFactor(font)) || 0;
        },
    });
    Object.defineProperty(proto, "offsetHeight", {
        configurable: true,
        get() {
            const size = parseInt((this.style && this.style.fontSize) || "16", 10);
            return Math.round((size || 16) * 1.2);
        },
    });
} catch (e) { /* ignore */ }

// ---------- 指纹缓存种子 ----------
// 京东的风控 JS 把采集结果缓存在 localStorage 里，换 token 时一起打进 expandParams：
//   __we_m_gl__  WebGL（vendor / unmasked renderer）
//   __we_m_ft__  已安装字体列表
//   __we_m_cv__  canvas 指纹
// jsdom 现算出来的又薄又假，所以注入一份从真机导出的缓存，让库复用真实采集结果。
//
// ⚠️ **`WQ_dy1_vk` 是例外，绝对不能从种子里注入。** 它是「每个 appId 对应的 fp」，
// 也就是 cactus 记信誉分的**身份**。早先为了对齐把浏览器的 fp
// （`yzz5bivazpzzn227`）钉在种子里，等于和用户的浏览器共用一个身份 ——
// 我们这边密集打接口把这个 fp 的信誉打坏之后，**浏览器也跟着一起被降权**
// （实测浏览器自己新铸的 token 同样 403）。换成自己生成的新 fp 后，
// 待遇立刻从「裸 403（当机器人）」回到「200 + code:605（当浏览器，要验证）」。
// 不复用浏览器身份，避免脚本与浏览器共享风控信誉。
//
// 我们自己生成的 fp 由 token 缓存（`JD_TK_CACHE`）持久化，所以身份是稳定的，
// 不需要也不应该由种子提供。
//
// 同理，**所有「身份/风控态」类的键也一律不注入**。种子只该提供「这台机器长什么样」
// （WebGL / 字体 / canvas 这些设备能力），不该提供「我是谁、我之前干过什么」。
// 判据来自实测：用户在无痕窗口清空 jd cookie + 重新登录 + 过一次滑块，搜索立刻恢复
// —— 说明风控标记就绑在这套身份上。种子里钉着被标记的旧身份，等于一直背着它。
const IDENTITY_KEYS = new Set([
    "WQ_dy1_vk", "WQ_dy1_tk_algo",          // fp 与 token（cactus 记信誉分的身份）
    "3AB9D23F7A4B3C9B", "3AB9D23F7A4B3CSS",  // eid 设备号 / jsToken
    "PCA9D23F7A4B3CSS", "PCTSD23F7A4B3CSS", "CA1AN5BV0CA8DS2EPC",
    "shshshfpa", "shshshfpx", "shshshfpb",   // 风控指纹三兄弟
    "dra_union_device",                      // 监控侧设备号
    "JDst_rac_nfd", "JDst_rac_last_update",  // 风控任务态
    "JDst_behavior_flag", "JDst_behavior_report_flag",
    "WQ_dy1_gFlag", "WQ_dy1_vFlag", "WQ_dy1_pFlag",
    "AntiDebug_Breaker", "hf_time",
]);
try {
    const seedPath = require("path").join(__dirname, "fp_seed.json");
    const fs = require("fs");
    if (fs.existsSync(seedPath)) {
        const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
        for (const [k, v] of Object.entries(seed)) {
            if (IDENTITY_KEYS.has(k)) continue;
            try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ }
        }
    }
} catch (e) { /* 没有种子就退回现算 */ }

// ---------- token 落盘复用 ----------
// 服务端发的 token 自带 24h 有效期（`WQ_dy1_tk_algo` 里的 `e:86400`），
// 但 jsdom 的 localStorage 是纯内存的，进程一重启就没了，于是每次冷启动
// 都得再向 cactus 换一个新的。这有两个坏处：白费一次 cactus 请求；
// token 可能携带签发时刻的信誉分，
// 手里那个"干净期"换来的好 token 不该随进程退出一起丢掉。
// 所以把这个键持久化：启动时读回来，库写进去时同步刷盘。
const TK_KEYS = ["WQ_dy1_tk_algo", "WQ_dy1_vk"];
const tkCachePath = process.env.JD_TK_CACHE;
const tkProfile = process.env.JD_TK_PROFILE || "default";
if (tkCachePath) {
    const fs = require("fs");
    try {
        if (fs.existsSync(tkCachePath)) {
            const cached = JSON.parse(fs.readFileSync(tkCachePath, "utf-8"));
            const values = cached && cached.profile === tkProfile && cached.values;
            for (const key of TK_KEYS) {
                if (values && values[key]) window.localStorage.setItem(key, values[key]);
            }
        }
    } catch (e) { /* 缓存坏了就当没有 */ }

    // 注意：不能靠 hook `localStorage.setItem` 来落盘 —— 库是用属性赋值
    // （`localStorage[k] = v`）写的，走 jsdom Storage 的 Proxy，根本不经过 setItem。
    // 所以改成「读出来刷盘」，由 h5st5_server.js 在每次签名后调一次。
    let lastDump = "";
    globalThis.__jdFlushTokenCache = () => {
        try {
            const values = {};
            for (const key of TK_KEYS) {
                const v = window.localStorage.getItem(key);
                if (v) values[key] = v;
            }
            const dump = { profile: tkProfile, values };
            const text = JSON.stringify(dump);
            if (text === lastDump || Object.keys(values).length === 0) return;
            const tempPath = tkCachePath + ".tmp";
            fs.writeFileSync(tempPath, text);
            fs.renameSync(tempPath, tkCachePath);
            lastDump = text;
        } catch (e) { /* 写不了就算了，不影响签名 */ }
    };
}

// ---------- 环境画像对齐 ----------
// 库在换 token 前会把采集对象 JSON.stringify 后编码成 expandParams。我们的环境
// 代码先于库加载，所以这里 patch 到的就是库要用的那个 stringify，可以在编码前
// 把已知与真实浏览器不一致的字段校准过来。
//
// 目标值来自一次真实 Chrome 的实测（在真实搜索页里重新加载同一个库、patch
// stringify 截获采集对象，appId=f06cc）。几个要点：
//
// * bu1 是**故意抛一个 `Error: test err` 后读取的调用栈**，用来看
//   `document.querySelector` 被页面上哪些脚本 hook 过（真页面有 jdwebm.js、
//   js_security_v3_main.js、dra probe 等）。jsdom 里没有这些帧，产出空串——
//   这一项就占了约 1000 字符，正是 expandParams 体积对不上的主因。
// * bu2 是另一处调用栈，真浏览器里指向 js_security 自身。
// * extend.bu3/bu6 等是各项检测的计数结果，jsdom 下与真机不同。
const REAL_STACK_BU1 = [
    "Error: test err",
    "    at HTMLDocument._$Pi (https://storage.360buyimg.com/webcontainer/js_security_v3_0.1.6.js?v=2024-06-20-17:5:9219)",
    "    at document.querySelector (https://storage.360buyimg.com/jsresource/ws_js/jdwebm.js?v=pcSearch:1:68279)",
    "    at HTMLDocument.querySelector (https://storage.360buyimg.com/webcontainer/main/js_security_v3_main.js?v=20260816:5:8919)",
    "    at https://storage.360buyimg.com/dev-static/dra/probe-web/1.2.3/browser.js:1:114252",
    "    at f (https://storage.360buyimg.com/dev-static/dra/probe-web/1.2.3/browser.js:1:60440)",
    "    at Generator.<anonymous> (https://storage.360buyimg.com/dev-static/dra/probe-web/1.2.3/browser.js:1:61762)",
    "    at Generator.next (https://storage.360buyimg.com/dev-static/dra/probe-web/1.2.3/browser.js:1:60848)",
    "    at fE (https://storage.360buyimg.com/dev-static/dra/probe-web/1.2.3/browser.js:1:66308)",
    "    at a (https://storage.360buyimg.com/dev-static/dra/probe-web/1.2.3/browser.js:1:66502)",
    "    at https://storage.360buyimg.com/dev-static/dra/probe-web/1.2.3/browser.js:1:66563",
].join("\n");

const REAL_STACK_BU2 =
    "    at https://storage.360buyimg.com/webcontainer/js_security_v3_0.1.6.js"
    + "?v=2024-06-20-17:5:71875";

const ENV_PROFILE = {
    wk: 0,
    bu1: REAL_STACK_BU1,
    bu2: REAL_STACK_BU2,
    ccn: 20,
    extend: {
        wk: 0, l: 0, ls: 5, wd: 0,
        bu3: 105, bu4: 0, bu5: 0, bu6: 21, bu7: 0, bu8: 0,
        bu10: 14, bu11: 4, bu12: -8,
    },
};

function alignEnv(env) {
    try {
        for (const [k, v] of Object.entries(ENV_PROFILE)) {
            if (k === "extend") continue;
            env[k] = v;
        }
        if (env.extend && typeof env.extend === "object") {
            Object.assign(env.extend, ENV_PROFILE.extend);
        }
        // 真浏览器里这两个 canvas 指纹是同一个值：canvas 取自缓存、canvas1 现算，
        // 二者不一致同样是破绽。
        if (env.canvas) env.canvas1 = env.canvas;
    } catch (e) { /* ignore */ }
    return env;
}

// ---------- 签名串环境对齐（h5st 第 7 段）----------
// 这里有个容易踩的坑：库有**两个**环境采集对象，字段名重叠但语义不同。
//   1. 换 token 时 POST 给 cactus 的 expandParams —— 有 `ai`（appId），30 余项，
//      `extend.bu3` 是个上百的计数。
//   2. 每次签名时编码进 h5st 第 7 段的采集对象 —— 没有 `ai`，只 20 余项，
//      `extend.bu3` 是 0/1 的布尔位。
// 之前只校准了 ①，②一直是 jsdom 的原样输出，而边缘层校验的恰好是 ②
// （实测：把浏览器可用签名的第 7/8 段换成我们的，立刻 403）。
//
// 参照值取自真实 Chrome：在**真实搜索页里重新注入同一个库**（先 patch 页面的
// JSON.stringify 再注入），这样库既用我们的 stringify、又能看到完整页面环境。
// 早先在 about:blank iframe 里抓的参照是错的——那里没有页面的风控脚本，
// bu3/bu6 会退化成 1/-1，照它对齐反而对不上现网。
//
// 下列字段是逐项对齐网页环境后保留的必要采集项：
//
//   wk    64   → 0     ★校验。检测位掩码，非 0 = 发现运行环境被篡改
//   bu4   1    → 0     ★校验。同类检测位
//   bu8   1    → 0     ★校验。同类检测位
//   bu3   1    → 105   ★校验，但**不校验具体值**：7 / 43 / 105 都通，
//                       只有 jsdom 的 1 不通。它是页面上被 hook 的函数计数
//   ls    -1   → 5      不校验。我们确实声明了 5 个语言，纠正它只是让画像自洽
//   bu6   -1           不校验，且各站不同（search=22 / www=29）→ **不写死**
//   bu13  "Fd"         不校验，取自各 origin 自己的 localStorage → **不写死**
//
// 所以只按需校准，不去复刻某个站点的完整画像 —— 站点相关的值会随京东前端
// 发版漂移，写死等于给自己埋雷。
//
// 注意：这个对象**没有**顶层 wk，只有 extend.wk。多加一个键会改变 JSON 形状，
// 第 7 段跟着变长，照样过不了校验。
const SIGN_ENV_EXTEND = {
    wk: 0, l: 0, wd: 0, ls: 5,
    bu3: 105, bu4: 0, bu6: 22, bu8: 0,
    bu13: "M1,Fd",
};

// `JD_SIGN_ENV_OVERRIDE` 收一段 JSON，覆盖 extend 里的任意项，用来试新画像。
function alignSignEnv(env) {
    if (process.env.JD_NO_ALIGN) return env;
    try {
        if (env.extend && typeof env.extend === "object") {
            Object.assign(env.extend, SIGN_ENV_EXTEND);
            if (process.env.JD_SIGN_ENV_OVERRIDE) {
                Object.assign(env.extend,
                              JSON.parse(process.env.JD_SIGN_ENV_OVERRIDE));
            }
        }
    } catch (e) { /* ignore */ }
    return env;
}

{
    const origStringify = JSON.stringify;
    const debugPath = process.env.JD_DEBUG_ENV;
    const dump = (suffix, o) => {
        if (!debugPath) return;
        try {
            require("fs").writeFileSync(debugPath + suffix, origStringify(o, null, 1));
        } catch (e) { /* ignore */ }
    };
    JSON.stringify = function (o, ...rest) {
        try {
            if (o && typeof o === "object" && "fp" in o && "extend" in o) {
                if ("ai" in o) {
                    dump(".cactus.json", alignEnv(o));
                } else {
                    dump(".sign.json", alignSignEnv(o));
                }
            }
        } catch (e) { /* ignore */ }
        return origStringify.apply(this, [o, ...rest]);
    };
}

// ---------- 反自动化检测点 ----------
// 实测采集对象里有两项直接暴露了运行环境：
//   bu2 = 某个 Error 的调用栈 → jsdom 下会漏出 "at listOnTimeout (node:internal/timers…)"
//   bu3 = Window.toString()   → jsdom 会漏出 "function Window() { throw new TypeError… }"
// 真浏览器分别是浏览器帧和 "function Window() { [native code] }"。
try {
    const nativeWindow = "function Window() { [native code] }";
    window.Window.toString = () => nativeWindow;
    Object.defineProperty(window.Window, "toString", {
        value: () => nativeWindow, writable: true, configurable: true,
    });
} catch (e) { /* ignore */ }

// 让所有 Error 栈看起来像浏览器里的栈
try {
    Error.prepareStackTrace = function (err, frames) {
        const head = `${err.name}: ${err.message}`;
        const lines = frames.slice(0, 6).map((f, i) => {
            const fn = f.getFunctionName();
            const loc = `${PAGE_URL}:${100 + i * 7}:${10 + i * 3}`;
            return fn ? `    at ${fn} (${loc})` : `    at ${loc}`;
        });
        return [head].concat(lines).join("\n");
    };
} catch (e) { /* ignore */ }

// 原生函数的 toString 不该暴露实现体；patch 本身也要自我隐藏，
// 否则 bu3 会漏出这段补丁的源码（bu3 = Window.toString() + "$" +
// Function.prototype.toString.toString()）。
try {
    const origFnToString = Function.prototype.toString;
    const NATIVE = new WeakSet();
    function toString() {
        if (NATIVE.has(this)) {
            return `function ${this.name || ""}() { [native code] }`;
        }
        return origFnToString.call(this);
    }
    NATIVE.add(toString);
    NATIVE.add(origFnToString);
    for (const fn of [window.HTMLCanvasElement.prototype.getContext,
                      window.HTMLCanvasElement.prototype.toDataURL,
                      window.navigator.permissions && window.navigator.permissions.query,
                      window.matchMedia]) {
        if (typeof fn === "function") NATIVE.add(fn);
    }
    Function.prototype.toString = toString;
} catch (e) { /* ignore */ }

// ---------- 干净 iframe 探针 ----------
// 库会 appendChild 一个 iframe，然后从 contentWindow 里取「未被 hook 的原生实现」
// 与主 window 的对比 —— 这是很常见的反 hook 手法。jsdom 的 iframe 是另一个
// 独立 realm，上面所有补丁都不在，于是逐项露馅：
//   contentWindow.navigator.languages  ["en-US","en"]（主窗口是 zh-CN,…）
//   contentWindow.Window.toString()    jsdom 的 throw new TypeError 桩
//   contentWindow.HTMLCanvasElement.prototype.getContext  jsdom 源码
// 结果就是采集对象里 wk（检测位掩码）非 0、bu4/bu6/bu8 被置成「已检测到篡改」。
// 让 contentWindow / contentDocument 直接指回主窗口，探针取到的就和主窗口一致，
// 对比自然相等。
try {
    const iframeProto = window.HTMLIFrameElement.prototype;
    Object.defineProperty(iframeProto, "contentWindow", {
        configurable: true, get() { return window; },
    });
    Object.defineProperty(iframeProto, "contentDocument", {
        configurable: true, get() { return window.document; },
    });
} catch (e) { /* ignore */ }

// document.cookie：采集项 pp 会从 cookie 里读登录 pin（浏览器是 {"p2":"<pin>"}）。
// 只把 cookie 给 XHR 是不够的，jsdom 的 document.cookie 仍然是空的，pp 就成了 {}。
// 注意要放在 JD_COOKIE 声明之后。
indexedDB = window.indexedDB || {};
console.log = () => {};
console.warn = () => {};
console.error = () => {};

// ---------- 真网 XHR ----------
// h5st 5.3 的签名 token 不是本地算的：库会 POST cactus.jd.com/request_algo，
// 服务端回一个 tk 和一段 algo 函数（内含随机盐 rd），签名 = SHA256(tk+fp+ts+appId+rd)。
// jsdom 自带的 XHR 到不了真网，库就会退回本地兜底 token，而兜底 token 服务端不认
// （PC 商品/搜索直接 403）。所以这里用 node https 实现一个能带 JD cookie 的 XHR。
const https = require("https");
const { URL } = require("url");

const JD_COOKIE = process.env.JD_COOKIE || "";

// 采集项 pp 会从 cookie 里读登录 pin（浏览器是 {"p2":"<pin>"}）。只把 cookie 给
// XHR 不够——jsdom 的 document.cookie 仍是空的，pp 就成了 {}，环境一看就是假的。
try {
    for (const pair of JD_COOKIE.split(";")) {
        const item = pair.trim();
        if (!item || item.indexOf("=") === -1) continue;
        try { window.document.cookie = item + "; path=/"; } catch (e) { /* skip */ }
    }
} catch (e) { /* ignore */ }
const JD_ORIGIN = process.env.JD_ORIGIN || "https://search.jd.com";
const JD_REFERER = process.env.JD_REFERER || "https://search.jd.com/";

class NodeXHR {
    constructor() {
        this.readyState = 0;
        this.status = 0;
        this.responseText = "";
        this.response = "";
        this.timeout = 0;
        this.withCredentials = false;
        this._headers = {};
        this._respHeaders = "";
    }
    open(method, url) {
        this._method = (method || "GET").toUpperCase();
        this._url = url;
        this.readyState = 1;
    }
    setRequestHeader(k, v) { this._headers[k] = v; }
    getAllResponseHeaders() { return this._respHeaders; }
    getResponseHeader(k) {
        const m = new RegExp("^" + k + ": (.*)$", "im").exec(this._respHeaders);
        return m ? m[1] : null;
    }
    abort() {}
    _done() {
        this.readyState = 4;
        if (this.onreadystatechange) this.onreadystatechange();
        if (this.onload) this.onload();
    }
    send(data) {
        let u;
        try { u = new URL(this._url, JD_ORIGIN); } catch (e) { this.status = 0; this._done(); return; }
        const headers = Object.assign({
            // 换 token 那一发请求本身也会被打量，头要和浏览器一致。
            // 注意 Accept-Encoding 用 identity：这里不打算再实现一遍解压。
            "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "User-Agent": window.navigator.userAgent,
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6",
            "Origin": JD_ORIGIN,
            "Referer": JD_REFERER,
            "priority": "u=1, i",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
        }, this._headers);
        if (JD_COOKIE) headers["Cookie"] = JD_COOKIE;
        if (data && !headers["Content-Type"] && !headers["content-type"]) {
            headers["Content-Type"] = "application/json";
        }
        const req = https.request({
            method: this._method,
            hostname: u.hostname,
            path: u.pathname + u.search,
            headers,
        }, (res) => {
            const chunks = [];
            res.on("data", (d) => chunks.push(d));
            res.on("end", () => {
                this.status = res.statusCode;
                this.responseText = Buffer.concat(chunks).toString("utf8");
                this.response = this.responseText;
                this._respHeaders = Object.entries(res.headers)
                    .map(([k, v]) => `${k}: ${v}`).join("\r\n");
                if (process.env.JD_DEBUG) {
                    require("fs").appendFileSync(process.env.JD_DEBUG,
                        JSON.stringify({
                            url: String(u), status: this.status,
                            reqBody: data ? String(data) : null,
                            resp: this.responseText.slice(0, 1500),
                        }) + "\n");
                }
                this._done();
            });
        });
        req.on("error", () => {
            this.status = 0;
            if (this.onerror) this.onerror();
            this._done();
        });
        if (data) req.write(data);
        req.end();
    }
}

window.XMLHttpRequest = NodeXHR;
globalThis.XMLHttpRequest = NodeXHR;
