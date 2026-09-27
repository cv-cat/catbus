'use strict';

const CryptoJS = require('crypto-js');
const reference = require('./reference_profile.json');

const DES_KEY = CryptoJS.enc.Utf8.parse('zbp30y86');
const I12_DYNAMIC_INDEXES = [18, 53, 69, 86, 103, 120];

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function integerOption(value, fallback, minimum, maximum) {
    const resolved = value == null ? fallback : Number(value);
    if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
        throw new TypeError(`integer option must be in [${minimum}, ${maximum}]`);
    }
    return resolved;
}

function buildI12Data(seed, templateValue, dynamicIndexes = I12_DYNAMIC_INDEXES) {
    const decoded = JSON.parse(Buffer.from(String(templateValue), 'base64').toString('utf8'));
    for (const index of dynamicIndexes) decoded.d[String(index)] = seed;
    return Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64');
}

function buildTelemetryValue(fi, options = {}, profileReference = {}) {
    if (profileReference.telemetryTemplate) {
        return String(profileReference.telemetryTemplate).replace(
            '__TIME_ORIGIN__',
            String(options.timeOrigin ?? ''),
        );
    }
    return '{mt:{},m:{me:1},k:{},p:{ulr:0,ps:1,f:1,rs:1,sc:1,vc:1},'
        + `st:{h:0,f:1,kr:0},ft:{ae:null,ak:null,cdr:null,bf:null,fi:${fi}}}`;
}

function buildProfileFields(options = {}) {
    const profileReference = reference.webProfile;
    if (!profileReference || !profileReference.fields) {
        throw new Error('webProfile reference fields are missing');
    }

    const fields = clone(profileReference.fields);
    // A complete DevTools capture can be replayed byte-for-byte.  In this
    // mode every field is required and preserved; no local timestamp, cookie,
    // telemetry, or i12 value is substituted.
    if (options.exactFields === true) {
        const captured = options.fields;
        if (!captured || typeof captured !== 'object' || Array.isArray(captured)) {
            throw new TypeError('exactFields requires captured fields');
        }
        const expected = Object.keys(fields);
        const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(captured, key));
        const extra = Object.keys(captured).filter((key) => !Object.prototype.hasOwnProperty.call(fields, key));
        if (missing.length || extra.length) {
            throw new TypeError(`exactFields schema mismatch; missing=${missing.join(',')}; extra=${extra.join(',')}`);
        }
        return clone(captured);
    }
    // Keep historical 6.32.2 fixtures reproducible while using the current
    // 6.47.2 browser profile by default. Cookie input selects old fixtures.
    const cookie = String(options.documentCookie || '');
    if (/webBuild=6\.32\.2(?:;|$)/.test(cookie)) {
        fields.x1 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
    }
    const timestampMs = integerOption(options.timestampMs, Date.now(), 1, Number.MAX_SAFE_INTEGER);
    const ets = integerOption(options.ets, timestampMs, 1, Number.MAX_SAFE_INTEGER);
    const i12Seed = integerOption(
        options.i12Seed,
        profileReference.i12Seed,
        0,
        255,
    );
    const telemetryFi = integerOption(
        options.telemetryFi,
        profileReference.telemetryFi,
        0,
        1000000,
    );

    fields.x44 = String(timestampMs);
    fields.x57 = options.documentCookie == null
        ? `ets=${ets}; domain=.xiaohongshu.com; path=/; max-age=2592000`
        : String(options.documentCookie);
    fields.x83 = buildI12Data(
        i12Seed,
        fields.x83,
        profileReference.i12DynamicIndexes ?? I12_DYNAMIC_INDEXES,
    );
    fields.x84 = buildTelemetryValue(telemetryFi, options, profileReference);

    const overrides = options.fields || {};
    for (const [key, value] of Object.entries(overrides)) {
        if (!Object.prototype.hasOwnProperty.call(fields, key)) {
            throw new TypeError(`unsupported webProfile field: ${key}`);
        }
        fields[key] = value;
    }
    return fields;
}

function encodeProfileData(fields) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        throw new TypeError('profile fields must be an object');
    }
    const serialized = JSON.stringify(fields);
    const base64 = Buffer.from(serialized, 'utf8').toString('base64');
    const encrypted = CryptoJS.DES.encrypt(
        CryptoJS.enc.Latin1.parse(base64),
        DES_KEY,
        { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.ZeroPadding },
    );
    return encrypted.ciphertext.toString(CryptoJS.enc.Hex);
}

function generateProfileData(options = {}) {
    return encodeProfileData(buildProfileFields(options));
}

if (require.main === module) {
    try {
        const options = process.argv[2] ? JSON.parse(process.argv[2]) : {};
        const profileData = generateProfileData(options);
        process.stdout.write(`${JSON.stringify({
            profileData,
            length: profileData.length,
            sdkVersion: reference.release.webProfileSdkVersion,
            algorithm: 'base64-des-ecb-zero-padding-hex',
        })}\n`);
    } catch (error) {
        process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
        process.exit(1);
    }
}

module.exports = {
    buildProfileFields,
    encodeProfileData,
    generateProfileData,
};
