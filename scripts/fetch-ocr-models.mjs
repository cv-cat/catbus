// 把 ddddocr 的检测 / 识别模型和字符集放到 packages/assets-ocr/models/：从 PyPI 上固定版本的 ddddocr wheel 里取出，
// 校验 wheel 与每个文件的 sha256。本机已经装过同版本的 ddddocr（例如对拍用的 .golden/<p> 虚拟环境）时直接复制，不下载。
// 也可以用 CATBUS_DDDDOCR_WHEEL=<本地 wheel 路径> 指定离线的 wheel。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const root = fileURLToPath(new URL('../', import.meta.url))
const outDir = join(root, 'packages/assets-ocr/models')

const VERSION = '1.6.1'
const WHEEL = {
  url: 'https://files.pythonhosted.org/packages/0e/48/cbaed3981b8d8d51141b9b4779b811f4728e65d952a1e3e2e5e929539183/ddddocr-1.6.1-py3-none-any.whl',
  sha256: 'c7c70f4ae2d0335440ae8b272eea48c9f6888ecef46785fe2311f0c97a133935',
}

// 输出文件 → wheel 里的来源。字符集是 ddddocr/charsets.py 的 CHARSET_OLD（默认识别模型 common_old.onnx 用的那份），转成紧凑 JSON
const FILES = {
  'common_det.onnx': { from: 'ddddocr/common_det.onnx', sha256: '6faa8ea85a8c1a634e5050c4a138fca10f30194e0d7abbe9ade1fcd423af6ed6' },
  'common_old.onnx': { from: 'ddddocr/common_old.onnx', sha256: 'b8f2ad9cbc1f2e3922a6cb9459e30824e7e2467f3fb4fd61420640e34ea0bf68' },
  'charset_old.json': { from: 'ddddocr/charsets.py', sha256: '2c097552127cb5476189e653c0d2ccfd6b6c87425c57f81a01b5770207c33360', convert: charsetJson },
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const log = (msg) => console.error(`[fetch-ocr-models] ${msg}`)

/** charsets.py 里 `CHARSET_OLD = [...]` 这个 Python 列表字面量 → JSON。 */
function charsetJson(source) {
  const text = source.toString('utf8')
  let i = text.indexOf('[', text.indexOf('CHARSET_OLD'))
  const list = []
  for (i++; i < text.length; ) {
    const ch = text[i]
    if (ch === ']') break
    if (ch !== "'" && ch !== '"') {
      i++
      continue
    }
    let s = ''
    for (i++; text[i] !== ch; i++) {
      if (text[i] !== '\\') {
        s += text[i]
        continue
      }
      const e = text[++i]
      if (e === 'u' || e === 'x' || e === 'U') {
        const n = { u: 4, x: 2, U: 8 }[e]
        s += String.fromCodePoint(parseInt(text.slice(i + 1, i + 1 + n), 16))
        i += n
      } else s += { n: '\n', t: '\t', r: '\r', 0: '\0' }[e] ?? e
    }
    list.push(s)
    i++
  }
  return Buffer.from(JSON.stringify(list))
}

/** 从 zip（wheel）里取出指定文件。wheel 不超过 4 GB，不需要 zip64。 */
function unzip(buf, names) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('wheel 不是有效的 zip')
  const out = new Map()
  let off = buf.readUInt32LE(eocd + 16)
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('zip 中央目录损坏')
    const method = buf.readUInt16LE(off + 10)
    const size = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const local = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    off += 46 + nameLen + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32)
    if (!names.includes(name)) continue
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + size)
    if (method === 0) out.set(name, Buffer.from(data))
    else if (method === 8) out.set(name, inflateRawSync(data))
    else throw new Error(`${name}：不支持的压缩方式 ${method}`)
  }
  return out
}

/** 本机已装的 ddddocr 包目录（.golden/<p> 虚拟环境，macOS / Linux 与 Windows 两种布局）。 */
function localPackages() {
  const dirs = []
  const golden = join(root, '.golden')
  if (!existsSync(golden)) return dirs
  for (const venv of readdirSync(golden)) {
    const lib = join(golden, venv, 'lib')
    if (existsSync(lib)) for (const py of readdirSync(lib)) dirs.push(join(lib, py, 'site-packages'))
    dirs.push(join(golden, venv, 'Lib', 'site-packages'))
  }
  return dirs.filter((d) => existsSync(join(d, 'ddddocr', '__init__.py')))
}

function convert(file, raw) {
  const data = FILES[file].convert ? FILES[file].convert(raw) : raw
  return sha256(data) === FILES[file].sha256 ? data : null
}

mkdirSync(outDir, { recursive: true })
const missing = Object.keys(FILES).filter((file) => {
  const dest = join(outDir, file)
  if (existsSync(dest) && sha256(readFileSync(dest)) === FILES[file].sha256) {
    log(`${file} 已就位`)
    return false
  }
  return true
})

// 先找本机已装的同版本 ddddocr
for (const dir of localPackages()) {
  for (const file of [...missing]) {
    const src = join(dir, FILES[file].from)
    const data = existsSync(src) ? convert(file, readFileSync(src)) : null
    if (!data) continue
    log(`从 ${dir} 复制 ${file}`)
    writeFileSync(join(outDir, file), data)
    missing.splice(missing.indexOf(file), 1)
  }
}

if (missing.length) {
  let wheel
  if (process.env.CATBUS_DDDDOCR_WHEEL) {
    log(`读取 ${process.env.CATBUS_DDDDOCR_WHEEL}`)
    wheel = readFileSync(process.env.CATBUS_DDDDOCR_WHEEL)
  } else {
    log(`下载 ddddocr ${VERSION}：${WHEEL.url}`)
    const res = await fetch(WHEEL.url)
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status} ${WHEEL.url}`)
    wheel = Buffer.from(await res.arrayBuffer())
  }
  if (sha256(wheel) !== WHEEL.sha256) throw new Error(`ddddocr-${VERSION} wheel 的 sha256 不匹配`)
  const entries = unzip(
    wheel,
    missing.map((f) => FILES[f].from),
  )
  for (const file of missing) {
    const raw = entries.get(FILES[file].from)
    if (!raw) throw new Error(`wheel 里没有 ${FILES[file].from}`)
    const data = convert(file, raw)
    if (!data) throw new Error(`${file} 的 sha256 不匹配`)
    log(`取出 ${file}`)
    writeFileSync(join(outDir, file), data)
  }
}
