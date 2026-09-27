// 把京东验证码模型放到 packages/assets-jd/models/：优先从本地 references/JdApis 的 UPSTREAM commit 取，
// 没有 references 时（CI）从 GitHub 下载。两种来源都校验 sha256。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const upstream = readFileSync(new URL('src/platforms/jd/UPSTREAM', root), 'utf8')
const commit = /^commit: (\w+)$/m.exec(upstream)[1]
const repo = /^repo: (\S+)$/m.exec(upstream)[1]
const reference = new URL('references/JdApis/', root)
const outDir = new URL('packages/assets-jd/models/', root)

const MODELS = {
  'orientation_model_v2_0.9882.onnx': 'cffe911c1dff47fbfbbd90110aaab9c07134645c460d35b3ae8832079bea91ba',
  'u2netp.onnx': '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

mkdirSync(outDir, { recursive: true })
for (const [file, hash] of Object.entries(MODELS)) {
  const dest = new URL(file, outDir)
  if (existsSync(dest) && sha256(readFileSync(dest)) === hash) {
    console.error(`[fetch-jd-models] ${file} 已就位`)
    continue
  }
  const path = `static/jcap/run/models/${file}`
  let data
  if (existsSync(new URL('.git', reference))) {
    console.error(`[fetch-jd-models] 从 references/JdApis@${commit.slice(0, 7)} 复制 ${file}`)
    data = execFileSync('git', ['-C', fileURLToPath(reference), 'show', `${commit}:${path}`], {
      maxBuffer: 256 * 1024 * 1024,
    })
  } else {
    const url = `${repo.replace('github.com', 'raw.githubusercontent.com')}/${commit}/${path}`
    console.error(`[fetch-jd-models] 下载 ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status} ${url}`)
    data = Buffer.from(await res.arrayBuffer())
  }
  if (sha256(data) !== hash) throw new Error(`${file} 的 sha256 不匹配`)
  writeFileSync(dest, data)
}
