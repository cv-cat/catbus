#!/usr/bin/env node
/*
 * Generate the myFollow likeData token with the exact VMP engine loaded by
 * Chrome.  The bundle is a captured browser asset, never a browser session:
 * it contains webpack module 4953 (sorted values joined by ':') and module
 * 41cb (the $encode engine).  No Cookie/header is read here.
 *
 * stdin: {"did":"...","ts":1787590832257,"uri":"/rest/v/feed/myfollow"}
 * stdout: the 56-character token only
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const bundle = path.join(__dirname, "..", "fixtures",
  "current_follow_script_813.network-response");

function loadModules() {
  if (!fs.existsSync(bundle)) throw new Error(`missing captured bundle: ${bundle}`);
  const source = fs.readFileSync(bundle, "utf8");
  let modules;
  const sandbox = {
    window: { webpackJsonp: { push(value) { modules = value[1]; } } },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout, clearTimeout, Buffer,
  };
  sandbox.self = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { timeout: 20000 });
  if (!modules || typeof modules["41cb"] !== "function") {
    throw new Error("captured bundle has no module 41cb");
  }

  const cache = {};
  function requireModule(id) {
    // module 4953 only tests the browser bridge flag; the actual engine is
    // module 41cb.  6984 is the browserify global shim used by that module.
    if (id === "6c3d") return { a: true };
    if (id === "6984") return (value) => value;
    if (cache[id]) return cache[id].exports;
    if (typeof modules[id] !== "function") throw new Error(`missing module ${id}`);
    const module = { exports: {} };
    cache[id] = module;
    modules[id](module, module.exports, requireModule);
    return module.exports;
  }
  // webpack helpers used by module 4953.
  requireModule.d = (exports, name, getter) => {
    if (!Object.prototype.hasOwnProperty.call(exports, name)) {
      Object.defineProperty(exports, name, { enumerable: true, get: getter });
    }
  };
  return requireModule("4953");
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  const did = String(input.did || "");
  const ts = Number(input.ts);
  const uri = String(input.uri || "/rest/v/feed/myfollow");
  if (!Number.isFinite(ts)) throw new Error("ts must be a finite number");
  const signer = loadModules();
  const token = signer.a({ did, ts, uri });
  if (typeof token !== "string" || !/^[0-9a-f]{56}$/.test(token)) {
    throw new Error(`unexpected token output: ${String(token)}`);
  }
  process.stdout.write(token);
}

main();
