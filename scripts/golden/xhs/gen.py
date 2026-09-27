"""xhs 的对拍数据：用上游 Spider_XHS 的代码构造请求（只用假凭证），记录请求序列。

运行：.golden/xhs/Scripts/python scripts/golden/xhs/gen.py
依赖：uv pip install -r references/Spider_XHS/requirements.txt；references/Spider_XHS 下 npm install（crypto-js）

框架之外补的确定性处理（都只在本脚本里 monkeypatch，不改上游、不改 catbus_golden.py）：
- secrets.randbits 在 import 时就绑定到了系统随机源，这里换成确定性的 getrandbits；
- 两份 x-xray-traceid 的模块级自增序号每个用例重置为 XRAY_SEQ；
- PC / Creator 的 ds 缓存（模块级 5 分钟缓存）每个用例清空；
- web_ssk 握手的 X25519 私钥改由确定性随机字节生成（公钥用 node 从私钥导出）；
- Creator 签名传参用的临时文件名不走 random（否则会占用确定性序列，TS 侧没有这一步）；
- 上游 bug：XHSLiveAPI._request 对 live-room 域总会留下 x-b3-traceid，而 live 头顺序表里没有它，
  build_pc_live_headers 必然抛错（所有直播 HTTP 接口都不可用）。这里在排序前去掉它（catbus 同样处理）。
- 上游 JS 的 crypto.randomBytes（x-rap-param 的 mask / xorKey / nonce / 填充，webSsk 的 x6/x7 随机数）
  由 crypto_determinism.cjs 改为从已固定的 Math.random 取值，catbus 的签名 vm 做同样替换。
"""

import base64
import json
import os
import secrets
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catbus_golden as g  # noqa: E402

out = g.setup('xhs', 'Spider_XHS')
os.environ['NODE_OPTIONS'] += ' --require "' + (Path(__file__).resolve().parent / 'crypto_determinism.cjs').as_posix() + '"'

secrets.randbits = lambda k: g._getrandbits(None, k)

# Creator 的 run_signer 用 NamedTemporaryFile 传参：临时文件名的随机字符不能占用确定性序列
import itertools  # noqa: E402
import tempfile  # noqa: E402

_tmp_names = (f'catbus{i:010d}' for i in itertools.count())
tempfile._get_candidate_names = lambda: _tmp_names
tempfile.gettempdir()

import xhs_utils.xhs_core.params as core_params  # noqa: E402
import xhs_utils.xhs_creator.dsl as creator_dsl  # noqa: E402
import xhs_utils.xhs_pc.dsl as pc_dsl  # noqa: E402
import xhs_utils.xhs_pc.params as pc_params  # noqa: E402
from xhs_utils.xhs_pc import auth as pc_auth_mod  # noqa: E402
from xhs_utils.xhs_creator import auth as creator_auth_mod  # noqa: E402
import apis.xhs_pc_login_apis as pc_login_mod  # noqa: E402
from apis.xhs_pc_apis import XHS_Apis  # noqa: E402
from apis.xhs_pc_login_apis import XHSLoginApi  # noqa: E402
from apis.xhs_creator_apis import XHS_Creator_Apis  # noqa: E402
from apis.xhs_creator_login_apis import XHSCreatorLoginApi  # noqa: E402
from apis.xhs_live import XHSLiveAPI  # noqa: E402
from apis.xhs_pugongying_apis import PuGongYingAPI  # noqa: E402
from apis.xhs_qianfan_apis import QianFanAPI  # noqa: E402

XRAY_SEQ = 1000
ROOT = g.ROOT
WEB_SSK_JS = (ROOT / 'references' / 'Spider_XHS' / 'xhs_utils' / 'xhs_pc' / 'js' / 'web_ssk.js').as_posix()

# ---------------------------------------------------------------- 假凭证（只有假值）
USER_ID = '5f0000000000000000000001'
A1 = '19a0c4506c7fakea1fakea1fakea1fakea1fakea150000123456'
PC_COOKIES = (
    'abRequestId=fake-ab-request-id; ets=1789999990000; webBuild=6.47.2; xsecappid=xhs-pc-web; '
    f'loadts=1789999990123; a1={A1}; webId=0123456789abcdef0123456789abcdef; gid=fake-gid-value; '
    'websectiga=0000000000000000000000000000000000000000000000000000000000000000; '
    'sec_poison_id=00000000-0000-0000-0000-000000000000; web_session=fake-web-session; acw_tc=fake-acw'
)
CREATOR_COOKIES = (
    f'abRequestId=fake-ab-request-id; ets=1789999990000; a1={A1}; webId=0123456789abcdef0123456789abcdef; '
    'gid=fake-gid-value; customer-sso-sid=fake-sso; x-user-id-creator.xiaohongshu.com=5f0000000000000000000001; '
    'customerClientId=fake-client; access-token-creator.xiaohongshu.com=fake-creator-token; '
    'galaxy_creator_session_id=fake-galaxy; galaxy.creator.beaker.session.id=fake-beaker; web_session=fake-web-session; '
    'webBuild=1.26.0; xsecappid=ugc; websectiga=0000000000000000000000000000000000000000000000000000000000000000; '
    'sec_poison_id=00000000-0000-0000-0000-000000000000; loadts=1789999990123'
)
PGY_COOKIES = {
    'a1': A1, 'webId': '0123456789abcdef0123456789abcdef', 'gid': 'fake-gid-value',
    'web_session': 'fake-web-session', 'access-token-pgy.xiaohongshu.com': 'fake-pgy-token',
}

NOTE_ID = '6a3b5a0b000000002103ee67'
NOTE_URL = f'https://www.xiaohongshu.com/explore/{NOTE_ID}?xsec_token=FAKEtoken=&xsec_source=pc_feed'
DSL = '1789999980000'
PC_DS_JS = f"function getdss() {{ return '{DSL}'; }};\nvar _0x1=[];\n"
CREATOR_DS_JS = (
    f"function getdss() {{ return '{DSL}'; }};\nvar __$c='00';\n"
    'var _dsf = function (k, b) { var o = []; for (var i = 0; i < 16; i++) o.push((b[i] * 31 + b[23 - i] + i) & 255); return o; };\n'
)
WEBSECTIGA = 'ab' * 32
# 假的 seccallback 程序：满足上游校验（>=1000 字符、形如 x()(window,{...})），执行后回调固定的 websectiga
SEC_PROGRAM = (
    "function _p(){return function(w,o){w.seccallback(o.v)}}_p()(window,{v:'" + WEBSECTIGA + "'});"
    + '/*' + 'x' * 1100 + '*/'
)
GID = 'g' * 72
NOTE_CARD = {
    'type': 'normal', 'title': '测试笔记', 'desc': '正文', 'time': 1789000000000,
    'user': {'user_id': '5f0000000000000000000003', 'nickname': '作者', 'xsec_token': 'AUTHtoken='},
    'interact_info': {'liked_count': '1.2万', 'comment_count': '34', 'collected_count': '56', 'share_count': '7'},
    'image_list': [{'width': 1080, 'height': 1440, 'info_list': [
        {'image_scene': 'WB_PRV', 'url': 'http://sns-webpic-qc.xhscdn.com/1/2/notes_pre_post/1040g3k8abc!nc_n_webp_prv_1'},
        {'image_scene': 'WB_DFT', 'url': 'http://sns-webpic-qc.xhscdn.com/1/2/notes_pre_post/1040g3k8abc!nd_dft_wlteh_webp_3'}]}],
}
SEC_POISON = '11111111-2222-3333-4444-555555555555'
FAKE_SSK = bytes(range(40))


def node(script: str, *args: str) -> str:
    return subprocess.run(['node', '-e', script, *args], capture_output=True, text=True, check=True, env={**os.environ, 'NODE_OPTIONS': ''}).stdout.strip()


def fixed_handshake():
    """确定性的 X25519 握手：私钥是 32 个确定性随机字节，公钥由 node 从私钥导出（与 catbus 一致）."""
    priv = g._urandom(32)
    pub = node(
        f"const w=require({json.dumps(WEB_SSK_JS)});const k=w.privateKeyFromRaw(Buffer.from(process.argv[1],'base64'));"
        "const c=require('crypto');process.stdout.write(c.createPublicKey(k).export({format:'der',type:'spki'}).subarray(-32).toString('base64'))",
        base64.b64encode(priv).decode(),
    )
    return {'private_key_base64': base64.b64encode(priv).decode(), 'client_public_key_base64': pub}


def encrypted_ssk(client_private_b64: str) -> str:
    """服务端下发的加密 SSK：用客户端私钥与固定的服务端公钥协商出同一个共享密钥，AES-256-GCM 固定 nonce."""
    return node(
        f"const w=require({json.dumps(WEB_SSK_JS)});const c=require('crypto');"
        "const s=c.diffieHellman({privateKey:w.privateKeyFromRaw(Buffer.from(process.argv[1],'base64')),publicKey:w.publicKeyFromRaw(w.SERVER_PUBLIC_KEY)});"
        "const n=Buffer.alloc(12,7);const e=c.createCipheriv('aes-256-gcm',s,n);const ct=Buffer.concat([e.update(Buffer.from(process.argv[2],'base64')),e.final()]);"
        "process.stdout.write(Buffer.concat([n,ct,e.getAuthTag()]).toString('base64'))",
        client_private_b64, base64.b64encode(FAKE_SSK).decode(),
    )


_handshakes = []


def _handshake():
    h = fixed_handshake()
    _handshakes.append(h)
    return h


pc_login_mod.create_web_ssk_handshake = _handshake

import apis.xhs_live as live_mod  # noqa: E402

_build_live = live_mod.build_pc_live_headers


def _build_live_fixed(headers, cookies, *, method='POST'):
    return _build_live({k: v for k, v in headers.items() if k.lower() != 'x-b3-traceid'}, cookies, method=method)


live_mod.build_pc_live_headers = _build_live_fixed


def ok(data=None, **extra):
    return {'code': 0, 'success': True, 'msg': '成功', 'data': data if data is not None else {}, **extra}


def respond(req):
    url = req['url']
    if '/api/sec/v1/ds?appId=xhs-pc-web' in url:
        return {'status': 200, 'headers': {'content-type': 'application/javascript'}, 'body': PC_DS_JS}
    if '/api/sec/v1/ds?appId=ugc' in url:
        return {'status': 200, 'headers': {'content-type': 'application/javascript'}, 'body': CREATOR_DS_JS}
    if url in ('https://www.xiaohongshu.com/', 'https://www.xiaohongshu.com/explore'):
        return {'status': 200, 'headers': {'set-cookie': 'abRequestId=fake-ab-from-nav; Domain=.xiaohongshu.com; Path=/'}, 'body': '<html></html>'}
    if url.startswith('https://creator.xiaohongshu.com/login') or url.startswith('https://creator.xiaohongshu.com/publish/publish'):
        return {'status': 200, 'headers': {}, 'body': '<html></html>'}
    if '/api/sec/v1/scripting' in url:
        body = json.loads(req['body'] or '{}')
        if body.get('type') == 'ds':
            return ok({'data': PC_DS_JS if body.get('appId') == 'xhs-pc-web' else CREATOR_DS_JS})
        return ok({'secPoisonId': SEC_POISON, 'data': SEC_PROGRAM})
    if '/api/sns/web/v1/login/activate' in url:
        priv = _handshakes[-1]['private_key_base64']
        return ok({'session': 'fake-visitor-session', 'ssk': encrypted_ssk(priv)})
    if '/api/sec/v1/shield/webprofile' in url:
        return {'status': 200, 'headers': {'set-cookie': f'gid={GID}; Domain=.xiaohongshu.com; Path=/'}, 'body': ok()}
    if '/api/sns/web/v1/login/qrcode/create' in url:
        return ok({'qr_id': 'fake-qr-id', 'code': 'fake-qr-code', 'url': 'https://www.xiaohongshu.com/mobile/login?qrId=fake'})
    if '/api/qrcode/userinfo' in url:
        return ok({'codeStatus': 0})
    if '/api/sns/web/v2/user/me' in url:
        return ok({'user_id': USER_ID, 'nickname': '测试用户', 'guest': False, 'red_id': '123', 'images': 'https://x/a.jpg'})
    if '/api/sns/web/v1/login/check_code' in url:
        return ok({'mobile_token': 'fake-mobile-token'})
    if '/api/sns/web/v2/login/code' in url:
        return ok({'session': 'fake-login-session', 'user_id': USER_ID})
    if '/api/sns/web/v1/login/qrcode/status' in url:
        return ok({'code_status': 2, 'login_info': {'session': 'fake-login-session', 'user_id': USER_ID}})
    if '/api/solar/user/info' in url:
        return ok({'userId': 'brand-user-1', 'nickName': '品牌'})
    if '/api/solar/cooperator/blogger/track' in url:
        return ok({'trackId': 'kolMatch_fake'})
    if '/api/solar/cooperator/blogger/v2' in url:
        return ok({'total': 1, 'kols': [{'userId': 'kol1', 'name': '达人'}]})
    if '/api/draco/distributor-square/distributors-tags' in url:
        return ok({'distributor_tag_map': {'distribution_category': [{'first_category': '美妆', 'second_category': ['护肤', '彩妆']}]}})
    if '/api/draco/distributor-square/distributors' in url:
        return ok({'total': 1, 'list': [{'distributor_id': 'd1'}]})
    if '/api/media/v1/upload/creator/permit' in url:
        return ok({'uploadTempPermits': [{'fileIds': ['spectrum/fake-file-id'], 'token': 'fake-cos-token', 'expireTime': 1790003600123, 'uploadAddr': 'ros-upload.xiaohongshu.com'}]}, )
    if url.startswith('https://ros-upload.xiaohongshu.com/spectrum/'):
        return {'status': 200, 'headers': {'X-Ros-Video-Id': 'fake-video-id'}, 'body': ''}
    if '/api/cas/customer/web/service-ticket' in url:
        return ok({'ticket': '', 'type': ''})
    if '/api/cas/customer/web/qr-code' in url:
        return ok({'id': 'fake-cqr', 'url': 'https://customer.xiaohongshu.com/qr?fake', 'status': 2})
    if '/api/cas/customer/web/zones' in url:
        return ok([])
    if '/api/galaxy/user/info' in url:
        return ok({'userId': USER_ID, 'userName': '测试用户', 'redId': '123'})
    if '/api/sns/web/v1/feed' in url:
        return ok({'items': [{'id': NOTE_ID, 'model_type': 'note', 'note_card': NOTE_CARD}]})
    if '/api/sns/red/live/web/v1/room/current_room_info' in url:
        return ok({'room_id': '570443028306756154', 'host_info': {'user_id': 'host1', 'nickname': '主播'}})
    return ok()


def reset():
    pc_params._xray_seq[0] = XRAY_SEQ
    core_params._xray_seq[0] = XRAY_SEQ
    pc_dsl._default._value = None
    pc_dsl._default._fetched_at = 0.0
    creator_dsl._default._value = None
    creator_dsl._default._program = None
    creator_dsl._default._fetched_at = 0.0
    _handshakes.clear()


def case(name, fn, **input):
    def run():
        reset()
        return fn()
    g.case(out, name, run, input=input, respond=respond)


def pc_auth(cookies=PC_COOKIES, user_id=USER_ID):
    return pc_auth_mod.XHSPcAuth(cookies=cookies, user_id=user_id, _factory_token=pc_auth_mod._AUTH_FACTORY_TOKEN)


def pc(fn):
    return lambda: fn(XHS_Apis(pc_auth()))


def live(fn):
    return lambda: fn(XHSLiveAPI(pc_auth()))


def creator_auth():
    return creator_auth_mod.XHSCreatorAuth(cookies=CREATOR_COOKIES, _factory_token=creator_auth_mod._AUTH_FACTORY_TOKEN)


def creator(fn):
    return lambda: fn(XHS_Creator_Apis(creator_auth()))


def main():
    only = set(sys.argv[1:])

    def c(name, fn, **input):
        if not only or name in only:
            case(name, fn, **input)

    # ---------------------------------------------------------------- 游客：匿名设备初始化 + webprofile
    def guest_init():
        api = XHSLoginApi()
        cookies = api.generate_init_cookies()
        api.ensure_webprofile(cookies)
        return cookies

    c('guest_init', guest_init)

    # 游客 item get：匿名设备初始化 → webprofile → user/me（xy-direction 要 user_id）→ feed
    def guest_item_get():
        api = XHSLoginApi()
        cookies = api.generate_init_cookies()
        api.ensure_webprofile(cookies)
        auth = pc_auth_mod.XHSPcAuth(
            cookies=cookies, login_source='cookie', http_client=api.http, host_cookies=api.host_cookies_snapshot(),
            host_cookie_state=api.host_cookie_state(), cookie_source_url='https://edith.xiaohongshu.com', profile=api.profile,
            _factory_token=pc_auth_mod._AUTH_FACTORY_TOKEN,
        )
        return XHS_Apis(auth).get_note_info(NOTE_URL)[2]

    c('guest_item_get', guest_item_get, url=NOTE_URL)

    # ---------------------------------------------------------------- 登录：二维码 / 短信（匿名初始化之后的请求）
    def login_qrcode():
        api = XHSLoginApi()
        cookies = api.generate_init_cookies()
        _, _, qr = api.generate_qrcode(cookies)
        api.check_qrcode_status(qr['qr_id'], qr['code'], cookies)
        api.ensure_webprofile(cookies)
        api._login_by_qrcode_status(qr['qr_id'], qr['code'], cookies)
        return api.get_user_info(cookies)[1]

    def login_sms():
        api = XHSLoginApi()
        cookies = api.generate_init_cookies()
        api.ensure_webprofile(cookies)
        api.send_phone_code('13800000000', cookies)
        api.login_by_phone('13800000000', '123456', cookies)
        return api.get_user_info(cookies)[1]

    c('login_qrcode', login_qrcode)
    c('login_sms', login_sms)

    # ---------------------------------------------------------------- PC 主站
    other = '5f0000000000000000000002'
    c('pc_note_info', pc(lambda a: a.get_note_info(NOTE_URL)), url=NOTE_URL)
    c('pc_user_me', pc(lambda a: a.get_user_me()))
    c('pc_user_info', pc(lambda a: a.get_user_info(other)), user_id=other)
    c('pc_user_notes', pc(lambda a: a.get_user_note_info(other, 'cur1', 'tok', 'pc_feed')))
    c('pc_user_likes', pc(lambda a: a.get_user_like_note_info(other, '', 'tok', 'pc_user')))
    c('pc_user_collects', pc(lambda a: a.get_user_collect_note_info(other, '', '', 'pc_search')))
    c('pc_homefeed_category', pc(lambda a: a.get_homefeed_all_channel()))
    c('pc_homefeed', pc(lambda a: a.get_homefeed_recommend('homefeed_recommend', '', 1, 0)))
    c('pc_homefeed_p2', pc(lambda a: a.get_homefeed_recommend('homefeed.fashion_v3', '1.79e+18', 3, 20)))
    c('pc_search_notes', pc(lambda a: a.search_note('咖啡 探店', 2, 1, 1, search_id='2fixedsearchid')))
    c('pc_search_users', pc(lambda a: a.search_user('咖啡', 2)))
    c('pc_comments', pc(lambda a: a.get_note_out_comment(NOTE_ID, 'c1', 'FAKEtoken=')))
    c('pc_sub_comments', pc(lambda a: a.get_note_inner_comment({'note_id': NOTE_ID, 'id': 'cm1'}, 'c2', 'FAKEtoken=')))
    c('pc_unread', pc(lambda a: a.get_unread_message()))
    c('pc_mentions', pc(lambda a: a.get_metions('')))
    c('pc_likes', pc(lambda a: a.get_likesAndcollects('x1')))
    c('pc_connections', pc(lambda a: a.get_new_connections('')))
    c('pc_trending', pc(lambda a: a.get_trending_queries()))
    c('pc_boards', pc(lambda a: a.get_user_board(other, page=2)))
    c('pc_note_video', lambda: XHS_Apis.get_note_no_water_video(NOTE_ID))
    c('pc_no_water_img', lambda: [XHS_Apis.get_note_no_water_img(u)[2] for u in NO_WATER_URLS])

    # ---------------------------------------------------------------- 直播 / 私信（XHSLiveAPI）
    room = '570443028306756154'
    c('im_categories_edith', live(lambda a: a._request(a.edith_url, '/api/sns/red/live/web/feed/category')))
    c('live_room_info', live(lambda a: a.current_room_info(room)))
    c('live_square', live(lambda a: a.square_feed(category='hot')))
    c('live_gift_panel', live(lambda a: a.gift_panel('host1', room)))
    c('live_business', live(lambda a: a.aggregate_business_info(room, 'host1')))
    c('live_send_comment', live(lambda a: a.send_comment(room, '主播好', host_id='host1')))
    c('im_chats', live(lambda a: a.get_chats()))
    c('im_history', live(lambda a: a.get_message_history(other, last_id=99)))
    c('im_celestial', live(lambda a: a.get_celestial_lt()))
    c('im_read', live(lambda a: a.mark_messages_read([{'chat_id': other, 'read_store_id': 7, 'unread_count': 1, 'type': 1, 'need_rm_offline': True}])))
    c('im_revoke', live(lambda a: a.revoke_message({'chat_user_id': other, 'message_id': 'm1'})))
    c('im_delete', live(lambda a: a.delete_message({'chat_user_id': other})))

    # ---------------------------------------------------------------- 创作者中心
    c('creator_user_info', creator(lambda a: a.get_user_info()))
    c('creator_posted', creator(lambda a: [a.get_posted_notes_page(0), a.get_posted_notes_page(1)]))
    c('creator_topic', creator(lambda a: a.get_topic('旅行')))
    c('creator_poi', creator(lambda a: a.get_location_info('上海')))
    c('creator_permit', creator(lambda a: a.get_fileIds('image')))
    c('creator_upload', creator(lambda a: a.upload_media(PNG, 'image')))
    c('creator_transcode', creator(lambda a: a.query_transcode('vid1')))
    c('creator_encryption', creator(lambda a: a.encryption('fid1')))
    c('creator_post_note', creator(lambda a: a.post_note({'title': '标题', 'desc': '正文', 'media_type': 'image', 'images': [PNG], 'type': 1})))

    def creator_login():
        api = XHSCreatorLoginApi()
        api._prepare_login_session()
        api._complete_security()
        api.generate_qrcode(api.profile.cookie_map)
        api.query_qrcode_status('fake-cqr')
        api.send_phone_code('13800000000')
        api.login_by_phone('13800000000', '123456')
        return api.get_user_info()[1]

    c('creator_login', creator_login)

    # ---------------------------------------------------------------- 蒲公英 / 千帆
    c('pgy_categories', lambda: PuGongYingAPI().get_all_categories(PGY_COOKIES))
    c('pgy_kols', lambda: PuGongYingAPI().get_user_by_page(2, PGY_COOKIES, ['美妆']))
    c('pgy_detail', lambda: PuGongYingAPI().get_user_detail('kol1', PGY_COOKIES))
    c('pgy_fans', lambda: PuGongYingAPI().get_user_fans_detail('kol1', PGY_COOKIES))
    c('pgy_fans_history', lambda: PuGongYingAPI().get_user_fans_history('kol1', PGY_COOKIES))
    c('pgy_notes', lambda: PuGongYingAPI().get_user_notes_detail('kol1', PGY_COOKIES))
    c('pgy_invite', lambda: PuGongYingAPI().send_invite('kol1', PGY_COOKIES, '产品', ['2026-10-01', '2026-10-31'], '合作', '微信 fake'))
    c('qf_categories', lambda: QianFanAPI().get_all_categories(PGY_COOKIES))
    c('qf_list', lambda: QianFanAPI().get_user_by_page('0(1)', QF_TAGS, 2, PGY_COOKIES))
    c('qf_list_all', lambda: QianFanAPI().get_user_by_page('-1', [], 1, PGY_COOKIES))
    c('qf_detail', lambda: QianFanAPI().get_user_detail('d1', PGY_COOKIES))
    c('qf_cooperation', lambda: QianFanAPI().get_user_cooperation('d1', PGY_COOKIES))
    c('qf_shop', lambda: QianFanAPI().get_user_shop('d1', PGY_COOKIES))
    c('qf_items', lambda: QianFanAPI().get_user_item('d1', PGY_COOKIES))
    c('qf_fans', lambda: QianFanAPI().get_user_fans('d1', PGY_COOKIES))

    # ---------------------------------------------------------------- RWP 长连的帧与 IM protobuf（纯算）
    def rwp_frames():
        auth = pc_auth()
        ws = live_mod.XHSWebSocket(auth, uid=USER_ID, sid='fake-sid', device_id='fake-device', fingerprint='1790000000123')
        chat = live_mod.encode_im_chat_message(
            mid='mid-1', ts=1790000000123, token='', sender=USER_ID, receiver=OTHER_ID, content='你好 hi', content_type=1,
            nickname='', group_chat=False, command=None, ref_id='', trigger_source=1,
        )
        ack = bytes([0x2a]) + bytes([len(ACK_BODY)]) + ACK_BODY
        inbound = bytes([0x22]) + bytes([len(INBOUND_BODY)]) + INBOUND_BODY
        room = {'t': 4, 'b': {'d': {'biz': 'room', 'b': [{'d': base64.b64encode(json.dumps(
            {'command': 1, 'customData': json.dumps({'type': 'text', 'desc': '弹幕', 'profile': {'user_id': 'u9', 'nickname': '观众'}})}).encode()).decode(), 'e': {}, 'm': 'x'}]}}}
        return {
            'handshake': ws.handshake(),
            'register': ws.register('im', 'protobuf'),
            'join': ws.join_room('570443028306756154'),
            'state_sync': ws.state_sync(),
            'heartbeat': ws.transport_heartbeat(),
            'viewer_heart': ws.heartbeat('570443028306756154', profile={'nickname': 'n', 'avatar': 'a', 'user_id': USER_ID, 'role': 0}),
            'chat': base64.b64encode(chat).decode(),
            'im_frame': ws.im_frame(chat, command='sendMessage'),
            'ack': live_mod.decode_im_one_message(ack),
            'inbound': live_mod.decode_im_one_message(inbound),
            'room': live_mod.decode_room_push(room),
            'room_frame': room,
        }

    c('rwp_frames', rwp_frames)


OTHER_ID = '5f0000000000000000000002'
# ChatACK{mid=mid-1, messageid=msg-9, ts=1790000000200, code=0} 与 ChatMessage{mid, messageid, ts, payload=JSON}
ACK_BODY = bytes([0x0a, 5]) + b'mid-1' + bytes([0x12, 5]) + b'msg-9' + bytes([0x18]) + bytes([0xc8, 0x81, 0xa4, 0xa3, 0x88, 0x34])
_payload = json.dumps({'sender': OTHER_ID, 'content': json.dumps({'content': '收到'})}).encode()
INBOUND_BODY = bytes([0x0a, 5]) + b'mid-2' + bytes([0x12, 5]) + b'msg-8' + bytes([0x18]) + bytes([0xc8, 0x81, 0xa4, 0xa3, 0x88, 0x34]) + bytes([0x2a, len(_payload)]) + _payload


NO_WATER_URLS = [
    'https://sns-webpic-qc.xhscdn.com/202609/abc/notes_pre_post/1040g2abc!nd_dft_wlteh_webp_3',
    'https://sns-webpic-qc.xhscdn.com/202609/abc/spectrum/1040g0k0abc!nd_dft_wgth_webp_3',
    'https://sns-img-hw.xhscdn.com/a/b/c.jpg?imageView2',
    'https://sns-webpic-qc.xhscdn.com/202609/abc/1040g008xyz!nd_dft',
]
QF_TAGS = [{'first_category': '美妆', 'second_category': ['护肤', '彩妆']}]
# 3x2 PNG（上游 get_file_info 用 opencv 解出宽高）
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGP4z8AAQQxwFgBB0gX7h/C5SAAAAABJRU5ErkJggg==')


if __name__ == '__main__':
    main()
