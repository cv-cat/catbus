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
