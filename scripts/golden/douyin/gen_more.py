"""douyin 对拍数据的第二部分：私信、上传、创作者中心发布、登录。由 gen.py 在末尾 exec，共用它的全局变量。"""

import base64
import json
from pathlib import Path

import catbus_golden as g


# ================================================================ 二进制响应：框架只能记录 JSON 可序列化的 body，这里把 bytes 记成 {"base64": ...}
class _Responses(list):
    def append(self, spec):
        body = spec.get('body')
        if isinstance(body, (bytes, bytearray)):
            spec = {**spec, 'body': {'base64': base64.b64encode(bytes(body)).decode()}}
        super().append(spec)


g._responses = _Responses()

import static.Response_pb2 as ResponsePb  # noqa: E402
from dy_apis.douyin_creator_api import DouyinCreatorAPI  # noqa: E402
from dy_apis.douyin_im_media import DouyinIMMedia  # noqa: E402

CONV_ID = f'0:1:{UID}:1234567890'
CONV_SHORT = 7400000000000000123


def pb_create():
    r = ResponsePb.Response()
    r.cmd = 609
    r.message = 'OK'
    info = r.body.create_conversation_v2_body.conversation_info_list.add()
    info.conversation_id = CONV_ID
    info.conversation_short_id = CONV_SHORT
    info.conversation_type = 1
    info.ticket = 'fake-conv-ticket'
    return r.SerializeToString()


def pb_ok():
    r = ResponsePb.Response()
    r.cmd = 100
    r.message = 'OK'
    return r.SerializeToString()


def im_respond(req):
    url = req['url']
    if 'conversation/create' in url:
        return {'status': 200, 'headers': {'content-type': 'application/x-protobuf'}, 'body': pb_create()}
    if 'message/send' in url:
        return {'status': 200, 'headers': {'content-type': 'application/x-protobuf'}, 'body': pb_ok()}
    if 'get_identity_security_token' in url:
        return {'message': 'success', 'data': {'identity_security_token': 'fake-identity-token', 'device_id': '7400000000000009999'}}
    return respond(req)


case('im_create', logged(lambda a: list(DouyinAPI.create_conversation(a, '1234567890'))), im_respond, to_uid='1234567890')
case('im_send_text', logged(lambda a: DouyinAPI.send_msg(a, CONV_ID, CONV_SHORT, 'fake-conv-ticket', '在吗？ hi')), im_respond,
     conversation_id=CONV_ID, short_id=str(CONV_SHORT), conv_ticket='fake-conv-ticket', text='在吗？ hi')


# 拿不到服务端证书时 bd-ticket-guard 回退 ECDSA
def cert_fail(req):
    if 'get_client_cert' in req['url']:
        return {'message': 'error', 'data': {'error_code': 1}}
    return respond(req)


case('comment_publish_ecdsa', logged(lambda a: DouyinAPI.publish_comment(a, AWEME, 'ecdsa')), cert_fail, aweme_id=AWEME, text='ecdsa')

# ---------------------------------------------------------------- 私信图片
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGNgYGD4z8DAwMAAAAwAAf8v0Mo8AAAAAElFTkSuQmCC')
STS = {'access_key_id': 'AKFAKE', 'secret_access_key': 'fake/secret+key', 'session_token': 'STS2fake-session-token', 'space_name': 'im-space',
       'expire_at': 1790003600000}


def media_respond(req):
    url = req['url']
    if 'im/upload/config' in url:
        return {'status_code': 0, 'public_image_config': STS, 'inner_image_config': {**STS, 'space_name': 'im-inner'}, 'public_file_config': STS}
    if 'Action=ApplyImageUpload' in url:
        return {'Result': {'UploadAddress': {'StoreInfos': [{'StoreUri': 'tos-cn-i-fake/abc', 'Auth': 'SpaceKey/fake'}],
                                             'UploadHosts': ['tos-fake.snssdk.com'], 'SessionKey': 'fake-session-key'}}}
    if 'Action=ApplyUploadInner' in url:
        node = {'StoreInfos': [{'StoreUri': 'tos-cn-v-fake/abc', 'Auth': 'SpaceKey/fake', 'UploadID': ''}], 'UploadHost': 'tos-fake.snssdk.com',
                'SessionKey': 'fake-session-key', 'UploadHeader': {}}
        return {'Result': {'InnerUploadAddress': {'UploadNodes': [node]}}}
    if '/upload/v1/' in url:
        return {'code': 2000, 'message': 'Success'}
    if 'Action=CommitUploadInner' in url:
        return {'Result': {'Results': [{'Vid': 'v0fake-vid', 'PosterUri': 'tos-cn-i-fake/poster', 'Uri': 'tos-cn-i-fake/abc',
                                        'SourceInfo': {'Width': 1080, 'Height': 1920, 'Duration': 15.2},
                                        'Encryption': {'Uri': 'tos-cn-o-fake/enc', 'SecretKey': 'fake-skey', 'SourceMd5': 'fakemd5',
                                                       'Extra': {'img_width': '2', 'img_height': '3'}}}]}}
    if 'Action=CommitImageUpload' in url:
        return {'Result': {'PluginResult': [{'ImageUri': 'tos-cn-i-fake/img', 'ImageWidth': 2, 'ImageHeight': 3}]}}
    if 'upload/auth/v5' in url:
        return {'status_code': 0, 'auth': json.dumps({'AccessKeyID': 'AKFAKE', 'SecretAccessKey': 'fake/secret+key', 'SessionToken': 'STS2fake'})}
    if 'aweme/create_v2' in url:
        return {'status_code': 0, 'item_id': '7400000000000000555'}
    if 'creator/get/url' in url:
        return {'status_code': 0, 'url': {'url_list': ['https://p3-creator.douyinpic.com/img.jpeg']}}
    if req['method'] == 'HEAD' and 'creator.douyin.com' in url:
        return {'status': 200, 'headers': {'X-Ware-Csrf-Token': '0001000000017a,creatorcsrf0123456789,86370,success,x'}, 'body': ''}
    if 'creator-micro/content/upload' in url:
        return {'status': 200, 'headers': {'content-type': 'text/html'}, 'body': '<html></html>'}
    return im_respond(req)


case('im_upload_image', logged(lambda a: DouyinIMMedia.upload_image(a, PNG)), media_respond, png=base64.b64encode(PNG).decode())
case('im_send_image', logged(lambda a: DouyinAPI.send_image(a, CONV_ID, CONV_SHORT, 'fake-conv-ticket', PNG)), media_respond)


# ---------------------------------------------------------------- 创作者中心：图文 / 视频发布
def creator_auth():
    auth = logged_auth()
    auth.bootstrap_creator_session()
    return auth


VIDEO = b'\x00\x00\x00\x18ftypmp42' + bytes(range(256)) * 4
IMAGE_REFERER = 'https://creator.douyin.com/creator-micro/content/post/image?enter_from=publish_page&media_type=image&type=new'

case('post_images', lambda: DouyinCreatorAPI.post_images(creator_auth(), [PNG, PNG], title='标题', desc='正文 #话题', visibility=0), media_respond,
     title='标题', desc='正文 #话题')
case('post_video_cover', lambda: DouyinCreatorAPI.post_video(creator_auth(), VIDEO, title='视频标题', desc='视频描述', visibility=2, cover=PNG),
     media_respond, video=base64.b64encode(VIDEO).decode(), title='视频标题', desc='视频描述')
case('post_video', lambda: DouyinCreatorAPI.post_video(
    creator_auth(), VIDEO, title='视频标题', desc='视频描述', visibility=0, timing=1790086400,
    cover_tools_extend_info=DouyinCreatorAPI.build_video_cover_tools_extend_info('tos-cn-i-fake/poster')),
    media_respond, video=base64.b64encode(VIDEO).decode(), title='视频标题', desc='视频描述', timing=1790086400)


def media_upload_image():
    auth = creator_auth()
    sts = DouyinCreatorAPI.get_image_upload_auth(auth, referer=IMAGE_REFERER)
    info = DouyinCreatorAPI.upload_one_image(auth, sts, PNG, user_id='')
    return [info, DouyinCreatorAPI.get_creator_media_url(auth, info['uri'])]


case('media_upload_image', media_upload_image, media_respond)


# ================================================================ 登录：扫码（非严格）与短信（严格）
import os  # noqa: E402
import time as _time  # noqa: E402

from dy_apis.login_api import DYLoginApi  # noqa: E402

# 上游的 Node 脚本是 CommonJS，但 references/ 在 catbus 仓库里，会被上层 package.json 的 "type": "module" 当成 ESM。
# 复制到仓库外的临时目录再跑（脚本本身不改），等价于在上游自己的仓库里运行。
import shutil  # noqa: E402
import tempfile  # noqa: E402

import utils.acrawler as _acrawler  # noqa: E402
import utils.challenge_template as _template  # noqa: E402

_node_dir = Path(tempfile.mkdtemp(prefix='catbus_douyin_'))
shutil.copytree(_acrawler._RUNTIME, _node_dir / 'acrawler_runtime')
shutil.copy(_template.RUNNER, _node_dir / 'challenge_template_runner.js')
_acrawler._RUNNER = _node_dir / 'acrawler_runtime' / 'run_ac_node.js'
_template.RUNNER = str(_node_dir / 'challenge_template_runner.js')

# tempfile 的临时文件名用 random.Random 取 8 个字符，框架替换了 Random 之后会多消耗 8 个随机数；
# 这是 Python 运行时的细节，不是上游逻辑，换成计数器
import itertools  # noqa: E402

_tmp_counter = itertools.count()
tempfile._RandomNameSequence.__next__ = lambda self: 'catbus%06d' % next(_tmp_counter)

# 上游用本机时区写 bd_ticket_guard_regenerate_keys_time / download_guide；这里固定北京时间，与 catbus 一致
_real_strftime = _time.strftime
_time.strftime = lambda fmt, t=None: _real_strftime(fmt, t if t is not None else _time.gmtime(_time.time() + 8 * 3600))

LOGIN_BLOB = base64.b64encode(bytes((i * 7 + 3) % 256 for i in range(176))).decode()
AC_NONCE = '0680fake00000000000a'
UIFID_TEMP = ('0123456789abcdef' * 14)[:224]
ODIN_TT = ('fedcba9876543210' * 10)[:160]
TTWID_1 = '1%7C' + ('A' * 43) + '%7C1790000000%7C' + ('b' * 64)
TTWID_2 = '1%7C' + ('A' * 43) + '%7C1790000002%7C' + ('c' * 64)
LOGIN_CSRF = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
PASSPORTIV = ('Pv-' + 'x' * 400)[:380]
SEC_TS = '#' + 'a' * 60
TEMPLATE = ('module.exports = { default: function () { return { p_in: "' + '9f' * 32
            + '", e_in: { automa_ele: "false", console_liad: "false", t: "0000000000000" } } } }')
SERVER_DATA = base64.b64encode(json.dumps({'ticket': 'hash.login-ticket', 'ts_sign': 'ts.2.loginsign', 'client_cert': 'pub.logincert',
                                           'create_time': 1790000000, 'log_id': 'fake'}).encode()).decode()
LONG_MSTOKEN = 'L' * 172


def login_respond(state):
    def respond_fn(req):
        url, method = req['url'], req['method']
        if url.startswith('https://www.douyin.com/?recommend=1'):
            return {'status': 200, 'headers': {'content-type': 'text/html', 'set-cookie': [
                f'__ac_nonce={AC_NONCE}; Path=/', f'UIFID_TEMP={UIFID_TEMP}; Domain=douyin.com; Path=/', f'odin_tt={ODIN_TT}; Domain=douyin.com; Path=/']},
                'body': '<html>acrawler</html>'}
        if 'ttwid/union/register' in url:
            return {'status': 200, 'headers': {'set-cookie': f'ttwid={TTWID_1}; Path=/; Domain=douyin.com'}, 'body': {'status_code': 0}}
        if url.endswith('/ttwid/check/'):
            return {'status': 200, 'headers': {'set-cookie': f'ttwid={TTWID_2}; Path=/; Domain=douyin.com'}, 'body': {'status_code': 0}}
        if 'login_guiding_strategy' in url:
            return {'status': 200, 'headers': {'set-cookie': [f'passport_csrf_token={LOGIN_CSRF}; Domain=douyin.com; Path=/',
                                                               f'passport_csrf_token_default={LOGIN_CSRF}; Domain=douyin.com; Path=/']},
                    'body': {'message': 'success', 'data': {}}}
        if 'mssdk.bytedance.com/web/common' in url:
            return {'status': 200, 'headers': {'x-ms-token': LONG_MSTOKEN}, 'body': {'code': 0}}
        if 'get_sec_ts' in url:
            return {'status': 200, 'headers': {'bd-ticket-guard-sec-ts': SEC_TS}, 'body': {'data': None, 'message': 'success'}}
        if 'passport/web/challenge' in url:
            return {'message': 'success', 'data': {'passportiv': PASSPORTIV, 'template': TEMPLATE}}
        if 'get_qrcode' in url:
            return {'message': 'success', 'data': {'token': 'fake-qr-token', 'qrcode_index_url': 'https://aweme.snssdk.com/magic/eco/runtime/release/qr?token=fake', 'error_code': 0}}
        if 'check_qrconnect' in url:
            state['check'] = state.get('check', 0) + 1
            if state['check'] == 1:
                return {'message': 'success', 'data': {'status': 'new', 'error_code': 0}}
            if state['check'] == 2:
                return {'message': 'success', 'data': {'status': 'scanned', 'error_code': 0}}
            return {'status': 200, 'headers': {'bd-ticket-guard-server-data': SERVER_DATA,
                                               'set-cookie': 'sessionid=fake-login-session; Domain=douyin.com; Path=/'},
                    'body': {'message': 'success', 'data': {'status': 'confirmed', 'error_code': 0,
                                                            'redirect_url': 'https://www.douyin.com/passport/sso/login/callback/?ticket=fake'}}}
        if 'send_code' in url:
            return {'message': 'success', 'data': {'mobile_ticket': 'fake-mobile-ticket', 'error_code': 0}}
        if 'sms_login' in url:
            return {'status': 200, 'headers': {'bd-ticket-guard-server-data': SERVER_DATA,
                                               'set-cookie': 'sessionid=fake-sms-session; Domain=douyin.com; Path=/'},
                    'body': {'message': 'success', 'data': {'error_code': 0, 'redirect_url': 'https://www.douyin.com/passport/sso/login/callback/?ticket=sms'}}}
        if 'login/callback' in url:
            return {'status': 302, 'headers': {'location': 'https://www.douyin.com/', 'set-cookie': 'sessionid_ss=fake-ss; Domain=douyin.com; Path=/'}, 'body': ''}
        if url == 'https://www.douyin.com/':
            return {'status': 200, 'headers': {'content-type': 'text/html'}, 'body': '<html></html>'}
        return respond(req)
    return respond_fn


def with_blob(fn):
    def run():
        os.environ['DY_DTRAIT_BLOB'] = LOGIN_BLOB
        try:
            return fn()
        finally:
            os.environ.pop('DY_DTRAIT_BLOB', None)
    return run


def qrcode_flow():
    auth = DYLoginApi().qrcode_login(timeout=300, show_qr=False)
    return {'cookies': dict(auth.cookie), 'ticket': auth.ticket, 'ts_sign': auth.ts_sign, 'client_cert': auth.client_cert}


def sms_flow():
    api = DYLoginApi()
    auth = api.bootstrap_auth(strict=True)
    api.send_sms_code(auth, '13800000000')
    api.phone_login(auth, '13800000000', '123456')
    return {'cookies': dict(auth.cookie), 'ticket': auth.ticket, 'ts_sign': auth.ts_sign}


case('login_qrcode', with_blob(qrcode_flow), login_respond({}), dtrait_blob=LOGIN_BLOB)
case('login_sms', with_blob(sms_flow), login_respond({}), dtrait_blob=LOGIN_BLOB, phone='13800000000', code='123456')


# ================================================================ 长连接：直播弹幕与私信（截获 WebSocketApp，只记录握手参数与收发的帧）
import gzip  # noqa: E402

import dy_apis.douyin_recv_msg as _recv  # noqa: E402
import dy_live.server as _live  # noqa: E402
import static.Live_pb2 as LivePb  # noqa: E402


class _FakeWS:
    last = None

    def __init__(self, url, header=None, cookie=None, **kwargs):
        _FakeWS.last = {'url': url, 'header': header, 'cookie': cookie, 'sent': []}

    def run_forever(self, origin=None, **kwargs):
        _FakeWS.last['origin'] = origin

    def send(self, data, opcode=None):
        _FakeWS.last['sent'].append(base64.b64encode(data).decode())

    def close(self):
        pass


_live.WebSocketApp = _FakeWS
_recv.WebSocketApp = _FakeWS


def fetch_pb():
    r = LivePb.LiveResponse()
    r.cursor = 't-1790000000123_r-1_d-1_u-1_h-1'
    r.internalExt = 'internal_src:dim|wss_push_room_id:7400000000000000000|fetch_time:1790000000123'
    return r.SerializeToString()


def live_ws_respond(req):
    if 'webcast/im/fetch' in req['url']:
        return {'status': 200, 'headers': {'content-type': 'application/protobuf'}, 'body': fetch_pb()}
    return live_respond(req)


def live_ws():
    _live.DouyinLive(WEB_RID, logged_auth()).start_ws()
    return _FakeWS.last


def push_frame():
    res = LivePb.LiveResponse()
    res.needAck = True
    res.internalExt = 'ack-ext-001'
    chat = LivePb.ChatMessage()
    chat.user.nickname = '观众A'
    chat.user.sec_uid = 'MS4wLjABAAAAviewerA'
    chat.user.id = 111
    chat.content = '主播好！'
    gift = LivePb.GiftMessage()
    gift.user.nickname = '观众B'
    gift.user.sec_uid = 'MS4wLjABAAAAviewerB'
    gift.gift.name = '小心心'
    gift.comboCount = 3
    member = LivePb.MemberMessage()
    member.user.nickname = '观众C'
    member.user.id = 333
    social = LivePb.SocialMessage()
    social.user.nickname = '观众D'
    social.user.id = 444
    social.action = 1
    for method, msg in (('WebcastChatMessage', chat), ('WebcastGiftMessage', gift), ('WebcastMemberMessage', member),
                        ('WebcastSocialMessage', social), ('WebcastUnknownMessage', chat)):
        m = res.messagesList.add()
        m.method = method
        m.payload = msg.SerializeToString()
    frame = LivePb.PushFrame()
    frame.logId = 987654321987654321
    frame.payloadType = 'msg'
    frame.payload = gzip.compress(res.SerializeToString(), mtime=0)
    return frame.SerializeToString()


def live_frame():
    frame = push_frame()
    ws = _FakeWS('x')
    _live.DouyinLive(WEB_RID, logged_auth()).on_message(ws, frame)
    return {'frame': base64.b64encode(frame).decode(), 'sent': _FakeWS.last['sent']}


def recv_ws():
    r = _recv.DouyinRecvMsg(logged_auth())
    r.start()
    return _FakeWS.last


def im_push():
    body = ResponsePb.Response()
    body.cmd = 500
    msg = body.body.new_message_notify.message
    msg.conversation_id = CONV_ID
    msg.server_message_id = 7400000000000000777
    msg.index_in_conversation = 12
    msg.sender = 1234567890
    msg.message_type = 7
    msg.content = json.dumps({'text': '你好呀', 'aweType': 700}, ensure_ascii=False)
    frame = LivePb.PushFrame()
    frame.payloadType = 'pb'
    frame.payload = body.SerializeToString()
    return {'frame': base64.b64encode(frame.SerializeToString()).decode()}


case('live_ws', live_ws, live_ws_respond, web_rid=WEB_RID)
case('live_frame', live_frame)
case('recv_ws', recv_ws)
case('im_push', im_push)
