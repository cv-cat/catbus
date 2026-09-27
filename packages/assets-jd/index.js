import { fileURLToPath } from 'node:url'

const model = (file) => fileURLToPath(new URL(`./models/${file}`, import.meta.url))

/** 模型文件的绝对路径。 */
export const models = {
  orientation: model('orientation_model_v2_0.9882.onnx'),
  u2netp: model('u2netp.onnx'),
}
