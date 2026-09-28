"""tiktok 的对拍数据：用上游 TiktokApis 的代码构造请求与签名（只用假凭证），记录请求序列。

运行：.golden/tiktok/Scripts/python.exe scripts/golden/tiktok/gen.py
依赖：uv pip install -r references/TiktokApis/requirements.txt（blackboxprotobuf 换成 bbpb）

框架之外的补丁（不改 catbus_golden.py）：
- secrets.randbits：签名密钥字用它，按 catbus_golden 的 getrandbits 公式固定；
- 上游起的 node 进程（WebMssdk frontierSign、Shop BSID）预加载 tiktok/node_determinism.cjs，
  并按包内路径运行 static/tiktok/ 下的同一份 JS（catbus 根目录 package.json 是 ESM，
  上游的 CommonJS 运行器在 references/ 原位跑不起来）；
- 上游 http_client.request 在 catbus_golden 截获前会补 impersonate 等参数，这里保持不变。
"""

import base64
import json
import secrets
import sys
from collections import OrderedDict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catbus_golden as g  # noqa: E402

out = g.setup('tiktok', 'TiktokApis')
ROOT = g.ROOT
STATIC = ROOT / 'static' / 'tiktok'

secrets.randbits = lambda k: g._getrandbits(None, k)

import os  # noqa: E402

os.environ['NODE_OPTIONS'] = f'--require "{(ROOT / "scripts" / "golden" / "tiktok" / "node_determinism.cjs").as_posix()}"'

from signing import aws_v4, pure, ticket_guard  # noqa: E402
from signing import live_wire  # noqa: E402
from builder.signer import TiktokSigner  # noqa: E402
from signing.shop_bsid import ShopBSIDSigner  # noqa: E402

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'


def case(name, fn, **input):
    g.case(out, name, fn, input=input)


def b64(v):
    return {'base64': base64.b64encode(bytes(v)).decode()}


# ---------------------------------------------------------------- 纯算签名原语
KEY = [0x01234567, 0x89ABCDEF, 0xFEDCBA98, 0x76543210, 1, 2, 3, 4, 0xFFFFFFFF, 0x80000000, 12345, 67890]
Q = 'aid=1988&app_name=tiktok_web&keyword=%E7%8C%AB&msToken=abc'

case('pure_x_bogus', lambda: [
    pure.encode_x_bogus(Q, UA, '', timestamp=1790000000, ubcode=136, magic=2894886431),
    pure.encode_x_bogus('msToken=' + 'A' * 142 + '==', UA, '{"a":1}', timestamp=1790000000, ubcode=14, magic=2894886431),
    pure.encode_x_bogus(Q, UA),
])
case('pure_gnarly_project', lambda: [
    pure.encode_gnarly_project(Q, '{"x":"中文"}', UA, timestamp=1790000000, timestamp_ms=1790000000123, key_words=KEY),
    pure.encode_gnarly_project(Q, b'\x1f\x8b\x00\xff', UA),
])
case('pure_gnarly_current', lambda: [
    pure.encode_gnarly_current(Q, '', UA, timestamp=1790000000, timestamp_ms=1790000000123,
                               random_low16=4660, random32=0xDEADBEEF, random_tail=7, key_words=KEY),
    pure.encode_gnarly_current(Q, 'room_id=1', UA),
])
case('pure_dynosaur', lambda: [
    pure.encode_dynosaur_current(Q, UA, page='www.tiktok.com/', timestamp=1790000000, rand_b=123456789,
                                 runtime_field8='1234567890', runtime_field18='1.0.0.2870',
                                 runtime_field19='0123456789abcdef0123456789abcdef', key_words=KEY),
    pure.encode_dynosaur_current(Q, UA, page='www.tiktok.com/@猫/live'),
    pure._hash_url_state(Q),
])


def legacy_sign():
    signer = TiktokSigner()
    url = 'https://www.tiktok.com/api/comment/list/?aid=1988&cursor=0&referer=https%3A%2F%2Fwww.tiktok.com%2F&msToken=tok_en-1'
    a = signer.sign(url=url, method='GET', headers={'a': 'b'}, body=None, user_agent=UA,
                    referer='https://www.tiktok.com/@tiktok?lang=zh-Hans')
    b = signer.sign(url=url.replace('/api/comment/list/', '/webcast/room/like/'), method='POST', headers={'a': 'b'},
                    body='{"to_uid":"1"}', user_agent=UA, referer='https://www.tiktok.com/@x/live',
                    metrics={'dynosaur_page': 'www.tiktok.com/@x/live', 'rand_b': 111222333})
    c = signer.sign(url='https://www.tiktok.com/tiktok/web/project/post/v1/?app_name=tiktok_web&aid=1988&msToken=mt',
                    method='POST', headers={'a': 'b'}, body='{"k":1}', user_agent=UA, signing_timestamp=1789999999)
    return [a['values'], b['values'], c['values']]


case('signer_dispatch', legacy_sign)


def aws():
    pairs = [('Action', 'ApplyUploadInner'), ('Version', '2020-11-19'), ('SpaceName', 'tiktok'), ('FileType', 'video'),
             ('s', 'abcdefghijk'), ('device_platform', 'web'), ('business_tag', 'tiktok_video_submission_web'), ('Z', 'a b~*')]
    return [
        aws_v4.canonical_query(pairs),
        aws_v4.sign(method='GET', path='/top/v1', query=pairs, access_key_id='AKFAKE', secret_access_key='SKFAKE',
                    session_token='STFAKE'),
        aws_v4.sign(method='POST', path='/top/v1', query=pairs[:3], access_key_id='AKFAKE', secret_access_key='SKFAKE',
                    session_token='STFAKE', body=b'{"SessionKey":"sk"}', service='imagex'),
    ]


case('aws_v4', aws)

# 固定的假 P-256 私钥与假 ticket（AES-GCM 加密后当作浏览器的 encrypt_ticket）
from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: E402
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC  # noqa: E402

PRIVATE_KEY = ec.derive_private_key(0x1F2E3D4C5B6A79880123456789ABCDEF0123456789ABCDEF0123456789ABCDEF, ec.SECP256R1())
PRIVATE_PEM = PRIVATE_KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                        serialization.NoEncryption()).decode()
_key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=16, salt=b'secure-salt', iterations=1000).derive(b'tt-ticket-guard-iv')
ENCRYPT_TICKET = base64.b64encode(b'\x00' * 12 + AESGCM(_key).encrypt(b'\x00' * 12, b'fake-ticket-0001', None)).decode()
TS_SIGN = 'ts.2.fakefakefake'
(out / '_fixtures.json').write_text(json.dumps({'private_key': PRIVATE_PEM, 'encrypt_ticket': ENCRYPT_TICKET,
                                                'ts_sign': TS_SIGN}, indent=2) + '\n', encoding='utf-8', newline='\n')


def guard():
    headers = ticket_guard.build_headers(private_key_pem=PRIVATE_PEM, encrypt_ticket=ENCRYPT_TICKET, ts_sign=TS_SIGN,
                                         path='/api/comment/publish/', timestamp=1790000000)
    data = ticket_guard.decode_client_data(headers['tt-ticket-guard-client-data'])
    # ECDSA 签名本身带随机数，只比确定的部分，签名串用公钥验一次
    sig = base64.b64decode(data.pop('req_sign'))
    PRIVATE_KEY.public_key().verify(sig, b'ticket=fake-ticket-0001&path=/api/comment/publish/&timestamp=1790000000',
                                    ec.ECDSA(hashes.SHA256()))
    headers.pop('tt-ticket-guard-client-data')
    return {'headers': headers, 'client_data': data,
            'ticket': ticket_guard.decrypt_encrypt_ticket(ENCRYPT_TICKET),
            'client_data_encoded': ticket_guard.encode_client_data(ts_sign=TS_SIGN, req_sign='AAAA', timestamp=1790000000)}


case('ticket_guard', guard)

# ---------------------------------------------------------------- 直播 protobuf（signing/live_wire.py）
from signing.protobuf import field_bytes, field_string, field_varint  # noqa: E402


def live_frames():
    user = field_varint(1, 42) + field_string(3, '观众') + field_string(38, 'viewer') + field_string(46, 'MS4wFAKE')
    chat = field_bytes(2, user) + field_string(3, '你好')
    like = field_varint(2, 3) + field_varint(3, 99) + field_bytes(5, user)
    gift = field_varint(2, 5655) + field_varint(6, 2) + field_bytes(7, user) + field_bytes(15, field_varint(5, 5655) + field_string(16, 'Rose'))
    msgs = b''.join(field_bytes(1, field_string(1, m) + field_bytes(2, p) + field_varint(3, i + 1))
                    for i, (m, p) in enumerate([('WebcastChatMessage', chat), ('WebcastLikeMessage', like),
                                                ('WebcastGiftMessage', gift), ('WebcastMemberMessage', b'\x08\x01')]))
    resp = msgs + field_string(2, 'cursor-1') + field_varint(3, 1000) + field_string(5, 'ext=1') + field_varint(8, 10000) + field_varint(9, 1)
    import gzip
    frame = field_varint(1, 7) + field_varint(2, 8) + field_bytes(5, field_string(1, 'compress_type') + field_string(2, 'gzip')) \
        + field_string(7, 'msg') + field_bytes(8, gzip.compress(resp, mtime=0))
    return {
        'response_raw': b64(resp),
        'response': live_wire.decode_response(resp),
        'frame_raw': b64(frame),
        'frame': live_wire.decode_push_frame(frame),
        'heartbeat': b64(live_wire.encode_heartbeat(7300000000000000001)),
        'enter': b64(live_wire.encode_enter_room(7300000000000000001, 12, 'cursor-1')),
        'ack': b64(live_wire.encode_frame('ack', b'ext=1', log_id=8)),
    }


case('live_wire', live_frames)

# ---------------------------------------------------------------- 上游 Node 签名运行器（WebMssdk frontierSign、Shop BSID）
FRONTIER_COOKIE = 'ttwid=1%7Cfake%7C1790000000%7Cabc; msToken=fakeMsToken; s_v_web_id=verify_fake'


def frontier():
    signer = TiktokSigner(script=str(STATIC / 'signing' / 'env' / 'sign.js'))
    return [
        signer.frontier_sign(cookie=FRONTIER_COOKIE, user_agent=UA, referer='https://www.tiktok.com/@host/live'),
        signer.frontier_sign(cookie=FRONTIER_COOKIE, user_agent=UA, referer='https://www.tiktok.com/messages',
                             stub='0123456789abcdef0123456789abcdef'),
    ]


case('frontier_sign', frontier)

SHOP_MS = 'A' * 142 + '=='
SHOP_OEC = 'ab' * 80
SHOP_COOKIE = f'msToken={SHOP_MS}; oec_lucifer={SHOP_OEC}; ttwid=fake'


def shop_bsid():
    signer = ShopBSIDSigner(script=str(STATIC / 'shop_bsid' / 'sign.js'))
    body = '{"product_id":"1729384756","page_start":2,"page_size":3,"sort_rule":1,"review_filter":{"filter_type":1,"filter_value":6},"component_name":"pdp_left_reviews"}'
    r = signer.sign(url='https://shop.tiktok.com/api/shop/pdp_desktop/get_product_reviews', method='POST',
                    headers=OrderedDict((('accept', 'application/json,*/*;q=0.8'), ('content-type', 'application/json'))),
                    body=body, cookie=SHOP_COOKIE, user_agent=UA, include_diagnostics=True)
    return r


case('shop_bsid', shop_bsid)

# ================================================================ 请求构造：TiktokWebAPI 的各个方法
from api.tiktok_web import TiktokWebAPI  # noqa: E402
from builder.auth import TiktokAuth  # noqa: E402

# 上游对部分端点校验"浏览器实测的签名长度"（随 query 长度变化，假数据下必然不等）；catbus 不做这道闸门，对拍时关掉
_sign_request = TiktokAuth.sign_request
TiktokAuth.sign_request = lambda self, path, **kw: _sign_request(self, path, **{**kw, 'expected_lengths': None})

# 只有假值
MS_TOKEN = 'FakeMsToken-0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV=='
COOKIE = ('ttwid=1%7Cfake-ttwid%7C1790000000%7Cabcdef; tt_csrf_token=fake-csrf-token-0001; tt_chain_token=fakechain; '
          's_v_web_id=verify_fake0001_AbCdEfGh_IjKl_4MnO_8PqR_StUvWxYz0123; multi_sids=7000000000000000001%3Afakesid0001; '
          f'sessionid=fakesession0001; sid_tt=fakesession0001; msToken={MS_TOKEN}; store-country-code=sg')
UID = '7000000000000000001'
IM_HEADERS = OrderedDict([
    ('aid', '1988'), ('app_name', 'tiktok_web'), ('channel', 'tiktok_web'), ('device_platform', 'web_pc'),
    ('device_id', UID), ('region', 'SG'), ('priority_region', 'SG'), ('os', 'windows'),
    ('referer', 'https://www.tiktok.com/messages?lang=zh-Hans'), ('root_referer', 'https://www.tiktok.com/messages?lang=zh-Hans'),
    ('cookie_enabled', 'true'), ('screen_width', '2560'), ('screen_height', '1440'), ('browser_language', 'zh-CN'),
    ('browser_platform', 'Win32'), ('browser_name', 'Mozilla'), ('browser_version', UA.split('Mozilla/', 1)[-1]),
    ('browser_online', 'true'), ('verifyFp', 'verify_fake0001_AbCdEfGh_IjKl_4MnO_8PqR_StUvWxYz0123'),
    ('app_language', 'zh-Hans'), ('webcast_language', 'zh-Hans'), ('tz_name', 'Asia/Shanghai'), ('is_page_visible', 'true'),
    ('focus_state', 'true'), ('is_fullscreen', 'false'), ('history_len', '4'), ('user_is_login', 'true'),
    ('data_collection_enabled', 'true'), ('from_appID', '1988'), ('locale', 'zh-Hans'), ('user_agent', UA),
    ('Web-Sdk-Ms-Token', MS_TOKEN),
])
METRICS = {'im_headers': IM_HEADERS, 'im_sequence_id': 10001, 'im_config_id': 7, 'im_ws_sequence_id': 20001,
           'im_wid': '7300000000000000999', 'screen_width': 2560, 'screen_height': 1440, 'browser_language': 'zh-CN',
           'browser_platform': 'Win32', 'tz_name': 'Asia/Shanghai'}
RUNTIME = dict(ticket_guard_private_key=PRIVATE_PEM, ticket_guard_encrypt_ticket=ENCRYPT_TICKET, ticket_guard_ts_sign=TS_SIGN,
               secsdk_csrf_token='fake-secsdk-csrf', browser_metrics=METRICS)
(out / '_session.json').write_text(json.dumps({'cookie': COOKIE, **RUNTIME}, ensure_ascii=False, indent=2) + '\n',
                                   encoding='utf-8', newline='\n')

SEC = 'MS4wLjABAAAAfakeSecUid0123456789abcdefghijklmnopqrstuvwxyz'
AWEME = '7300000000000000123'
ROOM = '7300000000000000456'
HOST = '7100000000000000789'
VIDEO_URL = f'https://www.tiktok.com/@creator/video/{AWEME}'
PRODUCT_URL = 'https://shop.tiktok.com/us/pdp/fake-product/1729384756'
LIVE_PAGE = 'https://www.tiktok.com/@host.name/live'


def html_with(scope: dict) -> str:
    return ('<html><head></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">'
            + json.dumps({'__DEFAULT_SCOPE__': scope}, ensure_ascii=False, separators=(',', ':')) + '</script></body></html>')


ITEM_STRUCT = {'id': AWEME, 'desc': '猫 #cat', 'createTime': 1789990000,
               'video': {'id': AWEME, 'width': 720, 'height': 1280, 'duration': 14, 'cover': 'https://p16/c.jpg',
                         'playAddr': 'https://v16-webapp-prime.tiktok.com/video/x/?a=1988'},
               'author': {'id': '6900000000000000001', 'uniqueId': 'creator', 'nickname': '创作者', 'secUid': SEC},
               'music': {'id': '1', 'playUrl': 'https://m/a.mp3', 'duration': 14},
               'statsV2': {'playCount': '1200', 'diggCount': '34', 'commentCount': '5', 'collectCount': '6', 'shareCount': '7'}}
USER_INFO = {'user': {'id': '107955', 'uniqueId': 'tiktok', 'nickname': 'TikTok', 'secUid': SEC, 'signature': 'hi',
                      'avatarLarger': 'https://p16/a.jpg'},
             'stats': {'followerCount': 10, 'followingCount': 1, 'heartCount': 99, 'videoCount': 3}}
SHOP_DATA = {'product_info': {'product_model': {'product_id': '1729384756', 'name': '假商品', 'images': [{'url_list': ['https://p/1.jpg']}]},
                              'promotion_model': {'promotion_product_price': {'sale_price_decimal': '9.99', 'currency': 'USD'}}},
             'review_info': {'product_reviews': [{'review_id': 'r1', 'review_text': '好', 'review_user': {'name': 'a'}}],
                             'has_more': True, 'total_reviews': 4}}
SHOP_HTML = ('<html><script id="__MODERN_ROUTER_DATA__" type="application/json">'
             + json.dumps({'loaderData': {'pdp': {'page_config': {'components_map': [
                 {'component_name': 'product_info', 'component_data': SHOP_DATA}]}}}}, ensure_ascii=False) + '</script></html>')


def respond_api(req):
    url = req['url']
    if '/video/' in url and url.startswith('https://www.tiktok.com/@'):
        return {'status': 200, 'headers': {'content-type': 'text/html'},
                'body': html_with({'webapp.video-detail': {'statusCode': 0, 'itemInfo': {'itemStruct': ITEM_STRUCT}}})}
    if url.startswith('https://www.tiktok.com/@') and '/api' not in url:
        return {'status': 200, 'headers': {'content-type': 'text/html'},
                'body': html_with({'webapp.user-detail': {'statusCode': 0, 'userInfo': USER_INFO}, 'webapp.a-b': {}})}
    if 'shop.tiktok.com/us/pdp' in url:
        return {'status': 200, 'headers': {'content-type': 'text/html'}, 'body': SHOP_HTML}
    if 'get_product_reviews' in url:
        return {'code': 0, 'data': {'product_reviews': [{'review_id': 'r2', 'review_text': '二'}], 'has_more': False}}
    if 'post/item_list' in url:
        return {'status_code': 0, 'itemList': [ITEM_STRUCT], 'cursor': '1789990000000', 'hasMore': True}
    if 'web-cookie-privacy/config' in url:
        return {'statusCode': 200, 'body': {'consent': {'wid': '7300000000000000999'}}}
    return {'status_code': 0, 'extra': {}}


def api_case(name, fn, **input):
    def run():
        auth = TiktokAuth.from_cookie(COOKIE, **RUNTIME)
        return fn(TiktokWebAPI(auth), auth)
    g.case(out, name, run, input=input, respond=respond_api)


api_case('user_posted', lambda a, au: a.get_user_posted(SEC, '17', auth=au))
api_case('recommend_feed', lambda a, au: a.get_recommend_feed(auth=au))
api_case('user_playlist', lambda a, au: a.get_user_playlist(SEC, cursor='5', auth=au))
api_case('profile_followers', lambda a, au: a.get_profile_followers(SEC, min_cursor='1789990000', auth=au))
api_case('profile_following', lambda a, au: a.get_profile_following(SEC, auth=au))
api_case('following_item_list', lambda a, au: a.get_following_item_list(cursor='9', auth=au))
api_case('notice_count', lambda a, au: a.get_notice_count(auth=au))
api_case('notice_multi', lambda a, au: a.get_notice_multi(
    group_list=[{'count': 20, 'is_mark_read': 0, 'group': 500, 'max_time': 1789990000, 'min_time': 0}], auth=au))
api_case('im_user_profile', lambda a, au: a.get_im_user_profile(['107955', '42'], auth=au))
api_case('collection_list', lambda a, au: a.get_collection_list(SEC, cursor='3', auth=au))
api_case('repost_list', lambda a, au: a.get_repost_list(SEC, auth=au))
api_case('collected_item_list', lambda a, au: a.get_collected_item_list(SEC, cursor='16', auth=au))
api_case('playlist_name_check', lambda a, au: a.check_playlist_name('我的 收藏', auth=au))
api_case('collection_create', lambda a, au: a.post_collection_create('我的 收藏', auth=au))
api_case('collection_modify_info', lambda a, au: a.post_collection_modify_info('7394627756635573022', '新名字', auth=au))
api_case('collection_detail', lambda a, au: a.get_collection_detail('7394627756635573022', auth=au))
api_case('collection_item_list', lambda a, au: a.get_collection_item_list('7394627756635573022', cursor='30', auth=au))
# 上游把关键词原样放进 Referer 请求头，非 ASCII 时 curl 直接报错；catbus 在请求头里做了百分号编码，对拍用 ASCII 关键词
api_case('search_live_room', lambda a, au: a.search_live_room('猫 cat', auth=au))
api_case('search_general', lambda a, au: a.search_general('cat', offset='12', auth=au))
api_case('search_suggest', lambda a, au: a.get_search_suggest('cat', auth=au))
api_case('comments', lambda a, au: a.get_comments(AWEME, '20', auth=au))
api_case('comment_replies', lambda a, au: a.get_comment_replies(AWEME, '7300000000000000999', '0', referer=VIDEO_URL,
                                                                 root_referer=VIDEO_URL, auth=au))
api_case('comment_publish', lambda a, au: a.post_comment(AWEME, '好看 & 猫', auth=au))
api_case('comment_reply', lambda a, au: a.post_comment_reply(AWEME, '7300000000000000999', '回复', auth=au))
api_case('item_digg', lambda a, au: a.post_item_digg(AWEME, auth=au))
api_case('item_undigg', lambda a, au: a.post_item_digg(AWEME, digg_type='0', auth=au, referer=VIDEO_URL,
                                                       query_referer='https://www.tiktok.com/@creator'))
api_case('item_collect', lambda a, au: a.post_item_collect(AWEME, SEC, auth=au))
api_case('follow_user', lambda a, au: a.post_follow_user('107955', SEC, auth=au, referer='https://www.tiktok.com/@tiktok',
                                                         query_referer='https://www.tiktok.com/@tiktok'))
api_case('unfollow_user', lambda a, au: a.post_follow_user('107955', SEC, action_type='0', follow_type='0', auth=au,
                                                           referer='https://www.tiktok.com/@tiktok',
                                                           query_referer='https://www.tiktok.com/@tiktok'))
api_case('related_items', lambda a, au: a.get_related_items(AWEME, auth=au, referer=VIDEO_URL))
api_case('webcast_feed', lambda a, au: a.get_webcast_feed(auth=au))
api_case('live_user_room', lambda a, au: a.get_live_user_room('host.name', auth=au))
api_case('webcast_drawer_tabs', lambda a, au: a.get_webcast_drawer_tabs(auth=au))
api_case('live_gift_list', lambda a, au: a.get_live_gift_list(ROOM, auth=au))
api_case('webcast_rank_list', lambda a, au: a.get_webcast_rank_list(HOST, ROOM, auth=au))
api_case('live_chat', lambda a, au: a.post_live_chat(ROOM, '你好', auth=au, referer='https://www.tiktok.com/@host.name/live'))
api_case('live_like', lambda a, au: a.post_live_like(HOST, ROOM, auth=au, referer='https://www.tiktok.com/@host.name/live'))
api_case('creator_item_list', lambda a, au: a.get_creator_item_list(cursor=50, auth=au))
api_case('creator_poi_list', lambda a, au: a.post_creator_poi_list(page_num=2, auth=au))
api_case('wid', lambda a, au: a.get_wid(auth=au))
api_case('video_detail', lambda a, au: a.get_video_detail(VIDEO_URL, auth=au))
api_case('user_info', lambda a, au: a.get_user_info('https://www.tiktok.com/@tiktok', auth=au))
api_case('shop_product_detail', lambda a, au: a.get_shop_product_detail(PRODUCT_URL, auth=au))
# 收藏夹：公开（collectionStatus=3）、把视频加入收藏夹
api_case('collection_create_public', lambda a, au: a.post_collection_create('公开 收藏', collection_status='3', auth=au))
api_case('collection_modify_info_public', lambda a, au: a.post_collection_modify_info('7394627756635573022', '新名字', collection_status='3', auth=au))
api_case('collection_modify_items', lambda a, au: a.post_collection_modify_items(
    '7394627756635573022', AWEME, referer=VIDEO_URL, profile_url='https://www.tiktok.com/@creator', auth=au))
# 翻页
api_case('related_items_page', lambda a, au: a.get_related_items(AWEME, cursor='16', auth=au, referer=VIDEO_URL))
# 系统通知（group 661）：首页与私信页两种上下文
api_case('inbox_notice_list', lambda a, au: a.get_inbox_notice_list(
    group_list=[{'count': 20, 'is_mark_read': 0, 'group': 661, 'max_time': 1789990000, 'min_time': 0}], auth=au))
api_case('inbox_notice_list_default', lambda a, au: a.get_inbox_notice_list(auth=au))
api_case('message_notice_list', lambda a, au: a.get_message_notice_list(auth=au))
# 只有房间号时：进房、查是否在播
api_case('enter_live_room', lambda a, au: a.enter_live_room(ROOM, auth=au))
api_case('check_live_rooms', lambda a, au: a.check_live_rooms([ROOM, '7300000000000000457'], auth=au))


def shop_review_page(a, au):
    au.set_cookie('msToken', SHOP_MS)
    au.set_cookie('oec_lucifer', SHOP_OEC)
    a.shop_signer = ShopBSIDSigner(script=str(STATIC / 'shop_bsid' / 'sign.js'))
    return a.get_shop_product_review_page(PRODUCT_URL, page_start=2, auth=au)


api_case('shop_review_page', shop_review_page)


# ================================================================ 二进制响应：记录成 {base64}（catbus_golden 只会记录文本）
def _respond_binary(req):
    g._captured.append(req)
    spec = g._responder[0](req)
    if not (isinstance(spec, dict) and 'body' in spec and set(spec) <= {'status', 'headers', 'body'}):
        spec = {'status': 200, 'headers': {}, 'body': spec}
    spec = {'status': spec.get('status', 200), 'headers': spec.get('headers') or {}, 'body': spec['body']}
    body = spec['body']
    g._responses.append({**spec, 'body': b64(body) if isinstance(body, (bytes, bytearray)) else body})
    return g.FakeResponse(req['url'], spec['status'], spec['headers'], body)


g._respond = _respond_binary

# 直播 protobuf：HTTP 首批与 WS 推送（消息 ID 不重复）
from signing.protobuf import field_bytes as fb, field_string as fs, field_varint as fv  # noqa: E402
import gzip  # noqa: E402


def live_user(uid, nick, handle):
    return fv(1, uid) + fs(3, nick) + fs(38, handle) + fs(46, 'MS4w' + handle)


def live_msgs(base):
    u = live_user(42, '观众', 'viewer')
    items = [('WebcastChatMessage', fb(2, u) + fs(3, '你好')),
             ('WebcastLikeMessage', fv(2, 3) + fv(3, 99) + fb(5, u)),
             ('WebcastGiftMessage', fv(2, 5655) + fv(6, 2) + fb(7, u) + fb(15, fv(5, 5655) + fs(16, 'Rose'))),
             ('WebcastMemberMessage', fb(2, u))]
    return b''.join(fb(1, fs(1, m) + fb(2, p) + fv(3, base + i)) for i, (m, p) in enumerate(items))


LIVE_HTTP = live_msgs(1) + fs(2, 'cursor-1') + fv(3, 1000) + fs(5, 'ext=1') + fv(8, 10000)
LIVE_WS = live_msgs(11) + fs(2, 'cursor-2') + fs(5, 'ext=2') + fv(9, 1)
LIVE_FRAME = fv(1, 7) + fv(2, 8) + fb(5, fs(1, 'compress_type') + fs(2, 'gzip')) + fs(7, 'msg') + fb(8, gzip.compress(LIVE_WS, mtime=0))


def respond_live(req):
    if '/webcast/im/fetch/' in req['url']:
        return {'status': 200, 'headers': {'content-type': 'application/protobuf'}, 'body': LIVE_HTTP}
    return respond_api(req)


SIGNER = TiktokSigner(script=str(STATIC / 'signing' / 'env' / 'sign.js'))


def live_case(name, fn, **input):
    def run():
        auth = TiktokAuth.from_cookie(COOKIE, signer=SIGNER, **RUNTIME)
        return fn(TiktokWebAPI(auth), auth)
    g.case(out, name, run, input=input, respond=respond_live)


live_case('webcast_im_fetch', lambda a, au: a.get_webcast_im_fetch('12', ROOM, auth=au, referer=LIVE_PAGE))


class FakeWS:
    """websocket.create_connection 的替身：记录地址与发出的帧，按顺序回放预置的帧。"""

    def __init__(self, url, frames, stop=None, **kwargs):
        self.url, self.frames, self.stop, self.kwargs, self.sent = url, list(frames), stop, kwargs, []

    def send(self, data, opcode=None):
        self.sent.append(bytes(data) if isinstance(data, (bytes, bytearray)) else data)

    def recv(self):
        if not self.frames:
            if self.stop is not None:
                self.stop.set()
            import websocket
            raise websocket.WebSocketTimeoutException('done')
        frame = self.frames.pop(0)
        if not self.frames and self.stop is not None:
            self.stop.set()
        return frame

    def close(self):
        pass


def with_fake_ws(frames, stop=None):
    import websocket
    holder = {}

    def create_connection(url, **kwargs):
        holder['ws'] = FakeWS(url, frames, stop, **kwargs)
        return holder['ws']
    websocket.create_connection = create_connection
    return holder



def live_listen(a, au):
    import threading
    stop = threading.Event()
    holder = with_fake_ws([LIVE_FRAME], stop)
    events = list(a.iter_live_ws_events('12', ROOM, auth=au, referer=LIVE_PAGE, stop_event=stop))
    ws = holder['ws']
    return {'url': ws.url, 'origin': ws.kwargs.get('origin'), 'sent': [b64(x) for x in ws.sent], 'events': events, 'frame': b64(LIVE_FRAME)}


live_case('live_listen', live_listen)

# ================================================================ 私信
from static import Tiktok_Request_pb2 as im_pb  # noqa: E402
import blackboxprotobuf as _bbp  # noqa: E402

# requirements 里的 blackboxprotobuf==1.0.1 依赖 protobuf 3.10，装不上，这里用的是 bbpb。
# 1.0.1 把 length-delimited 字段解成 bytes（上游 decode_im_protobuf 的 scalar() 据此解 JSON），bbpb 解成 str；
# 把 str 换回 bytes，还原上游依赖的行为。
_bbp_decode = _bbp.decode_message


def _as_bytes(v):
    if isinstance(v, str):
        return v.encode('utf-8')
    if isinstance(v, dict):
        return {k: _as_bytes(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_as_bytes(x) for x in v]
    return v


_bbp.decode_message = lambda raw, *a, **k: (lambda r: (_as_bytes(r[0]), r[1]))(_bbp_decode(raw, *a, **k))

CONV = f'0:1:{UID}:6900000000000000001'


def im_pull_response():
    """一个带会话和两条文本消息的回包（字段布局照上游 decode_im_protobuf 识别的形状）。"""
    def msg(sid, sender, text, ts):
        return (fs(1, CONV) + fv(2, 1) + fv(3, sid) + fv(5, 7300000000000000777) + fv(6, 7) + fv(7, sender)
                + fs(8, json.dumps({'aweType': 0, 'text': text}, ensure_ascii=False, separators=(',', ':'))) + fv(10, ts))
    conv = fs(1, CONV) + fv(2, 7300000000000000777) + fv(3, 1)
    return fv(1, 203) + fv(3, 0) + fb(6, fb(203, fb(1, conv) + fb(2, msg(9001, 6900000000000000001, '你好', 1789990000000))
                                               + fb(2, msg(9002, int(UID), 'hi', 1789990001000))))


IM_PULL = im_pull_response()


def respond_im(req):
    if 'im-api-' in req['url']:
        return {'status': 200, 'headers': {'content-type': 'application/x-protobuf'}, 'body': IM_PULL}
    return respond_api(req)


def im_case(name, fn, **input):
    def run():
        auth = TiktokAuth.from_cookie(COOKIE, signer=SIGNER, **RUNTIME)
        return fn(TiktokWebAPI(auth), auth)
    g.case(out, name, run, input=input, respond=respond_im)


def messages_of(a, raw):
    return {'raw': b64(raw), 'messages': a.decode_im_protobuf(raw)['messages']}


im_case('im_user_init', lambda a, au: messages_of(a, a.get_im_messages_per_user_init(cursor=0, auth=au)))
im_case('im_conversation', lambda a, au: messages_of(a, a.get_im_messages_by_conversation(
    CONV, 7300000000000000777, 1, 0, 1, 50, auth=au)))
# 翻页：init 的 cursor、会话的 anchor_index 换成上一页的 next_cursor
im_case('im_user_init_page', lambda a, au: messages_of(a, a.get_im_messages_per_user_init(cursor=1789990000123, auth=au)))
im_case('im_conversation_page', lambda a, au: messages_of(a, a.get_im_messages_by_conversation(
    CONV, 7300000000000000777, 1, 1789990000000456, 1, 50, auth=au)))
im_case('im_user_combo', lambda a, au: messages_of(a, a.get_im_messages_per_user_combo(
    [{'inbox_type': 0, 'cursor': 1789990000000, 'limit': 50, 'scene': 1}, {'inbox_type': 1, 'cursor': 0, 'limit': 20, 'scene': 1, 'cursor_type': 1}],
    status_adapter_map=1, last_pull_time=1789990000, auth=au)))


def im_send_reply():
    body = im_pb.SendMessageResponseBody(server_message_id=7400000000000000001, status=0, check_code=0, is_async_send=False)
    resp = im_pb.Response(cmd=100, sequence_id=20001, status_code=0, body=im_pb.ResponseBody(send_message_body=body))
    return im_pb.Frame(seqid=1, payload=resp.SerializeToString()).SerializeToString()


def im_send(a, au):
    holder = with_fake_ws(['hi', im_send_reply()])
    r = a.send_im_message(CONV, 7300000000000000777, '你好 catbus', auth=au)
    ws = holder['ws']
    return {'url': ws.url, 'sent': [b64(x) for x in ws.sent], 'response': r}


im_case('im_send', im_send)


def im_notify():
    m = im_pb.MessageBody(conversation_id=CONV, conversation_short_id=7300000000000000777, server_message_id=9003, message_type=7,
                          sender=6900000000000000001, sec_sender='MS4wpeer', content='{"aweType":0,"text":"推送"}', create_time=1789990002000)
    resp = im_pb.Response(cmd=500, status_code=0, body=im_pb.ResponseBody(has_new_message_notify=im_pb.NewMessageNotify(message=m)))
    frame = im_pb.Frame(seqid=5, payload=resp.SerializeToString()).SerializeToString()
    return {'frame': b64(frame), 'decoded': TiktokWebAPI.decode_im_ws_notification(frame),
            'send_response': TiktokWebAPI._decode_im_send_response(im_send_reply()), 'reply': b64(im_send_reply())}


case('im_decode', im_notify)

# ================================================================ Creator Studio：上传与发布
UPLOAD_AUTH = {'video_token_v5': {'access_key_id': 'AKVIDEO', 'secret_acess_key': 'SKVIDEO', 'session_token': 'STVIDEO', 'space_name': 'tiktok'},
               'vframe_token_v5': {'access_key_id': 'AKFRAME', 'secret_acess_key': 'SKFRAME', 'session_token': 'STFRAME', 'space_name': 'tiktok-ai-frame'},
               'status_code': 0}
APPLIED = {'Result': {'InnerUploadAddress': {'UploadNodes': [{
    'Vid': 'v0vid001', 'SessionKey': 'sessionkey001', 'UploadHost': 'tos-sg.example.com',
    'StoreInfos': [{'StoreUri': 'tos-sg/obj001', 'Auth': 'SpaceKey/tos-auth-001'}]}]}}}
MEDIA = bytes(range(256)) * 4


def respond_upload(req):
    url = req['url']
    if '/api/v1/video/upload/auth/' in url:
        return UPLOAD_AUTH
    if 'Action=ApplyUploadInner' in url or 'Action=ApplyImageUpload' in url:
        return APPLIED
    if 'Action=CommitImageUpload' in url:
        return {'Result': {'PluginResult': [{'ImageUri': 'tos-sg/img001', 'ImageWidth': 1080, 'ImageHeight': 1920}]}}
    if 'Action=CommitUploadInner' in url:
        return {'Result': {'Results': [{'Uri': 'tos-sg/poster001'}]}}
    if 'Action=GetUploadCandidates' in url:
        return {'Result': {'Domains': [{'Name': 'up1.example.com', 'StoreID': 's1', 'Sign': 'sig1'}]}}
    if '/upload/v1/' in url:
        return {'code': 2000, 'data': {'crc32': 'ok'}}
    if 'transcode/enable' in url and req['method'] == 'HEAD':
        return {'status': 200, 'headers': {'x-ware-csrf-token': '0,fake-ware-token,86370000,success,fake'}, 'body': ''}
    if 'transcode/result' in url:
        return {'status_code': 0, 'transcode_result': [{'transcode_status': 3, 'play_url': 'https://v.example.com/play.mp4'}]}
    if 'project/post' in url:
        return {'status_code': 0, 'single_post_resp_list': [{'status_code': 0, 'item_id': '7400000000000000002'}]}
    return {'status_code': 0}


def upload_case(name, fn, **input):
    def run():
        auth = TiktokAuth.from_cookie(COOKIE, **RUNTIME)
        return fn(TiktokWebAPI(auth), auth)
    g.case(out, name, run, input=input, respond=respond_upload)


upload_case('upload_auth_signed', lambda a, au: a.get_upload_auth(auth=au))
upload_case('upload_auth_unsigned', lambda a, au: a.get_upload_auth(signed=False, auth=au, referer=f'{a.origin}/tiktokstudio/upload/post/photo'))
upload_case('upload_candidates', lambda a, au: a.get_upload_candidates(upload_auth=UPLOAD_AUTH, auth=au))
upload_case('apply_upload_inner_video', lambda a, au: a.apply_upload_inner(len(MEDIA), upload_auth=UPLOAD_AUTH, client_best_hosts=['up1.example.com', 'up2.example.com'], auth=au))
upload_case('apply_upload_inner_image', lambda a, au: a.apply_upload_inner(10, file_type='image', space_name='tiktok-ai-frame', upload_auth=UPLOAD_AUTH, auth=au))
upload_case('upload_tos_post', lambda a, au: a.upload_tos_bytes(APPLIED, MEDIA, upload_auth=UPLOAD_AUTH, post_upload=True, auth=au))
upload_case('upload_tos_plain', lambda a, au: a.upload_tos_bytes(APPLIED, MEDIA, filename='undefined', auth=au))
upload_case('commit_upload_inner', lambda a, au: a.commit_upload_inner('sessionkey001', upload_auth=UPLOAD_AUTH, space_name='tiktok-ai-frame', auth=au))
upload_case('apply_image_upload', lambda a, au: a.apply_image_upload(len(MEDIA), upload_auth=UPLOAD_AUTH, auth=au))
upload_case('commit_image_upload', lambda a, au: a.commit_image_upload('sessionkey001', upload_auth=UPLOAD_AUTH, auth=au))
upload_case('upload_photo_bytes', lambda a, au: a.upload_photo_bytes(MEDIA, upload_auth=UPLOAD_AUTH, auth=au))
upload_case('upload_media_image', lambda a, au: a.upload_media_bytes(MEDIA, file_type='image', space_name='tiktok', scene='poster',
                                                                     business_tag='tiktok_video_cover_web', upload_auth=UPLOAD_AUTH, auth=au))
upload_case('transcode_enable', lambda a, au: a.enable_video_transcode('v0vid001', auth=au))
upload_case('transcode_result', lambda a, au: a.get_video_transcode_result('v0vid001', width=720, height=1280, duration_ms=14000,
                                                                           file_key='file_1790000000123_000042', auth=au))
upload_case('media_openid', lambda a, au: a.get_media_openid(auth=au))
upload_case('project_create', lambda a, au: a.post_project_create('ROO_abcdefghijk012345', auth=au))


def project_bodies(a, au):
    return {
        'video': a.build_creator_project_body(creation_id='ROO_abcdefghijk012345', video_id='v0vid001', text='文案 #cat', cover_uri='tos-sg/poster001',
                                              play_url='https://v.example.com/play.mp4', filename='a.mp4', width=720, height=1280,
                                              duration_ms=14000, fps=30, visibility_type=0),
        'photo': a.build_creator_photo_project_body(creation_id='abcdefghijklmnopqrstu', photos=[
            {'id': 'file_1790000000123_42', 'uri': 'tos-sg/img001', 'width_px': 1080, 'height_px': 1920},
            {'id': 'file_1790000000124_7', 'uri': 'tos-sg/img002', 'width_px': 800, 'height_px': 600}], text='图文', title='标题', visibility_type=2),
        'creation_id': a._creator_creation_id(),
        'photo_creation_id': a._creator_photo_creation_id(),
        'upload_s': a._upload_random_s(),
    }


upload_case('project_bodies', project_bodies)


def project_bodies_toggles(a, au):
    """发布的互动开关（allow_comment / duet / stitch / content_reuse / ai_remix）写进 body 的位置。"""
    return {
        'video': a.build_creator_project_body(creation_id='ROO_abcdefghijk012345', video_id='v0vid001', text='文案', cover_uri='tos-sg/poster001',
                                              play_url='https://v.example.com/play.mp4', filename='a.mp4', width=720, height=1280,
                                              duration_ms=14000, fps=30, visibility_type=0, allow_comment=0, allow_duet=1,
                                              allow_stitch=1, allow_content_reuse=0, allow_ai_remix=0),
        'photo': a.build_creator_photo_project_body(creation_id='abcdefghijklmnopqrstu', photos=[
            {'id': 'file_1790000000123_42', 'uri': 'tos-sg/img001', 'width_px': 1080, 'height_px': 1920}], text='图文', title='标题',
            visibility_type=0, allow_comment=0, allow_duet=0, allow_stitch=0, allow_content_reuse=0, allow_ai_remix=1),
    }


upload_case('project_bodies_toggles', project_bodies_toggles)
upload_case('post_project', lambda a, au: a.post_project('{"post_common_info":{"creation_id":"ROO_x"}}', ticket_guard={}, auth=au))


# ================================================================ 命令流程
def flow_user_items():
    """catbus tiktok user items @tiktok = 主页 SSR 取 secUid → post/item_list。"""
    auth = TiktokAuth.from_cookie(COOKIE, **RUNTIME)
    api = TiktokWebAPI(auth)
    info = api.get_user_info('https://www.tiktok.com/@tiktok', auth=auth)
    return api.get_user_posted(info['userInfo']['user']['secUid'], '0', auth=auth)


g.case(out, 'flow_user_items', flow_user_items, input={'user': '@tiktok'}, respond=respond_api)


def flow_product_reviews():
    """catbus tiktok comment list <商品 URL> --cursor 2 = 商品页 SSR → 第 2 页评价（BSID）。"""
    auth = TiktokAuth.from_cookie(COOKIE, **RUNTIME)
    auth.set_cookie('msToken', SHOP_MS)
    auth.set_cookie('oec_lucifer', SHOP_OEC)
    api = TiktokWebAPI(auth, shop_signer=ShopBSIDSigner(script=str(STATIC / 'shop_bsid' / 'sign.js')))
    api.get_shop_product_detail(PRODUCT_URL, auth=auth)
    return api.get_shop_product_review_page(PRODUCT_URL, page_start=2, auth=auth)


g.case(out, 'flow_product_reviews', flow_product_reviews, input={'product': PRODUCT_URL, 'cursor': '2'}, respond=respond_api)


# ---------------------------------------------------------------- 收藏夹：加视频、改公开状态
FOLDER = '7394627756635573022'


def respond_folder(req):
    url = req['url']
    if '/video/' in url and url.startswith('https://www.tiktok.com/@'):
        item = {**ITEM_STRUCT, 'collected': False}
        return {'status': 200, 'headers': {'content-type': 'text/html'},
                'body': html_with({'webapp.video-detail': {'statusCode': 0, 'itemInfo': {'itemStruct': item}}})}
    if '/api/collection/detail/' in url:
        return {'statusCode': 0, 'collectionInfo': {'collectionId': FOLDER, 'name': '旧名字', 'status': 3, 'total': '5', 'userName': 'me_handle'}}
    return respond_api(req)


def flow_folder_add():
    """catbus tiktok folder add <收藏夹> <视频 URL> = 视频页 → 还没收藏时先收藏 → collection/modify_items。"""
    auth = TiktokAuth.from_cookie(COOKIE, **RUNTIME)
    api = TiktokWebAPI(auth)
    item = api.get_video_detail(VIDEO_URL, auth=auth)
    handle = item['author']['uniqueId']
    page = f'https://www.tiktok.com/@{handle}/video/{item["id"]}'
    profile = f'https://www.tiktok.com/@{handle}'
    api.post_item_collect(item['id'], item['author']['secUid'], auth=auth, referer=page, query_referer=profile)
    return api.post_collection_modify_items(FOLDER, item['id'], referer=page, profile_url=profile, auth=auth)


g.case(out, 'flow_folder_add', flow_folder_add, input={'folder': FOLDER, 'item': VIDEO_URL}, respond=respond_folder)


def flow_folder_update():
    """catbus tiktok folder update <收藏夹> --name 新名字 = 收藏夹详情取原来的公开状态 → modify_info。"""
    auth = TiktokAuth.from_cookie(COOKIE, **RUNTIME)
    api = TiktokWebAPI(auth)
    info = api.get_collection_detail(FOLDER, auth=auth)['collectionInfo']
    return api.post_collection_modify_info(FOLDER, '新名字', collection_status=str(info['status']), auth=auth)


g.case(out, 'flow_folder_update', flow_folder_update, input={'folder': FOLDER, 'name': '新名字'}, respond=respond_folder)

# ---------------------------------------------------------------- 只有房间号的直播间
ENTER_ROOM = {
    'id_str': ROOM, 'status': 2, 'title': '直播中', 'user_count': 12,
    'owner': {'id_str': HOST, 'display_id': 'host.name', 'nickname': '主播'},
    'cover': {'url_list': ['https://p16/cover.jpg']},
    'stream_url': {
        'flv_pull_url': {'FULL_HD1': 'https://pull-flv.example.com/stage/stream-1_or4.flv', 'HD1': 'https://pull-flv.example.com/stage/stream-1_hd.flv'},
        'hls_pull_url': 'https://pull-hls.example.com/stage/stream-1/index.m3u8',
        'rtmp_pull_url': 'rtmp://pull-rtmp.example.com/stage/stream-1',
    },
}


def respond_room(req):
    url = req['url']
    if '/webcast/room/enter/' in url:
        return {'status_code': 0, 'data': ENTER_ROOM, 'extra': {}}
    if '/webcast/room/check_alive/' in url:
        return {'status_code': 0, 'data': [{'alive': True, 'room_id': int(ROOM), 'room_id_str': ROOM}], 'extra': {}}
    if '/webcast/room/like/' in url:
        return {'status': 200, 'headers': {}, 'body': ''}
    return respond_api(req)


def flow_live_get_room():
    """catbus tiktok live get <房间号> = check_alive → 在播时进房取房间对象。"""
    auth = TiktokAuth.from_cookie(COOKIE, **RUNTIME)
    api = TiktokWebAPI(auth)
    api.check_live_rooms(ROOM, auth=auth)
    return api.enter_live_room(ROOM, auth=auth)['data']


g.case(out, 'flow_live_get_room', flow_live_get_room, input={'room': ROOM}, respond=respond_room)


def flow_live_like_room():
    """catbus tiktok live like <房间号> = 进房取主播 → room/like（referer 是主播的直播页）。"""
    auth = TiktokAuth.from_cookie(COOKIE, **RUNTIME)
    api = TiktokWebAPI(auth)
    owner = api.enter_live_room(ROOM, auth=auth)['data']['owner']
    return api.post_live_like(owner['id_str'], ROOM, auth=auth, referer=f'https://www.tiktok.com/@{owner["display_id"]}/live')


g.case(out, 'flow_live_like_room', flow_live_like_room, input={'room': ROOM}, respond=respond_room)

# ---------------------------------------------------------------- 通知：动态（500）+ 系统通知（661）
DIGG_NOTICE = {'nid_str': '7400000000000000101', 'type': 41, 'create_time': 1789985000,
               'digg': {'from_user': [{'uid': '42', 'nickname': '观众', 'unique_id': 'viewer'}],
                        'aweme': {'aweme_id': AWEME, 'author': {'unique_id': 'creator'}}}}
SYSTEM_NOTICE = {'nid_str': '7400000000000000201', 'type': 212, 'create_time': 1789988000, 'has_read': False,
                 'template_notice': {'schema_url': 'https://www.tiktok.com/inbox', 'notice': {
                     'title_template': {'title': '账号更新'}, 'content': '你的账号已完成验证'}}}


def respond_notice(req):
    url = req['url']
    if '/api/notice/multi/' in url:
        return {'status_code': 0, 'notice_lists': [{'group': 500, 'has_more': True, 'max_time': 1789980000, 'min_time': 1789990000,
                                                    'notice_list': [DIGG_NOTICE]}]}
    if '/api/inbox/notice_list/' in url:
        return {'status_code': 0, 'notice_lists': [{'group': 661, 'has_more': False, 'max_time': 1789970000, 'min_time': 1789988000,
                                                    'notice_list': [SYSTEM_NOTICE]}]}
    return respond_api(req)


def flow_notice_list():
    """catbus tiktok notice list = notice/multi（group 500）+ inbox/notice_list（group 661）。"""
    auth = TiktokAuth.from_cookie(COOKIE, **RUNTIME)
    api = TiktokWebAPI(auth)
    activity = api.get_notice_multi(group_list=[{'count': 20, 'is_mark_read': 0, 'group': 500, 'max_time': 0, 'min_time': 0}], auth=auth)
    system = api.get_inbox_notice_list(group_list=[{'count': 20, 'is_mark_read': 0, 'group': 661, 'max_time': 0, 'min_time': 0}], auth=auth)
    return {'activity': activity, 'system': system}


g.case(out, 'flow_notice_list', flow_notice_list, input={}, respond=respond_notice)
