// 对拍专用：把上游的 node 预言机脚本当 CommonJS 执行。
// references/ 位于 catbus 仓库内，最近的 package.json 声明了 "type": "module"，
// 直接 `node x.js` 会被当成 ES module 而失败；这里用 Module#_compile 绕开，
// __dirname / require / require.main 与直接运行时一致。
'use strict'
const Module = require('module')
const fs = require('fs')
const path = require('path')

const file = path.resolve(process.argv[2])
process.argv.splice(1, 1)
const m = new Module(file, null)
m.filename = file
m.paths = Module._nodeModulePaths(path.dirname(file))
process.mainModule = m
m._compile(fs.readFileSync(file, 'utf8'), file)
