const env = require('./env_core');
const _require = require;
const _process = process;
const _Buffer = Buffer;
const _Array = Array;
const _fs = require('fs');
const _path = require('path');
const _childProcess = require('child_process');
const _vm = require('vm');
const _nativeFetch = global.fetch && global.fetch.bind(global);
const TRANSPORT_BRIDGE = _path.resolve(__dirname, 'http_bridge.py');
let runtimeInput = {};
try {
    const stdin = _require('fs').readFileSync(0, 'utf8').trim();
    if (stdin) runtimeInput = JSON.parse(stdin);
} catch (error) {
    console.error('[input-error]', error && error.message || error);
}
const LIVE_NETWORK = runtimeInput.liveNetwork === true;
const MAX_SOLVE_ATTEMPTS = Math.max(1, Math.min(30,
    Number(runtimeInput.maxSolveAttempts || 8)));
const runtimeState = {
    latestFp: null,
    latestCheck: null,
    latestChallenge: null,
    lastSolvedChallenge: null,
    solving: false,
    solveAttempts: 0,
    completed: false,
    resultEmitted: false,
    bridgeCookies: Object.create(null),
    cookieUpdates: Object.create(null),
};

function emitResult(payload) {
    if (!runtimeInput.returnResult || runtimeState.resultEmitted) return;
    runtimeState.resultEmitted = true;
    console.log('__JCAP_RESULT__' + JSON.stringify({
        ...payload,
        cookies: runtimeState.cookieUpdates,
        localStorage: snapshotLocalStorage(),
    }));
}
const projectRoot = _path.resolve(__dirname, '..', '..', '..');
const repoRequire = _require('module').createRequire(
    _path.join(projectRoot, 'package.json'));
const { JSDOM } = repoRequire('jsdom');
const { createCanvas: createNativeCanvas } = repoRequire('@napi-rs/canvas');

const PAGE_URL = String(runtimeInput.pageUrl ||
    'https://passport.jd.com/new/login.aspx?ReturnUrl=https://home.jd.com/index.html');
const PAGE_ORIGIN = new URL(PAGE_URL).origin;
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: PAGE_URL,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
});
const rawWindow = dom.window;
const rawNavigator = rawWindow.navigator;
const rawDocument = rawWindow.document;
const rawLocation = rawWindow.location;
const rawLocalStorage = rawWindow.localStorage;
const rawPerformance = rawWindow.performance;

for (const [key, value] of Object.entries(runtimeInput.localStorage || {})) {
    try { rawLocalStorage.setItem(String(key), String(value)); } catch (_) {}
}

function snapshotLocalStorage() {
    const snapshot = Object.create(null);
    for (let index = 0; index < rawLocalStorage.length; index++) {
        const key = rawLocalStorage.key(index);
        if (key == null) continue;
        snapshot[String(key)] = String(rawLocalStorage.getItem(key) || '');
    }
    return snapshot;
}

// The official loader executes this bundle from the 2.8.5 CDN URL.  JCAP
// includes document.currentScript.src in both its device fingerprint (`dcs`)
// and the WASM base-path calculation.  JSDOM leaves currentScript null when a
// bundle is evaluated from a local file, which is observably different from
// the production page.
const JCAP_SCRIPT_URL =
    'https://storage.360buyimg.com/jsresource/jcap/version/v2.8.5/1/jcap_ujb96b.js';

// JCAP records Error.stack and encrypts the resulting file table into `cs`.
// Programmatic DOM events otherwise append run.js/jsdom/node frames that can
// never occur for a physical browser event. Keep the vendor's own frames and
// format them exactly like a normal V8 stack before the official code parses
// them; the vendor source itself remains byte-for-byte unchanged.
const prepareJcapStack = env.setFuncNative(function prepareStackTrace(error, frames) {
    const kept = Array.isArray(frames) ? frames.filter(frame => {
        try {
            const source = String(frame.getFileName()
                || frame.getScriptNameOrSourceURL() || '');
            return source.split('?', 1)[0] === JCAP_SCRIPT_URL;
        } catch (_) {
            return false;
        }
    }) : [];
    const name = String(error && error.name || 'Error');
    const message = String(error && error.message || '');
    const first = message ? `${name}: ${message}` : name;
    return [first, ...kept.map(frame => `    at ${String(frame)}`)].join('\n');
}, 'prepareStackTrace', 2);
try {
    Object.defineProperty(Error, 'prepareStackTrace', {
        configurable: true,
        writable: true,
        enumerable: false,
        value: prepareJcapStack,
    });
} catch (_) {}
const runtimeScript = rawDocument.createElement('script');
runtimeScript.src = JCAP_SCRIPT_URL;
try {
    Object.defineProperty(rawDocument, 'currentScript', {
        configurable: true,
        get() { return runtimeScript; },
    });
} catch (_) {}

function defineRuntimeValue(target, name, value) {
    try {
        Object.defineProperty(target, name, {
            value, configurable: true, enumerable: true,
        });
    } catch (_) {}
}

// 与已保存的完整请求样本保持同一台 Windows/Chrome 设备画像。JSDOM 的
// screen 默认为 0x0，navigator 也缺少反爬脚本会读取的硬件字段。
const runtimeUserAgent = String(runtimeInput.userAgent ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
for (const [name, value] of Object.entries({
    width: 2560, height: 1440, availWidth: 2560, availHeight: 1392,
    colorDepth: 24, pixelDepth: 24,
})) defineRuntimeValue(rawWindow.screen, name, value);
for (const [name, value] of Object.entries({
    innerWidth: 2560, innerHeight: 1297, outerWidth: 2560, outerHeight: 1392,
    screenX: 0, screenY: 0, screenLeft: 0, screenTop: 0, devicePixelRatio: 1,
})) defineRuntimeValue(rawWindow, name, value);
for (const [name, value] of Object.entries({
    userAgent: runtimeUserAgent, appVersion: runtimeUserAgent.replace(/^Mozilla\//, ''),
    platform: 'Win32', vendor: 'Google Inc.', language: 'zh-CN',
    languages: Object.freeze(['zh-CN', 'zh', 'en', 'zh-TW', 'ja']),
    hardwareConcurrency: 32, deviceMemory: 8, maxTouchPoints: 0,
    webdriver: false,
})) defineRuntimeValue(rawNavigator, name, value);
const runtimeConnection = Object.freeze({
    effectiveType: '4g', downlink: 10, rtt: 50, saveData: false,
    type: 'wifi', bandwidth: 10,
});
defineRuntimeValue(rawNavigator, 'connection', runtimeConnection);
defineRuntimeValue(rawNavigator, 'mozConnection', runtimeConnection);
defineRuntimeValue(rawNavigator, 'webkitConnection', runtimeConnection);
defineRuntimeValue(rawNavigator, 'pdfViewerEnabled', true);
defineRuntimeValue(rawNavigator, 'userActivation', Object.freeze({
    hasBeenActive: false, isActive: false,
}));
// Keep the nested set-like object configurable.  Freezing it violates the
// recursive Proxy invariant (the proxy must then return the exact object),
// which made JCAP's guarded WebGPU probe throw and silently emit gpu="".
defineRuntimeValue(rawNavigator, 'gpu', {
    wgslLanguageFeatures: { size: 12 },
});
defineRuntimeValue(rawWindow, 'chrome', Object.freeze({ runtime: Object.freeze({}) }));
Object.defineProperty(rawWindow, 'navigator', {
    value: rawNavigator, enumerable: true, configurable: true,
});

// JCAP probes installed fonts by comparing span.offsetWidth/offsetHeight for
// `candidate,generic` against the three generic families. JSDOM reports zero
// for every span, which produces an impossible Windows fingerprint (`fts` is
// empty). Return deterministic metrics for the common fonts represented by
// the same profile used by the rest of this runtime.
const runtimeFonts = new Set([
    'Arial', 'Arial Black', 'Book Antiqua', 'Calibri', 'Cambria', 'Century',
    'Century Gothic', 'Comic Sans MS', 'Consolas', 'Courier', 'Courier New',
    'Georgia', 'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif',
    'Microsoft YaHei', 'MS Gothic', 'Segoe UI', 'SimSun', 'Tahoma',
    'Times New Roman', 'Trebuchet MS', 'Verdana',
]);
function runtimeFontMetric(node, dimension) {
    const family = String(node && node.style && node.style.fontFamily || '');
    const names = family.split(',').map(value => value.trim().replace(/^['"]|['"]$/g, ''));
    const fallback = names[names.length - 1].toLowerCase();
    const base = fallback.includes('monospace') ? 128
        : fallback.includes('serif') && !fallback.includes('sans') ? 124 : 126;
    const candidate = names[0] || '';
    const installed = names.length > 1 && runtimeFonts.has(candidate);
    if (dimension === 'height') return installed ? 21 + (candidate.length % 2) : 20;
    return installed ? base + 3 + (candidate.length % 11) : base;
}
for (const [name, dimension] of [['offsetWidth', 'width'], ['offsetHeight', 'height']]) {
    try {
        Object.defineProperty(rawWindow.HTMLElement.prototype, name, {
            configurable: true,
            get() { return runtimeFontMetric(this, dimension); },
        });
    } catch (_) {}
}

// 首轮只补已由成功 Chrome 样本确认的基础对象；网络先拦截，不实际发送。
function canvasDimension(node, name, fallback) {
    const value = Number(node && node[name]);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function ensureNative2d(node, state) {
    const width = canvasDimension(node, 'width', 300);
    const height = canvasDimension(node, 'height', 150);
    if (!state.canvas || state.canvas.width !== width || state.canvas.height !== height) {
        state.canvas = createNativeCanvas(width, height);
        state.context = state.canvas.getContext('2d');
        for (const [name, value] of Object.entries(state.properties)) {
            try { state.context[name] = value; } catch (_) {}
        }
    }
    return state.context;
}

function makeCanvas2dContext(node) {
    const state = { canvas: null, context: null, properties: Object.create(null) };
    node.__jcapNative2d = state;
    return new Proxy({}, {
        get(_target, name) {
            if (name === 'canvas') return node;
            const context = ensureNative2d(node, state);
            const value = context[name];
            return typeof value === 'function' ? value.bind(context) : value;
        },
        set(_target, name, value) {
            state.properties[name] = value;
            try { ensureNative2d(node, state)[name] = value; } catch (_) {}
            return true;
        },
    });
}

function FakeWebGLRenderingContext(canvas) {
    this.canvas = canvas;
    this.ARRAY_BUFFER = 34962;
    this.STATIC_DRAW = 35044;
    this.FLOAT = 5126;
    this.TRIANGLE_STRIP = 5;
    this.VERTEX_SHADER = 35633;
    this.FRAGMENT_SHADER = 35632;
}
for (const [name, implementation] of Object.entries({
    createBuffer() { return {}; },
    bindBuffer() {},
    bufferData(_target, data) {
        const values = [];
        const length = data && Number(data.length) || 0;
        // env_core wraps objects crossing the synthetic window boundary.
        // Iterating a Proxy-wrapped TypedArray calls its native iterator with
        // the wrong receiver, so copy through indexed access instead.
        for (let index = 0; index < length; index++) values.push(Number(data[index]));
        this.__vertices = values;
    },
    createProgram() { return {}; },
    createShader() { return {}; },
    shaderSource() {},
    compileShader() {},
    attachShader() {},
    linkProgram() {},
    getAttribLocation() { return 0; },
    getUniformLocation() { return {}; },
    useProgram() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    uniform2f() {},
    drawArrays() {},
    getExtension(name) {
        if (name === 'WEBGL_debug_renderer_info') {
            return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
        }
        if (name === 'WEBGL_lose_context') return { loseContext() {} };
        return null;
    },
    getParameter(parameter) {
        if (parameter === 37445) return 'Google Inc. (NVIDIA)';
        if (parameter === 37446) {
            return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) ' +
                'Direct3D11 vs_5_0 ps_5_0, D3D11)';
        }
        return null;
    },
})) {
    FakeWebGLRenderingContext.prototype[name] = env.setFuncNative(
        implementation, name, implementation.length);
}
defineRuntimeValue(rawWindow, 'WebGLRenderingContext', FakeWebGLRenderingContext);

function webGlDataUrl(node) {
    const width = canvasDimension(node, 'width', 300);
    const height = canvasDimension(node, 'height', 150);
    const canvas = createNativeCanvas(width, height);
    const context = canvas.getContext('2d');
    const vertices = node.__jcapWebGL && node.__jcapWebGL.__vertices;
    const values = Array.isArray(vertices) && vertices.length >= 9
        ? vertices : [-.2, -.9, 0, .4, -.26, 0, 0, .732134444, 0];
    const point = index => [
        (values[index] + 1) * width / 2,
        (1 - values[index + 1]) * height / 2,
    ];
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, 'rgba(204, 242, 0, 1)');
    gradient.addColorStop(1, 'rgba(255, 255, 0, 1)');
    context.fillStyle = gradient;
    for (const triangle of [[0, 3, 6], [3, 6, 9]]) {
        if (triangle[2] + 1 >= values.length) continue;
        context.beginPath();
        const first = point(triangle[0]);
        context.moveTo(first[0], first[1]);
        for (const index of triangle.slice(1)) {
            const next = point(index);
            context.lineTo(next[0], next[1]);
        }
        context.closePath();
        context.fill();
    }
    return canvas.toDataURL('image/png');
}
rawWindow.HTMLCanvasElement.prototype.getContext = env.setFuncNative(
    function getContext(kind) {
        if (kind === '2d') {
            this.__jcapContextKind = '2d';
            if (!this.__jcapContext2d) this.__jcapContext2d = makeCanvas2dContext(this);
            return this.__jcapContext2d;
        }
        if (kind === 'webgl' || kind === 'experimental-webgl') {
            this.__jcapContextKind = 'webgl';
            if (!this.__jcapWebGL) this.__jcapWebGL = new FakeWebGLRenderingContext(this);
            return this.__jcapWebGL;
        }
        return null;
    },
    'getContext', 1);
rawWindow.HTMLCanvasElement.prototype.toDataURL = env.setFuncNative(
    function toDataURL() {
        if (this.__jcapContextKind === 'webgl') return webGlDataUrl(this);
        if (!this.__jcapNative2d) this.__jcapContext2d = makeCanvas2dContext(this);
        ensureNative2d(this, this.__jcapNative2d);
        return this.__jcapNative2d.canvas.toDataURL('image/png');
    }, 'toDataURL', 0);
rawWindow.fetch = env.setFuncNative(async function fetch(url, options) {
    console.log('[capture.fetch]', String(url), options && options.method || 'GET');
    throw new Error('capture-only');
}, 'fetch', 1);
rawWindow.Buffer = _Buffer;

const CaptureXHR = env.setFuncNative(function XMLHttpRequest() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.response = '';
    this.withCredentials = false;
    this.headers = {};
    this.listeners = {};
}, 'XMLHttpRequest', 0);

function bridgeFetch(target, request) {
    const cookieMap = Object.create(null);
    for (const item of String(request.headers && request.headers.cookie || '').split(';')) {
        const separator = item.indexOf('=');
        if (separator <= 0) continue;
        cookieMap[item.slice(0, separator).trim()] = item.slice(separator + 1).trim();
    }
    Object.assign(cookieMap, runtimeState.bridgeCookies);
    request.headers.cookie = Object.entries(cookieMap)
        .map(([name, value]) => `${name}=${value}`).join('; ');
    try {
        const parsed = new URL(target);
        const transportPrefix = parsed.pathname.endsWith('/cgi-bin/api/check')
            ? '[captcha.transport.check]' : '[captcha.transport]';
        console.log(transportPrefix, JSON.stringify({
            method: String(request.method || 'GET').toUpperCase(),
            host: parsed.host,
            path: parsed.pathname,
            headerNames: Object.keys(request.headers || {})
                .map(name => String(name).toLowerCase()).sort(),
            cookieNames: Object.keys(cookieMap).sort(),
            bodyLength: request.body == null ? 0 : String(request.body).length,
        }));
    } catch (_) {}
    const result = _childProcess.spawnSync(
        String(runtimeInput.pythonExecutable || 'python'), [TRANSPORT_BRIDGE], {
            input: JSON.stringify({
                method: request.method || 'GET',
                url: target,
                headers: request.headers || {},
                body: request.body == null ? '' : String(request.body),
            }),
            encoding: 'utf8',
            timeout: 25000,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
        });
    if (result.error || result.status !== 0) {
        const error = new Error('JCAP transport bridge failed');
        error.cause = { code: result.error && result.error.code || result.status };
        throw error;
    }
    const payload = JSON.parse(String(result.stdout || ''));
    const receivedCookieNames = [];
    for (const setCookie of Array.isArray(payload.setCookies) ? payload.setCookies : []) {
        const pair = String(setCookie || '').split(';', 1)[0];
        const separator = pair.indexOf('=');
        if (separator <= 0) continue;
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
            runtimeState.cookieUpdates[name] = value;
            if (value) runtimeState.bridgeCookies[name] = value;
            else delete runtimeState.bridgeCookies[name];
            receivedCookieNames.push(name);
        }
    }
    try {
        const path = new URL(target).pathname;
        if (path.includes('/cgi-bin/api/')) {
            console.log('[captcha.cookies]', JSON.stringify({
                path, received: receivedCookieNames.sort(),
                jar: Object.keys(runtimeState.bridgeCookies).sort(),
            }));
        }
    } catch (_) {}
    const responseHeaders = Array.isArray(payload.headers) ? payload.headers : [];
    return {
        status: Number(payload.status || 0),
        statusText: String(payload.statusText || ''),
        url: String(payload.url || target),
        headers: { entries: () => responseHeaders[Symbol.iterator]() },
        text: async () => String(payload.body || ''),
    };
}
CaptureXHR.prototype.open = env.setFuncNative(function open(method, url) {
    this.method = String(method);
    this.url = String(url);
    this.readyState = 1;
}, 'open', 2);
CaptureXHR.prototype.setRequestHeader = env.setFuncNative(
    function setRequestHeader(name, value) { this.headers[String(name)] = String(value); },
    'setRequestHeader', 2);
CaptureXHR.prototype.addEventListener = env.setFuncNative(
    function addEventListener(name, callback) { this.listeners[name] = callback; },
    'addEventListener', 2);
CaptureXHR.prototype.send = env.setFuncNative(function send(body) {
    const text = body == null ? '' : String(body);
    const fields = {};
    try {
        const params = new URLSearchParams(text);
        for (const key of new Set(params.keys())) {
            fields[key] = String(params.get(key) || '').length;
        }
    } catch (_) {}
    let safeUrl = this.url;
    try {
        const parsed = new URL(this.url, PAGE_URL);
        for (const key of ['sid', 'si', 'ct', 'vt', 'token']) {
            if (parsed.searchParams.has(key)) {
                const value = parsed.searchParams.get(key) || '';
                parsed.searchParams.set(key, `<len:${value.length}>`);
            }
        }
        safeUrl = parsed.toString();
    } catch (_) {}
    console.log('[capture.xhr]', JSON.stringify({
        method: this.method, url: safeUrl, headers: this.headers,
        bodyLength: text.length, fields,
    }));
    try {
        const requestPath = new URL(this.url, PAGE_URL).pathname;
        if (requestPath.endsWith('/cgi-bin/api/check')) {
            console.log('[captcha.request]', JSON.stringify({
                method: this.method, path: requestPath,
                bodyLength: text.length, fields,
                headerNames: Object.keys(this.headers).map(name => name.toLowerCase()),
            }));
        }
    } catch (_) {}
    if (LIVE_NETWORK && (_nativeFetch || runtimeInput.pythonExecutable)) {
        const target = new URL(this.url, PAGE_URL).toString();
        const headers = Object.assign({
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'accept-encoding': 'gzip, deflate, br, zstd',
            origin: PAGE_ORIGIN,
            priority: 'u=1, i',
            referer: PAGE_URL,
            'sec-ch-ua': String(runtimeInput.secChUa ||
                '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"'),
            'sec-ch-ua-mobile': String(runtimeInput.secChUaMobile || '?0'),
            'sec-ch-ua-platform': String(runtimeInput.secChUaPlatform || '"Windows"'),
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': String(rawNavigator.userAgent || ''),
        }, this.headers);
        if (runtimeInput.cookie) headers.cookie = String(runtimeInput.cookie);
        let pending;
        try {
            const request = {
                method: this.method || 'GET', headers,
                body: String(this.method || 'GET').toUpperCase() === 'GET' ? undefined : text,
                redirect: 'follow',
            };
            pending = runtimeInput.pythonExecutable
                ? Promise.resolve().then(() => bridgeFetch(target, request))
                : _nativeFetch(target, request);
        } catch (error) {
            console.error('[capture.network-sync-error]', {
                message: error && error.message,
                cause: error && error.cause && error.cause.code,
            });
            if (typeof this.onerror === 'function') this.onerror(error);
            if (typeof this.listeners.error === 'function') this.listeners.error(error);
            return;
        }
        pending.then(async response => {
            this.status = response.status;
            this.statusText = response.statusText;
            this.responseURL = response.url;
            this.responseText = await response.text();
            this.response = this.responseText;
            try {
                const parsedBody = JSON.parse(this.responseText);
                const path = new URL(target).pathname;
                if (path.endsWith('/cgi-bin/api/fp')) runtimeState.latestFp = parsedBody;
                if (path.endsWith('/cgi-bin/api/check')) {
                    runtimeState.latestCheck = parsedBody;
                    console.log('[captcha.check]', JSON.stringify({
                        code: parsedBody && parsedBody.code,
                        sCode: parsedBody && parsedBody.s_code,
                        tp: parsedBody && parsedBody.tp,
                        type: parsedBody && parsedBody.type,
                        message: String(parsedBody && parsedBody.msg || '').slice(0, 80),
                        stLength: String(parsedBody && parsedBody.st || '').length,
                        hasVt: Boolean(parsedBody && parsedBody.vt),
                        fields: parsedBody && typeof parsedBody === 'object'
                            ? Object.keys(parsedBody).sort() : [],
                    }));
                    if (!(parsedBody && parsedBody.vt)
                            && runtimeState.solveAttempts >= MAX_SOLVE_ATTEMPTS) {
                        setTimeout(() => {
                            reportEnvironment();
                            emitResult({ ok: false, error: 'attempts_exhausted' });
                            if (runtimeInput.returnResult) _process.exit(0);
                        }, 250);
                    }
                }
                if ((path.endsWith('/cgi-bin/api/check') || path.endsWith('/cgi-bin/api/refresh'))
                        && parsedBody && parsedBody.img && Number.isFinite(Number(parsedBody.tp))) {
                    runtimeState.latestChallenge = parsedBody;
                    const solveDelay = path.endsWith('/cgi-bin/api/refresh') ? 2200 : 350;
                    setTimeout(() => autoSolveChallenge().catch(error =>
                        console.error('[captcha.solve-error]', error && error.stack || error)), solveDelay);
                }
            } catch (_) {}
            this._responseHeaders = Array.from(response.headers.entries());
            this.readyState = 4;
            if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
            if (typeof this.onload === 'function') this.onload();
            if (typeof this.listeners.load === 'function') this.listeners.load();
        }).catch(error => {
            console.error('[capture.network-error]', {
                message: error && error.message,
                cause: error && error.cause && error.cause.code,
            });
            if (typeof this.onerror === 'function') this.onerror(error);
            if (typeof this.listeners.error === 'function') this.listeners.error(error);
        });
        return;
    }
    setTimeout(() => {
        this.readyState = 4;
        if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
        if (typeof this.onerror === 'function') this.onerror(new Error('capture-only'));
        if (typeof this.listeners.error === 'function') this.listeners.error();
    }, 0);
}, 'send', 1);
CaptureXHR.prototype.abort = env.setFuncNative(function abort() {}, 'abort', 0);
CaptureXHR.prototype.getAllResponseHeaders = env.setFuncNative(function getAllResponseHeaders() {
    return (this._responseHeaders || []).map(([key, value]) => `${key}: ${value}`).join('\r\n');
}, 'getAllResponseHeaders', 0);
CaptureXHR.prototype.getResponseHeader = env.setFuncNative(function getResponseHeader(name) {
    const lower = String(name).toLowerCase();
    const pair = (this._responseHeaders || []).find(([key]) => key.toLowerCase() === lower);
    return pair ? pair[1] : null;
}, 'getResponseHeader', 1);

const windowTarget = {
    navigator: rawNavigator,
    document: rawDocument,
    location: rawLocation,
    screen: rawWindow.screen,
    innerWidth: rawWindow.innerWidth,
    innerHeight: rawWindow.innerHeight,
    outerWidth: rawWindow.outerWidth,
    outerHeight: rawWindow.outerHeight,
    screenX: rawWindow.screenX,
    screenY: rawWindow.screenY,
    screenLeft: rawWindow.screenLeft,
    screenTop: rawWindow.screenTop,
    devicePixelRatio: rawWindow.devicePixelRatio,
    chrome: rawWindow.chrome,
    WebGLRenderingContext: rawWindow.WebGLRenderingContext,
    Intl,
    fetch: rawWindow.fetch,
    XMLHttpRequest: CaptureXHR,
    Math,
    Object, Array: _Array, JSON, Date, RegExp, String, Number, Boolean,
    URL, URLSearchParams, FormData, Blob,
    Error, TypeError, Map, Set, WeakMap, WeakSet, Promise, Proxy, Reflect,
    ArrayBuffer, DataView, Uint8Array, Int32Array, Float64Array,
    requestAnimationFrame: rawWindow.requestAnimationFrame.bind(rawWindow),
    cancelAnimationFrame: rawWindow.cancelAnimationFrame.bind(rawWindow),
    localStorage: rawLocalStorage,
    performance: rawPerformance,
    addEventListener: rawWindow.addEventListener.bind(rawWindow),
};

function setElementBox(node, boxFactory) {
    if (!node) return;
    const getBox = typeof boxFactory === 'function' ? boxFactory : () => boxFactory;
    for (const key of ['width', 'height', 'clientWidth', 'clientHeight',
        'offsetWidth', 'offsetHeight']) {
        try {
            Object.defineProperty(node, key, {
                configurable: true,
                // HTML image width/height and CSSOM client/offset dimensions
                // are integer IDL attributes. getBoundingClientRect below is
                // the API that preserves sub-pixel geometry.
                get() {
                    return Math.round(Number(
                        getBox()[key.replace(/^client|^offset/, '').toLowerCase()] || 0));
                },
            });
        } catch (_) {}
    }
    node.getBoundingClientRect = function getBoundingClientRect() {
        const box = getBox();
        const left = Number(box.left || 0);
        const top = Number(box.top || 0);
        const width = Number(box.width || 0);
        const height = Number(box.height || 0);
        return { x: left, y: top, left, top, width, height,
            right: left + width, bottom: top + height, toJSON() { return this; } };
    };
}

function decodeImageSize(src) {
    const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(src || ''));
    if (!match) return null;
    const data = _Buffer.from(match[2], 'base64');
    if (match[1] === 'png' && data.length >= 24) {
        return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
    if ((match[1] === 'jpg' || match[1] === 'jpeg') && data.length > 4) {
        for (let offset = 2; offset + 9 < data.length;) {
            if (data[offset] !== 0xff) { offset++; continue; }
            const marker = data[offset + 1];
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
                0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
                return { height: data.readUInt16BE(offset + 5),
                    width: data.readUInt16BE(offset + 7) };
            }
            if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
            const length = data.readUInt16BE(offset + 2);
            if (!length) break;
            offset += length + 2;
        }
    }
    return null;
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function dispatchTrace(points, imageSize) {
    const image = rawDocument.querySelector('#cpc_img');
    const canvas = rawDocument.querySelector('#trackLine');
    if (!image || !canvas) return false;
    const displayWidth = 290;
    const displayHeight = imageSize.height * displayWidth / imageSize.width;
    const box = { left: 367, top: 240, width: displayWidth, height: displayHeight };
    setElementBox(image, box);
    setElementBox(canvas, box);
    const scaleX = displayWidth / imageSize.width;
    const scaleY = displayHeight / imageSize.height;
    const displayPoints = points.map(point => [
        box.left + Number(point[0]) * scaleX,
        box.top + Number(point[1]) * scaleY,
    ]);
    const expanded = displayPoints.length > 8 ? displayPoints : [];
    if (displayPoints.length <= 8) {
        for (let segment = 0; segment < displayPoints.length - 1; segment++) {
            const start = displayPoints[segment];
            const end = displayPoints[segment + 1];
            const steps = segment === 0 ? 12 : 18;
            for (let index = segment === 0 ? 0 : 1; index <= steps; index++) {
                const ratio = index / steps;
                expanded.push([
                    start[0] + (end[0] - start[0]) * ratio,
                    start[1] + (end[1] - start[1]) * ratio,
                ]);
            }
        }
    }
    const mouse = (type, point, target) => target.dispatchEvent(new rawWindow.MouseEvent(type, {
        bubbles: true, cancelable: true,
        clientX: point[0], clientY: point[1], screenX: point[0], screenY: point[1],
        button: 0, buttons: type === 'mousedown' || type === 'mousemove' ? 1 : 0,
    }));
    mouse('mousedown', expanded[0], canvas);
    for (const point of expanded.slice(1)) {
        await delay(7 + Math.floor(Math.random() * 8));
        mouse('mousemove', point, rawDocument);
    }
    await delay(20);
    mouse('mouseup', expanded[expanded.length - 1], rawDocument);
    return true;
}

async function dispatchRotation(angle) {
    const slider = rawDocument.querySelector('#slider-div');
    const dragBox = rawDocument.querySelector('.drag-box');
    if (!slider || !dragBox) return false;
    const sliderWidth = 48;
    const totalWidth = 290;
    const boxLeft = 367;
    const boxTop = 460;
    setElementBox(dragBox, { left: boxLeft, top: boxTop, width: totalWidth, height: 48 });
    setElementBox(slider, () => ({
        left: boxLeft + (Number.parseFloat(slider.style.left || '0') || 0),
        top: boxTop, width: sliderWidth, height: 48,
    }));
    const travel = totalWidth - sliderWidth;
    const start = [boxLeft + sliderWidth / 2, boxTop + 24];
    const end = [start[0] + travel * angle / 360, start[1]];
    const mouse = (type, point, target) => target.dispatchEvent(new rawWindow.MouseEvent(type, {
        bubbles: true, cancelable: true,
        clientX: point[0], clientY: point[1], screenX: point[0], screenY: point[1],
        button: 0, buttons: type === 'mouseup' ? 0 : 1,
    }));
    mouse('mousedown', start, slider);
    for (let index = 1; index <= 35; index++) {
        const ratio = index / 35;
        const ease = 1 - Math.pow(1 - ratio, 2.2);
        const point = [start[0] + (end[0] - start[0]) * ease,
            start[1] + Math.sin(ratio * Math.PI) * 1.5];
        await delay(8 + Math.floor(Math.random() * 7));
        mouse('mousemove', point, rawDocument);
    }
    await delay(25);
    // In a browser the moved slider remains under the pointer.  The mouseup
    // therefore bubbles from the slider and is followed by the resulting
    // click; dispatching mouseup directly on document loses JCAP's global
    // click/touche_message record even though the component's xyList works.
    mouse('mouseup', end, slider);
    slider.dispatchEvent(new rawWindow.MouseEvent('click', {
        bubbles: true, cancelable: true,
        clientX: end[0], clientY: end[1], screenX: end[0], screenY: end[1],
        button: 0, buttons: 0,
    }));
    return true;
}

async function dispatchSlider(offset, mainSize, slotSize) {
    const main = rawDocument.querySelector('#main_img');
    const slot = rawDocument.querySelector('#slot_img');
    const slider = rawDocument.querySelector('.local_footer .move-img');
    const footer = rawDocument.querySelector('.local_footer');
    if (!main || !slot || !slider || !footer || !mainSize || !slotSize) return false;
    // PC JCAP modal is 310px wide and `.captcha_body` has 3.23% margins on
    // both sides: 310 * (1 - 2 * .0323) = 289.974px. Browsers expose the
    // image/slider container as 290px; using the mobile 281px geometry shifts
    // the submitted displacement by several pixels and the server rejects it.
    const displayWidth = 290;
    const scale = displayWidth / mainSize.width;
    const displayHeight = mainSize.height * scale;
    // tp=30 uses the d33c3516 component: #slot_img has height:100% and keeps
    // its 65:170 source aspect ratio. (The separate tp=40 component makes its
    // slot square; applying that geometry here corrupts the encrypted `mw`.)
    const slotWidth = slotSize.width * scale;
    const boxLeft = 367;
    const imageTop = 240;
    const footerTop = imageTop + displayHeight + 18;
    const sliderWidth = 48;
    setElementBox(main, {
        left: boxLeft, top: imageTop, width: displayWidth, height: displayHeight,
    });
    setElementBox(slot, () => ({
        left: boxLeft, top: imageTop, width: slotWidth, height: displayHeight,
    }));
    setElementBox(footer, {
        left: boxLeft, top: footerTop, width: displayWidth, height: 48,
    });
    setElementBox(slider, () => ({
        left: boxLeft + (Number.parseFloat(slider.style.left || '0') || 0),
        top: footerTop, width: sliderWidth, height: 48,
    }));
    const travel = Math.max(0, Math.min(
        Math.round(Number(offset) * scale), displayWidth - sliderWidth));
    const start = [
        Math.round(boxLeft + sliderWidth / 2 + (Math.random() - 0.5) * 10),
        Math.round(footerTop + 24 + (Math.random() - 0.5) * 8),
    ];
    const mouse = (type, point, target) => target.dispatchEvent(new rawWindow.MouseEvent(type, {
        bubbles: true, cancelable: true,
        clientX: point[0], clientY: point[1], screenX: point[0], screenY: point[1],
        button: 0, buttons: type === 'mousedown' || type === 'mousemove' ? 1 : 0,
    }));
    mouse('mousedown', start, slider);
    // The component records only relative clientX/clientY and wall-clock
    // deltas.  Generate a fresh minimum-jerk movement for every challenge;
    // reusing one normalized capture is easy for the service to cluster.
    const maxTravel = displayWidth - sliderWidth;
    const canOvershoot = travel + 2 < maxTravel;
    const overshoot = canOvershoot && Math.random() < 0.46
        ? 2 + Math.floor(Math.random() * Math.min(4, maxTravel - travel - 1))
        : 0;
    const correctionAt = overshoot ? 0.84 + Math.random() * 0.08 : 1;
    const duration = Math.round(
        390 + travel * (1.15 + Math.random() * 0.85) + Math.random() * 180);
    const cadence = 7.5 + Math.random() * 4.5;
    const pointCount = Math.max(36, Math.min(72, Math.round(duration / cadence)));
    const verticalArc = (Math.random() - 0.5) * Math.min(10, 3 + travel / 32);
    const minimumJerk = value => {
        const p = Math.max(0, Math.min(1, value));
        return p * p * p * (10 + p * (-15 + 6 * p));
    };
    let lastX = 0;
    let lastY = 0;
    let verticalNoise = 0;
    let elapsed = 0;
    for (let index = 1; index <= pointCount; index++) {
        const phase = index / pointCount;
        let x;
        if (overshoot && phase > correctionAt) {
            const correctionPhase = (phase - correctionAt) / (1 - correctionAt);
            x = travel + overshoot * (1 - minimumJerk(correctionPhase));
        } else {
            const forwardPhase = phase / correctionAt;
            x = (travel + overshoot) * minimumJerk(forwardPhase);
        }
        if (index < pointCount) x += (Math.random() - 0.5) * 1.4;
        x = Math.round(Math.max(0, Math.min(maxTravel, x)));
        if (!overshoot || phase <= correctionAt) x = Math.max(lastX, x);
        if (index === pointCount) x = travel;

        if (index < pointCount && Math.random() < 0.38) {
            verticalNoise += Math.random() < 0.5 ? -1 : 1;
            verticalNoise = Math.max(-2, Math.min(2, verticalNoise));
        }
        const y = index === pointCount
            ? Math.round(verticalArc * (0.12 + Math.random() * 0.18))
            : Math.round(Math.sin(Math.PI * phase) * verticalArc + verticalNoise);
        let wait = index === 1
            ? 72 + Math.floor(Math.random() * 115)
            : Math.max(6, Math.round(cadence + (Math.random() - 0.5) * 5));
        if (index > 2 && index < pointCount - 2 && Math.random() < 0.055) {
            wait += 8 * (1 + Math.floor(Math.random() * 3));
        }
        await delay(wait);
        mouse('mousemove', [start[0] + x, start[1] + y], rawDocument);
        lastX = x;
        lastY = y;
        elapsed += wait;
    }
    await delay(22 + Math.floor(Math.random() * 34));
    const end = [start[0] + travel, start[1] + lastY];
    // The slider follows the pointer, so release over the slider and let the
    // event bubble to the document.onmouseup handler installed by JCAP.
    mouse('mouseup', end, slider);
    console.log('[captcha.interaction]', JSON.stringify({
        targetNatural: Number(offset).toFixed(2),
        targetDisplay: travel.toFixed(2),
        sliderLeft: String(slider.style.left || ''),
        slotTransform: String(slot.style.transform || slot.style.webkitTransform || ''),
        mainWidth: Number(main.width || 0),
        slotWidth: Number(slot.width || 0),
        points: pointCount + 1,
        elapsed,
        overshoot,
    }));
    return true;
}

async function dispatchClick(point, imageSize) {
    const image = rawDocument.querySelector('#cpc_img');
    const overlay = rawDocument.querySelector('.cpc-img-overlay');
    if (!image || !overlay || !imageSize) return false;
    const displayWidth = 290;
    const displayHeight = imageSize.height * displayWidth / imageSize.width;
    const box = { left: 367, top: 240, width: displayWidth, height: displayHeight };
    setElementBox(image, box);
    setElementBox(overlay, box);
    const local = [Number(point[0]) * displayWidth / imageSize.width,
        Number(point[1]) * displayHeight / imageSize.height];
    const absolute = [box.left + local[0], box.top + local[1]];
    const mouse = (type, buttons) => {
        const event = new rawWindow.MouseEvent(type, {
            bubbles: true, cancelable: true,
            clientX: absolute[0], clientY: absolute[1],
            screenX: absolute[0], screenY: absolute[1],
            button: 0, buttons,
        });
        for (const [key, value] of [['offsetX', local[0]], ['offsetY', local[1]],
            ['pageX', absolute[0]], ['pageY', absolute[1]]]) {
            try { Object.defineProperty(event, key, { configurable: true, value }); } catch (_) {}
        }
        overlay.dispatchEvent(event);
    };
    mouse('mousedown', 1);
    await delay(55 + Math.floor(Math.random() * 30));
    mouse('mouseup', 0);
    await delay(20);
    mouse('click', 0);
    return true;
}

function solveImageLocally(tp, node, auxiliaryNode) {
    const src = node && String(node.getAttribute('src') || '');
    const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(src);
    if (!match) return null;
    const solverPath = _path.resolve(__dirname, '..', 'run', 'captcha_solver.py');
    const args = [solverPath, '--tp', String(tp)];
    if (runtimeInput.solverModel) args.push('--model', String(runtimeInput.solverModel));
    if (runtimeInput.orientationModel) {
        args.push('--orientation-model', String(runtimeInput.orientationModel));
    }
    if (auxiliaryNode) {
        const tipSrc = String(auxiliaryNode.getAttribute('src') || '');
        const tipMatch = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(tipSrc);
        if (tipMatch) args.push(tp === 30 ? '--slot-base64' : '--tip-base64', tipMatch[2]);
    }
    if (runtimeInput.dumpDir) {
        const dumpDir = _path.resolve(String(runtimeInput.dumpDir));
        _fs.mkdirSync(dumpDir, { recursive: true });
        args.push('--debug-output', _path.join(
            dumpDir, `solver-${tp}-${runtimeState.solveAttempts}.png`));
    }
    const result = _childProcess.spawnSync(
        String(runtimeInput.pythonExecutable || 'python'), args, {
            input: _Buffer.from(match[2], 'base64'),
            encoding: 'utf8',
            timeout: 25000,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
        });
    if (result.error || result.status !== 0) {
        console.error('[captcha.solver-process]', JSON.stringify({
            status: result.status,
            error: result.error && result.error.message,
            stderr: String(result.stderr || '').slice(0, 300),
        }));
        return null;
    }
    try {
        return JSON.parse(String(result.stdout || '').trim());
    } catch (error) {
        console.error('[captcha.solver-json]', error && error.message);
        return null;
    }
}

async function autoSolveChallenge() {
    const response = runtimeState.latestChallenge || runtimeState.latestCheck || {};
    const tp = Number(response.tp);
    if (!runtimeInput.autoSolve || !Number.isFinite(tp) || runtimeState.completed
            || runtimeState.solving || runtimeState.solveAttempts >= MAX_SOLVE_ATTEMPTS) return;
    const challengeKey = `${tp}:${String(response.img || '').length}:${String(response.img || '').slice(-24)}`;
    if (challengeKey === runtimeState.lastSolvedChallenge) return;
    runtimeState.lastSolvedChallenge = challengeKey;
    runtimeState.solving = true;
    runtimeState.solveAttempts++;
    try {
        if (tp === 2) {
            const image = rawDocument.querySelector('#cpc_img');
            const tip = rawDocument.querySelector('.tip_pic');
            const size = decodeImageSize(image && image.getAttribute('src'));
            if (!size) return;
            const solution = solveImageLocally(tp, image, tip);
            if (!solution) return;
            console.log('[captcha.solve]', JSON.stringify({
                tp, solver: String(solution.solver || 'u2net-masked-template'),
                attempt: runtimeState.solveAttempts, retry: Boolean(solution.retry),
                x: Number(solution.x || 0).toFixed(2),
                y: Number(solution.y || 0).toFixed(2),
                score: Number(solution.score || 0).toFixed(4),
                reason: String(solution.reason || ''),
            }));
            if (solution.retry) {
                const refresh = rawDocument.querySelector('#refreshPng, .jcap_refresh');
                if (refresh) refresh.dispatchEvent(new rawWindow.MouseEvent('click', {
                    bubbles: true, cancelable: true,
                }));
                return;
            }
            await dispatchClick([solution.x, solution.y], size);
        } else if (tp === 3) {
            const image = rawDocument.querySelector('#cpc_img');
            const size = decodeImageSize(image && image.getAttribute('src'));
            if (!size) return;
            const solution = solveImageLocally(tp, image);
            if (!solution) return;
            if (solution.retry) {
                console.log('[captcha.solve]', JSON.stringify({
                    tp, solver: 'local-u2net-skeleton', attempt: runtimeState.solveAttempts,
                    retry: true, reason: String(solution.reason || ''),
                    score: Number(solution.score || 0).toFixed(2),
                }));
                const refresh = rawDocument.querySelector('#refreshPng, .jcap_refresh');
                if (refresh) refresh.dispatchEvent(new rawWindow.MouseEvent('click', {
                    bubbles: true, cancelable: true,
                }));
                return;
            }
            if (!Array.isArray(solution.points) || solution.points.length < 2) return;
            console.log('[captcha.solve]', JSON.stringify({
                tp, solver: String(solution.solver || 'local-u2net-skeleton'),
                attempt: runtimeState.solveAttempts,
                points: solution.points.length, score: Number(solution.score || 0).toFixed(2),
            }));
            await dispatchTrace(solution.points, size);
        } else if (tp === 26) {
            const image = rawDocument.querySelector('.slot-content img');
            const solution = solveImageLocally(tp, image);
            if (!solution || !Number.isFinite(Number(solution.angle))) return;
            console.log('[captcha.solve]', JSON.stringify({
                tp, solver: String(solution.solver || 'orientation-classifier-axis'),
                attempt: runtimeState.solveAttempts,
                angle: Number(solution.angle).toFixed(2),
                score: Number(solution.score || 0).toFixed(4),
                axisStrength: Number(solution.axisStrength || 0).toFixed(4),
            }));
            await dispatchRotation(Number(solution.angle));
        } else if (tp === 30) {
            const main = rawDocument.querySelector('#main_img');
            const slot = rawDocument.querySelector('#slot_img');
            const mainSize = decodeImageSize(main && main.getAttribute('src'));
            const slotSize = decodeImageSize(slot && slot.getAttribute('src'));
            if (!mainSize || !slotSize) return;
            const solution = solveImageLocally(tp, main, slot);
            if (!solution || !Number.isFinite(Number(solution.offset))) return;
            const sliderBiases = Array.isArray(runtimeInput.sliderBiases)
                ? runtimeInput.sliderBiases : [0];
            const sliderBias = Number(sliderBiases[
                Math.min(runtimeState.solveAttempts - 1, sliderBiases.length - 1)
            ] || 0);
            console.log('[captcha.solve]', JSON.stringify({
                tp, solver: String(solution.solver || 'slider-edge-shape'),
                attempt: runtimeState.solveAttempts,
                offset: Number(solution.offset).toFixed(2),
                bias: sliderBias.toFixed(2),
                score: Number(solution.score || 0).toFixed(4),
                margin: Number(solution.margin || 0).toFixed(4),
                correlation: Number(solution.correlation || 0).toFixed(4),
            }));
            if (solution.retry) {
                const refresh = rawDocument.querySelector('#refreshPng, .jcap_refresh');
                if (refresh) refresh.dispatchEvent(new rawWindow.MouseEvent('click', {
                    bubbles: true, cancelable: true,
                }));
                return;
            }
            await dispatchSlider(Number(solution.offset) + sliderBias, mainSize, slotSize);
        } else {
            console.log('[captcha.solve]', JSON.stringify({
                tp, solver: 'unsupported-refresh', attempt: runtimeState.solveAttempts,
            }));
            const refresh = rawDocument.querySelector('#refreshPng, .jcap_refresh');
            if (refresh) refresh.dispatchEvent(new rawWindow.MouseEvent('click', {
                bubbles: true, cancelable: true,
            }));
        }
    } finally {
        runtimeState.solving = false;
    }
}
// Keep the realm-sensitive intrinsic constructors unwrapped.  Emscripten's
// emval layer caches globalThis.Array during module initialization and later
// uses instanceof before converting JS arrays into std::vector values.
const fakeWindow = windowTarget;
windowTarget.window = fakeWindow;
windowTarget.self = fakeWindow;
windowTarget.top = fakeWindow;
windowTarget.parent = fakeWindow;
windowTarget.globalThis = fakeWindow;
const fakeDocument = env.createProxy(rawDocument, 'document', 0);
const fakeNavigator = env.createProxy(rawNavigator, 'navigator', 0);
const fakeLocation = env.createProxy(rawLocation, 'location', 0);
env.init({
    window: fakeWindow,
    document: fakeDocument,
    navigator: fakeNavigator,
    location: fakeLocation,
});
// The event recorder writes through bare `localStorage.setItem(...)` while
// its reader uses `window.localStorage`. Browsers resolve both names to the
// same Storage object; expose that binding explicitly in Node as well.
Object.defineProperty(global, 'localStorage', {
    value: rawLocalStorage, writable: true, configurable: true,
});
Object.defineProperty(global, 'XMLHttpRequest', {
    value: CaptureXHR, writable: true, configurable: true,
});
Object.defineProperty(global, 'screen', {
    value: rawWindow.screen, writable: true, configurable: true,
});

function reportEnvironment() {
    const report = env.report();
    const errors = Array.isArray(report && report.errors) ? report.errors : [];
    const missing = Object.entries(report && report.undefined || {})
        .sort((left, right) => Number(right[1]) - Number(left[1]));
    console.log('[env.summary]', JSON.stringify({
        errorCount: errors.length,
        undefinedCount: missing.length,
        errorPaths: errors.slice(0, 40).map(item => ({
            path: String(item && item.path || ''),
            operation: String(item && item.operation || ''),
        })),
        undefinedPaths: missing.slice(0, 80).map(([path, count]) => ({
            path: String(path), count: Number(count),
        })),
    }));
    return report;
}

_process.on('uncaughtException', error => {
    console.error('[uncaught]', error && error.stack || error);
    reportEnvironment();
    _process.exitCode = 1;
});
_process.on('unhandledRejection', error => {
    console.error('[rejection]', error && error.stack || error);
    reportEnvironment();
    _process.exitCode = 1;
});

let exported;
try {
    // Keep the vendor bundle byte-for-byte identical to the current JCAP CDN
    // asset. Its check payload contains stack/file-path evidence, so execute
    // it with the production URL as the VM filename as well. A normal Node
    // require() leaks the local drive path through Error.stack even when the
    // source bytes themselves are untouched.
    const vendorPath = _path.resolve(__dirname, '..', 'run', 'jcap_ujb96b.js');
    const vendorSource = _fs.readFileSync(vendorPath, 'utf8');
    _vm.runInThisContext(vendorSource, { filename: JCAP_SCRIPT_URL });
    exported = windowTarget.jdCAP || global.jdCAP;
    Object.defineProperty(global, 'Buffer', {
        value: _Buffer, writable: true, configurable: true,
    });
    Object.defineProperty(global, 'process', {
        value: _process, writable: true, configurable: true,
    });
    Object.defineProperty(global, 'globalThis', {
        value: global, writable: true, configurable: true,
    });
    windowTarget.Array = _Array;
    console.log('[runtime.profile]', {
        screen: `${rawWindow.screen.width}x${rawWindow.screen.height}`,
        available: `${rawWindow.screen.availWidth}x${rawWindow.screen.availHeight}`,
        viewport: `${rawWindow.innerWidth}x${rawWindow.innerHeight}`,
        platform: rawNavigator.platform,
        webdriver: rawNavigator.webdriver,
        hardwareConcurrency: rawNavigator.hardwareConcurrency,
        deviceMemory: rawNavigator.deviceMemory,
        maxTouchPoints: rawNavigator.maxTouchPoints,
    });
    console.log('[realm]', {
        sameArray: _Array === windowTarget.Array,
        literalInstance: [] instanceof windowTarget.Array,
    });
    console.log('[export]', {
        commonjs: exported && Object.keys(exported),
        windowJdCAP: typeof window.jdCAP,
        globalJdCAP: typeof global.jdCAP,
        globalCaptcha: typeof global.captcha,
    });
} catch (error) {
    console.error('[load-error]', error && error.stack || error);
}

if (exported && typeof exported.captcha === 'function') {
    try {
        const info = {
            appType: 3,
            tdat_version: 99992,
            host: 'jcap.m.jd.com',
            tdat_ctx: 'A8RpzPvMpQPEEPZC737Wbcqo4er3yvFj4ubEUKiJqqus7qCcnO2epKHwrvn5qfin9_murquvurqxtb0DAwe3Bgutzs_QE78RyxfGFsXL0soaHBwd0dPT28_U1djaK9bY3tje2yzy8vP0oKan',
            cs: 1,
        };
        const option = {
            sessionId: String(runtimeInput.sessionId || '0'.repeat(91)),
            language: '1',
            autoClose: '0',
            onSuccess: result => {
                const vt = String(result && result.vt || '');
                runtimeState.completed = Boolean(vt);
                console.log('[success]', Boolean(vt));
                if (vt) {
                    emitResult({ ok: true, vt });
                    if (runtimeInput.returnResult) setTimeout(() => _process.exit(0), 50);
                }
            },
            onFailure: error => console.log('[failure]', error && error.code,
                error && (error.message || error.msg)),
            onCancel: () => console.log('[cancel]'),
            onLoad: value => {
                console.log('[onLoad]', typeof value);
                setTimeout(() => {
                    const root = rawDocument.querySelector('#captcha_dom');
                    const elements = root ? Array.from(root.querySelectorAll('*')) : [];
                    const elementSummary = elements.slice(0, 80).map(node => ({
                        tag: String(node.tagName || '').toLowerCase(),
                        id: String(node.id || ''),
                        className: typeof node.className === 'string' ? node.className : '',
                    }));
                    const imageSummary = elements.filter(node =>
                        String(node.tagName || '').toLowerCase() === 'img').map(node => ({
                        id: String(node.id || ''),
                        className: typeof node.className === 'string' ? node.className : '',
                        srcLength: String(node.getAttribute('src') || '').length,
                        width: Number(node.width || 0),
                        height: Number(node.height || 0),
                    }));
                    const response = runtimeState.latestChallenge || runtimeState.latestCheck || {};
                    const textSummary = elements.filter(node => {
                        const className = typeof node.className === 'string' ? node.className : '';
                        return /(^|\s)(tip_text|local_tip)(\s|$)/.test(className);
                    }).map(node => String(node.textContent || '').trim()).filter(Boolean);
                    if (runtimeInput.dumpDir) {
                        const dumpDir = _path.resolve(String(runtimeInput.dumpDir));
                        _fs.mkdirSync(dumpDir, { recursive: true });
                        const challengeNode = rawDocument.querySelector(
                            '#cpc_img, #main_img, #curve_main_img, .slot-content img, .img-box');
                        const typeSuffix = Number.isFinite(Number(response.tp))
                            ? `-${Number(response.tp)}` : '';
                        const dumps = [
                            [`challenge${typeSuffix}`, challengeNode],
                            [`main${typeSuffix}`, rawDocument.querySelector('#main_img')],
                            [`slot${typeSuffix}`, rawDocument.querySelector('#slot_img')],
                            [`tip${typeSuffix}`, rawDocument.querySelector('.tip_pic')],
                        ];
                        for (const [name, node] of dumps) {
                            const src = node && String(node.getAttribute('src') || '');
                            const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(src);
                            if (!match) continue;
                            const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
                            let target = _path.join(dumpDir, `${name}.${extension}`);
                            for (let index = 2; _fs.existsSync(target); index++) {
                                target = _path.join(dumpDir, `${name}-${index}.${extension}`);
                            }
                            _fs.writeFileSync(target, _Buffer.from(match[2], 'base64'));
                        }
                    }
                    console.log('[captcha.dom]', JSON.stringify({
                        root: Boolean(root),
                        elements: elementSummary,
                        images: imageSummary,
                        texts: textSummary,
                    }));
                    console.log('[captcha.challenge]', JSON.stringify({
                        code: response.code,
                        tp: response.tp,
                        imgType: typeof response.img,
                        imgLength: typeof response.img === 'string' ? response.img.length : 0,
                        fields: Object.keys(response).sort(),
                    }));
                    autoSolveChallenge().catch(error => console.error('[captcha.solve-error]',
                        error && error.stack || error));
                }, 150);
            },
        };
        // Passport 的短信验证会传 account；risk_h5 的通用处置页只传 sessionId。
        // 不要给后者伪造手机号，否则 JCAP 会话契约与 createSid 来源不一致。
        if (runtimeInput.account) option.account = String(runtimeInput.account);
        const factory = exported.captcha(info);
        console.log('[factory]', typeof factory);
        Promise.resolve(factory(option)).then(instance => {
            console.log('[instance]', typeof instance,
                instance && Object.keys(instance));
            if (instance && typeof instance.create === 'function') {
                // The official risk page stores `option` in the factory call
                // and invokes create() with no action argument. Passing option
                // a second time changes the middleware contract and therefore
                // the encrypted device/check payload.
                instance.create();
            }
        }).catch(error => console.error('[factory-error]', error && error.stack || error));
    } catch (error) {
        console.error('[invoke-error]', error && error.stack || error);
    }
}

setTimeout(() => {
    if (!runtimeState.completed) emitResult({ ok: false, error: 'timeout' });
    reportEnvironment();
    dom.window.close();
    _process.exit(_process.exitCode || 0);
}, Number(runtimeInput.runTimeoutMs || (runtimeInput.autoSolve ? 45000 : 3000)));
