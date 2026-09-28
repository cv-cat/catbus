# @cv-cat/catbus-assets-ocr

[catbus](https://www.npmjs.com/package/catbus-cli) 的验证码 OCR 模型，约 34 MB。作为 `catbus-cli` 的依赖安装，不需要单独安装。

内容取自 PyPI 上 [ddddocr](https://github.com/sml2h3/ddddocr) 1.6.1 的 wheel：

| 文件 | 来源 | 用途 |
|---|---|---|
| `models/common_det.onnx` | `ddddocr/common_det.onnx` | 检测：找出图里每个字的框 |
| `models/common_old.onnx` | `ddddocr/common_old.onnx` | 识别：ddddocr 的默认识别模型 |
| `models/charset_old.json` | `ddddocr/charsets.py` 的 `CHARSET_OLD` | 识别模型的字符集 |

模型文件不进 git，打包前由 catbus 仓库的 `scripts/fetch-ocr-models.mjs` 取回并校验 sha256。

ddddocr 以 MIT 许可证发布，原许可证见 [LICENSE-ddddocr](LICENSE-ddddocr)；本包其余部分同样是 MIT。
