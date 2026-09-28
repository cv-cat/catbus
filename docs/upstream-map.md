# 上游移植对照（references/ → catbus）

移植某个平台时查这份文档：上游的鉴权、登录、API 方法、要复制的 JS 资产、游客态和长连接的代码位置。

- 行号是写这份文档时的位置，只用来定位。动手前以 `src/platforms/<p>/UPSTREAM` 记录的 commit 为准，重新核对一遍。
- catbus 的规范见 [AGENTS.md](../AGENTS.md)，能力矩阵见 [capabilities.md](capabilities.md)。
- 「上游凭证来源」只用于理解上游代码和在本机跑上游对比；catbus 不读这些位置。

## 1. 通用

- 10 个上游都是 Python。
  - HTTP 以 `curl_cffi` 为主，用来模拟 Chrome 的 TLS / JA3 与 HTTP/2 指纹。
  - Weibo、Xianyu、Taobao 用的是 `requests`。
- 签名 JS 在上游里有两种调用方式：
  - `subprocess` 调 `node`；
  - `PyExecJS`，共三处：XHS 的 `xhs_creator_util.py`、Xianyu 的 `utils/goofish_utils.py`、Taobao 的 `utils/taobao_utils.py`。

  catbus 里统一改成 `node:vm` 执行（见 AGENTS.md 7.4）。
- 上游 JS 实际 `require` 的第三方 npm 模块只有三个，其余都是 Node 内置模块：
  - `jsdom`：JD；
  - `crypto-js`：XHS；
  - `@napi-rs/canvas`：JD；KS 的 `kwf_oracle.js` 里是 try/catch 的可选依赖。

### 1.1 Python → TS 替换对照

| 上游 Python | catbus |
|---|---|
| `curl_cffi`、`requests` | wreq-js（`core/http.ts`） |
| `websockets`、`websocket-client` | wreq-js 的 WebSocket（`core/stream.ts`） |
| `protobuf` + pb2 | protobufjs |
| `blackboxprotobuf`（无 schema 解码） | protobufjs 的 Reader |
| `onnxruntime` | onnxruntime-web |
| `opencv`、`scikit-image`、`scipy`、`numpy` | @techstark/opencv-js，其余手工移植 |
| `Pillow` | @napi-rs/canvas |
| `ddddocr` | 移植到 onnxruntime-web 上 |
| `pydantic` | zod |
| `loguru` | catbus 的 stderr logger |
| `subprocess node x.js`、`PyExecJS` | `node:vm`（见 AGENTS.md 7.4） |
| `qrcode` | qrcode |

### 1.2 游客态生成

对应 AGENTS.md 5.2 的 `guest.json`。

| 平台 | 生成位置 | 内容 |
|---|---|---|
| xhs | `xhs_utils/common_util.py:34` `generate_a1`、`:42` `generate_web_id` | `a1`、`webId` |
| douyin | `dy_apis/login_api.py:861` `register_ttwid`；`utils/dy_util.py:107` `generate_msToken`、`:185` `generate_webid`；`utils/mstoken.py:308` | `ttwid`、`msToken`、`webid` |
| tiktok | 没有生成器，`msToken` 来自 cookie（`builder/auth.py:156`） | 游客态需要在 catbus 里补 |
| bilibili | `builder/auth.py:52` `BiliAuth.anonymous`；`utils/device.py` | `buvid3` / `buvid4` 等 |
| kuaishou | `ks_apis/login_api.py:732` `bootstrap_device_fingerprint` | 设备指纹 cookie |
| weibo | m.weibo 本身可以匿名访问 | — |
| xianyu | `utils/build_cookies.py:52` `build_initial_cookies` | 先调一次 mtop 拿 `_m_h5_tk`，再调一次拿 `cookie2`；含 `tfstk` |
| taobao | `taobao_apis.py:29` `get_token` | `_m_h5_tk` |
| jd | `utils/device_token.py:112` `get_device_fields` | 设备字段 |
| x | `builder/auth.py:26` `GUEST_ACTIVATE_URL` = `https://api.x.com/1.1/guest/activate.json` | guest token，约 3 小时有效 |

### 1.3 长连接

对应 `live listen` / `msg listen`。

| 用途 | 位置 | 地址 |
|---|---|---|
| douyin 私信 | `dy_apis/douyin_recv_msg.py:42` | `wss://frontier-im.douyin.com/ws/v2` |
| douyin 直播 | `dy_live/server.py:178` | `wss://webcast100-ws-web-hl.douyin.com/webcast/im/push/v2/` |
| tiktok 私信 | `api/tiktok_chat.py:21` | `wss://im-ws.tiktok.com/ws/v2` |
| tiktok 直播 | `api/tiktok_web.py:5597` | `wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/` |
| xhs 直播 | `apis/xhs_live.py:31` | `wss://apppush-rws.xiaohongshu.com/rwp` |
| kuaishou 直播 | `ks_apis/live_api.py:1169`、`ks_apis/live_ws.py` 的 `LiveDanmakuClient` | 由接口下发 |
| xianyu 私信 | `goofish_live.py:18` | `wss://wss-goofish.dingtalk.com/` |
| taobao 私信 | `taobao_live.py:19` | `wss://wss-cntaobao.dingtalk.com/` |
| jd 客服 | `jd_apis/jd_chat_ws.py:5` | `wss://ws1-dd.jd.com/` |

---

## 2. 各仓库

### xhs — Spider_XHS

- **鉴权**
  - `xhs_utils/xhs_auth.py` 的 `XHSUnifiedAuth` 包含两个子鉴权：`.pc` 为 `XHSPcAuth`，`.creator` 为 `XHSCreatorAuth`，都继承自 `xhs_core/auth.py` 的 `XHSAuth`。
  - 构造方式：`from_qrcode_login`、`from_phone_login`、`from_cookie`。
  - 必需的 cookie 是 `a1` 和 `web_session`，按 host 分域存储。创作者中心对应 catbus 的 `creator` scope。
- **登录**：`apis/xhs_pc_login_apis.py` 的 `XHSLoginApi` 和 `apis/xhs_creator_login_apis.py` 的 `XHSCreatorLoginApi`，都有 `qrcode_login`、`phone_login`。
- **上游凭证来源**：`.env` 的 `COOKIES`。
- **API**（实例方法）
  - `apis/xhs_pc_apis.py` 的 `XHS_Apis`：`get_note_info(url)`、`get_user_info`、`get_user_me`、`get_user_all_notes`、`get_user_all_like_note_info`、`get_user_all_collect_note_info`、`search_note`、`search_some_note`、`search_user`、`get_note_all_comment`、`get_homefeed_recommend`、`get_unread_message`、`get_all_metions`、`get_note_no_water_video/img`
  - `apis/xhs_creator_apis.py` 的 `XHS_Creator_Apis`：`post_note`、`upload_media`、`get_all_posted_notes`
  - 直播：`apis/xhs_live.py`
  - 蒲公英 `apis/xhs_pugongying_apis.py`、千帆 `apis/xhs_qianfan_apis.py`：不移植（AGENTS 4.12）
- **JS 资产**（npm 依赖 `crypto-js`）
  - `xhs_utils/xhs_core/js/`：`sign.js`、`xs_common.js`、`b1.js`、`mns.js`、`websectiga_cli.js`、`websectiga_env.js`，以及 mns keystream 的 JSON
  - `xhs_utils/xhs_pc/js/`：`sign.js`、`xs_common.js`、`b1.js`、`mns.js`、`rap.js`、`rap_cli.js`、`rap_crypto.js`、`web_ssk.js`、`aes_encrypt.js`、`aes_decrypt.js`、`deflate.js`、`profile.js`，以及模板 / profile 的 JSON
  - `xhs_utils/xhs_creator/js/`：`xhs_creator_sign.js`、`xhs_creator_signature.js`、`profile.js`，以及指纹 / profile 的 JSON
- **注意**：拿笔记详情需要 `xsec_token`，所以优先传 URL；catbus 输出的 xhs `url` 都带上它。

### douyin — DouYin_Spider

- **鉴权**
  - `builder/auth.py` 的 `DouyinAuth.perepare_auth(cookieStr, web_protect_, keys_)`（方法名原文如此拼写）。
  - 私信签名还需要 `ticket`、`ts_sign`、`client_cert`、`private_key`，以及绑定设备的 `dtrait_blob`。catbus 里放在凭证文件的 `tokens` / `device`。
- **登录**：`dy_apis/login_api.py` 的 `DYLoginApi`：`qrcode_login`、`send_sms_code`、`phone_login`、`save_credential`、`get_login_auth`。
- **上游凭证来源**：`.env` 的 `DY_COOKIES`、`DY_LIVE_COOKIES`、`DY_TICKET`、`DY_TS_SIGN`、`DY_CLIENT_CERT`、`DY_PRIVATE_KEY`、`DY_DTRAIT_BLOB`。
- **API**（静态方法，第一个参数为 `auth`）
  - `dy_apis/douyin_api.py` 的 `DouyinAPI`：`get_work_info(url)`、`get_user_info(user_url)`、`get_user_all_work_info`、`get_work_all_comment`、`search_general_work`、`search_user`、`search_live`、`get_user_favorite`、`get_collect_list`、`get_user_follower_list/following`、`get_notice_list`、`get_feed`、`get_live_info`、`digg`、`publish_comment`、`collect_aweme`、`create_conversation`、`send_msg/image/video`
  - 商品：`get_live_production` / `get_all_live_production`（直播间商品）、`get_live_production_detail`（→ `product get`）、`get_product_comments`（→ 商品评价，需要 `product_id` 和 `shop_id`）
  - `dy_apis/douyin_creator_api.py` 的 `DouyinCreatorAPI`：`post_images`、`post_video`
- **JS 与 proto 资产**（无第三方 npm 依赖）
  - `static/{Live,PK,Request,Response}.proto`，旁边是对应的 pb2
  - `utils/acrawler_runtime/`：`ac_vm.js`、`run_ac_node.js`、`browser_window_shape.json`、`canvas_actual_exact.json`
  - `utils/challenge_template_runner.js`
  - `utils/challenge_profile.json`、`utils/mstoken_common_profile.json`、`utils/mstoken_profile.json`
- **注意**：`newsign/package.json` 声明了 `jsdom`、`canvas`、`sdenv`、`jsrsasign`，但没有任何代码引用，是遗留文件，不用管。

### tiktok — TiktokApis

- **鉴权**
  - `builder/auth.py` 的 `TiktokAuth.from_cookie(cookie_str)`。
  - 以存在 `sessionid`、`sid_tt` 或 `multi_sids` 之一判断已登录。
- **登录**：`api/tiktok_login.py` 的 `TiktokLoginAPI` 只有占位，调用即抛 `NotImplementedError`。所以只支持 cookie 登录。
- **上游凭证来源**：`demo.py` 读 `TIKTOK_COOKIE`。
- **API**：`api/tiktok.py` 的 `TiktokAPI`，继承自 `api/tiktok_web.py` 的 `TiktokWebAPI`，方法接收 `cookies_str`：
  - `get_user_posted(secUid)`、`get_user_info(user_url)`、`get_video_detail(video_url)`、`get_all_comments`、`post_comment`
  - 商城：`get_shop_product_detail`（→ `product get`）、`get_shop_product_reviews` / `get_all_shop_product_reviews`（→ 商品评价）
  - 其他：收藏、关注与粉丝列表、`post_item_digg`、`post_follow_user`、私信（`api/tiktok_chat.py`）、`creator_publish`、`creator_publish_photos`
- **JS 与 proto 资产**
  - `static/Tiktok_Request_pb2.py`：只有 pb2，没有 .proto。需要从 pb2 里的序列化 descriptor 导出 schema 给 protobufjs。
  - `signing/env/`：`env_core.js`、`sign.js`
  - `signing/source/`：`webmssdk.js`、`webmssdk_ex.js`、`webmssdk_legacy.js`
  - `signing/sdk_config.json`
  - `reverse/tiktok_shop_bsid/env/`：7 个 JS，商城签名用
  - 要移植成 TS 的 Python 签名：`signing/` 下的 `aws_v4.py`、`live_wire.py`、`protobuf.py`、`pure.py`、`shop_bsid.py`、`ticket_guard.py`
- **注意**：上游用了 `protobuf3_to_dict`，移植后用 protobufjs 的 `toObject` 代替。

### bilibili — BilibiliApis

- **鉴权**
  - `builder/auth.py` 的 `BiliAuth`：`from_cookie`、`from_qrcode_login`、`from_sms_login`、`from_session(path)`（读 session.json，支持自动刷新）、`anonymous`。
  - `is_login` 看 `SESSDATA`，csrf 取自 `bili_jct`。
- **登录**：`apis/bili_login_apis.py` 的 `BiliLoginApi`：`qrcode_login`、`sms_login`、`password_login`、`refresh_cookies`、`logout`。
  - `refresh_cookies` 对应 catbus 的自动刷新；`logout` 是 10 个平台里唯一的服务端登出。
- **上游凭证来源**：仓库根目录的 `session.json`（`utils/session.py` 写入），`cookies.txt` 是兼容镜像。
- **API**（静态方法，第一个参数为 `auth`）
  - `apis/bili_apis.py` 的 `BiliApi`：`get_nav`、`search_type`、`get_video_info(bvid/aid)`、`get_video_detail`、`get_play_url`、`get_danmaku_seg`、`get_replies(oid)`、`get_user_info(mid)`、`get_user_videos`、`get_all_user_videos`、`get_rcmd_feed`、`get_popular`、`get_subtitle_view`、`report_heartbeat`
  - `apis/bili_creator_apis.py`：`post_video`、`delete_archive`、`get_my_archives`、`post_dynamic`、`remove_dynamic`、`save_article_draft`、`submit_article`
  - `apis/bili_interact_apis.py`：`like`、`add_coin`、`favour`、`triple`、`add_reply`、`delete_reply`、`send_danmaku`
  - `apis/bili_live_apis.py`：`get_room_info`、`send_gift`、`send_danmaku`、`start_live`、`stop_live`
- **JS 资产**
  - `tools/sc_encrypt_bridge.js`：`apis/bili_gaia_apis.py:662` 调用，做风控指纹的加密上报。
  - 它还需要 `_gt/bili-sc-sdk.js`（`bili_gaia_apis.py:67`）。这是从 CDN 下载的第三方 SDK，上游不入库，多数环境里不存在。缺它时上游只发明文上报，已实证写接口照样成功。
  - catbus 的做法：只移植明文上报这一路，不复制 `sc_encrypt_bridge.js`。
- **验证码**：极验点选，`tools/geetest_solve.py`、`utils/geetest_hybrid.py`、`utils/geetest_metric.py`、`utils/geetest_ocr.py`，依赖 ddddocr、scipy、numpy、Pillow。

### kuaishou — KuaiShou-Spider

- **鉴权**
  - `builder/auth.py` 的 `KuaishouAuth`：`prepare_auth(cookie_str)`、`initialize()`。
  - `kwscode` / `kwssectoken` 只有 6 分钟有效期，每次使用时现算，不落盘。
  - cookie 分三个站点：www、cp（创作者）、live。发布需要 `kuaishou.web.cp.api_st` 和 `kuaishou.web.cp.api_ph`。
- **登录**：`ks_apis/login_api.py` 的 `KuaishouLoginAPI`：`login_by_qr`、`request_mobile_code`、`login_by_mobile_code`、`sts_login`、`pass_token_login`、`login_browser_session`。
  - `sts_login` / `pass_token_login` 用来换取子站点凭证，登录时一并完成。
- **上游凭证来源**：`.env` 的 `KS_COOKIES`。
- **API**
  - `ks_apis/kuaishou_api.py` 的 `KuaishouAPI`：`get_feed_hot`、`get_work_info`、`get_video_detail`、`get_comment_list`、`get_all_comment`、`get_sub_comment_list`、`get_profile`、`get_profile_feed`、`get_user_all_work`、`search_feed`、`search_user`、`get_relation`、`get_liked_list`、`get_collect_list`、`get_history_list`、`graphql`
  - 直播：`ks_apis/live_api.py` 的 `KuaishouLiveAPI`；弹幕：`ks_apis/live_ws.py` 的 `LiveDanmakuClient`
  - 发布：`ks_apis/publish_api.py` 的 `KuaishouPublishAPI`
- **JS 与 proto 资产**
  - `reverse/bundles/weapon/`：21 个 JS（kwf，以及 kws-0 到 kws-19）
  - `reverse/js/cp-kwf.js`
  - `reverse/tools/`：`kwf_oracle.js`、`kws_oracle.js`、`like_token_oracle.js`
  - `reverse/fixtures/live_ws_proto.json`：直播 proto，可直接作为 protobufjs `Root.fromJSON` 的输入
  - `reverse/fixtures/live_ws_maps.json`：`utils/live_proto.py` 用到的映射表
- **Python 侧签名**：`utils/sign/weapon_oracle.py`、`like_token.py`，要移植成 TS。

### weibo — WeiboApis

- **鉴权**：没有鉴权对象，各方法直接接收 `cookies_str`。
- **登录**：上游没有，只支持 cookie 登录。
- **上游凭证来源**：无。仓库另带一个 FastAPI 服务 `app.py`，不移植。
- **API**
  - `apis/weibo_apis.py` 的 `WeiboApis`：`get_self_info`、`getUserInfo`、`getUserPosted`、`getWordComments`、`getWorkInfo`、`searchSome`、`get_user_all_posted`
  - `apis/weibo_mobile_apis.py` 的 `WeiboMobileApis`（m.weibo，不需要 cookie）：`getWorkInfo`、`searchSome`。游客走这一路。
  - `apis/weibo_creator_apis.py` 的 `WeiboCreaterApis.post_weibo`
- **JS 资产**：`static/weibo.js` 存在，但 Python 里没有引用，不复制。

### xianyu — XianYuApis

- **鉴权**：没有独立的鉴权类。`build_initial_cookies()` 生成初始 cookie（含 `tfstk`），`XianyuApis` 内部负责 `get_token` / `refresh_token`。
- **登录**：`goofish_apis.py` 里的函数 `qrcode_login()`。
- **上游凭证来源**：无。
- **API**
  - `goofish_apis.py` 的 `XianyuApis`：`get_item_info(item_id)`、`public`（发布商品）、`upload_media`、`get_default_location`
  - 私信：`goofish_live.py` 的 `XianyuLive`（async WebSocket）：`create_chat`、`send_msg`、`list_all_conversations(cid)`（→ `msg history`）
- **JS 资产**
  - `static/goofish_js_origin_version_2.js`、`static/goofish_js_version_1.js`、`static/goofish_js_version_2.js`
  - `utils/et_f.js`、`utils/gen_tfstk.js`
- **注意**：上游用相对 CWD 的路径读 JS。catbus 从 `static/xianyu/` 按包内路径加载，不受 CWD 影响。

### taobao — TaoBaoApis

与闲鱼同属阿里系，结构几乎一致：mtop 签名 + 钉钉 wss 私信。

- **鉴权**：没有独立的鉴权类，`TaobaoApis(cookies, device_id)` 直接接收 cookie 字典。`get_token()` 调 `mtop.taobao.login.token.get.h5`，签名用 `_m_h5_tk`。
- **登录**：上游没有，只支持 cookie 登录。
- **上游凭证来源**：无。
- **API**
  - `taobao_apis.py` 的 `TaobaoApis`：`get_token`、`get_goods_uid_encrypt_uid(goods_url)`（从商品页 HTML 里取卖家 `uid` / `encrypt_uid`，供 `msg send --item` 用）、`upload_media`
  - 私信：`taobao_live.py` 的 `taobaoLive(cookies_str)`（async WebSocket）：`list_all_conversations(cid)`（→ `msg history`）、`create_chat`、`send_msg`
  - `utils/taobao_utils.py`：`generate_sign`、`generate_mid`、`generate_uuid`、`generate_device_id`、`decrypt`（实际是 base64 + MessagePack，由上游 JS 解码；import 了 blackboxprotobuf 但没用）、`trans_cookies`
- **JS 资产**：`static/taobao_js_20260407.js`
- **注意**
  - 上游**没有商品详情和商品搜索接口**。`item_detail_url` 字段是从闲鱼代码带过来的，没有使用。矩阵里 `item get` / `item search` 是 ○。
  - 与闲鱼一样，上游用相对 CWD 的路径读 JS；catbus 按包内路径加载。

### jd — JdApis

- **鉴权**
  - `builder/auth.py` 的 `JdAuth`，需要 `pt_key` 和 `pt_pin`。
  - 按 origin 保存 localStorage，catbus 里放在凭证文件的 `device`。
  - `update_cookies(persist=)`、`flush()`。
- **登录**：`jd_apis/jd_login_api.py` 的 `JdLoginAPI.qr_login`，以及 `jd_apis/jd_sms_login_api.py` 的 `JdSmsLoginAPI.login`。
- **上游凭证来源**：`default_auth_path()`，可用 `JDAPIS_AUTH_FILE` 覆盖。
  - Windows：`%LOCALAPPDATA%/JdApis/auth.json`
  - macOS：`~/Library/Application Support/JdApis/auth.json`
  - Linux：`$XDG_STATE_HOME/JdApis/auth.json`
- **API**：`jd_apis/jd_api.py` 的 `JdAPI`
  - `get_product_detail(sku)`、`get_product_comments`、`search`、`search_wares`、`get_browse_history`、`get_follow_products`、`get_cart_num`、`check_session`、`diagnose`
  - `get_order_list`（`:1348`，→ 扩展 `order list`）、`get_recommend_coupon(sku)`（`:929`，→ 扩展 `coupon list`）
  - 客服：聊天相关方法，以及 `jd_apis/jd_chat_ws.py` 的 `JdChatWS`
- **JS 资产**（npm 依赖 `jsdom`、`@napi-rs/canvas`）
  - `static/`：`h5st5_env.js`、`h5st5_lib.js`、`h5st5_server.js`、`pc_tk_lib.js`、`pc_tk_server.js`、`summer_cryptico_runner.js`
  - `static/webm/env/run.js`、`static/webm/run/jdwebm-riskhandle.js`
  - `static/jcap/env/`：`env_core.js`、`run.js`；`http_bridge.py` 要移植成 TS
  - `static/jcap/run/`：`jcap_ujb96b.js`；`captcha_solver.py` 要移植成 TS
  - `static/jcap/run/models/`：`orientation_model_v2_0.9882.onnx`、`u2netp.onnx`，共约 81 MB，放进 `@cv-cat/catbus-assets-jd`，不复制到 `static/`
  - 调用这些 JS 的 Python：`utils/h5st5.py`、`utils/device_token.py`、`utils/jcap_solver.py`、`utils/summer_cryptico.py`、`utils/webm.py`
- **注意**：上游 JS 用 `createRequire(<项目根>/package.json)` 解析 npm 模块。catbus 在 vm 里注入的 `require` 指向自己的 `node_modules`（见 AGENTS.md 7.4）。
- **验证码**：JCAP，依赖 onnxruntime、opencv、scikit-image、scipy。

### x — XApis

- **鉴权**
  - `builder/auth.py` 的 `XAuth.prepare_auth(cookies_str)`，需要 `auth_token` 和 `ct0`。
  - 支持 guest token（见 1.2）。
- **登录**：`x_apis/login_api.py`
  - `XLoginApi.login_by_password`
  - `XJetfuelLoginApi`：`login_by_password`、`login_by_password_pure`，后者需要 Castle profile。
- **上游凭证来源**：`.env` 的 `X_COOKIES`、`X_USERNAME`、`X_PASSWORD`、`X_PROXY`，以及 Castle profile 的 `CASTLE_PURE_RL_FILE`、`CASTLE_PURE_ONLY`。
- **API**（静态方法，第一个参数为 `auth`）
  - `x_apis/x_api.py` 的 `XAPI`：`get_work_info`、`get_work_comments`、`get_all_work_comments`、`search_work`、`get_user_info(user_name)`、`get_user_post_note`、`get_user_all_post_note`、`get_home_timeline`、`get_viewer`
  - `x_apis/x_write_api.py` 的 `XWriteAPI`：`post_tweet`、`delete_tweet`、`favorite`、`retweet`、`bookmark`、`follow/unfollow`
  - 媒体上传：`x_apis/x_media_api.py` 的 `XMediaAPI.upload`；私信：`x_apis/x_dm_api.py` 的 `XChatAPI`
- **JS 资产**（catbus 暂未移植账密登录，Castle 与 ui_metrics 没有复制）
  - `static/castle/`：`castle.js`、`castle.umd-BneRArir.js`、`env_core.js`、`rolldown-runtime-XXLRXQBO.js`、`run.js`、`castle_meta.json`、`chromium_zlib.meta.json`
  - `static/ui_metrics.js`
  - `static/graphql.json`（GraphQL 操作表）、`static/transaction_l1.json`
  - 调用这些 JS 的 Python：`utils/castle_token.py`、`utils/ui_metrics.py`
