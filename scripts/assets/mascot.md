# 吉祥物

catbus 的吉祥物是一位 Q 版的巴士车掌小姐，原创角色，图由图像模型生成（OpenAI `gpt-image-2.6`，透明底）。
要出新的姿势或贴纸时，沿用下面的角色描述，只换「姿势」一句，保证每张图里是同一个人。

| 文件 | 用途 | 姿势 |
| --- | --- | --- |
| `assets/logo.png` | logo、README 首屏、分享卡 | 单脚跳着挥手，举着 `>_` 车票，挎包里探出一只小黑猫 |
| `assets/stickers/plane.png` | README「给 AI Agent 用」 | 乘着车票折的纸飞机 |
| `assets/stickers/bus.png` | README「参与贡献」 | 坐在红色小巴士的车顶上挥手 |

## 角色描述

```text
an original cute girl mascot who is a young bus conductor: short wavy dark-navy bob with a small side braid tied with a red ribbon,
big bright amber eyes, a happy open-mouth smile, a navy conductor cap with a red band and a small gold bus emblem,
a navy double-breasted jacket with gold buttons and red piping, a red neck ribbon, white gloves, a navy pleated skirt,
white socks, brown loafers and a small brown satchel; she holds up a paper ticket printed with the symbol >_
```

## 画风

```text
Chibi anime die-cut sticker of <角色描述>, <姿势>. Thick clean white sticker border, soft cel shading, crisp line art, golden sparkles.
Centered on a transparent background, nothing else in the frame. No text other than >_ , no watermark.
```

请求参数：`size: 1024x1024`、`quality: high`、`background: transparent`。
透明底的效果不好时，改成纯色灰底（`#C8CDD6`），再按颜色从四边抠掉底色。

## 动画帧（WebUI 侧栏头像）

WebUI 侧栏的头像是关键帧动画，帧同样由图像模型生成（`gpt-image-2.6-flare`，图片编辑接口，`background: transparent`）。
接口只能出静态图，所以每个动作画成一张分镜格子再切帧。

- **母版**：先用原头像出一张去掉星星的 1024 透明底中立姿势。之后每个请求都带母版做参考图，否则画出来不是同一个角色。
- **分镜格子**：`1536x1024`、3 列 × 2 行，每格 512px，第 1 格画成母版原样（用来确定缩放）；一张图不超过 6 帧。
  提示词写明每格只改哪个部位、其余保持一致、四周留空、不要星星爱心等漂浮物（特效由代码加）。
- **模型不按逐帧描述画时**：减少一张图里的帧数，或者一帧一张图（`1024x1024`，只描述这一帧相对母版的变化）。
  表情类的帧把变化的局部贴回母版，身体就完全不动。
- **切帧**：按透明通道抠出每格的主体，缩放到和母版等高，再按身体下半部分对齐到母版，输出 512×512 透明底的帧。
- **打包**：所有动作的帧缩到 320px 拼成一张图集 `web/src/assets/mascot/anim/atlas.webp`，中立帧只存一份；
  清单 `web/src/data/mascot-anim.json` 记每个动作的帧率和「入 / 循环 / 出」三段的帧号。

| 动作 | 帧 |
| --- | --- |
| `blink` | 睁眼、半闭、闭眼 |
| `look` | 眼珠看左、看右、看上 |
| `cat-ear` | 猫折耳、猫眨眼 |
| `pat` | 察觉、眯眼大笑（帽子压扁）、左右歪头、陶醉 |
| `poke` | 戳左脸、戳右脸、愣住 |
| `shy` | 脸红躲眼神、双手半捂脸、完全捂脸、只露一只眼 |
| `peek` | 前倾扒着窗沿、看左、眨眼、看右、笑 |
| `cat-hide` | 猫缩下去、肩上没猫、猫从挎包探头、猫回到肩上 |
| `pout` | 鼓腮皱眉、扭头闭眼、睁一只眼偷看、忍不住笑 |
| `sleep` | 眼睛半闭、闭眼低头、头更低且猫也睡着、惊醒 |
| `cat-pet` | 猫抬头、蹭、歪头、喵（已打进图集，组件暂未使用） |
