"""taobao 的对拍数据：用上游 TaoBaoApis 的代码构造 HTTP 请求与私信长连的帧（只用假凭证）。

运行：.golden/taobao/Scripts/python.exe scripts/golden/taobao/gen.py
依赖：uv pip install -r references/TaoBaoApis/requirements.txt PyExecJS blackboxprotobuf websockets pydantic typing_extensions

补丁（只在本脚本里）：
- 上游 utils/taobao_utils.py 把 subprocess.Popen 换成了 partial，之后再 import asyncio 会在 Windows 上报错，
  所以先 import asyncio。
- requests 的 files= 上传：记录各个表单字段（multipart），而不是带随机 boundary 的请求体。
- 响应里的 Set-Cookie 按真实 requests 的行为并入 session（domain 为 .taobao.com），get_token 的重试靠它拿到新令牌。
- websockets.connect 换成假连接：记录握手头和发出的每一帧，按脚本推送收到的帧。
"""

import asyncio  # noqa: F401 — 必须先于上游模块导入，见上
import base64
import json
import struct
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catbus_golden as g  # noqa: E402

out = g.setup('taobao', 'TaoBaoApis')

import requests  # noqa: E402
import websockets  # noqa: E402

# ---------------------------------------------------------------- requests：multipart 与 Set-Cookie

_framework_request = requests.Session.request


def _request(self, method, url, params=None, data=None, headers=None, cookies=None, files=None, **kwargs):
    if files:
        merged = dict(self.cookies.get_dict()) if self.cookies else {}
        p = requests.Request(method.upper(), url, params=params, headers=headers, cookies=merged).prepare()
        pairs = [(k, v) for k, v in p.headers.items() if k.lower() not in ('content-length', 'content-type')]
        hdrs, cks = g._split_cookie_headers(pairs)
        parts = []
        for name, (filename, content, ctype) in files.items():
            if hasattr(content, 'read'):
                content = content.read()
            parts.append({'name': name, 'filename': filename, 'contentType': ctype, 'data': g._encode_body(content)})
        resp = g._respond({'method': p.method, 'url': p.url, 'headers': hdrs, 'cookies': cks, 'body': None, 'multipart': parts})
    else:
        resp = _framework_request(self, method, url, params=params, data=data, headers=headers, cookies=cookies, files=files, **kwargs)
    for k, v in resp.cookies.get_dict().items():
        self.cookies.set(k, v, domain='.taobao.com', path='/')
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

from taobao_apis import TaobaoApis  # noqa: E402
from taobao_live import taobaoLive  # noqa: E402
from message import make_image, make_text  # noqa: E402
from utils.taobao_utils import decrypt, generate_device_id, generate_mid, generate_sign, generate_uuid, trans_cookies  # noqa: E402

# main() 起的保活线程是 `while True: time.sleep(600)`，time.sleep 被换成空操作后会空转，停掉它
taobaoLive.user_alive = lambda self: None

# ---------------------------------------------------------------- 假凭证与假响应

MY_ID = '2200000001'
PEER_ID = '2200000999'
CID = f'{MY_ID}.1-{PEER_ID}.1#11001'
COOKIES = (f'cna=fakecna; cookie2=fakecookie2; t=faket; _tb_token_=faketbtoken; unb={MY_ID}; _nk_=tester; '
           'sgcookie=fakesg; _m_h5_tk=0123456789abcdef0123456789abcdef_1790003600000; _m_h5_tk_enc=fakeenc')

TOKEN_OK = ' mtopjsonp3({"api":"mtop.taobao.login.token.get.h5","data":{"result":{"accessToken":"fake-access-token","refreshToken":"fake-refresh"}},"ret":["SUCCESS::调用成功"],"v":"2.0"})'
TOKEN_EXPIRED = ' mtopjsonp3({"api":"mtop.taobao.login.token.get.h5","data":{},"ret":["FAIL_SYS_TOKEN_EXOIRED::令牌过期"],"v":"2.0"})'
GOODS_HTML = ('<html><script>var g_config = {"sellerNick":"\\u6d4b\\u8bd5\\u5356\\u5bb6","shopName":"\\u6d4b\\u8bd5\\u5e97\\u94fa",'
              '"shopUrl":"//shop1.taobao.com","userId":"' + PEER_ID + '"};</script>'
              '<div class="shop" data-encryptuid="FAKEENCRYPTUID0001"></div></html>')
UPLOAD_OK = {'success': True, 'status': 0, 'object': {'fileId': 12345678901, 'url': 'https://img.alicdn.com/imgextra/fake.png',
                                                     'size': 68, 'pix': '100x80'}}


def respond(req):
    url = req['url']
    if 'mtop.taobao.login.token.get.h5' in url:
        return {'status': 200, 'headers': {}, 'body': TOKEN_OK}
    if 'stream-upload' in url:
        return UPLOAD_OK
    if 'item.htm' in url:
        return {'status': 200, 'headers': {'content-type': 'text/html'}, 'body': GOODS_HTML}
    return {}


def case(name, fn, respond_fn=respond, **input):
    g.case(out, name, fn, input=input, respond=respond_fn)


# ---------------------------------------------------------------- 纯算：上游 JS


def pure():
    return {
        'device_id': generate_device_id(MY_ID),
        'mid': generate_mid(),
        'uuid': generate_uuid(),
        'sign': generate_sign(1790000000000, '0123456789abcdef0123456789abcdef', '{"a":"中文"}'),
        'decrypt': decrypt('gQGRhAHaACgzODg4Nzc3MTA4LjEtMjU5MTU2MDE5Mi4xIzExMDAxQGNudGFvYmFvAgADAQSzMzg4ODc3NzEwOEBjbnRhb2Jhbw=='),
    }


case('pure', pure)

# ---------------------------------------------------------------- HTTP：TaobaoApis


def api():
    cookies = trans_cookies(COOKIES)
    return TaobaoApis(cookies, generate_device_id(cookies['unb']))


case('get_token', lambda: api().get_token())


def token_retry_respond():
    state = {'n': 0}

    def fn(req):
        state['n'] += 1
        if state['n'] == 1:
            return {'status': 200, 'body': TOKEN_EXPIRED, 'headers': {'set-cookie': [
                '_m_h5_tk=fedcba9876543210fedcba9876543210_1790007200000;Path=/;Domain=taobao.com;Max-Age=86400',
                '_m_h5_tk_enc=newenc;Path=/;Domain=taobao.com;Max-Age=86400']}}
        return {'status': 200, 'headers': {}, 'body': TOKEN_OK}

    return fn


# 只放 _m_h5_tk 两个 cookie：requests 把刷新后的 cookie 移到末尾（新的 domain 分组），catbus 原位更新；
# 两个都刷新时两边顺序才一致
case('get_token_retry', lambda: TaobaoApis(trans_cookies('_m_h5_tk=0123456789abcdef0123456789abcdef_1; _m_h5_tk_enc=oldenc'),
                                           generate_device_id(MY_ID)).get_token(),
     respond_fn=token_retry_respond())

# 上游 __main__ 里的例子（节选），带各种已编码的字符
GOODS_URL = ('https://detail.tmall.com/item.htm?id=806319949537&mi_id=0000vtiP2t7OiKuXSFJ6Os3CycYK4LfNyLsSkxffiJKUvKY'
             '&skuId=5652727063890&spm=a21bo.jianhua%2Fa.201876.d12.78632a89Xn5WRG'
             '&utparam=%7B%22item_ctr%22%3A0.05020460486412048%2C%22x_object_type%22%3A%22item%22%7D&xxc=home_recommend')
case('goods_uid', lambda: api().get_goods_uid_encrypt_uid(GOODS_URL), url=GOODS_URL)

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
_tmp = Path(tempfile.mkdtemp()) / '1.png'
_tmp.write_bytes(PNG)
case('upload_media', lambda: api().upload_media(str(_tmp)), filename='1.png', data=base64.b64encode(PNG).decode())

# ---------------------------------------------------------------- 私信长连


def live():
    return taobaoLive(COOKIES)


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
        await lv.create_chat(ws, 'FAKEENCRYPTUID0001')
        await lv.send_msg(ws, CID + '@cntaobao', PEER_ID, 'cntaobaotester', make_text('你好 "quote"'))
        await lv.send_msg(ws, CID + '@cntaobao', PEER_ID, 'cntaobaotester',
                          make_image(12345678901, 'https://img.alicdn.com/imgextra/fake.png', 68, 100, 80))
        # heart_beat 是死循环：发出第一帧后取消
        task = asyncio.create_task(lv.heart_beat(ws))
        await asyncio.sleep(0)
        task.cancel()

    asyncio.run(run())
    return ws.sent


case('ws_frames', ws_frames, cid=CID, peer=PEER_ID, encrypt_uid='FAKEENCRYPTUID0001')


def mid_of():
    return generate_mid()


HISTORY_BODY = {
    'hasMore': 1,
    'nextCursor': 1789990000000,
    'userMessageModels': [
        {'message': {'messageId': 'm2', 'cid': CID + '@cntaobao', 'createAt': 1789990000500, 'sender': {'uid': PEER_ID + '@cntaobao'},
                     'extension': {'sender_nick': 'cntaobao测试卖家'}, 'content': {'contentType': 1, 'text': {'content': '在的'}}}},
        {'message': {'messageId': 'm1', 'cid': CID + '@cntaobao', 'createAt': 1789990000000, 'sender': {'uid': MY_ID + '@cntaobao'},
                     'extension': {'sender_nick': 'cntaobaotester'},
                     'content': {'contentType': 101, 'custom': {'type': 7, 'data': base64.b64encode(json.dumps(
                         {'fileId': 1, 'size': 68, 'url': 'https://img.alicdn.com/imgextra/fake.png', 'width': 100, 'height': 80}).encode()).decode()}}}},
    ],
}


def ws_history():
    lv = live()
    mid = mid_of()
    # 推送顺序：注册与同步发出后推 /s/vulcan，列表请求发出后回响应（hasMore=0 让上游停止翻页）
    body = dict(HISTORY_BODY, hasMore=0)
    ws = FakeWs([
        (2, {'lwp': '/s/vulcan', 'headers': {'mid': 'vulcan-mid', 'sid': 'vulcan-sid'}}),
        (4, {'code': 200, 'headers': {'mid': mid, 'sid': 'resp-sid', 'app-key': 'k', 'ua': 'u', 'dt': 'j'}, 'body': body}),
    ])
    _next_ws[0] = ws
    result = asyncio.run(lv.list_all_conversations(CID))
    return ws_result(ws, result)


case('ws_history', ws_history, cid=CID)


def ws_history_pages():
    """两页：上游在同一条连接里接着翻，第二个请求的游标取第一页的 nextCursor."""
    lv = live()
    mid = mid_of()
    ws = FakeWs([
        (2, {'lwp': '/s/vulcan', 'headers': {'mid': 'vulcan-mid', 'sid': 'vulcan-sid'}}),
        (4, {'code': 200, 'headers': {'mid': mid, 'sid': 'resp-sid'}, 'body': HISTORY_BODY}),
        (6, {'code': 200, 'headers': {'mid': mid, 'sid': 'resp-sid'}, 'body': {'hasMore': 0, 'nextCursor': 0, 'userMessageModels': []}}),
    ])
    _next_ws[0] = ws
    result = asyncio.run(lv.list_all_conversations(CID))
    return ws_result(ws, result)


case('ws_history_pages', ws_history_pages, cid=CID)

# ---------------------------------------------------------------- 推送解码


def msgpack(v):
    """最小的 MessagePack 编码器：服务端对 32 字节以上的字符串用 str16（上游 JS 不支持 str8）."""
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


def push_text(sender, nick, text, msg_id):
    return base64.b64encode(msgpack({1: {1: {1: sender + '@cntaobao'}, 2: CID + '@cntaobao', 3: msg_id, 4: 0, 5: 1790000000555,
                                          6: {1: 1, 2: {1: text}}, 7: 1, 10: {'sender_nick': nick}}})).decode()


PUSHES = [
    push_text(PEER_ID, 'cntaobao测试卖家', '这个还有货吗？', '3400000000001.PNM'),
    push_text(MY_ID, 'cntaobaotester', '自己发的', '3400000000002.PNM'),
]


def ws_listen():
    """上游 main()：注册、心跳、逐帧 ack，handle_message 解出文字消息后回一条 echo（示例代码，catbus 不回）."""
    lv = live()
    frames = [(3, {'lwp': '/s/para', 'headers': {'mid': 'status-mid', 'sid': 's0'},
                   'body': {'syncPushPackage': {'data': [{'data': '{"redReminder":"x"}'}]}}}),
              (4, {'lwp': '/s/para', 'headers': {'mid': 'push-0', 'sid': 's1', 'app-key': 'k', 'ua': 'u', 'dt': 'j'},
                   'body': {'syncPushPackage': {'data': [{'data': PUSHES[0]}]}}}),
              (6, {'lwp': '/s/para', 'headers': {'mid': 'push-1', 'sid': 's2'},
                   'body': {'syncPushPackage': {'data': [{'data': PUSHES[1]}]}}})]
    ws = FakeWs(frames)
    _next_ws[0] = ws
    asyncio.run(lv.main())
    return ws_result(ws, {'decoded': [json.loads(decrypt(p)) for p in PUSHES]})


case('ws_listen', ws_listen, pushes=PUSHES)
