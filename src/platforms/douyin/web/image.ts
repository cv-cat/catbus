import { imageSize as headerSize } from '../../../core/image.js'

/** 从文件头读图片宽高，读不出来时为 0（上游用 Pillow 的 _image_size）。 */
export function imageSize(data: Uint8Array): { width: number; height: number } {
  return headerSize(data) ?? { width: 0, height: 0 }
}
