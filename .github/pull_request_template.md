## 改动说明

<!-- 改了什么、为什么改。修 bug 的话写清楚现象和原因；关联的 issue 写 Closes #123。 -->

## 涉及平台

<!-- 勾选涉及的部分 -->

- [ ] core / cli（通用部分）
- [ ] xhs
- [ ] douyin
- [ ] tiktok
- [ ] bilibili
- [ ] kuaishou
- [ ] weibo
- [ ] xianyu
- [ ] taobao
- [ ] jd
- [ ] x
- [ ] 文档 / CI / 其他

## 上游

<!-- 移植或同步上游时填写：上游仓库、commit 范围，以及是否更新了 src/platforms/<p>/UPSTREAM。和上游无关时写「无」。 -->

## 检查清单

- [ ] `npm test` 通过
- [ ] `npm run typecheck` 通过
- [ ] 改了注册表（`src/platforms/<p>/index.ts`、`src/core/vocab.ts`）后运行了 `npm run gen:capabilities`，`docs/capabilities.md` 已更新
- [ ] 请求（URL、query、header 顺序、cookie、body、签名）有变化时，重新生成了对拍数据（`scripts/golden/<p>/gen.py`），并补了对拍测试（AGENTS.md 7.5）
- [ ] 新增或修改命令、选项、输出字段时，先改了 AGENTS.md（第 4、6 节），再改代码
- [ ] 代码、测试 fixture、对拍数据、日志和提交记录里**没有真实的 cookie、token、ticket、私钥**，只用假凭证
- [ ] stdout 只输出 JSON，调试信息都走 stderr / logger
- [ ] 没有修改 `references/` 里受版本控制的文件；没有引入需要现场编译的依赖

## 验证

<!-- 除了离线测试，是否在真机上验证过（npm run test:e2e 或手动）？写操作请说明用的是仅自己可见的内容。没有验证过就写「未真机验证」。 -->
