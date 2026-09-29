"""douyin 的对拍数据：用上游 DouYin_Spider 的代码构造请求（只用假凭证），记录请求序列。

运行：.golden/douyin/Scripts/python.exe scripts/golden/douyin/gen.py（第二部分在 gen_more.py，由本文件末尾执行）
依赖：VIRTUAL_ENV=.golden/douyin uv pip install -r references/DouYin_Spider/requirements.txt
      （blackboxprotobuf 要求 protobuf==3.10，与 protobuf>=5.27 冲突；先装其余依赖，再 `uv pip install --no-deps blackboxprotobuf`）

框架补丁（只在本目录里，不改 catbus_golden.py）：
- curl_cffi Session 的 cookie 罐按请求的 host 过滤（框架原样发出整罐 cookie，真实 curl 会按 domain 过滤）；
- 每个用例开始时重置上游的进程级状态：a_bogus / X-Bogus 签名器、mssdk 的 token 缓存、V8 随机串池；
- 二进制响应（protobuf）记成 {"base64": ...}；tempfile 的临时名不再消耗被替换的随机数；
- 上游的 Node 脚本复制到仓库外运行（catbus 的 package.json 是 "type": "module"，会把它们当成 ESM）；
- time.strftime 固定北京时间；
- dtrait 的 Math 指纹按 V8 的取值固定（见下方 _V8_MATH）。
"""

import base64
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catbus_golden as g  # noqa: E402

out = g.setup('douyin', 'DouYin_Spider')

from curl_cffi import requests as cffi  # noqa: E402
from curl_cffi.requests.cookies import Cookies  # noqa: E402

_fw_request = cffi.Session.request


def _domain_ok(host, domain):
    if not domain:
        return True
    if domain.startswith('.'):
        return host == domain[1:] or host.endswith(domain)
    return host == domain


def _filtered_request(self, method, url, *args, **kwargs):
    host = urlsplit(url).hostname or ''
    saved = self._cookies
    jar = Cookies()
    for c in saved.jar:
        if _domain_ok(host, c.domain):
            jar.jar.set_cookie(c)
    self._cookies = jar
    try:
        return _fw_request(self, method, url, *args, **kwargs)
    finally:
        self._cookies = saved


cffi.Session.request = _filtered_request

import utils.dy_util as dy_util  # noqa: E402
import utils.mstoken as mstoken_mod  # noqa: E402
from builder.auth import DouyinAuth  # noqa: E402
from dy_apis.douyin_api import DouyinAPI  # noqa: E402
from ecdsa import NIST256p, SigningKey  # noqa: E402
from utils.ab_pure import ABogusPureSigner  # noqa: E402
from utils.secsdk_web_sign import sign_url  # noqa: E402
from utils.sm3 import sm3_hex  # noqa: E402
from utils.strdata_pure import build_report_body  # noqa: E402
from utils.xbogus_pure import XbogusSigner  # noqa: E402

# dtrait 内层 blob 的 Math 指纹（utils/dtrait_features.math_features）入参全是字面常量，结果取决于本机的 libm。
# 上游的基准是浏览器 V8 的值（tests/test_dtrait_profile.py 的 CAPTURED_BLOB 就是 Chrome 抓的）：
# macOS 的 libm 算 tan(-1e300) 比 V8 低 1 ULP，这里固定成 V8 的值，与固定时区同理。
# gen_gap.py 的 dtrait 用例会断言默认档案生成的 blob 等于 CAPTURED_BLOB，别的函数在别的机器上有出入时会报出来。
import math as _math  # noqa: E402
import types as _types  # noqa: E402

import utils.dtrait_features as _dtrait_features  # noqa: E402

_V8_MATH = {('tan', -1e300): -1.4214488238747245}
_dtrait_features.math = _types.SimpleNamespace(**{k: getattr(_math, k) for k in dir(_math) if not k.startswith('_')})
_dtrait_features.math.tan = lambda x: _V8_MATH.get(('tan', x), _math.tan(x))

# 只有假值
PRIVATE_KEY = SigningKey.from_secret_exponent(0x1234567890ABCDEF, curve=NIST256p).to_pem().decode()
SERVER_POINT = SigningKey.from_secret_exponent(0xFEDCBA0987654321, curve=NIST256p).get_verifying_key().to_string()
SERVER_CERT = 'pub.' + base64.b64encode(b'\x04' + SERVER_POINT).decode()
TICKET = 'hash.fake-ticket-0000'
TS_SIGN = 'ts.2.fakesign0123456789abcdef'
CLIENT_CERT = 'pub.' + base64.b64encode(b'fake-client-cert').decode()
DTRAIT_BLOB = base64.b64encode(bytes(range(1, 97))).decode()
COOKIES = ('ttwid=1%7Cfake-ttwid%7C1790000000%7Cabcdef; UIFID=fake-uifid-0123456789abcdef; '
           's_v_web_id=verify_fakesvwebid_0000_0000_4000_8000_000000000000; '
           'passport_csrf_token=fakecsrf0123456789abcdef01234567; passport_csrf_token_default=fakecsrf0123456789abcdef01234567; '
           'odin_tt=fake-odin-tt; sessionid=fake-sessionid; sessionid_ss=fake-sessionid; sid_guard=fake-sid-guard; '
           'uid_tt=fake-uid-tt; bd_ticket_guard_client_web_domain=2; bd_ticket_guard_ts_sign_id=ts.2.fakesign')
MS_TOKEN = 'fake-mstoken-0123456789'
WEBID = '7400000000000000001'
UID = '97872126662'
SEC_UID = 'MS4wLjABAAAAfakeSecUid0123456789abcdef'
AWEME = '7433523124836060416'
CSRF_HEADER = '0001000000017a,fakecsrftoken0123456789abcdef,86370,success,fakesession0123'

INPUT = {'cookies': COOKIES, 'private_key': PRIVATE_KEY, 'server_cert': SERVER_CERT, 'ticket': TICKET, 'ts_sign': TS_SIGN,
         'client_cert': CLIENT_CERT, 'dtrait_blob': DTRAIT_BLOB, 'ms_token': MS_TOKEN, 'webid': WEBID, 'uid': UID}


def reset_state():
    dy_util._pure_signer = None
    dy_util._xb_signer = None
    mstoken_mod._cache.update(token='', ts=0)
    try:
        import dy_apis.douyin_creator_api as creator
        creator._BROWSER_RANDOM_S_POOL.clear()
    except Exception:
        pass


def respond(req):
    url = req['url']
    if req['method'] == 'HEAD':
        return {'status': 200, 'headers': {'X-Ware-Csrf-Token': CSRF_HEADER}, 'body': ''}
    if 'ttwid/union/register' in url:
        return {'status': 200, 'headers': {'set-cookie': 'ttwid=1%7Cguest-ttwid%7C1790000000%7C0123; Path=/; Domain=douyin.com'},
                'body': {'status_code': 0}}
    if 'mssdk.bytedance.com' in url:
        return {'status': 200, 'headers': {'x-ms-token': 'guest-mstoken-from-mssdk'}, 'body': {'code': 0}}
    if 'query/user' in url:
        return {'status_code': 0, 'id': WEBID, 'user_uid': UID}
    if 'get_client_cert' in url:
        return {'message': 'success', 'data': {'server_cert': SERVER_CERT, 'server_sn': 'fake-sn'}}
    return {'status_code': 0}


def logged_auth():
    auth = DouyinAuth.from_cookie(COOKIES, ticket=TICKET, ts_sign=TS_SIGN, client_cert=CLIENT_CERT, private_key=PRIVATE_KEY,
                                  dtrait_blob=DTRAIT_BLOB, bootstrap_creator=False)
    auth._ms_cache = MS_TOKEN
    auth._ms_ts = g.NOW_MS / 1000
    auth._webid = WEBID
    auth.uid = int(UID)
    return auth


def case(name, fn, respond_fn=respond, **input):
    def run():
        reset_state()
        return fn()
    g.case(out, name, run, input={**INPUT, **input}, respond=respond_fn)


def logged(fn):
    return lambda: fn(logged_auth())


# ================================================================ 纯算
def pure():
    signer = ABogusPureSigner(fixed=False)
    xb = XbogusSigner()
    queries = ['device_platform=webapp&aid=6383', 'a=%E4%B8%AD&b=', '']
    return {
        'sm3': [sm3_hex(b'abc'), sm3_hex(b'abcd' * 16), sm3_hex('中文'.encode())],
        'abogus': [signer.sign_query(q, 'x=1' if i == 1 else '', host=h)
                   for i, q in enumerate(queries) for h in ('www.douyin.com', 'live.douyin.com', 'creator.douyin.com', 'login.douyin.com')],
        'counter': signer.counter,
        'xbogus': [xb.sign(hashlib.md5(b'stub').hexdigest()), xb.sign(hashlib.md5(b'stub2').hexdigest())],
        'signature': dy_util.generate_signature('7400000000000000000', '111222333'),
        'sign_url': [sign_url('https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=1&keyword=a+b;c&x=100%&e=&k', uifid='fake-uifid'),
                     sign_url('https://www.douyin.com/aweme/v1/web/aweme/post/?uifid=u%20v&a=中文')],
        'mstoken': dy_util.generate_msToken(),
        'webid': dy_util.generate_fake_webid(),
        'sv_web_id': dy_util.generate_s_v_web_id(),
        'report': build_report_body(),
        'splice': dy_util.splice_url({'a': 'x/y z', 'b': None, 'c': 1, '中': '文'}),
    }


case('pure', pure)


# ================================================================ 游客：ttwid → 设备号 → msToken → 作品详情
def guest_item_get():
    auth = DouyinAuth()
    auth.perepare_auth('', '', '')
    from dy_apis.login_api import DYLoginApi
    ttwid = DYLoginApi.register_ttwid()
    auth.cookie['ttwid'] = ttwid
    auth._ttwid = ttwid
    return DouyinAPI.get_work_info(auth, f'https://www.douyin.com/video/{AWEME}')


def guest_respond(req):
    if 'aweme/detail' in req['url']:
        return {'status_code': 0, 'aweme_detail': {
            'aweme_id': AWEME, 'desc': '测试作品 #话题', 'create_time': 1735660800, 'aweme_type': 0,
            'author': {'uid': UID, 'sec_uid': SEC_UID, 'nickname': '作者', 'unique_id': 'author01'},
            'statistics': {'digg_count': 12, 'comment_count': 3, 'collect_count': 4, 'share_count': 5, 'play_count': 0},
            'video': {'cover': {'url_list': ['https://p3.douyinpic.com/cover.jpeg']}, 'width': 1080, 'height': 1920, 'duration': 15000,
                      'play_addr': {'uri': 'v0200fg', 'url_list': ['https://v3-web.douyinvod.com/play.mp4']}}}}
    return respond(req)


case('guest_item_get', guest_item_get, guest_respond, aweme_id=AWEME)

# ================================================================ 主站读接口（登录态，msToken / webid 已缓存）
case('work_info', logged(lambda a: DouyinAPI.get_work_info(a, f'https://www.douyin.com/video/{AWEME}')), aweme_id=AWEME)
case('user_works', logged(lambda a: DouyinAPI.get_user_work_info(a, f'https://www.douyin.com/user/{SEC_UID}', '0')), sec_uid=SEC_UID, cursor='0')
case('user_works_p2', logged(lambda a: DouyinAPI.get_user_work_info(a, f'https://www.douyin.com/user/{SEC_UID}', '1735660800000')),
     sec_uid=SEC_UID, cursor='1735660800000')
case('comments', logged(lambda a: DouyinAPI.get_work_out_comment(a, f'https://www.douyin.com/video/{AWEME}', '10')), aweme_id=AWEME, cursor='10')
case('replies', logged(lambda a: DouyinAPI.get_work_inner_comment(a, {'aweme_id': AWEME, 'cid': '7327990109411902208'}, '0', '10')),
     aweme_id=AWEME, cid='7327990109411902208', cursor='0', count='10')
case('user_info', logged(lambda a: DouyinAPI.get_user_info(a, f'https://www.douyin.com/user/{SEC_UID}')), sec_uid=SEC_UID)
case('search_general', logged(lambda a: DouyinAPI.search_general_work(a, '美食 探店', offset='15')), keyword='美食 探店', offset='15')
case('search_user', logged(lambda a: DouyinAPI.search_user(a, '巴旦木公主')), keyword='巴旦木公主')
case('search_live', logged(lambda a: DouyinAPI.search_live(a, '三角洲', '15')), keyword='三角洲', offset='15')
case('user_favorite', logged(lambda a: DouyinAPI.get_user_favorite(a, SEC_UID)), sec_uid=SEC_UID)
case('collect_list', logged(lambda a: DouyinAPI.get_collect_list(a)))
case('followers', logged(lambda a: DouyinAPI.get_user_follower_list(a, UID, SEC_UID)), user_id=UID, sec_uid=SEC_UID)
case('following', logged(lambda a: DouyinAPI.get_user_following_list(a, UID, SEC_UID, '1735660800')), user_id=UID, sec_uid=SEC_UID, max_time='1735660800')
case('notices', logged(lambda a: DouyinAPI.get_notice_list(a, '1735660000', '1735660800')), min_time='1735660000', max_time='1735660800')
case('feed', logged(lambda a: DouyinAPI.get_feed(a, refresh_index='3')), refresh_index='3')
case('my_uid', logged(lambda a: DouyinAPI.get_my_uid(a)))
case('device_id', lambda: DouyinAPI.get_device_id(logged_auth()))
case('my_sec_uid', logged(lambda a: DouyinAPI.get_my_sec_uid(a)),
     lambda req: {'user': {'sec_uid': SEC_UID, 'uid': UID, 'nickname': '我'}} if 'user/info' in req['url'] else respond(req))

# ================================================================ 写操作（bd-ticket-guard、dtrait、csrf、uid）
case('digg', logged(lambda a: DouyinAPI.digg(a, AWEME, '1')), aweme_id=AWEME, type='1')
case('undigg', logged(lambda a: DouyinAPI.digg(a, AWEME, '0')), aweme_id=AWEME, type='0')
case('collect', logged(lambda a: DouyinAPI.collect_aweme(a, AWEME, '1')), aweme_id=AWEME, action='1')
case('uncollect', logged(lambda a: DouyinAPI.collect_aweme(a, AWEME, '0')), aweme_id=AWEME, action='0')
case('comment_publish', logged(lambda a: DouyinAPI.publish_comment(a, AWEME, '好看！ & ok')), aweme_id=AWEME, text='好看！ & ok')
case('comment_reply', logged(lambda a: DouyinAPI.publish_comment(a, AWEME, '回复', reply_id='7327990109411902208')),
     aweme_id=AWEME, text='回复', reply_id='7327990109411902208')

# 没有缓存 uid：先 query/user 取 uid 再发
case('digg_uid', lambda: (lambda a: (setattr(a, 'uid', None), DouyinAPI.digg(a, AWEME, '1'))[1])(logged_auth()), aweme_id=AWEME)

# ================================================================ 直播与商品
ROOM_ID = '7400000000000000000'
WEB_RID = '852953608964'
ANCHOR = '98765432100'
LIVE_HTML = ('<html><head><script nonce="n1">var x = 1;</script>'
             '<script nonce="n2">self.__pace_f.push([1,"{\\"state\\":{\\"roomStore\\":{\\"roomInfo\\":{\\"room\\":{\\"id_str\\":\\"'
             + ROOM_ID + '\\",\\"status\\":2,\\"status_str\\":\\"2\\",\\"title\\":\\"测试直播\\",\\"user_count_str\\":\\"1.2万\\"},'
             '\\"roomId\\":\\"' + ROOM_ID + '\\",\\"anchor\\":{\\"id_str\\":\\"' + ANCHOR + '\\",\\"sec_uid\\":\\"' + SEC_UID
             + '\\",\\"nickname\\":\\"主播\\"}}},\\"userStore\\":{\\"odin\\":{\\"user_unique_id\\":\\"111222333\\"}}}}"])</script></head></html>')


def live_respond(req):
    if req['url'].startswith('https://live.douyin.com/' + WEB_RID):
        return {'status': 200, 'headers': {'set-cookie': 'ttwid=1%7Clive-ttwid%7C1790000000%7C9999; Path=/; Domain=douyin.com',
                                          'content-type': 'text/html'}, 'body': LIVE_HTML}
    if 'promotions/pop/v3' in req['url']:
        return {'status_code': 0, 'promotions': [{'promotion_id': '3622058069401408240', 'product_id': '3622058069401408999',
                                                  'shop_id': 'fakeShop01', 'title': '测试商品', 'min_price': 1990, 'max_price': 2990,
                                                  'cover': 'https://p3.douyinpic.com/goods.jpeg', 'status': 1, 'in_stock': True}]}
    return respond(req)


case('live_info', logged(lambda a: DouyinAPI.get_live_info(a, WEB_RID)), live_respond, web_rid=WEB_RID)
case('live_room_enter', logged(lambda a: DouyinAPI.get_live_room_enter(a, WEB_RID)), web_rid=WEB_RID)
case('live_rank', logged(lambda a: DouyinAPI.get_live_contribution_rank(a, ROOM_ID, ANCHOR, SEC_UID, web_rid=WEB_RID)),
     room_id=ROOM_ID, anchor_id=ANCHOR, sec_uid=SEC_UID, web_rid=WEB_RID)
case('live_production', logged(lambda a: DouyinAPI.get_live_production(a, 'https://live.douyin.com/' + WEB_RID, ROOM_ID, ANCHOR)),
     live_respond, url='https://live.douyin.com/' + WEB_RID, room_id=ROOM_ID, anchor_id=ANCHOR)
case('live_products', logged(lambda a: DouyinAPI.get_all_live_production(a, 'https://live.douyin.com/' + WEB_RID)), live_respond, web_rid=WEB_RID)
case('product_detail', logged(lambda a: DouyinAPI.get_live_production_detail(a, 'https://live.douyin.com/', '3622058069401408240')),
     promotion_id='3622058069401408240')
case('product_comments', logged(lambda a: DouyinAPI.get_product_comments(a, '3622058069401408999', 'fakeShop01', '10')),
     product_id='3622058069401408999', shop_id='fakeShop01', cursor='10')
case('webcast_fetch', logged(lambda a: base64.b64encode(DouyinAPI.get_webcast_detail(a, '111222333', ROOM_ID, 'https://live.douyin.com/' + WEB_RID)).decode()),
     lambda req: {'status': 200, 'headers': {}, 'body': '\x12\x05abcde'} if 'im/fetch' in req['url'] else respond(req),
     user_id='111222333', room_id=ROOM_ID)
case('live_like', logged(lambda a: DouyinAPI.diggLiveRoom(a, ROOM_ID, '1')), room_id=ROOM_ID)
case('live_chat', logged(lambda a: DouyinAPI.sendMsgInRoom(a, ROOM_ID, '主播好 666', web_rid=WEB_RID)), room_id=ROOM_ID, web_rid=WEB_RID, content='主播好 666')


# ================================================================ mssdk 的 msToken 生命周期
def ms_expired():
    auth = logged_auth()
    auth._ms_ts = 0
    mstoken_mod._cache.update(token=MS_TOKEN, ts=0)
    return auth.msToken


case('mstoken_renew', ms_expired)
case('mstoken_common', lambda: mstoken_mod.refresh_common_mstoken(current_token=MS_TOKEN))
case('mstoken_common_sms', lambda: mstoken_mod.refresh_common_mstoken(current_token=MS_TOKEN, sms=True))
case('mstoken_behavior', lambda: mstoken_mod.refresh_common_mstoken(current_token=MS_TOKEN, behavior=True))
case('server_cert', lambda: __import__('utils.bd_ticket', fromlist=['x']).fetch_server_cert(2906, COOKIES, origin='https://creator.douyin.com'))


# 第二部分：私信、上传、发布、登录
exec(compile((Path(__file__).parent / "gen_more.py").read_text(encoding="utf-8"), "gen_more.py", "exec"))
