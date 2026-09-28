import { fileURLToPath } from 'node:url'

const model = (file) => fileURLToPath(new URL(`./models/${file}`, import.meta.url))

/** 模型文件的绝对路径。 */
export const models = {
  /** 检测模型（YOLOX，输入 1×3×416×416 的 BGR），找出图里每个字的框。 */
  det: model('common_det.onnx'),
  /** 识别模型（CTC，输入 1×1×64×W 的灰度图），输出 T×1×C 的 logits。 */
  ocr: model('common_old.onnx'),
  /** 识别模型的字符集（JSON 字符串数组，下标 0 是 CTC blank）。 */
  charset: model('charset_old.json'),
}
