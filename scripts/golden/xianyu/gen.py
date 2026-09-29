"""xianyu 的对拍数据：用上游 XianYuApis 的代码构造 HTTP 请求与私信长连的帧（只用假凭证）。

运行：.golden/xianyu/Scripts/python.exe scripts/golden/xianyu/gen.py（macOS / Linux 为 .golden/xianyu/bin/python）
依赖：uv pip install -r references/XianYuApis/requirements.txt PyExecJS blackboxprotobuf pydantic typing_extensions websockets

补丁（只在本脚本里）：
- 上游 utils/goofish_utils.py 把 subprocess.Popen 换成了 partial，之后再 import asyncio 会在 Windows 上报错，所以先 import asyncio。
- requests：按真实 requests 的 prepare_request 合并 session 的 cookie（按域名匹配）与请求头；
  请求头只记上游显式设置的（请求级的，加上 session 上改过的 User-Agent），requests 库自己的默认头
  （python-requests UA、Connection 等）不算；files= 上传记录各个表单字段；响应的 Set-Cookie 按域名并入 session。
- 上游 gen_tfstk.js 在本仓库里会被根目录 package.json 的 "type": "module" 当成 ESM 而跑不起来，
  复制到临时目录再让上游的 _gen_tfstk 去跑（脚本本身不变）。
- 上游 bug：goofish_utils 把 subprocess.Popen 换成了 encoding="utf-8" 的 partial，_gen_tfstk 的
  check_output 于是返回 str，`.decode()` 抛错被吞掉，tfstk 永远是空串（utils/build_cookies.py 单独跑时正常）。
  这里在 _gen_tfstk 调用期间换回原来的 Popen，对拍按它的本意（生成 tfstk）来。
- websockets.connect 换成假连接：记录握手头和发出的每一帧，按脚本推送收到的帧。
"""

import asyncio  # noqa: F401 — 必须先于上游模块导入，见上
import base64
import json
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catbus_golden as g  # noqa: E402

out = g.setup('xianyu', 'XianYuApis')

import requests  # noqa: E402
import websockets  # noqa: E402
from requests.utils import default_headers  # noqa: E402

# ---------------------------------------------------------------- requests


def _set_cookies(session, url, resp):
    host = urlparse(url).hostname
    for line in resp.headers.get_list('set-cookie'):
        pair, *attrs = line.split(';')
        name, _, value = pair.partition('=')
        domain, path = host, '/'
        for a in attrs:
            k, _, v = a.strip().partition('=')
            if k.lower() == 'domain' and v:
                domain = '.' + v.lstrip('.').lower()
            elif k.lower() == 'path' and v:
                path = v
        session.cookies.set(name.strip(), value.strip(), domain=domain, path=path)


def _request(self, method, url, params=None, data=None, headers=None, cookies=None, files=None, json=None, **kwargs):
    p = self.prepare_request(requests.Request(method.upper(), url, params=params, data=data, headers=headers,
                                              cookies=cookies, files=files, json=json))
    defaults = default_headers()
    # 显式头：session 上改过默认值的，再按 dict 合并请求级的（已有的键原位改值，新键追加）
    explicit = {}
    for k, v in self.headers.items():
        if defaults.get(k) != v:
            explicit[k.lower()] = (k, v)
    for k, v in (headers or {}).items():
        if v is None:
            explicit.pop(k.lower(), None)
        else:
            explicit[k.lower()] = (k, v)
    pairs = list(explicit.values())
    # requests 按请求体补的 Content-Type（表单、json）追加在最后
    if not files and 'content-type' not in explicit and p.headers.get('Content-Type'):
        pairs.append(('Content-Type', p.headers['Content-Type']))
    if p.headers.get('Cookie'):
        pairs.append(('Cookie', p.headers['Cookie']))
    hdrs, cks = g._split_cookie_headers(pairs)
    mp = None
    body = p.body
    if files:
        mp = []
        for name, (filename, content, ctype) in files.items():
            if hasattr(content, 'read'):
                content.seek(0)  # prepare_request 已经读过一遍
                content = content.read()
            mp.append({'name': name, 'filename': filename, 'contentType': ctype, 'data': g._encode_body(content)})
        body = None
    resp = g._respond({'method': p.method, 'url': p.url, 'headers': hdrs, 'cookies': cks, 'body': g._encode_body(body), 'multipart': mp})
    _set_cookies(self, p.url, resp)
    return resp


requests.Session.request = _request

# ---------------------------------------------------------------- 假的 WebSocket


class FakeWs:
    """sent 记录发出的原始字符串；script 是 (等发出多少帧之后, 要推送的帧) 的列表，推完即关闭."""

    def __init__(self, script=()):
        self.sent = []
        self.delivered = []
        self.script = list(script)
        self.url = None
        self.headers = None

    async def send(self, data):
        self.sent.append(data)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.script:
            raise StopAsyncIteration
        after, frame = self.script[0]
        for _ in range(1000):
            if len(self.sent) >= after:
                break
            await asyncio.sleep(0)
        else:
            raise RuntimeError(f'等不到第 {after} 帧，已发 {len(self.sent)} 帧')
        self.script.pop(0)
        data = json.dumps(frame, ensure_ascii=False)
        self.delivered.append({'after': after, 'data': data})
        return data

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


_next_ws = [FakeWs()]


def _connect(url, extra_headers=None, **kwargs):
    ws = _next_ws[0]
    ws.url = url
    ws.headers = [[k, v] for k, v in (extra_headers or {}).items()]
    return ws


websockets.connect = _connect

import goofish_apis  # noqa: E402
from goofish_apis import XianyuApis, qrcode_login  # noqa: E402
from goofish_live import XianyuLive  # noqa: E402
from message import make_image, make_text  # noqa: E402
from utils.goofish_utils import decrypt, generate_device_id, generate_mid, generate_sign, generate_uuid, trans_cookies  # noqa: E402

# gen_tfstk.js 复制到临时目录（见文件头）
_tf = Path(tempfile.mkdtemp())
(_tf / 'utils').mkdir()
for f in ('gen_tfstk.js', 'et_f.js'):
    shutil.copy(g.ROOT / 'references' / 'XianYuApis' / 'utils' / f, _tf / 'utils' / f)
goofish_apis._HERE = _tf

_orig_gen_tfstk = goofish_apis._gen_tfstk


def _gen_tfstk(*args, **kwargs):
    patched = subprocess.Popen
    subprocess.Popen = getattr(patched, 'func', patched)
    try:
        return _orig_gen_tfstk(*args, **kwargs)
    finally:
        subprocess.Popen = patched


goofish_apis._gen_tfstk = _gen_tfstk

# main() 起的保活线程是 `while True: time.sleep(600)`，time.sleep 被换成空操作后会空转，停掉它
XianyuLive.user_alive = lambda self: None

# ---------------------------------------------------------------- 假凭证与假响应

MY_ID = '2200000001'
PEER_ID = '2200000999'
CID = '47000000001'
ITEM_ID = '900000000001'
TOKEN = '0123456789abcdef0123456789abcdef'
COOKIES = (f'cna=fakecna; cookie2=fakecookie2; t=faket; _tb_token_=faketbtoken; unb={MY_ID}; tracknick=tester; '
           f'sgcookie=fakesg; _m_h5_tk={TOKEN}_1790003600000; _m_h5_tk_enc=fakeenc')

OK = ['SUCCESS::调用成功']


def mtop(api, data, ret=None, v='1.0', cookies=()):
    body = {'api': api, 'data': data, 'ret': ret or OK, 'v': v}
    return {'status': 200, 'headers': {'set-cookie': list(cookies)} if cookies else {}, 'body': body}


UPLOAD_OK = {'success': True, 'status': 0, 'object': {'fileId': 12345678901, 'url': 'https://img.alicdn.com/imgextra/fake.png',
                                                     'size': 68, 'pix': '100x80'}}
DETAIL = {
    'itemDO': {'itemId': int(ITEM_ID), 'title': '九成新机械键盘', 'desc': '九成新机械键盘，青轴', 'soldPrice': '199.00',
               'gmtCreate': 1789990000000, 'browseCnt': 321, 'wantCnt': 12, 'collectCnt': 0, 'itemStatus': 0,
               'imageInfos': [{'url': 'http://img.alicdn.com/bao/uploaded/fake1.jpg', 'widthSize': 800, 'heightSize': 600, 'major': True},
                              {'url': 'http://img.alicdn.com/bao/uploaded/fake2.jpg', 'widthSize': 640, 'heightSize': 640}]},
    'sellerDO': {'sellerId': int(PEER_ID), 'nick': '测试卖家', 'city': '杭州'},
}
CHANNEL = {
    'cardList': [
        {'cardData': {'propertyId': '-10000', 'propertyName': '分类', 'valuesList': [
            {'catName': '键盘', 'channelCatId': '201456789', 'tbCatId': '50012345', 'isClicked': False},
            {'catName': '机械键盘', 'channelCatId': '201456790', 'tbCatId': '50012346', 'isClicked': True},
            {'catName': '其他', 'channelCatId': '201456791', 'tbCatId': '50012347', 'isClicked': True}]}},
        {'cardData': {'propertyId': '20000', 'propertyName': '品牌'}},
    ],
    'categoryPredictResult': {'catId': 50012346, 'catName': '机械键盘', 'channelCatId': 201456790, 'tbCatId': 50012346},
}
LOCATION = {'commonAddresses': [{'area': '玄武区', 'city': '南京', 'divisionId': 320102, 'longitude': 118.78248, 'latitude': 31.91629,
                                 'poiId': 'B0FFFAKE01', 'poi': '测试小区', 'prov': '江苏'}]}


def respond(req):
    url = req['url']
    for api, data in [('mtop.taobao.idlemessage.pc.login.token', {'accessToken': 'fake-access-token', 'refreshToken': 'fake-refresh'}),
                      ('mtop.taobao.idlemessage.pc.loginuser.get', {'userId': int(MY_ID), 'nick': 'tester'}),
                      ('mtop.taobao.idle.pc.detail', DETAIL),
                      ('mtop.taobao.idle.kgraph.property.recommend', CHANNEL),
                      ('mtop.taobao.idle.local.poi.get', LOCATION),
                      ('mtop.idle.pc.idleitem.publish', {'itemId': ITEM_ID})]:
        if api in url:
            return mtop(api, data)
    if 'stream-upload' in url:
        return UPLOAD_OK
    return {}


def case(name, fn, respond_fn=respond, **input):
    g.case(out, name, fn, input=input, respond=respond_fn)


def api():
    cookies = trans_cookies(COOKIES)
    return XianyuApis(cookies, generate_device_id(cookies['unb']))


# ---------------------------------------------------------------- MessagePack（推送解码用）


def msgpack(v):
    """最小的 MessagePack 编码器：32 字节以上的字符串用 str16（上游 JS 不支持 str8）."""
    if isinstance(v, dict):
        return bytes([0x80 | len(v)]) + b''.join(msgpack(k) + msgpack(x) for k, x in v.items())
    if isinstance(v, bool):
        return b'\xc3' if v else b'\xc2'
    if isinstance(v, int):
        if 0 <= v < 128:
            return bytes([v])
        if v < 1 << 32:
            return b'\xce' + struct.pack('>I', v)
        return b'\xcf' + struct.pack('>Q', v)
    b = v.encode()
    return (bytes([0xa0 | len(b)]) if len(b) < 32 else b'\xda' + struct.pack('>H', len(b))) + b


def push(sender, nick, content, summary, msg_id, content_type):
    ext = {'reminderContent': summary, 'reminderTitle': nick, 'senderUserId': sender,
           'reminderUrl': f'fleamarket://message_chat?itemId={ITEM_ID}&peerUserId={sender}&sid={CID}'}
    return base64.b64encode(msgpack({1: {1: {1: sender + '@goofish'}, 2: CID + '@goofish', 3: msg_id, 4: 0, 5: 1790000000555,
                                          6: {1: 101, 3: {1: '', 2: summary, 3: '', 4: content_type, 5: json.dumps(content, ensure_ascii=False)}},
                                          7: 1, 8: 1, 9: 0, 10: ext}, 3: {'needPush': 'true'}})).decode()


PUSHES = [
    push(PEER_ID, '测试买家', {'contentType': 1, 'text': {'text': '还在吗？能便宜点吗'}}, '还在吗？能便宜点吗', '3400000000001.PNM', 1),
    push(PEER_ID, '测试买家', {'contentType': 2, 'image': {'pics': [{'type': 0, 'url': 'https://img.alicdn.com/fake.png', 'width': 100, 'height': 80}]}},
         '[图片]', '3400000000002.PNM', 2),
    push(MY_ID, 'tester', {'contentType': 1, 'text': {'text': '自己发的'}}, '自己发的', '3400000000003.PNM', 1),
]
STATUS_PUSH = base64.b64encode(msgpack({1: CID + '@goofish', 2: 1, 3: {'redReminder': '等待买家付款', 'redReminderStyle': '1'}, 4: 1790000000555})).decode()

# ---------------------------------------------------------------- 纯算：上游 JS


def pure():
    return {
        'device_id': generate_device_id(MY_ID),
        'mid': generate_mid(),
        'uuid': generate_uuid(),
        'sign': generate_sign('1790000000000', TOKEN, '{"itemId":"中文"}'),
        'decrypt': [decrypt(p) for p in PUSHES + [STATUS_PUSH]],
        'tfstk': goofish_apis._gen_tfstk(),
    }


case('pure', pure, pushes=PUSHES + [STATUS_PUSH])

# ---------------------------------------------------------------- 初始 cookie（含 tfstk）：扫码登录的第一步（build_initial_cookies）

GUEST_COOKIES = {
    'log.mmstat.com': ['cna=FAKECNA0000000000000000; Domain=.mmstat.com; Path=/'],
    'mtop.taobao.idlehome.home.webpc.feed': ['mtop_partitioned_detect=1; Domain=goofish.com; Path=/',
                                             f'_m_h5_tk={TOKEN}_1790007200000; Domain=goofish.com; Path=/',
                                             '_m_h5_tk_enc=fakeenc0000; Domain=goofish.com; Path=/'],
    'mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get': ['cookie2=fakecookie20000; Domain=goofish.com; Path=/'],
}


def guest_respond(req):
    url = req['url']
    for key, cookies in GUEST_COOKIES.items():
        if key in url:
            if key == 'log.mmstat.com':
                return {'status': 200, 'headers': {'set-cookie': cookies}, 'body': 'window.goldlog=(window.goldlog||{});'}
            return mtop(key, {}, ret=['FAIL_SYS_TOKEN_EMPTY::令牌为空'], cookies=cookies)
    return respond(req)


def cookie_list(session):
    return sorted([c.name, c.value, c.domain] for c in session.cookies)



# ---------------------------------------------------------------- 登录态下的 HTTP：XianyuApis

case('get_token', lambda: api().get_token())


def token_retry_respond():
    state = {'n': 0}

    def fn(req):
        state['n'] += 1
        if state['n'] == 1:
            return mtop('mtop.taobao.idlemessage.pc.login.token', {}, ret=['FAIL_SYS_TOKEN_EXOIRED::令牌过期'], cookies=[
                '_m_h5_tk=fedcba9876543210fedcba9876543210_1790007200000;Path=/;Domain=goofish.com',
                '_m_h5_tk_enc=newenc;Path=/;Domain=goofish.com'])
        return respond(req)

    return fn


case('get_token_retry', lambda: api().get_token(), token_retry_respond())
case('refresh_token', lambda: api().refresh_token())
case('item_detail', lambda: api().get_item_info(ITEM_ID), item=ITEM_ID)
case('public_channel', lambda: api().get_public_channel('九成新机械键盘', [{'url': 'https://img.alicdn.com/imgextra/fake.png', 'width': 100, 'height': 80}]))
case('default_location', lambda: api().get_default_location())

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
_png = Path(tempfile.mkdtemp()) / '1.png'
_png.write_bytes(PNG)
case('upload_media', lambda: api().upload_media(str(_png)), filename='1.png', data=base64.b64encode(PNG).decode())

# 一口价 + 自提 + 价格；无图 + 包邮 + 不填价格；按距离计费；无需邮寄
case('publish', lambda: api().public([str(_png)], '九成新机械键盘', {'current_price': 199.9, 'original_price': 399},
                                     {'choice': '一口价', 'post_price': 12.5, 'can_self_pickup': True}),
     filename='1.png', data=base64.b64encode(PNG).decode())
case('publish_free', lambda: api().public([], '全新未拆封', None, {'choice': '包邮', 'can_self_pickup': False}))
case('publish_distance', lambda: api().public([], '按距离', {'current_price': 10, 'original_price': 0},
                                              {'choice': '按距离计费', 'can_self_pickup': False}))
case('publish_none', lambda: api().public([], '无需邮寄', {'current_price': 0.1, 'original_price': 0},
                                          {'choice': '无需邮寄', 'can_self_pickup': False}))

# ---------------------------------------------------------------- 扫码登录（完整流程）

LOGIN_COOKIES = [f'unb={MY_ID}; Domain=goofish.com; Path=/', 'tracknick=tester; Domain=goofish.com; Path=/',
                 'sgcookie=fakesg; Domain=goofish.com; Path=/', 'csg=fakecsg; Domain=goofish.com; Path=/']


def login_respond(req):
    url = req['url']
    if 'mini_login.htm' in url:
        return {'status': 200, 'headers': {'set-cookie': ['XSRF-TOKEN=fake-xsrf-token; Path=/',
                                                         '_tb_token_=faketbtoken; Domain=goofish.com; Path=/']}, 'body': '<html></html>'}
    if 'qrcode/generate.do' in url:
        return {'content': {'data': {'codeContent': 'https://passport.goofish.com/qrcodeCheck.htm?lgToken=fakeLgToken&tbScanOpenType=Notification',
                                     't': 1790000000123, 'ck': 'fakeck'}, 'success': True}}
    if 'qrcode/query.do' in url:
        return {'status': 200, 'headers': {'set-cookie': LOGIN_COOKIES},
                'body': {'content': {'data': {'qrCodeStatus': 'CONFIRMED', 'token': 'fake-login-token'}, 'success': True}}}
    if 'login_token/login.do' in url:
        return {'status': 200, 'headers': {'set-cookie': ['cookie2=fakecookie2login; Domain=goofish.com; Path=/']},
                'body': {'content': {'success': True}}}
    if 'mtop.idle.web.user.page.nav' in url:
        return mtop('mtop.idle.web.user.page.nav', {}, ret=['FAIL_SYS_TOKEN_EXOIRED::令牌过期'],
                    cookies=['_m_h5_tk=11112222333344445555666677778888_1790007200000; Domain=goofish.com; Path=/'])
    return guest_respond(req)


def login():
    x = qrcode_login(show_qrcode=False)
    return {'cookies': cookie_list(x.session), 'device_id': x.device_id}


case('qrcode_login', login, login_respond)

# ---------------------------------------------------------------- 私信长连


def live():
    return XianyuLive(COOKIES)


def ws_result(ws, result=None):
    return {'url': ws.url, 'headers': ws.headers, 'sent': ws.sent, 'server': ws.delivered, 'result': result}


def ws_init():
    ws = FakeWs()
    asyncio.run(live().init(ws))
    return ws_result(ws)


case('ws_init', ws_init)


def ws_frames():
    lv, ws = live(), FakeWs()

    async def run():
        await lv.create_chat(ws, PEER_ID, ITEM_ID)
        await lv.send_msg(ws, CID, PEER_ID, make_text('你好 "quote"'))
        await lv.send_msg(ws, CID, PEER_ID, make_image('https://img.alicdn.com/imgextra/fake.png', 100, 80))
        # heart_beat 是死循环：发出第一帧后取消
        task = asyncio.create_task(lv.heart_beat(ws))
        await asyncio.sleep(0)
        task.cancel()

    asyncio.run(run())
    return ws.sent


case('ws_frames', ws_frames, cid=CID, peer=PEER_ID, item=ITEM_ID)


def ws_send_to():
    """主动向指定用户发消息（README「主动发送」）：create_chat 不给 item_id 时用上游写死的默认商品，再 send_msg."""
    lv, ws = live(), FakeWs()

    async def run():
        await lv.create_chat(ws, PEER_ID)
        await lv.send_msg(ws, CID, PEER_ID, make_text('你好'))

    asyncio.run(run())
    return ws.sent


case('ws_send_to', ws_send_to, cid=CID, peer=PEER_ID)


def b64json(v):
    return base64.b64encode(json.dumps(v).encode()).decode()


HISTORY_BODY = {
    'hasMore': 1,
    'nextCursor': 1789990000000,
    'userMessageModels': [
        {'message': {'messageId': 'm3', 'cid': CID + '@goofish', 'createAt': 1789990000900,
                     'extension': {'reminderTitle': '测试买家', 'senderUserId': PEER_ID, 'reminderContent': '[图片]'},
                     'content': {'contentType': 101, 'custom': {'type': 2, 'data': b64json(
                         {'contentType': 2, 'image': {'pics': [{'type': 0, 'url': 'https://img.alicdn.com/fake.png', 'width': 100, 'height': 80}]}})}}}},
        {'message': {'messageId': 'm2', 'cid': CID + '@goofish', 'createAt': 1789990000500,
                     'extension': {'reminderTitle': '测试买家', 'senderUserId': PEER_ID, 'reminderContent': '还在吗'},
                     'content': {'contentType': 101, 'custom': {'type': 1, 'data': b64json({'contentType': 1, 'text': {'text': '还在吗'}})}}}},
        {'message': {'messageId': 'm1', 'cid': CID + '@goofish', 'createAt': 1789990000000,
                     'extension': {'reminderTitle': 'tester', 'senderUserId': MY_ID, 'reminderContent': '在的'},
                     'content': {'contentType': 101, 'custom': {'type': 1, 'data': b64json({'contentType': 1, 'text': {'text': '在的'}})}}}},
    ],
}


def ws_history():
    lv = live()
    mid = generate_mid()
    # 推送顺序：注册与同步发出后推 /s/vulcan，列表请求发出后回响应（hasMore=0 让上游停止翻页）
    ws = FakeWs([
        (2, {'lwp': '/s/vulcan', 'headers': {'mid': 'vulcan-mid', 'sid': 'vulcan-sid'}}),
        (4, {'code': 200, 'headers': {'mid': mid, 'sid': 'resp-sid', 'app-key': 'k', 'ua': 'u', 'dt': 'j'}, 'body': dict(HISTORY_BODY, hasMore=0)}),
    ])
    _next_ws[0] = ws
    result = asyncio.run(lv.list_all_conversations(CID))
    return ws_result(ws, result)


case('ws_history', ws_history, cid=CID)


def ws_history_pages():
    """两页：上游在同一条连接里接着翻，第二个请求的游标取第一页的 nextCursor."""
    lv = live()
    mid = generate_mid()
    ws = FakeWs([
        (2, {'lwp': '/s/vulcan', 'headers': {'mid': 'vulcan-mid', 'sid': 'vulcan-sid'}}),
        (4, {'code': 200, 'headers': {'mid': mid, 'sid': 'resp-sid'}, 'body': HISTORY_BODY}),
        (6, {'code': 200, 'headers': {'mid': mid, 'sid': 'resp-sid'}, 'body': {'hasMore': 0, 'nextCursor': 0, 'userMessageModels': []}}),
    ])
    _next_ws[0] = ws
    result = asyncio.run(lv.list_all_conversations(CID))
    return ws_result(ws, result)


case('ws_history_pages', ws_history_pages, cid=CID)


def text_model(msg_id, sender, nick, created, text):
    return {'message': {'messageId': msg_id, 'cid': CID + '@goofish', 'createAt': created,
                        'extension': {'reminderTitle': nick, 'senderUserId': sender, 'reminderContent': text},
                        'content': {'contentType': 101, 'custom': {'type': 1, 'data': b64json({'contentType': 1, 'text': {'text': text}})}}}}


# 三页，从新到旧：第一页只有自己发的消息，第二页是 HISTORY_BODY，第三页是最早的一条
HISTORY_PAGES = [
    {'hasMore': 1, 'nextCursor': 1789990002000, 'userMessageModels': [
        text_model('m6', MY_ID, 'tester', 1789990003000, '明天发货'),
        text_model('m5', MY_ID, 'tester', 1789990002000, '好的')]},
    HISTORY_BODY,
    {'hasMore': 0, 'nextCursor': 1789980000000, 'userMessageModels': [text_model('m0', PEER_ID, '测试买家', 1789980000000, '在吗')]},
]


def ws_history_all():
    """三页都在同一条连接里翻完（每收到一页就用 nextCursor 发下一页），结果反转成从旧到新."""
    lv = live()
    mid = generate_mid()
    ws = FakeWs([(2, {'lwp': '/s/vulcan', 'headers': {'mid': 'vulcan-mid', 'sid': 'vulcan-sid'}})] +
                [(4 + 2 * i, {'code': 200, 'headers': {'mid': mid, 'sid': 'resp-sid'}, 'body': body}) for i, body in enumerate(HISTORY_PAGES)])
    _next_ws[0] = ws
    result = asyncio.run(lv.list_all_conversations(CID))
    return ws_result(ws, result)


case('ws_history_all', ws_history_all, cid=CID)


def ws_listen():
    """上游 main()：注册、心跳、逐帧 ack；handle_message 解出消息后回一条 echo（示例代码，catbus 不回）."""
    lv = live()
    frames = [(3, {'lwp': '/s/para', 'headers': {'mid': 'status-mid', 'sid': 's0'},
                   'body': {'syncPushPackage': {'data': [{'data': '{"redReminder":"x"}'}]}}}),
              (4, {'lwp': '/s/sync', 'headers': {'mid': 'status-mid-2', 'sid': 's0'},
                   'body': {'syncPushPackage': {'data': [{'data': STATUS_PUSH}]}}}),
              (5, {'lwp': '/s/para', 'headers': {'mid': 'push-0', 'sid': 's1', 'app-key': 'k', 'ua': 'u', 'dt': 'j'},
                   'body': {'syncPushPackage': {'data': [{'data': PUSHES[0]}]}}}),
              (7, {'lwp': '/s/para', 'headers': {'mid': 'push-1', 'sid': 's2'},
                   'body': {'syncPushPackage': {'data': [{'data': PUSHES[1]}]}}}),
              (9, {'lwp': '/s/para', 'headers': {'mid': 'push-2', 'sid': 's3'},
                   'body': {'syncPushPackage': {'data': [{'data': PUSHES[2]}]}}})]
    ws = FakeWs(frames)
    _next_ws[0] = ws
    asyncio.run(lv.main())
    return ws_result(ws, {'decoded': [json.loads(decrypt(p)) for p in PUSHES]})


case('ws_listen', ws_listen, pushes=PUSHES)
