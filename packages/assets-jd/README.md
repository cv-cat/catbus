# @cv-cat/catbus-assets-jd

[catbus](https://www.npmjs.com/package/catbus-cli) 的京东验证码（JCAP）onnx 模型，约 81 MB。作为 `catbus-cli` 的依赖安装，不需要单独安装。

模型来自 [cv-cat/JdApis](https://github.com/cv-cat/JdApis) 的 `static/jcap/run/models/`，版本见 catbus 仓库的 `src/platforms/jd/UPSTREAM`。模型文件不进 git，打包前由 `scripts/fetch-jd-models.mjs` 取回并校验 sha256。
