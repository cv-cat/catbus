"use strict";

const fs = require("fs");
const nativeProcess = process;
const NativeURL = URL;

nativeProcess.env.TIKTOK_BSID_QUIET = "1";

function fail(message) {
    nativeProcess.stderr.write(`${message}\n`);
    nativeProcess.exit(1);
}

let input;
try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
    fail("invalid signer input");
}

if (!input || typeof input.url !== "string" || !input.url) fail("url is required");
if (typeof input.cookie !== "string" || !input.cookie) fail("cookie is required");
if (!Array.isArray(input.headers) || !input.headers.length) fail("ordered headers are required");

const runtime = require("./run");

(async () => {
    await runtime.boot({ cookie: input.cookie });
    const marker = runtime.capturedRequests.length;
    const method = String(input.method || "GET").toUpperCase();
    const body = input.body == null ? undefined : String(input.body);
    const officialOecSign = runtime.fakeWindow.lucifer && runtime.fakeWindow.lucifer._s;
    if (typeof officialOecSign !== "function") throw new Error("Lucifer signer is unavailable");
    // Capture WebMssdk's two legacy fields without consuming an OEC signing
    // turn.  The real BSID is calculated once below from the cleaned browser
    // pre-sign URL.
    runtime.fakeWindow.lucifer._s = () => "0".repeat(Number(input.expected_length || 382));
    try {
        await runtime.fakeWindow.fetch(input.url, {
            method,
            headers: input.headers,
            body,
        });
    } finally {
        runtime.fakeWindow.lucifer._s = officialOecSign;
    }
    const expected = new NativeURL(input.url);
    const captured = runtime.capturedRequests.slice(marker).reverse().find(item => {
        const candidate = new NativeURL(item.url);
        return candidate.origin === expected.origin && candidate.pathname === expected.pathname;
    });
    if (!captured) throw new Error("official SDK did not dispatch the target request");
    const signedUrl = new NativeURL(captured.url);
    const inputUrl = new NativeURL(input.url);
    const msToken = inputUrl.searchParams.get("msToken") || "";
    const generatedXBogus = signedUrl.searchParams.get("X-Bogus") || "";
    const xBogus = String(input.x_bogus || generatedXBogus);
    const legacySignature = signedUrl.searchParams.get("_signature") || "";
    const expectedLength = Number(input.expected_length || 382);
    const expectedMsTokenLength = Number(input.expected_ms_token_length || 144);
    if (msToken.length !== expectedMsTokenLength) throw new Error("msToken length does not match Chrome");
    if (xBogus.length !== 28) throw new Error("X-Bogus length does not match Chrome");
    if (legacySignature.length !== 47) throw new Error("_signature length does not match Chrome");
    // Preserve the raw msToken spelling from Chrome. URLSearchParams.set()
    // percent-encodes its trailing `==` and changes Lucifer's signed bytes.
    const cleanInputUrl = String(input.url)
        .replace(/([?&])X-Bogus=[^&]*&?/g, "$1")
        .replace(/([?&])_signature=[^&]*&?/g, "$1")
        .replace(/[?&]$/, "");
    const preSignUrl = `${cleanInputUrl}&X-Bogus=${xBogus}&_signature=${legacySignature}`;
    const bsid = officialOecSign.call(runtime.fakeWindow, {
        method,
        body: body == null ? "" : body,
        url: preSignUrl,
        flag: "fetch",
    });
    if (!/^[0-9a-f]+$/.test(bsid)) throw new Error("BSID format does not match Chrome");
    if (bsid.length !== expectedLength) {
        throw new Error(`BSID length ${bsid.length} does not match Chrome ${expectedLength}`);
    }
    // The current Shop runtime keeps all three WebMssdk fields and appends
    // Lucifer's BSID. Preserve the exact raw spelling and order from Chrome.
    const wireUrl = `${preSignUrl}&X-Tts-Oec-Bsid=${bsid}`;
    nativeProcess.stdout.write(JSON.stringify({
        signed_url: wireUrl,
        bsid,
        length: bsid.length,
        pre_sign_lengths: {
            msToken: msToken.length,
            "X-Bogus": xBogus.length,
            _signature: legacySignature.length,
        },
        pre_sign_url_length: preSignUrl.length,
        pre_sign_order: [...new NativeURL(preSignUrl).searchParams.keys()],
        pre_sign_url: preSignUrl,
    }));
    nativeProcess.exit(0);
})().catch(error => {
    fail(error && error.message ? error.message : "Shop BSID generation failed");
});
