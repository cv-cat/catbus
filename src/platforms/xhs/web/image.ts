/**
 * 图片宽高（上游 get_file_info 用 opencv 解码取 shape）。只读文件头：PNG / JPEG / GIF / WebP / BMP。
 */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const d = Buffer.from(b.buffer, b.byteOffset, b.byteLength)
  if (d.length >= 24 && d.readUInt32BE(0) === 0x89504e47) return { width: d.readUInt32BE(16), height: d.readUInt32BE(20) }
  if (d.length >= 10 && d.toString('ascii', 0, 3) === 'GIF') return { width: d.readUInt16LE(6), height: d.readUInt16LE(8) }
  if (d.length >= 26 && d.toString('ascii', 0, 2) === 'BM') return { width: d.readInt32LE(18), height: Math.abs(d.readInt32LE(22)) }
  if (d.length >= 30 && d.toString('ascii', 0, 4) === 'RIFF' && d.toString('ascii', 8, 12) === 'WEBP') {
    const kind = d.toString('ascii', 12, 16)
    if (kind === 'VP8 ') return { width: d.readUInt16LE(26) & 0x3fff, height: d.readUInt16LE(28) & 0x3fff }
    if (kind === 'VP8L') {
      const bits = d.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (kind === 'VP8X') return { width: d.readUIntLE(24, 3) + 1, height: d.readUIntLE(27, 3) + 1 }
  }
  if (d.length >= 4 && d[0] === 0xff && d[1] === 0xd8) {
    let o = 2
    while (o + 9 < d.length) {
      if (d[o] !== 0xff) return null
      const marker = d[o + 1]!
      const len = d.readUInt16BE(o + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: d.readUInt16BE(o + 7), height: d.readUInt16BE(o + 5) }
      o += 2 + len
    }
  }
  return null
}
