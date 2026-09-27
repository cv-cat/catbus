// Execute JD's public SummerCryptico bundle in Node without a browser.
// Input/output is one JSON document; plaintext is never written to diagnostics.
const vm = require("vm");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
    try {
        const request = JSON.parse(input);
        const storage = new Map();
        global.window = global;
        global.navigator = { appName: "Netscape" };
        global.localStorage = {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
        };

        const libraryModule = { exports: {} };
        const context = vm.createContext({
            module: libraryModule,
            exports: libraryModule.exports,
            window: global,
            navigator: global.navigator,
            localStorage: global.localStorage,
            console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
            Math, Date, JSON, Uint8Array, Uint32Array, ArrayBuffer,
            Promise, encodeURIComponent, decodeURIComponent, escape, unescape,
            setTimeout, clearTimeout,
        });
        vm.runInContext(String(request.source || ""), context, {
            filename: "summer-cryptico-h5.min.js",
            timeout: 10000,
        });
        const cryptico = libraryModule.exports && libraryModule.exports.SummerCryptico;
        if (!cryptico || typeof cryptico.encryptData !== "function") {
            throw new Error("SUMMER_CRYPTICO_EXPORT_MISSING");
        }
        const encrypted = cryptico.encryptData(
            String(request.publicKey || ""), String(request.plaintext || "")
        );
        process.stdout.write(JSON.stringify({ ok: true, encrypted }));
    } catch (error) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: String((error && error.message) || error),
        }));
        process.exitCode = 1;
    }
});
