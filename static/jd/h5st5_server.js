// h5st 5.3 常驻签名服务（行分隔 JSON-RPC）。
//
//   stdin :  {"id":1,"params":{...},"appId":"f06cc"}
//   stdout:  {"id":1,"ok":true,"result":{"h5st":"...", "_stk":"...", ...}}
//
// 三段式：
//   h5st5_env.js  浏览器环境引导（jsdom + 指纹面 + 真网 XHR + 采集对象校准）
//   h5st5_lib.js  现网 js_security_v3_0.1.6.js 原文，未改一字
//   本文件         把库跑在环境里，再包一层常驻 RPC
//
// 常驻是因为库有 232KB，冷启动 1~2s，而签名本身是毫秒级。
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const vm = require("vm");

require(path.join(__dirname, "h5st5_env.js"));

// 库原文用 vm 跑在当前全局里，这样它看到的就是 env 布置好的 window/navigator/…
// （不能用 require：库是浏览器脚本，靠裸全局变量互相引用。）
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "h5st5_lib.js"), "utf-8"),
                    { filename: "h5st5_lib.js" });

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
    line = line.trim();
    if (!line) return;
    let req;
    try {
        req = JSON.parse(line);
    } catch (e) {
        process.stdout.write(JSON.stringify({ ok: false, error: "BAD_JSON" }) + "\n");
        return;
    }
    try {
        const ps = new window.ParamsSign({ appId: req.appId || "f06cc" });
        const result = await ps.sign(req.params || {});
        // 换 token 是异步的，签完这一发才可能刚拿到新 token，所以在这里刷盘
        if (globalThis.__jdFlushTokenCache) globalThis.__jdFlushTokenCache();
        process.stdout.write(JSON.stringify({ id: req.id, ok: true, result }) + "\n");
    } catch (e) {
        process.stdout.write(JSON.stringify({
            id: req.id, ok: false, error: String((e && e.message) || e),
        }) + "\n");
    }
});

process.stdout.write(JSON.stringify({ ready: true }) + "\n");
