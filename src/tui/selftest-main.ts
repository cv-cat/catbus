// 界面自检的子进程入口（由 `catbus doctor` 用 process.execPath 启动）：
// 把自检放进子进程，是因为 Ink 画过一次就会在进程退出时往 stderr 写“显示光标”，不能让它进到 doctor 的输出里。
import { selfTest } from './selftest.js'

const result = await selfTest()
process.stdout.write(JSON.stringify(result) + '\n')
process.exit(result.ok ? 0 : 1)
