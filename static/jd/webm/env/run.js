const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const inputText = fs.readFileSync(0, 'utf8').trim();
const runtimeInput = inputText ? JSON.parse(inputText) : {};
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const repoRequire = createRequire(path.join(projectRoot, 'package.json'));
const { JSDOM } = repoRequire('jsdom');
const { createCanvas } = repoRequire('@napi-rs/canvas');
const bundlePath = path.resolve(__dirname, '..', 'run', 'jdwebm-riskhandle.js');
const bundleUrl = 'https://storage.360buyimg.com/webcontainer/js_security_v3/jdwebm.js?v=riskhandle';
const resultPrefix = '__WEBM_RESULT__';

function emit(payload) {
    process.stdout.write(`${resultPrefix}${JSON.stringify(payload)}\n`);
}

function nativeLike(fn, name, length) {
    try { Object.defineProperty(fn, 'name', { configurable: true, value: name }); } catch (_) {}
    if (Number.isInteger(length)) {
        try { Object.defineProperty(fn, 'length', { configurable: true, value: length }); } catch (_) {}
    }
    try {
        Object.defineProperty(fn, 'toString', {
            configurable: true,
            value: () => `function ${name}() { [native code] }`,
        });
    } catch (_) {}
    return fn;
}

function defineValue(target, name, value, enumerable = true) {
    try {
        Object.defineProperty(target, name, {
            configurable: true,
            enumerable,
            value,
        });
    } catch (_) {}
}

function snapshotStorage(storage) {
    const result = Object.create(null);
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key != null) result[String(key)] = String(storage.getItem(key) || '');
    }
    return result;
}

function snapshotCookies(document) {
    const result = Object.create(null);
    for (const part of String(document.cookie || '').split(';')) {
        const separator = part.indexOf('=');
        if (separator <= 0) continue;
        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (name) result[name] = value;
    }
    return result;
}

function makePlugin(name) {
    const plugin = [];
    const pdf = {
        type: 'application/pdf',
        suffixes: 'pdf',
        description: 'Portable Document Format',
    };
    const textPdf = {
        type: 'text/pdf',
        suffixes: 'pdf',
        description: 'Portable Document Format',
    };
    plugin.push(pdf, textPdf);
    Object.assign(plugin, {
        name,
        filename: 'internal-pdf-viewer',
        description: 'Portable Document Format',
        item: index => plugin[index] || null,
        namedItem: type => plugin.find(item => item.type === type) || null,
    });
    pdf.enabledPlugin = plugin;
    textPdf.enabledPlugin = plugin;
    return plugin;
}

function installBrowserProfile(window) {
    const navigator = window.navigator;
    const ua = String(runtimeInput.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
    for (const [name, value] of Object.entries({
        userAgent: ua,
        appVersion: ua.replace(/^Mozilla\//, ''),
        platform: 'Win32',
        vendor: 'Google Inc.',
        language: 'zh-CN',
        languages: Object.freeze(['zh-CN', 'zh', 'en', 'zh-TW', 'ja']),
        hardwareConcurrency: 32,
        deviceMemory: 8,
        maxTouchPoints: 0,
        webdriver: false,
        pdfViewerEnabled: true,
    })) defineValue(navigator, name, value);

    for (const [name, value] of Object.entries({
        width: 2560,
        height: 1440,
        availWidth: 2560,
        availHeight: 1392,
        colorDepth: 24,
        pixelDepth: 24,
    })) defineValue(window.screen, name, value);
    defineValue(window.screen, 'orientation', {
        angle: 0,
        type: 'landscape-primary',
    });
    for (const [name, value] of Object.entries({
        innerWidth: 2560,
        innerHeight: 1297,
        outerWidth: 2560,
        outerHeight: 1392,
        screenX: 0,
        screenY: 0,
        screenLeft: 0,
        screenTop: 0,
        devicePixelRatio: 1,
    })) defineValue(window, name, value);

    const plugins = [
        'PDF Viewer',
        'Chrome PDF Viewer',
        'Chromium PDF Viewer',
        'Microsoft Edge PDF Viewer',
        'WebKit built-in PDF',
    ].map(makePlugin);
    plugins.item = index => plugins[index] || null;
    plugins.namedItem = name => plugins.find(item => item.name === name) || null;
    plugins.refresh = () => {};
    const mimeTypes = [plugins[0][0], plugins[0][1]];
    mimeTypes.item = index => mimeTypes[index] || null;
    mimeTypes.namedItem = type => mimeTypes.find(item => item.type === type) || null;
    defineValue(navigator, 'plugins', plugins);
    defineValue(navigator, 'mimeTypes', mimeTypes);

    const connection = Object.freeze({
        downlink: 10,
        effectiveType: '4g',
        rtt: 50,
        saveData: false,
        type: 'wifi',
    });
    defineValue(navigator, 'connection', connection);
    defineValue(navigator, 'mozConnection', connection);
    defineValue(navigator, 'webkitConnection', connection);
    defineValue(navigator, 'permissions', {
        query: nativeLike(async descriptor => ({
            state: descriptor && descriptor.name === 'geolocation' ? 'prompt' : 'prompt',
        }), 'query', 1),
    });
    defineValue(navigator, 'getInterestGroupAdAuctionData',
        nativeLike(async () => [], 'getInterestGroupAdAuctionData', 0));
    defineValue(navigator, 'webkitTemporaryStorage', {
        queryUsageAndQuota: nativeLike(success => success(0, 120000000000),
            'queryUsageAndQuota', 2),
    });
    defineValue(window, 'indexedDB', {});
    defineValue(window, 'chrome', { runtime: {} });
    defineValue(window.performance, 'memory', { jsHeapSizeLimit: 4294705152 });
    defineValue(window, 'Notification', { permission: 'default' });
    defineValue(window, 'speechSynthesis', {
        getVoices: nativeLike(() => [], 'getVoices', 0),
        onvoiceschanged: null,
    });
    defineValue(window, 'AudioContext', nativeLike(function AudioContext() {
        this.sampleRate = 48000;
        this.destination = {
            maxChannelCount: 2,
            numberOfInputs: 1,
            numberOfOutputs: 0,
            channelCount: 2,
            channelCountMode: 'explicit',
            channelInterpretation: 'speakers',
        };
    }, 'AudioContext', 0));
    defineValue(window, 'matchMedia', nativeLike(query => ({
        matches: /prefers-color-scheme:\s*light/.test(String(query)),
        media: String(query),
        onchange: null,
        addListener: nativeLike(() => {}, 'addListener', 1),
        removeListener: nativeLike(() => {}, 'removeListener', 1),
        addEventListener: nativeLike(() => {}, 'addEventListener', 2),
        removeEventListener: nativeLike(() => {}, 'removeEventListener', 2),
        dispatchEvent: nativeLike(() => false, 'dispatchEvent', 1),
    }), 'matchMedia', 1));

    const fetchStub = nativeLike(async () => {
        throw new Error('WebM payload runner does not perform network requests');
    }, 'fetch', 1);
    defineValue(window, 'fetch', fetchStub);
    const XMLHttpRequest = nativeLike(function XMLHttpRequest() {}, 'XMLHttpRequest', 0);
    XMLHttpRequest.prototype.open = nativeLike(() => {}, 'open', 2);
    XMLHttpRequest.prototype.setRequestHeader = nativeLike(() => {}, 'setRequestHeader', 2);
    XMLHttpRequest.prototype.send = nativeLike(() => {
        throw new Error('WebM payload runner does not perform network requests');
    }, 'send', 0);
    defineValue(window, 'XMLHttpRequest', XMLHttpRequest);
}

function installLayout(window) {
    const fonts = new Set([
        'Arial', 'Arial Black', 'Book Antiqua', 'Calibri', 'Cambria', 'Century',
        'Century Gothic', 'Comic Sans MS', 'Consolas', 'Courier', 'Courier New',
        'Georgia', 'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif',
        'Microsoft YaHei', 'MS Gothic', 'Segoe UI', 'SimSun', 'Tahoma',
        'Times New Roman', 'Trebuchet MS', 'Verdana',
    ]);
    function metric(node, dimension) {
        const family = String(node && node.style && node.style.fontFamily || '');
        if (family) {
            const names = family.split(',').map(value => value.trim().replace(/^['"]|['"]$/g, ''));
            const fallback = names[names.length - 1].toLowerCase();
            const base = fallback.includes('monospace') ? 128
                : fallback.includes('serif') && !fallback.includes('sans') ? 124 : 126;
            const candidate = names[0] || '';
            const installed = names.length > 1 && fonts.has(candidate);
            if (dimension === 'height') return installed ? 21 + candidate.length % 2 : 20;
            return installed ? base + 3 + candidate.length % 11 : base;
        }
        if (String(node && node.className || '').toLowerCase().includes('adsbox')) return 1;
        const styleValue = Number.parseInt(String(node && node.style && node.style[dimension] || ''), 10);
        return Number.isFinite(styleValue) ? styleValue : 1;
    }
    for (const [name, dimension] of [['offsetWidth', 'width'], ['offsetHeight', 'height']]) {
        Object.defineProperty(window.HTMLElement.prototype, name, {
            configurable: true,
            get() { return metric(this, dimension); },
        });
    }
}

function installCanvas(window) {
    const contexts = new WeakMap();
    function ensure2d(node) {
        let state = contexts.get(node);
        const width = Math.max(1, Number(node.width) || 300);
        const height = Math.max(1, Number(node.height) || 150);
        if (!state || state.kind !== '2d' || state.canvas.width !== width || state.canvas.height !== height) {
            const canvas = createCanvas(width, height);
            state = { kind: '2d', canvas, context: canvas.getContext('2d') };
            contexts.set(node, state);
        }
        return state;
    }
    function WebGLRenderingContext(canvas) {
        this.canvas = canvas;
        Object.assign(this, {
            ARRAY_BUFFER: 34962,
            STATIC_DRAW: 35044,
            FLOAT: 5126,
            TRIANGLE_STRIP: 5,
            VERTEX_SHADER: 35633,
            FRAGMENT_SHADER: 35632,
            VENDOR: 7936,
            VERSION: 7938,
        });
    }
    for (const [name, implementation] of Object.entries({
        createBuffer() { return {}; },
        bindBuffer() {},
        bufferData(_target, data) {
            this.__vertices = Array.from({ length: Number(data && data.length) || 0 },
                (_value, index) => Number(data[index]));
        },
        createProgram() { return {}; },
        createShader() { return {}; },
        shaderSource() {},
        compileShader() {},
        attachShader() {},
        linkProgram() {},
        useProgram() {},
        getAttribLocation() { return 0; },
        getUniformLocation() { return {}; },
        enableVertexAttribArray() {},
        vertexAttribPointer() {},
        uniform2f() {},
        drawArrays() {},
        getExtension(name) {
            if (name === 'WEBGL_debug_renderer_info') {
                return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
            }
            return null;
        },
        getParameter(parameter) {
            if (parameter === 7936) return 'WebKit';
            if (parameter === 7938) return 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';
            if (parameter === 37445) return 'Google Inc. (NVIDIA)';
            if (parameter === 37446) {
                return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) ' +
                    'Direct3D11 vs_5_0 ps_5_0, D3D11)';
            }
            return null;
        },
        getShaderPrecisionFormat() { return {}; },
    })) WebGLRenderingContext.prototype[name] = nativeLike(
        implementation, name, implementation.length);
    defineValue(window, 'WebGLRenderingContext', WebGLRenderingContext);

    function webglDataUrl(node, context) {
        const width = Math.max(1, Number(node.width) || 300);
        const height = Math.max(1, Number(node.height) || 150);
        const canvas = createCanvas(width, height);
        const drawing = canvas.getContext('2d');
        const vertices = context && context.__vertices && context.__vertices.length >= 9
            ? context.__vertices : [-0.2, -0.9, 0, 0.4, -0.26, 0, 0, 0.732134444, 0];
        const point = index => [
            (vertices[index] + 1) * width / 2,
            (1 - vertices[index + 1]) * height / 2,
        ];
        const gradient = drawing.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, 'rgba(204, 242, 0, 1)');
        gradient.addColorStop(1, 'rgba(255, 255, 0, 1)');
        drawing.fillStyle = gradient;
        drawing.beginPath();
        const first = point(0);
        drawing.moveTo(first[0], first[1]);
        for (const index of [3, 6]) {
            const next = point(index);
            drawing.lineTo(next[0], next[1]);
        }
        drawing.closePath();
        drawing.fill();
        return canvas.toDataURL('image/png');
    }

    window.HTMLCanvasElement.prototype.getContext = nativeLike(function getContext(kind) {
        if (kind === '2d') return ensure2d(this).context;
        if (kind === 'webgl' || kind === 'experimental-webgl') {
            let state = contexts.get(this);
            if (!state || state.kind !== 'webgl') {
                state = { kind: 'webgl', context: new WebGLRenderingContext(this) };
                contexts.set(this, state);
            }
            return state.context;
        }
        return null;
    }, 'getContext', 1);
    window.HTMLCanvasElement.prototype.toDataURL = nativeLike(function toDataURL() {
        const state = contexts.get(this);
        if (state && state.kind === 'webgl') return webglDataUrl(this, state.context);
        return ensure2d(this).canvas.toDataURL('image/png');
    }, 'toDataURL', 0);
}

async function main() {
    if (!fs.existsSync(bundlePath)) throw new Error('missing WebM bundle');
    const pageUrl = String(runtimeInput.pageUrl ||
        'https://search.jd.com/Search?keyword=%E6%89%8B%E6%9C%BA');
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
        url: pageUrl,
        pretendToBeVisual: true,
        runScripts: 'outside-only',
    });
    const { window } = dom;
    installBrowserProfile(window);
    installLayout(window);
    installCanvas(window);
    window.console = console;

    const initialCookies = runtimeInput.cookies && typeof runtimeInput.cookies === 'object'
        ? runtimeInput.cookies : {};
    for (const [name, value] of Object.entries(initialCookies)) {
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || value == null) continue;
        try { window.document.cookie = `${name}=${String(value)}; path=/`; } catch (_) {}
    }
    const initialStorage = runtimeInput.localStorage && typeof runtimeInput.localStorage === 'object'
        ? runtimeInput.localStorage : {};
    for (const [name, value] of Object.entries(initialStorage)) {
        if (value == null) continue;
        try { window.localStorage.setItem(String(name), String(value)); } catch (_) {}
    }

    const scriptElement = window.document.createElement('script');
    scriptElement.src = bundleUrl;
    window.document.head.appendChild(scriptElement);
    try {
        Object.defineProperty(window.document, 'currentScript', {
            configurable: true,
            get() { return scriptElement; },
        });
    } catch (_) {}

    let source = fs.readFileSync(bundlePath, 'utf8');
    const entry = 'r(r.s=15)';
    if (!source.includes(entry)) throw new Error('unsupported WebM bundle entry');
    source = source.replace(entry, '(globalThis.__webm_require=r)');
    vm.runInContext(source, dom.getInternalVMContext(), { filename: bundleUrl });
    const req = window.__webm_require;
    if (!req) throw new Error('WebM module loader unavailable');
    const common = req(0);
    const util = req(1);
    util.initPolyfill();
    util.currentScript();
    const encryptedConfig = String(runtimeInput.configData || '');
    if (encryptedConfig) util.isDowngrade(common.decryptConfig(encryptedConfig));
    req(53).default();
    const fp = new window.WebmBrowser();
    const keyList = fp.keyArray();
    const fingerprint = fp.get(keyList);
    util.rewriteFingerPrintFunc(fp, keyList);
    util.doJosRandomId();
    req(8).queryNotifications();
    req(6).queryGeolocation();
    await Promise.resolve();

    const strategy = new (req(52).HfStrategy)(fp, keyList, fingerprint);
    let payload = null;
    strategy.send = value => {
        payload = typeof value === 'string' ? JSON.parse(value) : value;
    };
    await strategy.report();
    if (!payload || typeof payload !== 'object') throw new Error('WebM payload was not produced');

    const currentCookies = snapshotCookies(window.document);
    const cookieUpdates = Object.create(null);
    for (const [name, value] of Object.entries(currentCookies)) {
        if (String(initialCookies[name] ?? '') !== value) cookieUpdates[name] = value;
    }
    emit({
        ok: true,
        payload,
        cookies: cookieUpdates,
        localStorage: snapshotStorage(window.localStorage),
        diagnostics: {
            bodyFields: Object.keys(payload.body || {}).length,
            fingerprintLength: String(fingerprint || '').length,
            keyCount: keyList.length,
        },
    });
    dom.window.close();
}

main().catch(error => {
    emit({
        ok: false,
        error: String(error && error.name || 'Error'),
        errorMessage: String(error && error.message || '').slice(0, 240),
    });
    process.exitCode = 1;
});
