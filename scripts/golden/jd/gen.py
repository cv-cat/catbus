"""jd 的对拍数据：用上游 JdApis 的代码构造请求（只用假凭证），记录请求序列。

运行：.golden/jd/Scripts/python scripts/golden/jd/gen.py
依赖：uv pip install -r references/JdApis/requirements.txt；references/JdApis 下 npm install（jsdom、@napi-rs/canvas）

上游的签名 JS 跑在 node 子进程里：NODE_OPTIONS 预加载 node_determinism.cjs 与本目录的 preload.cjs，
子进程发往 cactus / jra 的请求被截获、回假数据并记到日志，这里按发生顺序并进用例的请求序列。
"""

import base64
import json
import os
import secrets
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catbus_golden as g  # noqa: E402

out = g.setup('jd', 'JdApis')
HERE = Path(__file__).resolve().parent
UPSTREAM = g.ROOT / 'references' / 'JdApis'
TMP = Path(tempfile.gettempdir())
NODE_LOG = TMP / 'catbus-jd-node.jsonl'
TK_CACHE = TMP / 'catbus-jd-tk.json'
os.environ['NODE_OPTIONS'] += f' --require "{(HERE / "preload.cjs").as_posix()}"'
os.environ['CATBUS_JD_NODE_LOG'] = str(NODE_LOG)
os.environ['JD_TK_CACHE'] = str(TK_CACHE)

# secrets.randbits 在 secrets 模块导入时就绑定了原始实现，框架没有替换它
secrets.randbits = lambda k: g._getrandbits(None, k)

from builder.auth import JdAuth  # noqa: E402
from jd_apis import jd_api  # noqa: E402
from jd_apis.jd_api import JdAPI  # noqa: E402
from utils import aks, device_token, h5st5, summer_cryptico, webm  # noqa: E402

PROFILE = h5st5._TK_PROFILE
# 上游 JdAuth 在 flush 时写用户目录下的 auth.json：对拍只在内存里跑
JdAuth.save = lambda self, path=None: None


def drain_node():
    """把 node 子进程的网络请求并进当前用例（在触发它的 Python 调用返回后调用）。"""
    if not NODE_LOG.exists():
        return
    for line in NODE_LOG.read_text(encoding='utf-8').splitlines():
        e = json.loads(line)
        headers, cookies = g._split_cookie_headers(list(e['headers'].items()))
        g._captured.append({'method': e['method'], 'url': e['url'], 'headers': headers, 'cookies': cookies,
                            'body': e['body'] or None, 'multipart': None})
        g._responses.append({'status': e['status'], 'headers': e['respHeaders'], 'body': e['resp']})
    NODE_LOG.unlink()


def after(fn):
    def wrapped(*a, **k):
        try:
            return fn(*a, **k)
        finally:
            drain_node()
    return wrapped


h5st5._sign_once = after(h5st5._sign_once)
device_token.get_device_fields = after(device_token.get_device_fields)
summer_cryptico.encrypt = after(summer_cryptico.encrypt)


def reset_node(token_cache=True):
    """每个用例从干净的签名进程开始（上游的常驻进程会跨用例延续随机数序列）。"""
    h5st5.shutdown()
    device_token.shutdown()
    h5st5._cookie, h5st5._origin, h5st5._referer = '', 'https://search.jd.com', 'https://search.jd.com/'
    device_token._cookie = ''
    device_token._page_url = device_token._origin = device_token._referer = None
    device_token.configure()
    if NODE_LOG.exists():
        NODE_LOG.unlink()
    if TK_CACHE.exists():
        TK_CACHE.unlink()
    if token_cache:
        TK_CACHE.write_text(json.dumps(SEED_CACHE), encoding='utf-8')
    aks_state = UPSTREAM / 'datas' / 'aks_key.json'
    if aks_state.exists():
        aks_state.unlink()


# ---------------------------------------------------------------- 预先换好的 h5st token（假 token，四个 appId）

def build_seed_cache():
    reset_node(token_cache=False)
    for app in ('f06cc', 'fb5df', '2b51e', '73806'):
        for _ in range(3):
            res = h5st5.sign({'functionId': 'seed', 't': '1'}, app)
            if h5st5._is_real_token(res.get('h5st', '')):
                break
    h5st5.shutdown()
    cache = json.loads(TK_CACHE.read_text(encoding='utf-8'))
    algo = json.loads(cache['values']['WQ_dy1_tk_algo'])
    apps = {app for per_fp in algo.values() for app in per_fp}
    assert apps == {'f06cc', 'fb5df', '2b51e', '73806'}, apps
    return cache


SEED_CACHE = build_seed_cache()
(out / '_token_cache.json').write_text(json.dumps(SEED_CACHE, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

# ---------------------------------------------------------------- 假凭证

COOKIES = ('__jdu=17899999991231234567890; '
           '__jda=122270672.17899999991231234567890.1789999999.1789999999.1789999999.1; __jdc=122270672; '
           'areaId=1; ipLoc-djd=1-2800-55812-0.1234567890; '
           '3AB9D23F7A4B3C9B=FAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEI; '
           '3AB9D23F7A4B3CSS=jdd03FAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIAAAAAFAKEFAKEFAKEAAAAAAFAKEFAKEFAKEFAKX; '
           'thor=FAKETHOR0123456789ABCDEF; pin=fake_pin_%E6%B5%8B%E8%AF%95; unick=fake; '
           'shshshfpa=0f0e0d0c-0b0a-0908-0706-050403020100-1789999999; shshshfpx=0f0e0d0c-0b0a-0908-0706-050403020100-1789999999; '
           'shshshfpb=FAKEshshshfpb')
SKU = '100087543376'
KEYWORD = '机械键盘'
WEBM_STORAGE = {'https://search.jd.com': {'__jdapis_webm_runtime__': '6.0.0-exact-1', 'hf_time': '1790086400123'}}


def logged():
    auth = JdAuth()
    auth.prepare_auth(COOKIES)
    auth.local_storage = json.loads(json.dumps(WEBM_STORAGE))
    return auth


def default_respond(req):
    url = req['url']
    if 'loginservice.aspx' in url:
        return 'jsonpLogin({"Identity":{"Unick":"fake","Name":"fake_pin_测试","IsAuthenticated":true}})'
    if 'getCustomCtrl' in url:
        return {'code': 0, 'data': 'FAKECONFIG'}
    if 'wsgw_getinfo' in (req['body'] or ''):
        return {'code': 0, 'whwswswws': 'FAKEWHWSWSWWS', 'interval': 1440}
    return {'code': 0, 'data': {}}


def case(name, fn, respond=default_respond, token_cache=True, **input):
    reset_node(token_cache)
    g.case(out, name, fn, input=input, respond=respond)


# ---------------------------------------------------------------- 商品、搜索、账号

case('product_detail', lambda: JdAPI.get_product_detail(logged(), SKU), sku=SKU)
case('product_comments', lambda: JdAPI.get_product_comments(logged(), SKU, count=10), sku=SKU, count=10)
case('recommend_coupon', lambda: JdAPI.get_recommend_coupon(logged(), SKU), sku=SKU)
case('related_search', lambda: JdAPI.get_related_search(logged(), SKU), sku=SKU)
case('search_hotwords', lambda: JdAPI.get_search_hotwords(logged()))
case('search_relwords', lambda: JdAPI.get_search_relwords(logged(), KEYWORD), keyword=KEYWORD)
case('cart_num', lambda: JdAPI.get_cart_num(logged()))
case('browse_history', lambda: JdAPI.get_browse_history(logged(), page=2, page_size=20), page=2, page_size=20)
case('follow_products', lambda: JdAPI.get_follow_products(logged(), page=1, page_size=20), page=1, page_size=20)
case('check_session', lambda: JdAPI.check_session(logged()))


def search_cached():
    auth = logged()
    return JdAPI.search(auth, KEYWORD, page=2, sort='sort_totalsales15_desc')


case('search_cached_webm', search_cached, keyword=KEYWORD, page=2, sort='sort_totalsales15_desc')


def search_fresh():
    """游客式会话：没有 WebM 令牌，先跑 jdwebm.js 再搜索。"""
    auth = JdAuth()
    auth.prepare_auth('__jdu=17899999991231234567890; areaId=1; ipLoc-djd=1-2800-55812-0')
    res = JdAPI.search(auth, KEYWORD, page=1)
    return {'result': res, 'cookie': auth.cookie, 'local_storage': auth.local_storage}


case('search_fresh_webm', search_fresh, keyword=KEYWORD)

ORDER_HTML = (HERE / 'order_list.html').read_text(encoding='utf-8')
case('order_list', lambda: JdAPI.get_order_list(logged(), page=2, date_range='2025'),
     respond=lambda req: ORDER_HTML, page=2, date_range='2025')

# ---------------------------------------------------------------- 咚咚


def chat_logged():
    auth = logged()
    auth.set_chat_info(aid='FAKEAID0123', app_id='im.customer', client_type='comet')
    return auth


case('aid_info', lambda: JdAPI.get_aid_info(logged()),
     respond=lambda req: {'code': '0', 'pin': 'fake_pin', 'aid': 'FAKEAID0123', 'subCode': '0'})
case('chat_info', lambda: JdAPI.get_chat_info(chat_logged(), vender_id='1000000', pid=SKU), vender_id='1000000', pid=SKU)
case('chat_session_log', lambda: JdAPI.get_chat_session_log(chat_logged()))
case('query_last_logs', lambda: JdAPI.query_last_logs(chat_logged(), vender_id='1000000', num=20), vender_id='1000000', num=20)

# ---------------------------------------------------------------- 签名与设备参数


def token_fetch():
    """没有 token 缓存：第一次签名触发 request_algo，warmup 等待后重签拿到 tk03。

    框架把 time.sleep 换成了空操作；这里 warmup 的等待必须真等，否则重签与换 token 的先后取决于进程调度。
    """
    no_sleep = time.sleep
    time.sleep = lambda s: threading.Event().wait(s)
    try:
        h5st5.configure('pin=fake_pin', 'https://item.jd.com', 'https://item.jd.com/')
        return h5st5.sign({'appid': 'item-v3', 'functionId': 'x', 'body': 'ab', 'client': 'pc', 'clientVersion': '1.0.0', 't': '1790000000123'}, 'fb5df')
    finally:
        time.sleep = no_sleep


case('h5st_token_fetch', token_fetch, token_cache=False)


def device_fields():
    device_token.configure('__jdu=17899999991231234567890; 3AB9D23F7A4B3C9B=OLD; pin=fake_pin')
    first = device_token.get_device_fields()
    forced = device_token.get_device_fields(force_refresh=True)
    return {'first': first, 'forced': forced}


case('device_fields', device_fields)

SUMMER_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/summer-cryptico-h5.min.js'
SUMMER_SOURCE = urllib.request.urlopen(SUMMER_URL, timeout=30).read().decode('utf-8')
# SM2 标准测试向量的公钥（04 || X || Y），前面垫两字节头
SM2_PUB = bytes.fromhex('09f9df311e5421a150dd7d161e4bc5c672179fad1833fc076bb08ff356f35020'
                        'ccea490ce26775a52dc6ea718cc1aa600aed05fbf35e084a6632f6072da9ad13')
GMPK = base64.b64encode(b'\x00\x01' + b'\x04' + SM2_PUB).decode()


def summer():
    summer_cryptico._source = ''
    return summer_cryptico.encrypt(GMPK, '13800000000')


case('summer_encrypt', summer, respond=lambda req: SUMMER_SOURCE, public_key=GMPK, plaintext='13800000000')

# ---------------------------------------------------------------- 登录：扫码

from jd_apis import jd_sms_login_api  # noqa: E402
from jd_apis.jd_chat_ws import JdChatWS  # noqa: E402
from jd_apis.jd_login_api import JdLoginAPI  # noqa: E402
from jd_apis.jd_sms_login_api import JdSmsLoginAPI  # noqa: E402
from utils import http_client, jcap_solver  # noqa: E402

LOGIN_HTML = ('<html><body><form><input type="hidden" id="uuid" name="uuid" value="fake-page-uuid-0001"/>'
              '<input type="hidden" name="source" value="pc_login"/><input type="hidden" id="loginType" value="f"/>'
              '<input type="hidden" name="_t" value="fake_t"/><input type="hidden" id="sa_token" value="FAKESATOKEN"/>'
              '<input type="hidden" id="useRandomSlideAuthCode" value="1"/></form></body></html>')
# 框架记录的响应只能是文本：二维码图片的内容对流程无关紧要
PNG_1PX = 'FAKE-PNG-BYTES'
SAFE_HTML = ('<html><head><title>安全验证</title></head><body><script>window.safeWebConfig = '
             "{o: 'FAKEO', s: \"FAKES\", list: [{validateType: 'DANGEROUS_DOWN', validateName: '短信', model: true, "
             "enP: 'FAKEENP', params: {m: '13800000000'}}, /* 注释 */ {validateType: 'FACE', enP: 'x', params: {}}]};"
             '</script></body></html>')


def login_respond(req):
    url = req['url']
    if url.startswith('https://passport.jd.com/new/login.aspx'):
        return {'status': 200, 'headers': {'set-cookie': ['__jd_ref_cls=Login_Page; Path=/']}, 'body': LOGIN_HTML}
    if url.startswith('https://qr.m.jd.com/show'):
        return {'status': 200, 'headers': {'content-type': 'image/png',
                                           'set-cookie': ['wlfstk_smdl=FAKEQRTOKEN; Domain=.jd.com; Path=/',
                                                          'QRCodeKey=FAKEQRCODEKEY; HttpOnly']},
                'body': PNG_1PX}
    if url.startswith('https://qr.m.jd.com/check'):
        return 'jQuery1234567({"code":200,"ticket":"FAKETICKET0123456789"})'
    if '/publicKey/init' in url:
        return {'data': GMPK}
    if '/uc/qrCodeTicketValidation' in url:
        return {'status': 200, 'headers': {'set-cookie': ['thor=FAKENEWTHOR; Domain=.jd.com; Path=/; HttpOnly',
                                                          'pin=fake_pin; Domain=.jd.com; Path=/']},
                'body': {'returnCode': 0, 'url': 'https://home.jd.com/index.html'}}
    if '/ssoDomain/getList' in url:
        return ['sso.jd.hk', 'sso.jdpay.com', 'bad domain!']
    if url.startswith('https://sso.jd.hk/alive'):
        return 'jQuery1({"result":"success"})'
    if url.startswith('https://sso.jdpay.com/alive'):
        return {'status': 200, 'headers': {'set-cookie': ['sso_alive=1; Path=/']}, 'body': "jQuery2('{\"result\":\"fail\"}')"}
    if url.startswith('https://seq.jd.com/jseqf.html'):
        return 'var _jdtdmap_sessionId="9876543210";'
    if '/uc/graphic/sessionId/refresh' in url:
        return {'code': 1, 'status': 1, 'sessionId': 'FAKECAPTCHASID', 'jwtToken': 'FAKEJWT'}
    if '/uc/mobile/sendMessage' in url:
        return '({"code":1,"msg":"验证码已发送至13800000000"})'
    if '/uc/mobile/loginService' in url:
        return {'_t': 'next_t', 'success': '/uc/crossDomain?next=1'}
    if url.startswith('https://passport.jd.com/uc/crossDomain'):
        return {'status': 200, 'headers': {'set-cookie': ['thor=FAKESMSTHOR; Domain=.jd.com; Path=/',
                                                          'pin=fake_pin; Domain=.jd.com; Path=/']}, 'body': 'ok'}
    if url.startswith('https://aq.jd.com/pwd/gmpk'):
        return {'resultCode': '10000', 'resultData': GMPK}
    if url.startswith('https://aq.jd.com/mobile/getCode'):
        return {'success': True, 'resultData': {'msg': '短信已发送至138****0000'}}
    if url.startswith('https://aq.jd.com/mobile/validateCode'):
        return {'success': True, 'resultData': {'page': 'https://passport.jd.com/uc/crossDomain?safe=1'}}
    if url.startswith('https://safe.jd.com/'):
        return SAFE_HTML
    if url.startswith(SUMMER_URL):
        return SUMMER_SOURCE
    return {'code': 0}


def fresh_auth():
    auth = JdAuth()
    auth.prepare_auth('__jdu=17899999991231234567890; areaId=1; ipLoc-djd=1-2800-55812-0')
    return auth


def qr_login():
    auth = fresh_auth()
    ok, msg, auth = JdLoginAPI.qr_login(auth, qr_path=str(TMP / 'catbus-jd-qr.png'))
    return {'ok': ok, 'msg': msg, 'cookie': auth.cookie}


case('qr_login', qr_login, respond=login_respond)

# ---------------------------------------------------------------- 登录：短信


class SequentialPool:
    """ThreadPoolExecutor 的顺序版：/alive 探测的请求与随机回调名按候选顺序发生。"""

    def __init__(self, *a, **k):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def map(self, fn, items):
        return [fn(x) for x in items]


jd_sms_login_api.ThreadPoolExecutor = SequentialPool
MOBILE = '13800000000'


def sms_login():
    auth = fresh_auth()
    context = JdSmsLoginAPI.start(auth)
    sent = JdSmsLoginAPI.send_code(context, MOBILE, 'FAKEVERIFYTOKEN0123456789012345678901')
    submitted = JdSmsLoginAPI.submit_code(context, MOBILE, '123456')
    return {'fields': context.fields, 'sent': list(sent[:2]), 'submitted': list(submitted[:2]), 'cookie': auth.cookie,
            'captcha': [context.captcha_status, context.captcha_session_id, context.captcha_jwt_token]}


case('sms_login', sms_login, respond=login_respond, mobile=MOBILE)


def safe_verify():
    auth = fresh_auth()
    trace = jd_sms_login_api.LoginTraceContext('fake-page-uuid-0001')
    context = jd_sms_login_api.SmsLoginContext(auth, http_client.session(), trace, {}, public_key=GMPK)
    summer_cryptico._source = ''
    page = JdSmsLoginAPI.load_safe_verify(
        context, {'safeVerifyUrl': 'https://safe.jd.com/dangerousVerify/index.action?o=QO&s=QS'})
    sent = JdSmsLoginAPI.send_safe_mobile_code(context, page)
    ok = JdSmsLoginAPI.submit_safe_mobile_code(context, page, sent[2], '654321')
    return {'config': page.config, 'params': page.request_params, 'sent': list(sent[:2]), 'ok': list(ok[:2]),
            'cookie': auth.cookie}


case('safe_verify', safe_verify, respond=login_respond)

# ---------------------------------------------------------------- 搜索 605：createSid → JCAP → checkToken

DISPOSAL_EV = json.dumps({'evType': '3', 'evUrl': 'https://cfe.m.jd.com/privatedomain/risk_handler/03101900/',
                          'evApi': 'color_pc_search_searchWare', 'title': '京东验证', 'evSid': ''}, ensure_ascii=False)
jcap_solver.solve_graphic_captcha = lambda *a, **k: 'FAKEJCAPVERIFYTOKEN0123456789ABCDEF'
search_calls = []


def risk_respond(req):
    url = req['url']
    if 'pc_search_searchWare' in url:
        search_calls.append(url)
        if len(search_calls) == 1:
            return {'code': '605', 'echo': 'the request needs to authenticate',
                    'disposal': {'rpId': 'FAKERPID', 'evContent': DISPOSAL_EV}}
        return {'code': 0, 'data': {'resultCount': 1, 'wareList': [
            {'wareId': '100087543376', 'wareName': '<font>机械</font>键盘', 'jdPrice': '299.00', 'shopName': '假店铺',
             'venderId': 1000, 'comment': '2万+'}]}}
    if 'createSid' in (req['body'] or ''):
        return {'code': 0, 'data': 'FAKERISKSID'}
    if 'checkToken' in (req['body'] or ''):
        return {'code': 0, 'data': 'FAKEEVTOKEN'}
    return default_respond(req)


def search_risk():
    search_calls.clear()
    auth = logged()
    auth.update_cookies({'unionwsws': '%7B%22devicefinger%22%3A%22FAKEDEVICEFINGER%22%7D'})
    res = JdAPI.search(auth, KEYWORD, page=1)
    return {'result': res, 'evtoken': auth.cookie.get('x-rp-evtoken')}


case('search_risk', search_risk, respond=risk_respond, keyword=KEYWORD)

# ---------------------------------------------------------------- 咚咚 WebSocket 帧


def chat_packets():
    auth = chat_logged()
    ws = JdChatWS(auth, vender_id='1000000', vender_app='jd.waiter')
    sent = []

    class FakeSocket:
        def send(self, text):
            sent.append(json.loads(text))

    ws.ws = FakeSocket()
    ws._alive = True
    ws.send_heartbeat()
    ws.send_hello(pid=SKU)
    ws.send_text('在吗', pid=SKU)
    return {'url': ws.url, 'packets': sent}


case('chat_packets', chat_packets)

# ---------------------------------------------------------------- 403 空 body：重签重试后探测登录态（diagnose 的第一步）


def forbidden_respond(alive):
    def respond(req):
        if 'loginservice.aspx' in req['url']:
            if alive:
                return 'jsonpLogin({"Identity":{"Unick":"fake","Name":"fake_pin_测试","IsAuthenticated":true}})'
            return 'jsonpLogin({"Identity":{"IsAuthenticated":false}})'
        return {'status': 403, 'headers': {}, 'body': ''}
    return respond


def diagnose_no_session():
    auth = logged()
    res = JdAPI.get_cart_num(auth)
    return {'res': res, 'diagnose': list(JdAPI.diagnose(auth))}


def diagnose_alive():
    """仍登录时 catbus 只探测登录态，不再像 diagnose 那样继续发 hotwords / getCartNum 探针。"""
    auth = logged()
    res = JdAPI.get_cart_num(auth)
    return {'res': res, 'session': list(JdAPI.check_session(auth))}


case('diagnose_no_session', diagnose_no_session, respond=forbidden_respond(False))
case('diagnose_alive', diagnose_alive, respond=forbidden_respond(True))

# ---------------------------------------------------------------- 评价条数（commentNum）

case('product_comments_30', lambda: JdAPI.get_product_comments(logged(), SKU, count=30), sku=SKU, count=30)

# ---------------------------------------------------------------- 收货地区（显式 area 覆盖 ipLoc-djd）

AREA = '2_2830_51810_0'
case('product_detail_area', lambda: JdAPI.get_product_detail(logged(), SKU, area=AREA), sku=SKU, area=AREA)
case('recommend_coupon_area', lambda: JdAPI.get_recommend_coupon(logged(), SKU, area=AREA), sku=SKU, area=AREA)
case('cart_num_area', lambda: JdAPI.get_cart_num(logged(), area=AREA), area=AREA)
case('browse_history_area', lambda: JdAPI.get_browse_history(logged(), page=1, page_size=20, area=AREA), area=AREA)
case('follow_products_area', lambda: JdAPI.get_follow_products(logged(), page=1, page_size=20, area=AREA), area=AREA)
case('search_area', lambda: JdAPI.search(logged(), KEYWORD, page=1, area=AREA), keyword=KEYWORD, area=AREA)

# ---------------------------------------------------------------- JCAP 求解器的纯算部分（合成图片）

import cv2  # noqa: E402
import numpy as np  # noqa: E402

sys.path.insert(0, str(UPSTREAM / 'static' / 'jcap' / 'run'))
import captcha_solver as cs  # noqa: E402

MODELS = g.ROOT / 'packages' / 'assets-jd' / 'models'
U2NETP = MODELS / 'u2netp.onnx'
ORIENTATION = MODELS / 'orientation_model_v2_0.9882.onnx'


def png(img):
    ok, buf = cv2.imencode('.png', img)
    assert ok
    return base64.b64encode(buf.tobytes()).decode()


def texture(width, height, phase=0.0):
    """确定性的彩色纹理（不依赖随机数）。"""
    y, x = np.mgrid[0:height, 0:width].astype(np.float64)
    b = 128 + 60 * np.sin(x / 9.0 + phase) + 40 * np.cos(y / 7.0)
    gch = 128 + 50 * np.sin((x + y) / 13.0) + 30 * np.cos(x / 5.0 - phase)
    r = 128 + 70 * np.cos((x - 2 * y) / 17.0 + phase) + 20 * np.sin(y / 3.0)
    return np.clip(np.dstack([b, gch, r]), 0, 255).astype(np.uint8)


def slider_images(offset=183):
    main = texture(300, 170)
    cv2.circle(main, (60, 60), 25, (30, 200, 90), -1)
    cv2.rectangle(main, (220, 100), (280, 150), (200, 40, 40), -1)
    mask = np.zeros((170, 65), np.uint8)
    cv2.rectangle(mask, (5, 60), (55, 110), 255, -1)
    cv2.circle(mask, (30, 60), 12, 255, -1)
    cv2.circle(mask, (55, 85), 10, 255, -1)
    slot = np.zeros((170, 65, 4), np.uint8)
    slot[:, :, :3] = main[:, offset:offset + 65]
    slot[:, :, 3] = mask
    region = main[:, offset:offset + 65]
    inside = mask > 0
    region[inside] = (region[inside].astype(np.float64) * 0.45 + 70).astype(np.uint8)
    return main, slot


def slider_case():
    main, slot = slider_images()
    return {'main': png(main), 'slot': png(slot), 'solution': cs.solve_slider(main, slot)}


g.case(out, 'jcap_slider', slider_case)


def stroke_mask(width=220, height=140):
    mask = np.zeros((height, width), np.uint8)
    pts = np.array([[20, 30], [110, 25], [60, 110], [200, 115]], np.int32)
    cv2.polylines(mask, [pts], False, 255, 9)
    cv2.circle(mask, (150, 60), 6, 255, -1)
    return mask


def skeleton_case():
    mask = stroke_mask()
    skel = cs.skeletonize(mask > 0)
    path, metrics = cs._longest_skeleton_path(skel)
    saliency = cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (0, 0), 2.5)
    saliency /= float(saliency.max())
    return {
        'mask': png(mask),
        'skeleton': base64.b64encode(np.packbits(skel.astype(np.uint8)).tobytes()).decode(),
        'path': [list(map(int, p)) for p in path],
        'metrics': metrics,
        'resampled': cs._resample_path(path),
        'saliency': base64.b64encode(saliency.astype(np.float32).tobytes()).decode(),
        'confident': cs._extract_confident_path(saliency.astype(np.float32)),
    }


cs.skeletonize = __import__('skimage.morphology', fromlist=['skeletonize']).skeletonize
g.case(out, 'jcap_skeleton', skeleton_case)


def trace_image(width=300, height=170):
    img = texture(width, height, 1.3)
    pts = np.array([[80, 50], [200, 45], [85, 120], [210, 118]], np.int32)
    cv2.polylines(img, [pts], False, (240, 240, 240), 11, cv2.LINE_AA)
    return img


def trace_case():
    img = trace_image()
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    background = cv2.medianBlur(lab.astype(np.uint8), 31).astype(np.float32)
    residual = np.linalg.norm(lab - background, axis=2).astype(np.float32)
    stroke = cs._stroke_likelihood(lab)
    mask = np.zeros(img.shape[:2], np.float32)
    cv2.polylines(mask, [np.array([[80, 50], [200, 45], [85, 120], [210, 118]], np.int32)], False, 1.0, 9)
    saliency = cv2.GaussianBlur(mask, (0, 0), 2.0)
    geometric = .25 * saliency + .75 * stroke
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    tex = cv2.GaussianBlur(cv2.magnitude(gx, gy), (0, 0), 3)
    params = [
        [140.0, 48.0, 60.0, -2.0, 147.0, 119.0, 62.0, 1.0],
        [150.0, 60.0, 55.0, 10.0, 150.0, 110.0, 50.0, -5.0],
        [100.0, 30.0, 20.0, 0.0, 100.0, 140.0, 20.0, 0.0],
    ]
    scores = [[cs._trace_score(lab, residual, tex, geometric, np.array(p), t) for t in ((0, 1, 2, 3), (0, 2, 1, 3))]
              for p in params]
    return {
        'image': png(img),
        'saliency': base64.b64encode(saliency.astype(np.float32).tobytes()).decode(),
        'residual_mean': float(residual.mean()),
        'stroke_mean': float(stroke.mean()),
        'stroke_sample': [float(stroke[y, x]) for y, x in ((50, 80), (47, 140), (80, 150), (10, 10))],
        'corners': [cs._corners(np.array(p)).tolist() for p in params],
        'chains': [cs._trace_chain(np.array(p), (0, 2, 1, 3)).tolist() for p in params],
        'params': params,
        'scores': scores,
    }


g.case(out, 'jcap_trace', trace_case)


def lsd_image():
    img = np.full((150, 200), 40, np.uint8)
    cv2.rectangle(img, (30, 30), (170, 120), 200, -1)
    box = cv2.boxPoints(((100, 75), (90, 40), 23.0)).astype(np.int32)
    cv2.fillPoly(img, [box], 90)
    cv2.line(img, (10, 140), (190, 100), 255, 3)
    return img


def lsd_case():
    img = lsd_image()
    lines = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD).detect(img)[0]
    return {'image': png(img), 'lines': [] if lines is None else lines.reshape(-1, 4).tolist()}


g.case(out, 'jcap_lsd', lsd_case)


def rotation_image():
    img = texture(160, 160, 0.4)
    cv2.rectangle(img, (40, 50), (120, 110), (20, 20, 220), -1)
    cv2.rectangle(img, (55, 30), (105, 50), (220, 220, 20), -1)
    matrix = cv2.getRotationMatrix2D((80, 80), 33.0, 1.0)
    return cv2.warpAffine(img, matrix, (160, 160), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)


def rotation_case():
    img = rotation_image()
    return {'image': png(img), 'solution': cs.solve_rotation(img, ORIENTATION)}


g.case(out, 'jcap_rotation', rotation_case)


def click_images():
    image = texture(290, 180, 2.0)
    tip = np.full((40, 60, 3), 245, np.uint8)
    star = np.array([[30, 4], [36, 16], [50, 17], [39, 26], [43, 38], [30, 31], [17, 38], [21, 26], [10, 17], [24, 16]], np.int32)
    cv2.fillPoly(tip, [star], (30, 30, 200))
    scaled = cv2.resize(tip, (66, 44), interpolation=cv2.INTER_CUBIC)
    image[100:144, 170:236] = np.where(scaled < 200, scaled, image[100:144, 170:236])
    return image, tip


def click_case():
    image, tip = click_images()
    saliency = cs._u2net_saliency(tip, U2NETP)
    return {'image': png(image), 'tip': png(tip), 'saliency_mean': float(saliency.mean()),
            'saliency_max': float(saliency.max()),
            'saliency_sample': [float(saliency[y, x]) for y, x in ((20, 30), (5, 5), (30, 20))],
            'solution': cs.solve_click(image, tip, U2NETP)}


g.case(out, 'jcap_click', click_case)
