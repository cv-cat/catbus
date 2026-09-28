"""kuaishou 的对拍数据：用上游 KuaiShou-Spider 的代码构造请求（只用假凭证），记录请求序列。

运行：.golden/kuaishou/Scripts/python scripts/golden/kuaishou/gen.py
依赖：uv pip install -r references/KuaiShou-Spider/requirements.txt

框架补丁（只在本文件里）：
- 上游用 subprocess 起 node 跑 reverse/tools/*_oracle.js；catbus 仓库根的 package.json 是 "type": "module"，
  直接跑会被当成 ES module，这里经 run_cjs.cjs 按 CommonJS 执行；并预加载 vm_determinism.cjs，
  让预言机内部 vm.createContext 出来的 context 也用固定的 Math.random / Date。
- 进程级签名器单例（ks_util）与 gdfp 预检缓存每个用例重置：一个用例对应浏览器的一次页面加载。
- FakeResponse 补上 http_version（gdfp 会检查协商协议）：默认 HTTP/1.1，gdfp manMachine 的响应按用例给 HTTP/2。
- 响应体可以是 bytes（滑块的背景图、滑块图），记录成 {base64}。
- random.gauss 的缓存（_inst.gauss_next）每个用例清空，与 TS 侧 rand.gauss 在 deterministic() 里清空对应。
"""

import base64
import hashlib
import io
import json
import os
import random
import subprocess as _subprocess
import sys
import tempfile
import types
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catbus_golden as g  # noqa: E402

HERE = Path(__file__).resolve().parent
RUN_CJS = (HERE / 'run_cjs.cjs').as_posix()

out = g.setup('kuaishou', 'KuaiShou-Spider')
os.environ['NODE_OPTIONS'] += f' --require "{(HERE / "vm_determinism.cjs").as_posix()}"'
g.FakeResponse.http_version = 2  # CurlHttpVersion.V1_1


def _respond_ks(req):
    """catbus_golden._respond 的变体：bytes 响应体记录成 {base64}；spec 里可以带 http_version。"""
    g._captured.append(req)
    spec = g._responder[0](req)
    if not (isinstance(spec, dict) and 'body' in spec and set(spec) <= {'status', 'headers', 'body', 'http_version'}):
        spec = {'status': 200, 'headers': {}, 'body': spec}
    version = spec.get('http_version')
    spec = {'status': spec.get('status', 200), 'headers': spec.get('headers') or {}, 'body': spec['body']}
    body = spec['body']
    g._responses.append({**spec, 'body': {'base64': base64.b64encode(body).decode()} if isinstance(body, (bytes, bytearray)) else body})
    resp = g.FakeResponse(req['url'], spec['status'], spec['headers'], body)
    if version is not None:
        resp.http_version = version
    return resp


g._respond = _respond_ks


def _run(args, **kwargs):
    if args and args[0] == 'node':
        args = ['node', RUN_CJS] + [str(a) for a in args[1:]]
    return _subprocess.run(args, **kwargs)


from utils import ks_util  # noqa: E402
from utils.sign import like_token, weapon_oracle, webweapon_boot  # noqa: E402
from utils.transport import shared_session  # noqa: E402

weapon_oracle.subprocess = types.SimpleNamespace(run=_run)
like_token.subprocess = types.SimpleNamespace(run=_run)

from builder.auth import KuaishouAuth  # noqa: E402
from builder.params import Params  # noqa: E402
from ks_apis import kuaishou_api as K  # noqa: E402
from ks_apis.kuaishou_api import KuaishouAPI  # noqa: E402
from ks_apis.live_api import KuaishouLiveAPI  # noqa: E402
from ks_apis.login_api import SID_CP, SID_LIVE, SID_WWW, KuaishouLoginAPI  # noqa: E402
from ks_apis.publish_api import KuaishouPublishAPI as Publish  # noqa: E402
from utils import live_proto  # noqa: E402
from utils.ksuploader import KsUploader  # noqa: E402
from utils.sign.falcon_pure import HxFalconSigner, build_sign_input  # noqa: E402
from utils.sign.sig3_pure import Sig3Signer  # noqa: E402

# ---------------------------------------------------------------- 假凭证与假数据（只有假值）

DID = 'web_' + '0123456789abcdef' * 2
KWFV1 = ('PnGU+fake' + 'kwfv1' * 40)[:174]
SECTOKEN = ('FakeSecToken' * 8)[:88]
KWSCODE = '0123456789abcdef' * 4
CP_PH = 'fake0000-cp00-ph00-0000-000000000000'
SELF_EID = '3xfakeself00001'
EID = '3xfakeuser00001'
PHOTO = '3xfakephoto0001'
ROOM = '3xfakeroom00001'
STREAM = 'fakeStream01'
COOKIES = '; '.join([
    'kpf=PC_WEB', 'clientid=3', f'did={DID}', 'didv=1789990000000', 'kwpsecproductname=kuaishou-vision',
    f'kwfv1={KWFV1}', f'kwssectoken={SECTOKEN}', f'kwscode={KWSCODE}', 'kpn=KUAISHOU_VISION', 'wid=12345678901234567',
    'userId=10001', 'kuaishou.server.webday7_st=fake-www-st', 'kuaishou.server.webday7_ph=fake-www-ph', 'bUserId=20001',
    'kuaishou.web.cp.api_st=fake-cp-st', f'kuaishou.web.cp.api_ph={CP_PH}', 'passToken=fake-pass-token', 'ktrace-context=fake|trace',
])
TMP = Path(tempfile.mkdtemp(prefix='catbus_ks_golden_'))
QR_PATH = str(TMP / 'qrcode.png')
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
IMAGE_PATH = TMP / 'pic.png'
IMAGE_PATH.write_bytes(PNG)
VIDEO_PATH = TMP / 'clip.mp4'
VIDEO_PATH.write_bytes(b'\x00\x00\x00\x18ftypmp42' + bytes(range(256)) * 4)

KWS_URL = 'https://h4.static.yximgs.com/kcdn/cdn-kcdn112369/kws/kws-13-0.0.1-obfuscated.6b74e9640ff18648.js?x-kcdn-pid=112369'
KWF_WWW = 'https://h4.static.yximgs.com/kcdn/cdn-kcdn112369/kwf/kwf-0.0.2.2cee19b4b7dec496.js?x-kcdn-pid=112369'
KWF_CP = 'https://h4.static.yximgs.com/kcdn/cdn-kcdn112369/kwf/kwf-0.1.1.a6d1e5d478c2cafa.js?x-kcdn-pid=112369'
UPLOAD = 'https://upload.kuaishouzt.com'
COVER_KEY = 'cp_video_upload_cover_0123456789abcdef.jpg'

MANIFEST = {'mediaType': 2, 'businessType': 2, 'version': '1.0.0', 'adaptationSet': [{'id': 1, 'duration': 16000, 'representation': [
    {'id': 1, 'url': 'https://v1.kwaicdn.com/low.mp4', 'width': 540, 'height': 960, 'maxBitrate': 1000},
    {'id': 2, 'url': 'https://v1.kwaicdn.com/high.mp4', 'width': 720, 'height': 1280, 'maxBitrate': 3000}]}]}
PHOTO_OBJ = {'id': PHOTO, 'duration': 16000, 'caption': '测试作品 #话题', 'likeCount': '1.2万', 'realLikeCount': 12345,
             'coverUrl': 'https://p1.a.yximgs.com/cover.jpg', 'photoUrl': 'https://v1.kwaicdn.com/b.mp4', 'liked': False,
             'timestamp': 1789990000000, 'expTag': 'x', 'llsid': '1', 'viewCount': '82.1万', 'videoRatio': 0.56, 'stereoType': 0,
             'musicBlocked': None, 'riskTagContent': None, 'riskTagUrl': None, 'manifest': MANIFEST, 'manifestH265': None,
             'photoH265Url': None, 'coronaCropManifest': None, 'coronaCropManifestH265': None, 'croppedPhotoH265Url': None,
             'croppedPhotoUrl': None, 'videoResource': None, 'commentCount': 7}
AUTHOR = {'id': EID, 'name': '作者', 'following': False, 'headerUrl': 'https://p1.a.yximgs.com/head.jpg', 'livingInfo': None, 'verifiedDetail': None}
FEED = {'type': 1, 'photo': PHOTO_OBJ, 'author': AUTHOR}
HOME_ITEM = {'id': STREAM, 'poster': 'https://live.yximgs.com/poster.jpg', 'caption': '直播标题', 'living': True, 'watchingCount': '1.5万',
             'author': {'id': ROOM, 'name': '主播', 'living': True}}


def _cfg(req):
    """gdfp /s/w/c：按请求里的 productName 选 kwf 脚本（CP 是 0.1.1）。"""
    plain = json.loads(webweapon_boot.decrypt_payload(json.loads(req['body'])['data']))
    fp = KWF_CP if plain['productName'] == 'onvideo-cp' else KWF_WWW
    data = {'fpUrl': fp, 'scriptSwitch': True, 'logUris': [], 'isVisibleReport': True, 'signUrl': KWS_URL, 'secToken': SECTOKEN, 'releatedUris': []}
    return {'status': 200, 'headers': {'content-type': 'application/json;charset=UTF-8'},
            'body': json.dumps({'dataRsp': webweapon_boot.encrypt_payload(json.dumps(data)), 'result': 1, 'error_msg': ''})}


def _graphql(req):
    op = json.loads(req['body'])['operationName']
    if op == 'visionVideoDetail':
        return {'data': {'visionVideoDetail': {'status': 1, 'type': 1, 'author': AUTHOR, 'photo': PHOTO_OBJ, 'authorStatement': None,
                                               'tags': [], 'commentLimit': {'canAddComment': 1}, 'llsid': '1', 'danmakuSwitch': True}}}
    if op == 'visionShortVideoReco':
        return {'data': {'visionShortVideoReco': {'llsid': '1', 'feeds': [FEED]}}}
    if op == 'commentListQuery':
        return {'data': {'visionCommentList': {'commentCountV2': 1, 'pcursorV2': 'no_more', 'rootCommentsV2': [
            {'commentId': '111', 'authorId': EID, 'authorName': '甲', 'content': '好看', 'headurl': None, 'timestamp': 1789990000000,
             'hasSubComments': True, 'likedCount': '12', 'liked': False, 'status': 0}]}}}
    if op == 'visionSubCommentList':
        return {'data': {'visionSubCommentList': {'pcursorV2': 'no_more', 'subCommentsV2': [
            {'commentId': '222', 'authorId': EID, 'authorName': '乙', 'content': '回复', 'timestamp': 1789990000000, 'likedCount': 1}]}}}
    if op == 'userInfoQuery':
        return {'data': {'userInfo': {'id': SELF_EID, 'name': '测试', 'avatar': None, 'eid': SELF_EID, 'userId': 10001}}}
    if op == 'visionProfileReduced':
        return {'data': {'visionProfileReduced': {'result': 1, 'userProfile': {'profile': {'user_name': '作者', 'user_id': EID, 'headurl': None, 'user_text': '简介'}}}}}
    if op == 'likeDataQuery':
        return {'data': {'likeData': {'result': 1, 'pcursor': 'no_more', 'feeds': [FEED]}}}
    return {'data': {}}


def respond(req):
    url = req['url']
    path = urllib.parse.urlsplit(url).path
    host = urllib.parse.urlsplit(url).netloc
    if host == 'gdfp.gifshow.com':
        if req['method'] == 'OPTIONS':
            return {'status': 200, 'body': '', 'headers': {'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST',
                                                          'access-control-allow-headers': 'content-type', 'access-control-max-age': '1800'}}
        if path == '/s/w/c':
            return _cfg(req)
        return {'c': 200, 'r': '98765432109876543'}
    if path == '/graphql':
        return _graphql(req)
    if host == 'id.kuaishou.com':
        if path == '/rest/c/infra/ks/qr/start':
            return {'result': 1, 'qrLoginToken': 'fake-qr-token', 'qrLoginSignature': 'fake-qr-sig', 'qrUrl': 'https://v.kuaishou.com/fake-qr',
                    'imageData': base64.b64encode(PNG).decode(), 'expireTime': 1790000060000}
        if path == '/rest/c/infra/ks/qr/acceptResult':
            return {'result': 1, 'qrToken': 'fake-qr-accepted', 'callback': '', 'sid': SID_WWW}
        if path == '/pass/kuaishou/login/qr/callback':
            return {'status': 200, 'headers': {'set-cookie': ['passToken=fake-pass-token; Path=/', 'userId=10001; Path=/']},
                    'body': {'result': 1, 'passToken': 'fake-pass-token', 'userId': 10001, 'bUserId': 20001, 'ssecurity': 'fake-ssecurity',
                             'kuaishou.server.webday7_st': 'fake-callback-st', 'kuaishou.server.webday7.at': 'fake-www-at', 'sid': SID_WWW}}
        if path == '/pass/kuaishou/login/mobileCode':
            return {'status': 200, 'headers': {'set-cookie': ['passToken=fake-pass-token; Path=/']},
                    'body': {'result': 1, 'passToken': 'fake-pass-token', 'userId': 10001, 'kuaishou.web.api_st': 'fake-api-st', 'kuaishou.web.api.at': 'fake-api-at'}}
        if path == '/pass/kuaishou/login/passToken' and req['method'] == 'GET':
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
            return {'status': 302, 'headers': {'location': q['callback'] + '&authToken=fake-sts-at&sid=' + q['sid']}, 'body': ''}
        if path == '/pass/kuaishou/login/passToken':
            return {'status': 200, 'headers': {'set-cookie': ['kuaishou.live.web_st=fake-live-st0; Path=/']},
                    'body': {'result': 1, 'kuaishou.live.web.at': 'fake-live-at', 'kuaishou.live.web_st': 'fake-live-st0', 'userId': 10001}}
        return {'result': 1}
    if path == '/rest/infra/sts':
        if host == 'cp.kuaishou.com':
            cookies = ['kuaishou.web.cp.api_st=fake-cp-st; Path=/', f'kuaishou.web.cp.api_ph={CP_PH}; Path=/']
        else:
            cookies = ['kuaishou.server.webday7_st=fake-www-st; Path=/', 'kuaishou.server.webday7_ph=fake-www-ph; Path=/', 'userId=10001; Path=/']
        return {'status': 302, 'headers': {'set-cookie': cookies, 'location': 'https://passport.kuaishou.com/pc/account/passToken/result'}, 'body': ''}
    if path in ('/new-reco', '/article/publish/video'):
        cookies = ['ktrace-context=fake|trace; Path=/'] if host == 'www.kuaishou.com' else []
        return {'status': 200, 'headers': {'set-cookie': cookies, 'content-type': 'text/html'}, 'body': '<html></html>'}
    if host == 'live.kuaishou.com':
        if path == '/live_api/baseuser/userLogin':
            return {'status': 200, 'headers': {'set-cookie': ['kuaishou.live.web_st=fake-live-st; Path=/', 'kuaishou.live.web_ph=fake-live-ph; Path=/']},
                    'body': {'data': {'result': 1}}}
        if path == '/live_api/home/list':
            return {'data': {'list': [{'labelId': 2, 'gameLiveInfo': [{'subLabelId': 0, 'liveInfo': [HOME_ITEM]}]}]}}
        if path == '/live_api/emoji/gift-list':
            if 'sortType=0' in url:
                return {'data': {'token': 'x', 'gifts': [{'id': 1, 'name': '棒棒糖', 'unitPrice': 1}, {'id': 2, 'name': '小心心', 'unitPrice': 0},
                                                         {'id': 3, 'name': '火箭', 'unitPrice': 5000}]}}
            return {'data': {'token': 'x', 'gifts': [{'id': 1, 'name': '棒棒糖', 'unitPrice': 1}]}}
        if path == '/live_api/emoji/allgifts':
            return {'data': {'1': {'id': 1, 'name': '棒棒糖', 'unitPrice': 1}, '9': {'id': 9, 'name': '粉丝团灯牌', 'unitPrice': 1}}}
        if path == '/live_api/liveroom/websocketinfo':
            return {'data': {'result': 1, 'token': 'fake-ws-token', 'websocketUrls': ['wss://live-ws.example/websocket']}}
        if path == '/live_api/category/classify':
            return {'data': {'list': [{'id': '1001', 'name': '王者荣耀', 'categoryAbbr': 'SYXX', 'categoryName': '手游休闲'}]}}
        return {'data': {'result': 1}}
    if host == 'upload.kuaishouzt.com':
        if path == '/api/upload/resume':
            return {'result': 1, 'existed': False, 'fragment_index': -1, 'fragment_list': [], 'endpoint': []}
        return {'result': 1}
    if host == 'cp.kuaishou.com':
        if path == '/rest/v2/creator/pc/authority/account/current':
            return {'result': 1, 'data': {'ab': {'enablePublish': True}}}
        if path == '/rest/cp/works/v2/video/pc/upload/pre':
            return {'result': 1, 'data': {'token': 'fake-upload-token', 'fileId': 555, 'endPoints': [UPLOAD]}}
        if path == '/rest/cp/works/v2/video/pc/upload/finish':
            return {'result': 1, 'data': {'fileId': 555, 'coverKey': COVER_KEY, 'mediaId': '12345678901234567890123456', 'videoDuration': 16000}}
        if path == '/rest/cp/works/atlas/pc/upload/pre':
            return {'result': 1, 'data': {'atlasId': 777, 'fileId': 666, 'uploadInfo': [{'token': 'fake-atlas-token', 'endPoints': [UPLOAD], 'blobKey': 'blob-1'}]}}
        if path == '/rest/cp/works/atlas/pc/upload/single/finish':
            return {'result': 1, 'data': {'url': [{'url': 'https://p1.a.yximgs.com/atlas-1.png'}]}}
        if path == '/rest/v2/creator/pc/notification/unReadCountV3':
            return {'result': 1, 'data': {'commentCount': 2, 'likeCount': 3}}
        if path == '/rest/cp/works/v2/video/pc/photo/list':
            if json.loads(req['body'])['queryType'] == '2':
                # 发布后管理页：本次发布还在处理中，没有 workId，未发布封面是这次 upload/finish 的 coverKey
                return {'result': 1, 'data': {'list': [{'publishId': 424242, 'workId': None, 'publishStatus': 2, 'unPublishCoverKey': COVER_KEY,
                                                        'title': '', 'userIdStr': SELF_EID, 'userName': '测试', 'uploadTime': 1790000000000}]}}
            return {'result': 1, 'data': {'list': [{'workId': PHOTO, 'caption': '我的作品', 'publishStatus': 1, 'publishTime': 1789990000000}]}}
        if path == '/rest/cp/works/v2/video/pc/publish/refresh':
            return {'result': 1, 'data': {'list': [{'publishId': 424242, 'publishStatus': 1, 'workId': '3xfakework0002', 'publishTime': 1790000000500}]}}
        return {'result': 1, 'message': '成功', 'data': {}}
    # www REST
    if path == '/rest/v/profile/get':
        return {'result': 1, 'eid': SELF_EID, 'userName': '测试', 'userHead': 'https://p1.a.yximgs.com/me.jpg', 'fans': 10, 'follows': 20}
    if path == '/rest/v/relation/fol':
        return {'result': 1, 'pcursor': 'no_more', 'authors': [{'user_id': EID, 'user_name': '作者', 'headurl': None}]}
    if path == '/rest/v/search/user':
        return {'result': 1, 'pcursor': 'no_more', 'searchSessionId': 'sess', 'users': [{'user_id': EID, 'user_name': '作者', 'fansCount': 100}]}
    return {'result': 1, 'pcursor': 'no_more', 'searchSessionId': 'sess', 'feeds': [FEED]}


def reset():
    """一个用例 = 浏览器的一次页面加载：签名器与 gdfp 预检缓存都从头开始."""
    random._inst.gauss_next = None
    ks_util.reset_hxfalcon_session()
    ks_util.reset_sig3_session()
    cache = getattr(shared_session(), webweapon_boot.PREFLIGHT_CACHE_ATTR, None)
    if isinstance(cache, dict):
        cache.clear()


def case(name, fn, **input):
    def run():
        reset()
        return fn()
    g.case(out, name, run, input=input, respond=respond)


def logged(site=None):
    """已物化的登录态：initialize(cookie) 不出网（票据有效、已有 wid）."""
    auth = KuaishouAuth().initialize(COOKIES)
    # 上游的直播 Cookie 合同校验要求浏览器直播页文档下发的 client_key / kuaishou.live.bfb1s，
    # 假会话（以及上游自己的扫码流程）都没有；这个开关只关掉校验，请求构造不变
    auth._allow_historical_live_contract = True
    if site:
        auth.use_site(site)
    return auth


LIVE = 'https://live.kuaishou.com'
CP = 'https://cp.kuaishou.com'

# ================================================================ 纯算
case('sig4', lambda: [
    HxFalconSigner(startup_random=1790000000123)._encode(build_sign_input('/rest/v/search/feed', 'POST', {}, {'keyword': '美食 a&b', 'page': 'search', 'webPageArea': '', 'pcursor': ''}, omit_empty_body=True), 1790000000999, 123456789012345),
    HxFalconSigner(startup_random=1790000000123, sdk_version=43469)._encode(build_sign_input('/rest/k/live/websocket/info', 'GET', {'liveStreamId': 'x'}, None), 1790000001000, 7),
    HxFalconSigner(startup_random=1790000000123)._encode(build_sign_input('/rest/c/infra/ks/qr/start', 'POST', {}, {'sid': 'a', 'channelType': 'UNKNOWN', 'isWebSig4': 'true'}, 'application/x-www-form-urlencoded'), 1790000001000, 99),
])
case('sig3', lambda: [Sig3Signer(1790000000, 100 + i).sign({'query': {}, 'body': b, 'type': 'json'}) for i, b in enumerate([
    {'kuaishou.web.cp.api_ph': 'x'}, {'caption': '中文 #话题', 'list': [1, 2], 'n': None}, {}])])
case('axios_query', lambda: Params().add_param('__NS_hxfalcon', 'HUDR_a-b.c$HE_01').add_param('caver', '2').add_param('k', 'a b:c,d[e]f$g/h?i').to_query_string())
case('weapon_aes', lambda: webweapon_boot.encrypt_payload('{"productName":"kuaishou-vision","ts":1790000000123,"did":"%s"}' % DID))
case('live_frames', lambda: {
    'enter': live_proto.enter_room_frame('fake-ws-token', STREAM),
    'enter_reconnect': live_proto.enter_room_frame('fake-ws-token', STREAM, reconnect_count=2),
    'heartbeat': live_proto.heartbeat_frame(1790000000123),
    'exit': live_proto.user_exit_frame(1790000000123),
    'feed': live_proto.encode_message({'payloadType': 310, 'compressionType': 1, 'payload': live_proto.encode_message({
        'displayWatchingCount': '1.2万',
        'commentFeeds': [{'id': 'c1', 'user': {'principalId': 'u1', 'userName': '观众'}, 'content': '666'}],
        'likeFeeds': [{'id': 'l1', 'user': {'principalId': 'u2', 'userName': '点赞的人'}}],
        'giftFeeds': [{'id': 'g1', 'user': {'principalId': 'u3', 'userName': '送礼的人'}, 'giftId': 1, 'batchSize': 3}],
    }, 'SCWebFeedPush')}, 'SocketMessage'),
})
case('oracle_kwf', lambda: weapon_oracle.gen_kwfv1(did=DID, href='https://www.kuaishou.com/new-reco', return_state=True))
case('oracle_kwf_cp', lambda: weapon_oracle.gen_kwfv1(did=DID, href='https://cp.kuaishou.com/article/publish/video?origin=www.kuaishou.com', kwfcv1='999', script_path=KWF_CP, return_state=True))
case('oracle_report', lambda: weapon_oracle.gen_fingerprint_report(did=DID, href='https://cp.kuaishou.com/article/publish/video?origin=www.kuaishou.com', cookie=f'did={DID}; kwfv1={KWFV1}', kwfcv1='4', current_kwfv1=KWFV1))
case('oracle_kws', lambda: weapon_oracle.gen_kwscode(sec_token=SECTOKEN, did=DID, href='https://www.kuaishou.com/new-reco', sign_url=KWS_URL))
case('oracle_like_token', lambda: like_token.generate_like_token(DID, 1790000000123))

# ================================================================ webweapon 引导
case('weapon_bootstrap', lambda: dict(KuaishouAuth().prepare_auth(COOKIES.replace(f'kwssectoken={SECTOKEN}; ', '').replace(f'kwscode={KWSCODE}; ', '')).cookie))
case('device_fingerprint', lambda: KuaishouLoginAPI.bootstrap_device_fingerprint(logged(), force=True))

# ================================================================ www
case('feed_hot', lambda: KuaishouAPI.get_feed_hot(logged()))
case('feed_hot_next', lambda: KuaishouAPI.get_feed_hot(logged(), '1'))
case('video_detail', lambda: KuaishouAPI.get_video_detail(logged(), PHOTO), photo=PHOTO)
case('short_video_reco', lambda: KuaishouAPI.get_short_video_reco(logged(), PHOTO), photo=PHOTO)
case('comment_list', lambda: KuaishouAPI.get_comment_list(logged(), PHOTO, 'cur1'), photo=PHOTO)
case('comment_list_gql', lambda: KuaishouAPI.get_comment_list_gql(logged(), PHOTO, 'cur1'), photo=PHOTO)
case('sub_comment_list', lambda: KuaishouAPI.get_sub_comment_list(logged(), '3xgv6ute4cr9szw', '1139746042562', ''))
case('profile_get', lambda: KuaishouAPI.get_profile(logged()))
case('profile_feed', lambda: KuaishouAPI.get_profile_feed(logged(), EID, 'cur1'), user=EID)


def _feed_then_liked():
    auth = logged()
    KuaishouAPI.get_profile_feed(auth, EID)
    return KuaishouAPI.get_liked_list(auth, '')


case('profile_feed_then_liked', _feed_then_liked)
case('search_feed', lambda: KuaishouAPI.search_feed(logged(), '美食 a&b'), keyword='美食 a&b')
case('search_feed_next', lambda: KuaishouAPI.search_feed(logged(), '美食', '1', search_session_id='sess'), keyword='美食')
case('search_user', lambda: KuaishouAPI.search_user(logged(), '美食'), keyword='美食')
case('search_user_next', lambda: KuaishouAPI.search_user(logged(), '美食', '2', search_session_id='sess'), keyword='美食')


def _relation(ftype):
    auth = logged()
    auth._self_eid_cache = SELF_EID
    return KuaishouAPI.get_relation(auth, ftype)


case('relation_following', lambda: _relation(1))
case('relation_fans', lambda: _relation(2))
case('liked_list', lambda: KuaishouAPI.get_liked_list(logged(), 'cur1'))
case('collect_list', lambda: KuaishouAPI.get_collect_list(logged(), EID, 'cur1'), user=EID)
case('playback_list', lambda: KuaishouAPI.get_playback_list(logged(), EID), user=EID)
case('like_data', lambda: KuaishouAPI.like_data(logged()))
case('profile_reduced', lambda: KuaishouAPI.vision_profile_reduced(logged(), EID), user=EID)
case('user_info', lambda: KuaishouAPI.get_user_info(logged()))

# ================================================================ 登录
case('qr_start', lambda: KuaishouLoginAPI.qr_start(logged(), SID_WWW, channel_type='UNKNOWN'))
case('qr_scan_result', lambda: KuaishouLoginAPI.qr_scan_result(logged(), 'fake-qr-token', 'fake-qr-sig', channel_type='UNKNOWN'))
case('qr_accept_result', lambda: KuaishouLoginAPI.qr_accept_result(logged(), 'fake-qr-token', 'fake-qr-sig', sid=SID_WWW, channel_type='UNKNOWN'))
case('qr_callback', lambda: KuaishouLoginAPI.qr_callback(logged(), 'fake-qr-accepted', SID_WWW, channel_type='UNKNOWN'))
case('request_mobile_code', lambda: KuaishouLoginAPI.request_mobile_code(logged(), '13800000000'))
case('mobile_code_login', lambda: KuaishouLoginAPI.login_by_mobile_code(logged(), '13800000000', '123456', with_sts=False, with_document=False)['cookies'])
case('sts_www', lambda: KuaishouLoginAPI.sts_login(logged(), SID_WWW))
case('sts_cp', lambda: KuaishouLoginAPI.sts_login(logged(), SID_CP))
case('document_www', lambda: KuaishouLoginAPI.bootstrap_document(logged(), 'https://www.kuaishou.com', '/new-reco')['cookies'])
case('document_cp', lambda: KuaishouLoginAPI.bootstrap_document(logged(), CP, '/article/publish/video?origin=www.kuaishou.com')['cookies'])


def _pass_token():
    auth = logged(LIVE)
    data, cookies = KuaishouLoginAPI.pass_token_login(auth, SID_LIVE, LIVE)
    return cookies


case('pass_token_login', _pass_token)
case('refresh_live_session', lambda: KuaishouLoginAPI.refresh_site_session(logged(LIVE), SID_LIVE, LIVE))


def _qrcode_login():
    auth = KuaishouAuth()
    auth.prepare_auth('')
    auth._live_bootstrap_enabled = True
    auth._ensure_browser_defaults()
    result = KuaishouLoginAPI.login_browser_session(auth, qr_path=QR_PATH, timeout=600.0, poll_interval=1.0)
    assert result.get('ok'), result
    auth.update_cookies(result.get('cookies') or {})
    auth._ensure_browser_defaults()
    # catbus 补充：登录时一并换取直播站凭证，再用 userInfoQuery 校验登录态
    auth._allow_historical_live_contract = True
    auth.use_site(LIVE)
    KuaishouLoginAPI.refresh_site_session(auth, SID_LIVE, LIVE)
    auth.use_site('https://www.kuaishou.com')
    info = KuaishouAPI.get_user_info(auth)
    return {'cookies': dict(auth._cookie), 'info': info, 'kwfcv1': auth.kwfcv1}


case('qrcode_login_flow', _qrcode_login)

# ================================================================ 直播
case('home_list', lambda: KuaishouLiveAPI.home_list(logged(LIVE)))
case('category_classify', lambda: KuaishouLiveAPI.category_classify(logged(LIVE)))
case('gift_list', lambda: KuaishouLiveAPI.gift_list(logged(LIVE), STREAM, eid=ROOM), room=ROOM)
case('gift_list_more', lambda: KuaishouLiveAPI.gift_list(logged(LIVE), STREAM, sort_type=0, eid=ROOM), room=ROOM)
case('emoji_all_gifts', lambda: KuaishouLiveAPI.emoji_all_gifts(logged(LIVE), eid=ROOM), room=ROOM)


def _live_gifts():
    """live gifts 命令：直播首页找房间 → 首屏礼物 → “更多礼物”."""
    auth = logged(LIVE)
    KuaishouLiveAPI.home_list(auth)
    KuaishouLiveAPI.gift_list(auth, STREAM, eid=ROOM)
    return KuaishouLiveAPI.gift_list(auth, STREAM, sort_type=0, eid=ROOM)


case('live_gifts_flow', _live_gifts, room=ROOM)


case('websocket_info', lambda: KuaishouLiveAPI.websocket_info(logged(LIVE), STREAM, eid=ROOM), room=ROOM)

# ================================================================ 创作者中心
case('authority_account_current', lambda: Publish.authority_account_current(logged(CP)))
case('notification_unread_count', lambda: Publish.notification_unread_count(logged(CP)))
case('video_photo_list', lambda: Publish.video_photo_list(logged(CP), '0', 1790000000123, 0, 1790000000123, 20, 5, ''))
case('atlas_upload_pre', lambda: Publish.atlas_upload_pre(logged(CP), [str(IMAGE_PATH)]))
case('atlas_upload_pre_next', lambda: Publish.atlas_upload_pre(logged(CP), [str(IMAGE_PATH)], atlas_id=777, file_id=666))
case('atlas_single_finish', lambda: Publish.atlas_upload_single_finish(logged(CP), 666, 777, 'blob-1'))
case('atlas_snapshot_save', lambda: Publish.atlas_publish_info_snapshot_save(logged(CP), 666, 777))
case('atlas_upload_finish', lambda: Publish.atlas_upload_finish(logged(CP), 666, 777, ['blob-1', 'blob-2']))
case('publish_atlas', lambda: Publish.publish_atlas(logged(CP), '图文#话题', 666, 777, photo_status=2))
case('video_upload_pre', lambda: Publish.video_upload_pre(logged(CP)))
case('uploader', lambda: [KsUploader('fake-upload-token', [UPLOAD]).resume(),
                          KsUploader('fake-upload-token', [UPLOAD]).upload_fragment(0, PNG, 0, len(PNG)),
                          KsUploader('fake-upload-token', [UPLOAD]).complete(1)])
case('publish_atlas_flow', lambda: Publish.publish_media_file(logged(), str(IMAGE_PATH), caption='我的图文 #话题', media_type='image', photo_status=1), image='pic.png')
def _publish_video():
    """视频发布 + 发布后管理页：photo/list(queryType=2) 拿 publishId，再 publish/refresh 取一次状态."""
    auth = logged()
    submit = Publish.publish_media_file(auth, str(VIDEO_PATH), caption='', media_type='video', photo_status=2)
    now = g.NOW_MS
    listing = Publish.video_photo_list(auth, '2', now, now - 365 * 86400000, now, 20, 5, '',
                                       referer=Publish.post_publish_manage_referer, post_publish=True)
    refresh = Publish.video_publish_refresh(auth)
    return {'submit': submit, 'list': listing, 'refresh': refresh}


case('publish_video_flow', _publish_video, video='clip.mp4')

# ================================================================ 命令流程：游客第一次运行
def _guest_feed():
    auth = KuaishouAuth().initialize('', login_if_empty=False)
    KuaishouLoginAPI.bootstrap_device_fingerprint(auth)
    auth.use_site('https://www.kuaishou.com')
    return KuaishouAPI.get_feed_hot(auth)


case('guest_feed_hot', _guest_feed)


# ================================================================ 滑块验证码（utils/captcha*.py、gdfp_manmachine.py、captcha_crypto.py）
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from utils import captcha as C  # noqa: E402
from utils import captcha_fp  # noqa: E402
from utils import gdfp_manmachine as GM  # noqa: E402
from utils.sign import captcha_crypto  # noqa: E402

CAP_W, CAP_H, PIECE = 200, 96, 44
GAP_X, GAP_Y = 131, 30
IFRAME = ('https://captcha.zt.kuaishou.com/iframe/index.html?captchaSession=Cg1fake%2Bsession%3D%3D&type=1'
          '&configUrl=https%3A%2F%2Fcaptcha.zt.kuaishou.com%2Frest%2Fzt%2Fcaptcha%2Fsliding%2Fconfig'
          '&bizName=ANTICRAWL_COMMON&displayType=1')
CAPTCHA_HOST = 'https://captcha.zt.kuaishou.com'
CAPTCHA_CONFIG = {
    'result': 1, 'captchaSn': 'fake-captcha-sn-0001',
    'bgPicUrl': f'{CAPTCHA_HOST}/rest/zt/captcha/sliding/bgPic', 'cutPicUrl': f'{CAPTCHA_HOST}/rest/zt/captcha/sliding/cutPic',
    'bgPicWidth': CAP_W, 'bgPicHeight': CAP_H, 'cutPicWidth': 52, 'cutPicHeight': CAP_H, 'disX': 4, 'disY': GAP_Y,
    'verifyUrl': f'{CAPTCHA_HOST}/rest/zt/captcha/sliding/verify', 'verifyUrl2': f'{CAPTCHA_HOST}/rest/zt/captcha/sliding/kSecretApiVerify',
    'refSes': 'fake-ref-ses',
}


def _png(arr, mode):
    buf = io.BytesIO()
    Image.fromarray(arr, mode).save(buf, 'PNG')
    return buf.getvalue()


def _texture():
    """确定性的圆斑（LCG，不用 random）：边缘多且不周期重复，模板匹配有唯一的最优位置."""
    yy, xx = np.mgrid[0:CAP_H, 0:CAP_W]
    img = np.zeros((CAP_H, CAP_W, 3), np.int32)
    img[...] = (70, 90, 110)
    state = [12345]

    def nxt():
        state[0] = (state[0] * 1103515245 + 12345) & 0x7FFFFFFF
        return state[0]
    for _ in range(90):
        cx, cy, r = nxt() % CAP_W, nxt() % CAP_H, 3 + nxt() % 9
        color = (nxt() % 256, nxt() % 256, nxt() % 256)
        img[(xx - cx) ** 2 + (yy - cy) ** 2 <= r * r] = color
    return img.astype(np.uint8)


def _piece_alpha():
    """拼图块：方块 + 上、右两个凸起；外圈一像素 alpha=128（抗锯齿，检验 alpha > 32 的阈值）."""
    yy, xx = np.mgrid[0:PIECE, 0:PIECE].astype(np.float64)
    core = (((xx >= 5) & (xx < 36) & (yy >= 9) & (yy < 40))
            | ((xx - 20) ** 2 + (yy - 9) ** 2 <= 36) | ((xx - 36) ** 2 + (yy - 25) ** 2 <= 25))
    ring = np.zeros_like(core)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ring |= np.roll(np.roll(core, dy, 0), dx, 1)
    a = np.where(core, 255, 0).astype(np.uint8)
    a[ring & ~core] = 128
    return a


def _pair_match():
    """背景：缺口处压暗、描白边；滑块：缺口处的原图抠出来，与背景同高."""
    bg = _texture()
    a = _piece_alpha()
    piece = np.zeros((PIECE, PIECE, 4), np.uint8)
    piece[..., :3] = np.where(a[..., None] > 0, bg[GAP_Y:GAP_Y + PIECE, GAP_X:GAP_X + PIECE], 0)
    piece[..., 3] = a
    sub = bg[GAP_Y:GAP_Y + PIECE, GAP_X:GAP_X + PIECE]
    sub[a > 0] = (sub[a > 0] * 0.7).astype(np.uint8)
    sub[a == 128] = 235
    cut = np.zeros((CAP_H, 52, 4), np.uint8)
    cut[GAP_Y:GAP_Y + PIECE, 4:4 + PIECE] = piece
    return _png(bg, 'RGB'), _png(cut, 'RGBA')


def _pair_fallback():
    """匹配不上（纯色滑块，掩码内没有边缘）：走“逐列亮度突变”的退路，突变在 x=150."""
    yy, xx = np.mgrid[0:CAP_H, 0:CAP_W].astype(np.float64)
    base = np.where(xx >= 150, 90 + 0.2 * xx - 70, 90 + 0.2 * xx)
    bg = np.clip(np.stack([base, base + 5, base + 10], -1), 0, 255).astype(np.uint8)
    disc = (xx[:PIECE, :PIECE] - 22) ** 2 + (yy[:PIECE, :PIECE] - 22) ** 2 <= 256
    piece = np.zeros((PIECE, PIECE, 4), np.uint8)
    piece[disc] = (200, 40, 90, 255)
    cut = np.zeros((CAP_H, 52, 4), np.uint8)
    cut[20:20 + PIECE, 4:4 + PIECE] = piece
    return _png(bg, 'RGB'), _png(cut, 'RGBA')


BG_PNG, CUT_PNG = _pair_match()
BG2_PNG, CUT2_PNG = _pair_fallback()
b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731

REST_RISK = {'result': 400002, 'data': {'result': 400002, 'url': IFRAME}}
GQL_RISK = {'errors': [{'message': 'Need captcha', 'locations': [], 'path': ['visionVideoDetail']}], 'data': {'captcha': {'url': IFRAME}}}


def captcha_responder(trigger, risk, verify_ok=True):
    """第一次命中 trigger 的业务请求回滑块挑战；验证码与 gdfp manMachine 的请求按真实形状回复."""
    state = {'risk': False}

    def reply(req):
        u = urllib.parse.urlsplit(req['url'])
        if u.netloc == 'captcha.zt.kuaishou.com':
            if u.path.endswith('/sliding/config'):
                return CAPTCHA_CONFIG
            if u.path.endswith('/bgPic'):
                return {'status': 200, 'headers': {'content-type': 'image/png'}, 'body': BG_PNG}
            if u.path.endswith('/cutPic'):
                return {'status': 200, 'headers': {'content-type': 'image/png'}, 'body': CUT_PNG}
            if u.path.endswith('/kSecretApiVerify'):
                return {'result': 1, 'error_msg': ''} if verify_ok else {'result': 350014, 'error_msg': 'anti check err'}
        if u.netloc == 'gdfp.gifshow.com' and u.path in ('/s/u/v', '/n/a/b'):
            body = GM.MAN_MACHINE_INIT_RESPONSE if u.path == '/s/u/v' else GM.REPORT_RESPONSE
            return {'status': 200, 'headers': {'content-type': 'application/json;charset=UTF-8'}, 'body': body.decode(), 'http_version': 3}
        if not state['risk'] and trigger(req):
            state['risk'] = True
            return risk
        return respond(req)
    return reply


def captcha_case(name, fn, trigger, risk, verify_ok=True, **input):
    def run():
        reset()
        return fn()
    g.case(out, name, run, input=input, respond=captcha_responder(trigger, risk, verify_ok))


def _py_float():
    xs = [0.125, 0.375, 2.675, 1.005, -0.004, -0.125, 100.345, 1e-07, 123.455, 0.5, 1.5, 2.5, -2.5, 0.015, 0.025,
          1234.5678, 131 - 2.2, 131 - 1.1, 131 - 0.4, 30 + 0.35, 5e-324, 1e300]
    reprs = [1e-05, 1e16, 123.0, 0.1 + 0.2, -0.0, 1.5e-07, 12345678901234567.0, 0.0001, 9999999999999998.0,
             30 + round(-0.004, 2), 0 + round(-0.004, 2), 1.0, 1e22, 2.5e-05, -1.2, 128.8]
    gauss = [random.gauss(0, 0.8) for _ in range(7)]
    return {'xs': xs, 'round2': [str(round(x, 2)) for x in xs], 'round1': [str(round(x, 1)) for x in xs],
            'round0': [str(round(x, 0)) for x in xs], 'reprs': reprs, 'repr': [str(v) for v in reprs],
            'gauss': gauss, 'gauss_round': [str(round(v, 2)) for v in gauss]}


def _captcha_crypto():
    payload = {'captchaSn': 'Cg1fake sn/+=', 'bgDisWidth': 686, 'relativeX': 131, 'trajectory': '1.5|30.12|0,131|29.9|12',
               'gpuInfo': captcha_fp.gpu_info_json(), 'flag': True, 'off': False, 'none': None, 'zh': "中文！(x)*~'"}
    return {'qs': captcha_crypto.qs_stringify(payload), 'param': captcha_crypto.verify_param(payload),
            'raw': b64(captcha_crypto.encrypt('中文abc\U0001F600')),
            'roundtrip': captcha_crypto.decrypt(captcha_crypto.encrypt('hello, 世界'))}


def _trajectory():
    first = C.build_trajectory(131, start_y=GAP_Y)
    return {'first': C.format_trajectory(first), 'points': first,
            'float': C.format_trajectory(C.build_trajectory(1.0, start_y=0)),
            'short': C.format_trajectory(C.build_trajectory(7, start_y=12))}


GDFP_COOKIES = {'did': DID, 'wid': '12345678901234567', 'kwpsecproductname': 'kuaishou-vision', 'didv': '1789990000000',
                'bUserId': '20001', 'kwssectoken': SECTOKEN, 'kwscode': KWSCODE, 'kwfv1': KWFV1}


def _gdfp_payloads():
    common = dict(did=DID, user_id='', cookies=GDFP_COOKIES, parent_url='https://www.kuaishou.com/new-reco', iframe_url=IFRAME,
                  ua=C.UA, identity='11111111-2222-4333-8444-555555555555', begin_ms=g.NOW_MS,
                  session_id='66666666-7777-4888-9999-000000000000', script_urls=[KWF_WWW, KWS_URL])
    core = GM.build_core_payload(now_ms=g.NOW_MS + 300, **common)
    whole = GM.build_whole_payload(now_ms=g.NOW_MS + 1300, **common)
    return {'sign': GM.sign_for(1786887567), 'url': GM.build_url('/s/u/v', extra='&type=SDK_INIT'), 'init': GM.build_init_body(DID),
            'core': GM.encode_body(core), 'whole': GM.encode_body(whole),
            'init_config': GM.parse_init_response(json.loads(GM.MAN_MACHINE_INIT_RESPONSE))}


case('py_float', _py_float)
case('captcha_crypto', _captcha_crypto)
case('captcha_trajectory', _trajectory)
case('captcha_fp', lambda: [captcha_fp.gpu_info_json(), captcha_fp.captcha_extra_param_json(did=DID),
                            captcha_fp.captcha_extra_param_json(did=DID, now_ms=1790000000999)])
case('gdfp_payloads', _gdfp_payloads)
case('captcha_gap', lambda: [C.find_gap_x(BG_PNG, CUT_PNG), C.find_gap_x(BG2_PNG, CUT2_PNG)],
     match=[b64(BG_PNG), b64(CUT_PNG)], fallback=[b64(BG2_PNG), b64(CUT2_PNG)])

_is_comment = lambda req: urllib.parse.urlsplit(req['url']).path == '/rest/v/photo/comment/list'  # noqa: E731
_is_detail = lambda req: (urllib.parse.urlsplit(req['url']).path == '/graphql'  # noqa: E731
                          and json.loads(req['body'])['operationName'] == 'visionVideoDetail')

# REST：comment/list 撞上 400002 → 验证码 iframe 的 webweapon 引导 → config → 两张图 → gdfp 三个请求 → verify → 重发
captcha_case('captcha_comment_list', lambda: KuaishouAPI.get_comment_list(logged(), PHOTO, 'cur1'), _is_comment, REST_RISK, photo=PHOTO)
# GraphQL：visionVideoDetail 的 errors + data.captcha.url，重发前重新序列化详情页的 Cookie 线序
captcha_case('captcha_video_detail', lambda: KuaishouAPI.get_video_detail(logged(), PHOTO), _is_detail, GQL_RISK, photo=PHOTO)
# verify 没通过：不重发，原样返回风控响应
captcha_case('captcha_verify_fail', lambda: KuaishouAPI.get_comment_list(logged(), PHOTO, 'cur1'), _is_comment, REST_RISK,
             verify_ok=False, photo=PHOTO)
