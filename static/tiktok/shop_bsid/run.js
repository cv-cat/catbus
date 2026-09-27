"use strict";

// The vendor files in this directory are immutable copies of TikTok Shop's
// official unisec loader/core.  All browser emulation lives in this file.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const env = require("./env_core");

const nativeConsole = console;
const nativeProcess = process;
const quiet = nativeProcess.env.TIKTOK_BSID_QUIET === "1";
const debugEnvironment = nativeProcess.env.TIKTOK_BSID_DEBUG === "1";
const sdkConsole = quiet ? {
    log() {}, info() {}, warn() {}, error() {}, debug() {}, trace() {},
    dir() {}, group() {}, groupEnd() {}, time() {}, timeEnd() {},
} : nativeConsole;
const nativeFetch = global.fetch;
const NativeHeaders = global.Headers;
const NativeRequest = global.Request;
const NativeResponse = global.Response;
const NativeTextEncoder = global.TextEncoder;
const nativeCrypto = global.crypto;
const nativeAtob = global.atob;

const PAGE_URL = "https://shop.tiktok.com/jp/pdp/ruzofo-2-4-ko-setto-silicone-hallux-valgus-correction-tool/1734259790973994282";
const LOADER_URL = "https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/oec/unisec/web/loader/1.0.0.52/sg/index.js";
const CORE_URL = "https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/oec/unisec/web/1.0.0.65/sg/index.js";
const WEBMSSDK_URL = "https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/webmssdk/1.0.0.162/webmssdk.js";
const WEBMSSDK_EX_URL = "https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/ttweb_webmssdk_ex/1.0.0.2875/webmssdk_ex.js";

const code = {
    loader: fs.readFileSync(path.join(__dirname, "loader.js"), "utf8"),
    core: fs.readFileSync(path.join(__dirname, "core.js"), "utf8"),
    webmssdk: fs.readFileSync(path.join(__dirname, "webmssdk.js"), "utf8"),
    webmssdkEx: fs.readFileSync(path.join(__dirname, "webmssdk_ex.js"), "utf8"),
};

function makeEventTarget(target) {
    const listeners = new Map();
    target.addEventListener = env.setFuncNative(function addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(callback);
    }, "addEventListener", 2);
    target.removeEventListener = env.setFuncNative(function removeEventListener(type, callback) {
        const values = listeners.get(type) || [];
        const index = values.indexOf(callback);
        if (index >= 0) values.splice(index, 1);
    }, "removeEventListener", 2);
    target.dispatchEvent = env.setFuncNative(function dispatchEvent(event) {
        for (const callback of listeners.get(event.type) || []) callback.call(target, event);
        const handler = target[`on${event.type}`];
        if (typeof handler === "function") handler.call(target, event);
        return true;
    }, "dispatchEvent", 1);
    return target;
}

function createStorage(name) {
    const values = Object.create(null);
    const storage = {};
    env.setObjNative(storage, "Storage");
    storage.getItem = env.setFuncNative(function getItem(key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    }, "getItem", 1);
    storage.setItem = env.setFuncNative(function setItem(key, value) {
        values[key] = String(value);
    }, "setItem", 2);
    storage.removeItem = env.setFuncNative(function removeItem(key) { delete values[key]; }, "removeItem", 1);
    storage.clear = env.setFuncNative(function clear() {
        for (const key of Object.keys(values)) delete values[key];
    }, "clear", 0);
    storage.key = env.setFuncNative(function key(index) { return Object.keys(values)[index] || null; }, "key", 1);
    Object.defineProperty(storage, "length", { get() { return Object.keys(values).length; } });
    Object.defineProperty(storage, "_name", { value: name });
    return storage;
}

function illegalConstructor(name) {
    return env.setFuncNative(function () {
        throw new TypeError("Illegal constructor");
    }, name, 0);
}

const EventTarget = illegalConstructor("EventTarget");
const Node = illegalConstructor("Node");
const Element = illegalConstructor("Element");
const HTMLElement = illegalConstructor("HTMLElement");
const HTMLCanvasElement = illegalConstructor("HTMLCanvasElement");
const HTMLAnchorElement = illegalConstructor("HTMLAnchorElement");
const HTMLScriptElement = illegalConstructor("HTMLScriptElement");
const CanvasRenderingContext2D = illegalConstructor("CanvasRenderingContext2D");
const WebGLRenderingContext = illegalConstructor("WebGLRenderingContext");
const CanvasGradient = illegalConstructor("CanvasGradient");
const ImageData = illegalConstructor("ImageData");
Object.setPrototypeOf(Node.prototype, EventTarget.prototype);
Object.setPrototypeOf(Element.prototype, Node.prototype);
Object.setPrototypeOf(HTMLElement.prototype, Element.prototype);
for (const ctor of [HTMLCanvasElement, HTMLAnchorElement, HTMLScriptElement]) {
    Object.setPrototypeOf(ctor.prototype, HTMLElement.prototype);
}

const elementDiagnostics = { createdTags: [], canvasCalls: [] };

function createElement(tagName) {
    const upper = String(tagName || "").toUpperCase();
    elementDiagnostics.createdTags.push(upper);
    const attributes = Object.create(null);
    const element = makeEventTarget({
        tagName: upper,
        nodeName: upper,
        style: {},
        dataset: {},
        childNodes: [],
        children: [],
        parentNode: null,
        ownerDocument: null,
        innerHTML: "",
        innerText: "",
        textContent: "",
        id: "",
        src: "",
        type: "",
        async: false,
        defer: false,
        onload: null,
        onerror: null,
    });
    Object.setPrototypeOf(
        element,
        upper === "CANVAS" ? HTMLCanvasElement.prototype
            : upper === "A" ? HTMLAnchorElement.prototype
                : upper === "SCRIPT" ? HTMLScriptElement.prototype
                    : HTMLElement.prototype,
    );
    element.setAttribute = env.setFuncNative(function setAttribute(name, value) {
        attributes[String(name)] = String(value);
        element[name] = String(value);
    }, "setAttribute", 2);
    element.getAttribute = env.setFuncNative(function getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(attributes, String(name)) ? attributes[String(name)] : null;
    }, "getAttribute", 1);
    element.appendChild = env.setFuncNative(function appendChild(child) {
        child.parentNode = element;
        element.childNodes.push(child);
        element.children.push(child);
        return child;
    }, "appendChild", 1);
    element.removeChild = env.setFuncNative(function removeChild(child) {
        element.childNodes = element.childNodes.filter(item => item !== child);
        element.children = element.children.filter(item => item !== child);
        return child;
    }, "removeChild", 1);
    element.remove = env.setFuncNative(function remove() {
        if (element.parentNode && typeof element.parentNode.removeChild === "function") {
            element.parentNode.removeChild(element);
        }
    }, "remove", 0);
    if (upper === "A") {
        let anchorUrl = new URL(PAGE_URL);
        Object.defineProperty(element, "href", {
            get() { return anchorUrl.href; },
            set(value) { anchorUrl = new URL(String(value), PAGE_URL); },
            configurable: true,
        });
        for (const key of ["protocol", "host", "hostname", "port", "pathname", "search", "hash", "origin"]) {
            Object.defineProperty(element, key, {
                get() { return anchorUrl[key]; },
                configurable: true,
            });
        }
    }
    if (upper === "CANVAS") {
        element.width = 300;
        element.height = 150;
        const context = {};
        env.setObjNative(context, "CanvasRenderingContext2D");
        Object.setPrototypeOf(context, CanvasRenderingContext2D.prototype);
        for (const method of [
            "fillRect", "strokeRect", "clearRect", "fillText", "strokeText",
            "beginPath", "closePath", "moveTo", "lineTo", "arc", "arcTo",
            "bezierCurveTo", "quadraticCurveTo", "fill", "stroke", "clip",
            "rect", "save", "restore", "translate", "rotate", "scale",
            "drawImage", "setTransform", "transform", "putImageData",
        ]) context[method] = env.setFuncNative(function () {
            elementDiagnostics.canvasCalls.push(method);
        }, method);
        context.measureText = env.setFuncNative(function measureText(text) {
            elementDiagnostics.canvasCalls.push("measureText");
            return { width: String(text || "").length * 7.2 };
        }, "measureText", 1);
        context.createLinearGradient = env.setFuncNative(function createLinearGradient() {
            const gradient = { addColorStop: env.setFuncNative(function addColorStop() {}, "addColorStop", 2) };
            Object.setPrototypeOf(gradient, CanvasGradient.prototype);
            return gradient;
        }, "createLinearGradient", 4);
        context.createRadialGradient = env.setFuncNative(function createRadialGradient() {
            const gradient = { addColorStop: env.setFuncNative(function addColorStop() {}, "addColorStop", 2) };
            Object.setPrototypeOf(gradient, CanvasGradient.prototype);
            return gradient;
        }, "createRadialGradient", 6);
        context.getImageData = env.setFuncNative(function getImageData() {
            elementDiagnostics.canvasCalls.push("getImageData");
            return { data: new Uint8ClampedArray(element.width * element.height * 4) };
        }, "getImageData", 4);
        context.createImageData = env.setFuncNative(function createImageData(width, height) {
            return { data: new Uint8ClampedArray(Number(width) * Number(height) * 4) };
        }, "createImageData", 2);
        context.isPointInPath = env.setFuncNative(function isPointInPath() { return false; }, "isPointInPath", 2);
        context.canvas = element;
        context.fillStyle = "#000000";
        context.strokeStyle = "#000000";
        const webglContext = {};
        env.setObjNative(webglContext, "WebGLRenderingContext");
        Object.setPrototypeOf(webglContext, WebGLRenderingContext.prototype);
        const debugRendererInfo = {
            UNMASKED_VENDOR_WEBGL: 37445,
            UNMASKED_RENDERER_WEBGL: 37446,
        };
        webglContext.getExtension = env.setFuncNative(function getExtension(name) {
            elementDiagnostics.canvasCalls.push(`webgl.getExtension:${name}`);
            return name === "WEBGL_debug_renderer_info" ? debugRendererInfo : null;
        }, "getExtension", 1);
        webglContext.getSupportedExtensions = env.setFuncNative(function getSupportedExtensions() {
            elementDiagnostics.canvasCalls.push("webgl.getSupportedExtensions");
            return ["WEBGL_debug_renderer_info"];
        }, "getSupportedExtensions", 0);
        webglContext.getParameter = env.setFuncNative(function getParameter(parameter) {
            elementDiagnostics.canvasCalls.push(`webgl.getParameter:${parameter}`);
            return ({
                37445: "Google Inc. (NVIDIA)",
                37446: "ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)",
                7936: "WebKit",
                7937: "WebKit WebGL",
                7938: "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
                35724: "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)",
            })[Number(parameter)] ?? 0;
        }, "getParameter", 1);
        element.getContext = env.setFuncNative(function getContext(type) {
            elementDiagnostics.canvasCalls.push(`getContext:${type}`);
            if (type === "2d") return context;
            if (type === "webgl" || type === "experimental-webgl") return webglContext;
            return null;
        }, "getContext", 1);
        element.toDataURL = env.setFuncNative(function toDataURL() {
            elementDiagnostics.canvasCalls.push("toDataURL");
            return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAQCAYAAABQrvyxAAADbklEQVR4AcSWWahNYRSAjzljN2TMrJRIhkxJZAgZywOhW7yZC3kglBdESZIXD5cyZbhI8iZDmTM9GB+QeeiaMg/fd+7Zu/9sm/t07tH67lr/+v/977X+tf591Mz8/a8errUwCupACQwHfQ3QSkP+tIRiSl9eXh4mYHBzcR4E7eno47AcOucYh54Kq8GkaqELIa3Z9CH8TnCKcSOIJUygCd7ncBd+QAXcgBYwAj5D2xwd0Y5/ogshz9i0A9QImIhtUh/RsYQJGPxXZsbCAOgDY+AV3IJIamPoO4OuLvHUl/Cyk2AVrMxl7JIwAcYZx3UxvuSwEuewPenB6CngSVitb9ieECpjm3k6Exg8AvsTlfX7sjIHAc5/YuycGJRB4kqVeXjdfzd6GPjefugKA0bnyXlGO+AI3IZIDNjEbB0TW8SEF9yg12G3B09pJ3oT+KJBaO+KGDTDjP19CGMaGEhjtGKQ6iQejl3hvM+aiEmnVsAgj7LDYfAkvQ+XsE3qAtrEtF9jXwPXd0cbtJUx8HaMlcX8cf0HdCienMn6HitjT59ggUGGVYiCdX8Pw3Xh3XCfvAo0Z5MhMBPcfCnaVtmMHg1dwFNwQ09tFuOmYPC+YCu24ldqL4bV8ZQw8+QYI1/+GL0F0sTEPKiBTJbCPyVsITN8wMr7cBb8ChnoPeyLYCW8uC+w74D3Yhl6BvjFEMyM1VFbak9MO0kbHLbBU3SaGLT7+bytF94Xn5ORPDg5TKA+Dh/yC9MM+xe8AVunB9pWMCE/q86bqGW21ZjOE/v7QJ6ncmCLeGGtcKXn/3+9X96XrizzvkQYhy1XFibwnUW2SSv0S3gPXlgT0ie2jD5P32rZOn6lWBqL/d2JUVr7dMN/E7wvqCrFdpzPKiuBisVu8YPRK0wgns0ZXtC32P3B6qCyYvD+Zng6V/A8gaR4ysmXusbW64lhBbah09bgjsUqep9so9iJYSX9YFxPJmA7GLQ9ZgK2Sm8eMIGr6HdgP3qpPcVyxqF4QS2zPRz5TdKqqD05q+aa9dECtLZ+5xnG4n5DGZ0GY4qwnU2gNEzAh1eycA1sgAWwCmbDHNgFC2Ej+Klcgd4OhRYT9z+PJh1ictlf3mQAYVLRnD9gto6JWIk9TJgIqriSFux4QvLi7kf7Cyv7sPVNQjtv+TCLL38AAAD//0WvmE8AAAAGSURBVAMACkfOk5B1KHEAAAAASUVORK5CYII=";
        }, "toDataURL", 0);
        element.toBlob = env.setFuncNative(function toBlob(callback) {
            if (callback) callback(null);
        }, "toBlob", 1);
    }
    return element;
}

const fakeWindow = makeEventTarget({});
const [Document, fakeDocument] = env.getNativeProto("HTMLDocument", {});
const [Navigator, fakeNavigator] = env.getNativeProto("Navigator", {});
const [Screen, fakeScreen] = env.getNativeProto("Screen", {});
const fakeLocation = {};
env.setObjNative(fakeLocation, "Location");

const loaderScript = createElement("script");
loaderScript.src = LOADER_URL;
loaderScript.defer = true;
const webmssdkScript = createElement("script");
webmssdkScript.src = WEBMSSDK_URL;
webmssdkScript.defer = true;
let currentScript = loaderScript;
let coreScheduled = false;
let webmssdkExScheduled = false;
const cookiePairs = [];
const diagnostics = {
    cookieReads: 0,
    elements: elementDiagnostics,
    accessed: {
        document: new Set(), navigator: new Set(),
        location: new Set(), screen: new Set(),
    },
};

function monitorGets(target, label) {
    if (!debugEnvironment) return target;
    return new Proxy(target, {
        get(object, property, receiver) {
            diagnostics.accessed[label].add(String(property));
            return Reflect.get(object, property, receiver);
        },
    });
}

function seedCookies(cookieHeader) {
    cookiePairs.length = 0;
    for (const pair of String(cookieHeader || "").split(";")) {
        const trimmed = pair.trim();
        if (!trimmed) continue;
        const equals = trimmed.indexOf("=");
        if (equals <= 0) continue;
        cookiePairs.push([trimmed.slice(0, equals), trimmed.slice(equals + 1)]);
    }
}

function serializeCookies() {
    return cookiePairs.map(([name, value]) => `${name}=${value}`).join("; ");
}

function currentBsToken() {
    const entry = cookiePairs.find(([name]) => name === "oec_lucifer");
    if (!entry || !entry[1]) return undefined;
    return /^[0-9a-f]{160}$/i.test(entry[1]) ? entry[1] : undefined;
}

function seedSecurityStorage() {
    const msToken = cookiePairs
        .filter(([name, value]) => name === "msToken" && value.length === 144)
        .map(([, value]) => value)[0];
    const bsToken = currentBsToken();
    if (msToken) {
        fakeWindow.localStorage.setItem("msToken", msToken);
        fakeWindow.localStorage.setItem("xmst", msToken);
        fakeWindow.localStorage.setItem("xmstr", JSON.stringify({ sTm: Date.now(), acc: 0 }));
        fakeWindow.localStorage.setItem("xmsi", "0");
        fakeWindow.sessionStorage.setItem("msToken", msToken);
    }
    // Chrome persists the 160-hex OEC value verbatim.  Treating it as
    // base64 expands it to 240 hex characters and invalidates every BSID.
    if (bsToken) fakeWindow.localStorage.setItem("_lcf_v", bsToken);
}

function executeVendorScript(scriptElement, source, filename) {
    try {
        currentScript = scriptElement;
        vm.runInThisContext(source, { filename });
        if (typeof scriptElement.onload === "function") scriptElement.onload.call(scriptElement);
        scriptElement.dispatchEvent({ type: "load", target: scriptElement });
    } catch (error) {
        if (typeof scriptElement.onerror === "function") scriptElement.onerror.call(scriptElement, error);
        scriptElement.dispatchEvent({ type: "error", target: scriptElement, error });
        throw error;
    } finally {
        currentScript = loaderScript;
    }
}

const fakeHead = createElement("head");
const fakeBody = createElement("body");
const originalHeadAppend = fakeHead.appendChild;
fakeHead.appendChild = env.setFuncNative(function appendChild(child) {
    const result = originalHeadAppend.call(fakeHead, child);
    if (child && child.tagName === "SCRIPT" && !fakeDocument.scripts.includes(child)) {
        fakeDocument.scripts.push(child);
    }
    const src = String(child && child.src || "");
    if (!coreScheduled && /\/oec\/unisec\/web\/(?!loader\/).*\/index\.js/.test(src)) {
        coreScheduled = true;
        setTimeout(() => executeVendorScript(child, code.core, "core.js"), 0);
    }
    if (!webmssdkExScheduled && /\/ttweb_webmssdk_ex\/.*\/webmssdk_ex\.js/.test(src)) {
        webmssdkExScheduled = true;
        setTimeout(() => executeVendorScript(child, code.webmssdkEx, "webmssdk_ex.js"), 0);
    }
    return result;
}, "appendChild", 1);

Object.defineProperties(fakeDocument, {
    cookie: {
        get() { diagnostics.cookieReads += 1; return serializeCookies(); },
        set(value) {
            const first = String(value || "").split(";", 1)[0];
            const equals = first.indexOf("=");
            if (equals > 0) {
                const name = first.slice(0, equals).trim();
                const pair = [name, first.slice(equals + 1)];
                const index = cookiePairs.findIndex(item => item[0] === name);
                if (index >= 0) cookiePairs[index] = pair;
                else cookiePairs.push(pair);
            }
        },
        enumerable: true,
    },
    domain: { get() { return "shop.tiktok.com"; }, enumerable: true },
    URL: { get() { return PAGE_URL; }, enumerable: true },
    documentURI: { get() { return PAGE_URL; }, enumerable: true },
    referrer: { get() { return ""; }, enumerable: true },
    title: { get() { return ""; }, set() {}, enumerable: true },
    characterSet: { get() { return "UTF-8"; }, enumerable: true },
    readyState: { get() { return "complete"; }, enumerable: true },
    hidden: { get() { return false; }, enumerable: true },
    visibilityState: { get() { return "visible"; }, enumerable: true },
    currentScript: { get() { return currentScript; }, enumerable: true },
    baseURI: { get() { return PAGE_URL; }, enumerable: true },
    defaultView: { get() { return fakeWindow; }, enumerable: true },
});
fakeDocument.head = fakeHead;
fakeDocument.body = fakeBody;
fakeDocument.documentElement = createElement("html");
fakeDocument.scripts = [loaderScript, webmssdkScript];
fakeDocument.createElement = env.setFuncNative(function createElementForDocument(tag) {
    const element = createElement(tag);
    element.ownerDocument = fakeDocument;
    return element;
}, "createElement", 1);
fakeDocument.createTextNode = env.setFuncNative(function createTextNode(text) { return { textContent: String(text) }; }, "createTextNode", 1);
fakeDocument.createEvent = env.setFuncNative(function createEvent(type) {
    return { type, initEvent(value) { this.type = value; }, preventDefault() {}, stopPropagation() {} };
}, "createEvent", 1);
fakeDocument.getElementById = env.setFuncNative(function getElementById(id) {
    return fakeDocument.scripts.find(script => script.id === String(id)) || null;
}, "getElementById", 1);
fakeDocument.getElementsByTagName = env.setFuncNative(function getElementsByTagName(tag) {
    const lower = String(tag || "").toLowerCase();
    if (lower === "head") return [fakeHead];
    if (lower === "body") return [fakeBody];
    if (lower === "script") return fakeDocument.scripts;
    return [];
}, "getElementsByTagName", 1);
fakeDocument.querySelector = env.setFuncNative(function querySelector() { return null; }, "querySelector", 1);
fakeDocument.querySelectorAll = env.setFuncNative(function querySelectorAll() { return []; }, "querySelectorAll", 1);
makeEventTarget(fakeDocument);

function makeMimeType(type, suffixes, description) {
    const mime = { type, suffixes, description, enabledPlugin: null };
    env.setObjNative(mime, "MimeType");
    return mime;
}

const pdfMime = makeMimeType("application/pdf", "pdf", "Portable Document Format");
const textPdfMime = makeMimeType("text/pdf", "pdf", "Portable Document Format");
const pluginNames = [
    "PDF Viewer", "Chrome PDF Viewer", "Chromium PDF Viewer",
    "Microsoft Edge PDF Viewer", "WebKit built-in PDF",
];
const fakePlugins = pluginNames.map(name => {
    const plugin = [pdfMime, textPdfMime];
    Object.assign(plugin, {
        name,
        filename: "internal-pdf-viewer",
        description: "Portable Document Format",
        item: env.setFuncNative(function item(index) { return this[index] || null; }, "item", 1),
        namedItem: env.setFuncNative(function namedItem(type) {
            return this.find(value => value.type === type) || null;
        }, "namedItem", 1),
    });
    env.setObjNative(plugin, "Plugin");
    return plugin;
});
pdfMime.enabledPlugin = fakePlugins[0];
textPdfMime.enabledPlugin = fakePlugins[0];
fakePlugins.item = env.setFuncNative(function item(index) { return this[index] || null; }, "item", 1);
fakePlugins.namedItem = env.setFuncNative(function namedItem(name) {
    return this.find(value => value.name === name) || null;
}, "namedItem", 1);
fakePlugins.refresh = env.setFuncNative(function refresh() {}, "refresh", 0);
env.setObjNative(fakePlugins, "PluginArray");
const fakeMimeTypes = [pdfMime, textPdfMime];
fakeMimeTypes.item = env.setFuncNative(function item(index) { return this[index] || null; }, "item", 1);
fakeMimeTypes.namedItem = env.setFuncNative(function namedItem(type) {
    return this.find(value => value.type === type) || null;
}, "namedItem", 1);
env.setObjNative(fakeMimeTypes, "MimeTypeArray");

Object.defineProperties(fakeNavigator, {
    userAgent: { get() { return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"; }, enumerable: true },
    platform: { get() { return "Win32"; }, enumerable: true },
    language: { get() { return "zh-CN"; }, enumerable: true },
    languages: { get() { return ["zh-CN", "zh", "en", "zh-TW", "ja"]; }, enumerable: true },
    cookieEnabled: { get() { return true; }, enumerable: true },
    appName: { get() { return "Netscape"; }, enumerable: true },
    vendor: { get() { return "Google Inc."; }, enumerable: true },
    onLine: { get() { return true; }, enumerable: true },
    hardwareConcurrency: { get() { return 20; }, enumerable: true },
    webdriver: { get() { return false; }, enumerable: true },
    maxTouchPoints: { get() { return 10; }, enumerable: true },
    deviceMemory: { get() { return 32; }, enumerable: true },
    productSub: { get() { return "20030107"; }, enumerable: true },
    plugins: { get() { return fakePlugins; }, enumerable: true },
    mimeTypes: { get() { return fakeMimeTypes; }, enumerable: true },
});
const fakeConnection = {};
env.setObjNative(fakeConnection, "NetworkInformation");
Object.defineProperties(fakeConnection, {
    effectiveType: { get() { return "3g"; }, enumerable: true },
    rtt: { get() { return 350; }, enumerable: true },
    downlink: { get() { return 1.55; }, enumerable: true },
    saveData: { get() { return false; }, enumerable: true },
});
Object.defineProperties(fakeNavigator, {
    connection: { get() { return fakeConnection; }, enumerable: true },
    mozConnection: { get() { return undefined; }, enumerable: true },
    webkitConnection: { get() { return undefined; }, enumerable: true },
});
fakeNavigator.sendBeacon = env.setFuncNative(function sendBeacon() { return true; }, "sendBeacon", 2);

Object.defineProperties(fakeScreen, {
    width: { get() { return 2560; } }, height: { get() { return 1440; } },
    availWidth: { get() { return 2560; } }, availHeight: { get() { return 1392; } },
    colorDepth: { get() { return 24; } }, pixelDepth: { get() { return 24; } },
});

const pageUrl = new URL(PAGE_URL);
for (const key of ["href", "protocol", "host", "hostname", "port", "pathname", "search", "hash", "origin"]) {
    Object.defineProperty(fakeLocation, key, { get() { return key === "href" ? PAGE_URL : pageUrl[key]; }, enumerable: true });
}
fakeLocation.assign = env.setFuncNative(function assign() {}, "assign", 1);
fakeLocation.replace = env.setFuncNative(function replace() {}, "replace", 1);
fakeLocation.reload = env.setFuncNative(function reload() {}, "reload", 0);
fakeLocation.toString = env.setFuncNative(function toString() { return PAGE_URL; }, "toString", 0);

const fakePerformance = {};
env.setObjNative(fakePerformance, "Performance");
const startTime = Date.now();
fakePerformance.now = env.setFuncNative(function now() { return Date.now() - startTime; }, "now", 0);
fakePerformance.timeOrigin = startTime;
fakePerformance.timing = { navigationStart: startTime, domLoading: startTime + 100, domComplete: startTime + 500, loadEventEnd: startTime + 600 };
fakePerformance.getEntries = env.setFuncNative(function getEntries() { return []; }, "getEntries", 0);
fakePerformance.getEntriesByType = env.setFuncNative(function getEntriesByType() { return []; }, "getEntriesByType", 1);
fakePerformance.getEntriesByName = env.setFuncNative(function getEntriesByName() { return []; }, "getEntriesByName", 1);
fakePerformance.mark = env.setFuncNative(function mark() {}, "mark", 1);
fakePerformance.measure = env.setFuncNative(function measure() {}, "measure", 1);

const MOCK_SERVER_CONFIG = {
    js_url: { sg: CORE_URL, eu: CORE_URL, ttp: CORE_URL },
    js_url_v2: { sg: CORE_URL, eu: CORE_URL, ttp: CORE_URL },
    global_config: {
        enable_web_sdk: true,
        enable_web_sign: true,
        enable_web_rt: true,
        enable_web_rt_polling: true,
        sign_apis: [],
        exclude_apis: ["^/api/v[0-9]+/bs/rt.*"],
    },
    biz_config: {
        "1988": {
            enable_web_sdk: true,
            enable_web_sign: true,
            enable_web_rt: true,
            enable_web_rt_polling: true,
            sign_apis: [],
        },
    },
};

function makeJsonResponse(payload, status = 200) {
    const bodyText = JSON.stringify(payload);
    const response = Object.create(NativeResponse.prototype);
    const responseHeaders = new NativeHeaders({ "content-type": "application/json" });
    Object.defineProperties(response, {
        ok: { value: status >= 200 && status < 300, enumerable: true },
        status: { value: status, enumerable: true },
        statusText: { value: status === 200 ? "OK" : "", enumerable: true },
        url: { value: "", enumerable: true },
        redirected: { value: false, enumerable: true },
        type: { value: "basic", enumerable: true },
        headers: { value: responseHeaders, enumerable: true },
        body: { value: null, enumerable: true },
        bodyUsed: { value: false, enumerable: true },
    });
    response.json = env.setFuncNative(async function json() { return JSON.parse(bodyText); }, "json", 0);
    response.text = env.setFuncNative(async function text() { return bodyText; }, "text", 0);
    response.arrayBuffer = env.setFuncNative(async function arrayBuffer() {
        const bytes = new NativeTextEncoder().encode(bodyText);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }, "arrayBuffer", 0);
    response.clone = env.setFuncNative(function clone() { return makeJsonResponse(payload, status); }, "clone", 0);
    return response;
}

const capturedRequests = [];
const transportFetch = env.setFuncNative(async function fetch(input, init) {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const headers = new NativeHeaders((init && init.headers) || (input && input.headers) || undefined);
    capturedRequests.push({ url, headers: Object.fromEntries(headers.entries()), method: (init && init.method) || (input && input.method) || "GET", body: init && init.body });
    if (url.includes("/api/v1/bs/setting")) {
        return makeJsonResponse({
            data: JSON.stringify(MOCK_SERVER_CONFIG),
        });
    }
    if (url.includes("/monitor_web/settings/browser-settings")) {
        return makeJsonResponse({ data: {}, status: 200, ok: true });
    }
    return makeJsonResponse({ code: 0, data: {} });
}, "fetch", 1);

function XMLHttpRequest() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = "";
    this.response = "";
    this.onreadystatechange = null;
    this.onload = null;
    this.onerror = null;
    this._headers = [];
}
env.setFuncNative(XMLHttpRequest, "XMLHttpRequest", 0);
XMLHttpRequest.prototype.open = env.setFuncNative(function open(method, url) { this._method = method; this._url = String(url); this.readyState = 1; }, "open", 2);
XMLHttpRequest.prototype.setRequestHeader = env.setFuncNative(function setRequestHeader(name, value) { this._headers.push([String(name), String(value)]); }, "setRequestHeader", 2);
XMLHttpRequest.prototype.getAllResponseHeaders = env.setFuncNative(function getAllResponseHeaders() { return "content-type: application/json\r\n"; }, "getAllResponseHeaders", 0);
XMLHttpRequest.prototype.getResponseHeader = env.setFuncNative(function getResponseHeader(name) { return String(name).toLowerCase() === "content-type" ? "application/json" : null; }, "getResponseHeader", 1);
XMLHttpRequest.prototype.send = env.setFuncNative(function send(body) {
    capturedRequests.push({ url: this._url, headers: Object.fromEntries(this._headers), method: this._method || "GET", body });
    this.readyState = 4;
    this.status = 200;
    this.responseText = String(this._url || "").includes("/api/v1/bs/setting")
        ? JSON.stringify({
            data: JSON.stringify(MOCK_SERVER_CONFIG),
            headers: {}, status: 200, ok: true,
        })
        : '{"code":0,"data":{}}';
    this.response = this.responseText;
    if (typeof this.onreadystatechange === "function") this.onreadystatechange();
    if (typeof this.onload === "function") this.onload();
}, "send", 1);
XMLHttpRequest.prototype.addEventListener = env.setFuncNative(function addEventListener(type, handler) { this[`on${type}`] = handler; }, "addEventListener", 2);
XMLHttpRequest.prototype.removeEventListener = env.setFuncNative(function removeEventListener(type, handler) { if (this[`on${type}`] === handler) this[`on${type}`] = null; }, "removeEventListener", 2);

Object.assign(fakeWindow, {
    window: fakeWindow, self: fakeWindow, top: fakeWindow, parent: fakeWindow,
    document: fakeDocument, navigator: fakeNavigator, location: fakeLocation, screen: fakeScreen,
    localStorage: createStorage("localStorage"), sessionStorage: createStorage("sessionStorage"),
    performance: fakePerformance, console: sdkConsole, crypto: nativeCrypto,
    fetch: transportFetch, Headers: NativeHeaders, Request: NativeRequest, Response: NativeResponse,
    XMLHttpRequest, URL, URLSearchParams, TextEncoder, TextDecoder, Blob, FormData,
    Event: global.Event, CustomEvent: global.CustomEvent || function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    setTimeout, setInterval, clearTimeout, clearInterval, queueMicrotask,
    requestAnimationFrame: env.setFuncNative(function requestAnimationFrame(callback) { return setTimeout(callback, 16); }, "requestAnimationFrame", 1),
    cancelAnimationFrame: env.setFuncNative(function cancelAnimationFrame(id) { clearTimeout(id); }, "cancelAnimationFrame", 1),
    getComputedStyle: env.setFuncNative(function getComputedStyle() { return {}; }, "getComputedStyle", 1),
    matchMedia: env.setFuncNative(function matchMedia(query) { return { matches: false, media: String(query), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }; }, "matchMedia", 1),
    innerWidth: 1297, innerHeight: 800, outerWidth: 1313, outerHeight: 985, devicePixelRatio: 1,
    screenX: 0, screenY: 0, screenTop: 33, screenLeft: 0, scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0,
});
for (const value of [Function, Date, RegExp, Array, Object, String, Number, Boolean, Symbol, Error, TypeError, RangeError, Map, Set, WeakMap, WeakSet, Promise, Proxy, Reflect, ArrayBuffer, DataView, Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array]) {
    fakeWindow[value.name] = value;
}
Object.assign(fakeWindow, { Math, JSON, Intl, BigInt, eval });
Object.assign(fakeWindow, {
    EventTarget, Node, Element, HTMLElement, HTMLCanvasElement,
    HTMLAnchorElement, HTMLScriptElement, Document,
    HTMLDocument: Document, Navigator, Screen, CanvasRenderingContext2D,
    WebGLRenderingContext, CanvasGradient, ImageData,
});
fakeWindow.parseInt = parseInt;
fakeWindow.parseFloat = parseFloat;
fakeWindow.isNaN = isNaN;
fakeWindow.isFinite = isFinite;
fakeWindow.atob = global.atob;
fakeWindow.btoa = global.btoa;
fakeWindow.encodeURIComponent = encodeURIComponent;
fakeWindow.decodeURIComponent = decodeURIComponent;
fakeWindow.encodeURI = encodeURI;
fakeWindow.decodeURI = decodeURI;
fakeWindow.chrome = {
    app: { isInstalled: false },
    runtime: { PlatformOs: { MAC: "mac", WIN: "win", ANDROID: "android", CROS: "cros", LINUX: "linux", OPENBSD: "openbsd" } },
    loadTimes: env.setFuncNative(function loadTimes() { return {}; }, "loadTimes", 0),
    csi: env.setFuncNative(function csi() { return {}; }, "csi", 0),
};

const runtimeDocument = debugEnvironment
    ? env.createProxy(monitorGets(fakeDocument, "document"), "document", 2) : fakeDocument;
const runtimeNavigator = debugEnvironment
    ? env.createProxy(monitorGets(fakeNavigator, "navigator"), "navigator", 2) : fakeNavigator;
const runtimeLocation = debugEnvironment
    ? env.createProxy(monitorGets(fakeLocation, "location"), "location", 2) : fakeLocation;
const runtimeScreen = debugEnvironment
    ? env.createProxy(monitorGets(fakeScreen, "screen"), "screen", 2) : fakeScreen;
if (debugEnvironment) {
    fakeWindow.document = runtimeDocument;
    fakeWindow.navigator = runtimeNavigator;
    fakeWindow.location = runtimeLocation;
    fakeWindow.screen = runtimeScreen;
}
env.init({ window: fakeWindow, document: runtimeDocument, navigator: runtimeNavigator, location: runtimeLocation });
if (quiet) global.console = sdkConsole;
Object.defineProperties(global, {
    screen: { value: fakeScreen, writable: true, configurable: true },
    localStorage: { value: fakeWindow.localStorage, writable: true, configurable: true },
    sessionStorage: { value: fakeWindow.sessionStorage, writable: true, configurable: true },
    performance: { value: fakePerformance, writable: true, configurable: true },
    fetch: { value: transportFetch, writable: true, configurable: true },
    XMLHttpRequest: { value: XMLHttpRequest, writable: true, configurable: true },
    chrome: { value: fakeWindow.chrome, writable: true, configurable: true },
});

function safeShape(value) {
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).map(key => [key, typeof value[key]]));
}

async function boot(options = {}) {
    seedCookies(options.cookie || "");
    seedSecurityStorage();
    currentScript = loaderScript;
    vm.runInThisContext(code.loader, { filename: "loader.js" });
    currentScript = webmssdkScript;
    vm.runInThisContext(code.webmssdk, { filename: "webmssdk.js" });
    currentScript = loaderScript;
    await new Promise(resolve => setTimeout(resolve, 100));
    if (fakeWindow.lucifer && typeof fakeWindow.lucifer.init === "function") {
        await fakeWindow.lucifer.init({
            aid: 1988,
            ttwid: "",
            region: "sg",
            mode: 516,
            isSDK: false,
            isBoe: false,
            custom: {},
            initialPathList: ["^/captcha/get", "^/captcha/verifyV2", "^/captcha/feedbackV2", "^/.*"],
            excludePathList: [],
        });
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (fakeWindow.byted_acrawler && typeof fakeWindow.byted_acrawler.init === "function") {
        const webmssdkInit = fakeWindow.byted_acrawler.init({
            aid: 1988,
            isSDK: false,
            boe: false,
            region: "sg-tiktok",
            mode: 516,
            enablePathList: ["/view/product", "/shop/pdp", "/api/shop/", "/pdp/"],
        });
        if (webmssdkInit && typeof webmssdkInit.catch === "function") {
            webmssdkInit.catch(error => {
                if (!quiet) nativeConsole.error("webmssdk init failed", error && error.message || error);
            });
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return {
        lucifer: safeShape(fakeWindow.lucifer),
        config: fakeWindow.lucifer && typeof fakeWindow.lucifer.getConfig === "function" ? fakeWindow.lucifer.getConfig() : null,
        capturedRequests,
        nativeFetchAvailable: typeof nativeFetch === "function",
    };
}

if (require.main === module) {
    boot().then(result => {
        const config = result.config;
        nativeConsole.log(JSON.stringify({
            lucifer: result.lucifer,
            config: config && { aid: config.aid, region: config.region, mode: config.mode, initialized: config._isInitialized },
            capturedRequestCount: result.capturedRequests.length,
            capturedUrls: result.capturedRequests.map(item => item.url),
        }, null, 2));
        nativeProcess.exit(0);
    }).catch(error => {
        nativeConsole.error(error && error.stack || error);
        nativeProcess.exitCode = 1;
    });
}

module.exports = { boot, capturedRequests, diagnostics, fakeWindow, seedCookies, transportFetch };
