// 京东 PC 风控设备参数服务（行分隔 JSON-RPC）。
//
// h5st5_env.js 提供与项目统一的 Chrome 152 指纹面、Cookie 和真网 XHR；
// pc_tk_lib.js 是 gias.jd.com/js/pc-tk.js 原文。浏览器 API 仅在本机 Node
// 环境中补齐，不启动或控制真实浏览器。
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const vm = require("vm");

require(path.join(__dirname, "h5st5_env.js"));
console.debug = () => {};
console.info = () => {};

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "pc_tk_lib.js"), "utf-8"),
                    { filename: "pc_tk_lib.js" });

function getDeviceFields() {
    const jsToken = new Promise((resolve) => {
        window.getJsToken((value) => resolve(value || {}), 5000);
    });
    const eid = new Promise((resolve) => {
        window.getJdEid((value, fp, meta) => resolve({
            eid: String(value || ""), fp: String(fp || ""), meta: meta || {},
        }), null, 100);
    });
    return Promise.all([jsToken, eid]).then(([tk, device]) => {
        const cookies = Object.create(null);
        for (const item of String(document.cookie || "").split(";")) {
            const pos = item.indexOf("=");
            if (pos > 0) cookies[item.slice(0, pos).trim()] = item.slice(pos + 1).trim();
        }
        return {
            eid: device.eid || String(device.meta.eid || ""),
            eid2: String(tk.jsToken || ""),
            fp: String(tk.fp || device.fp || device.meta.fp || ""),
            giaD: String(cookies._gia_d || ""),
        };
    });
}

let queue = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
    queue = queue.then(async () => {
        let req;
        try {
            req = JSON.parse(String(line || "").trim());
            const fields = await getDeviceFields();
            if (!fields.eid || !fields.eid2 || !fields.fp) {
                throw new Error("DEVICE_FIELDS_EMPTY");
            }
            process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: fields }) + "\n");
        } catch (error) {
            process.stdout.write(JSON.stringify({
                id: req && req.id, ok: false,
                error: String((error && error.message) || error),
            }) + "\n");
        }
    });
});

process.stdout.write(JSON.stringify({ ready: true }) + "\n");
