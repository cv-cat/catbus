"""douyin 对拍数据的第三部分：补齐上游已有、第一轮没移植的能力。由 gen.py 在末尾 exec，共用 gen.py / gen_more.py 的全局变量。

搜索筛选与视频频道、作品管理（work_list）、发布的地点 / 合集 / 热点 / 下载 / 封面、收藏夹移动、私信文件与分享卡片、
直播千票榜与点赞次数、商品评价的标签、通知分组、短信登录的 SSO 链；
以及 dtrait 内层 blob 的纯算（utils/dtrait_features.py）和上游 fix-dtrait-blob 分支的默认设备档案（utils/dtrait_profile.json）。
"""

# ================================================================ 搜索筛选
case('search_general_filter', logged(lambda a: DouyinAPI.search_general_work(
    a, '美食', sort_type='2', publish_time='7', offset='0', filter_duration='1-5', search_range='3', content_type='2')),
    keyword='美食')

VIDEO_LOGID = '20260928120000ABCDEF0123456789AB'
SEARCH_AWEME = {'aweme_id': AWEME, 'desc': '搜索到的视频', 'create_time': 1735660800, 'aweme_type': 0,
                'author': {'uid': UID, 'sec_uid': SEC_UID, 'nickname': '作者'}, 'statistics': {'digg_count': 1},
                'video': {'play_addr': {'uri': 'v0200fg', 'url_list': ['https://v3-web.douyinvod.com/play.mp4']}}}


def video_search_respond(req):
    if '/aweme/v1/web/search/item/' in req['url']:
        return {'status': 200, 'headers': {'X-Tt-Logid': VIDEO_LOGID},
                'body': {'status_code': 0, 'has_more': 1, 'guide_search_words': [], 'data': [{'type': 1, 'aweme_info': SEARCH_AWEME}]}}
    return respond(req)


case('search_video', logged(lambda a: list(DouyinAPI.search_video_work(a, '美食 探店', '0', '16', '1', '180', '0-1', '1'))),
     video_search_respond, keyword='美食 探店')
case('search_video_p2', logged(lambda a: list(DouyinAPI.search_video_work(a, '美食', '16', '16', '0', '0', '', '0', 'prev-logid-0001'))),
     video_search_respond, keyword='美食', search_id='prev-logid-0001')
case('search_user_filter', logged(lambda a: DouyinAPI.search_user(a, '巴旦木公主', '0', '25', douyin_user_fans='1w_10w',
                                                                  douyin_user_type='enterprise_user')))

# ================================================================ 作品管理：创作者中心 work_list（发布页的作品预览）
case('work_list', lambda: DouyinCreatorAPI.get_preview_video_list(creator_auth()), media_respond)

# ================================================================ 发布：地点、合集、热点、不允许下载、图集封面、tos- 封面
POI = {'poi_id': '6601136811511474183', 'poi_name': '北京·天安门'}
MIX = '7400000000000000888'

case('post_images_extra', lambda: DouyinCreatorAPI.post_images(
    creator_auth(), [PNG, PNG], title='标题', desc='正文 #话题 @好友', visibility=1, allow_download=False, timing=1790086400,
    cover_index=1, poi=POI, mix_id=MIX, hot_spot={'word': '热点词'}), media_respond)
case('post_video_extra', lambda: DouyinCreatorAPI.post_video(
    creator_auth(), VIDEO, title='视频标题', desc='视频描述', visibility=0, allow_download=False, cover='tos-cn-i-fake/mycover',
    poi=POI, mix_id=MIX, hot_spot={'word': '热点词'}), media_respond, video=base64.b64encode(VIDEO).decode())

# ================================================================ 收藏夹移动
FOLDER = '7379252593215919891'
case('collect_move', logged(lambda a: DouyinAPI.move_collect_aweme(a, AWEME, '我的收藏夹', FOLDER)), aweme_id=AWEME, folder=FOLDER)
case('collect_remove', logged(lambda a: DouyinAPI.remove_collect_aweme(a, AWEME, '我的收藏夹', FOLDER)), aweme_id=AWEME, folder=FOLDER)

# ================================================================ 私信：文件、作品 / 图文分享卡片、用户名片、网页卡片
FILE_BYTES = b'hello catbus file\n' * 4
case('im_send_file', logged(lambda a: DouyinAPI.send_file(a, CONV_ID, CONV_SHORT, 'fake-conv-ticket', FILE_BYTES)), media_respond,
     file=base64.b64encode(FILE_BYTES).decode())

SHARE_VIDEO = {
    'aweme_id': AWEME, 'desc': '分享的视频 #话题', 'aweme_type': 0, 'is_aigc': False, 'is_live_photo': 0,
    'author': {'uid': '5550001', 'sec_uid': SEC_UID, 'nickname': '作者'},
    'video': {'cover': {'uri': 'tos-cn-p-0015/cover', 'url_list': ['https://p3.douyinpic.com/cover.jpeg'], 'width': 720, 'height': 720},
              'width': 1080, 'height': 1920},
    'share_info': {'share_url': 'https://www.iesdouyin.com/share/video/7433523124836060416/'},
    'ai_ext': {'k': 1}, 'profile_uid': '5550001',
}
SHARE_PHOTOS = {
    'aweme_id': '7433523124836060417', 'desc': '分享的图文', 'aweme_type': 68,
    'author': {'uid': '5550002', 'sec_uid': SEC_UID, 'nickname': '图文作者'},
    'images': [{'uri': 'tos-cn-i-0813/img1', 'url_list': ['https://p3.douyinpic.com/img1.jpeg'], 'width': 1080, 'height': 1440},
               {'uri': 'tos-cn-i-0813/img2', 'url_list': ['https://p3.douyinpic.com/img2.jpeg'], 'width': 1080, 'height': 1440}],
    'video': {'cover': {'uri': 'x', 'url_list': []}},
}


def share_respond(detail):
    def fn(req):
        if 'aweme/detail' in req['url']:
            return {'status_code': 0, 'aweme_detail': detail}
        return im_respond(req)
    return fn


case('im_share_aweme', logged(lambda a: DouyinAPI.send_share_aweme(a, CONV_ID, CONV_SHORT, 'fake-conv-ticket',
                                                                  f'https://www.douyin.com/video/{AWEME}')),
     share_respond(SHARE_VIDEO), detail=SHARE_VIDEO)
case('im_share_photos', logged(lambda a: DouyinAPI.send_share_photos(a, CONV_ID, CONV_SHORT, 'fake-conv-ticket',
                                                                    'https://www.douyin.com/note/7433523124836060417')),
     share_respond(SHARE_PHOTOS), detail=SHARE_PHOTOS)

AVATAR = {'uri': 'aweme-avatar/fake', 'url_list': ['https://p3.douyinpic.com/avatar.jpeg'], 'width': 720, 'height': 720}
case('im_user_card', logged(lambda a: DouyinAPI.send_user_card(a, CONV_ID, CONV_SHORT, 'fake-conv-ticket', None,
                                                              uid='5550001', sec_uid=SEC_UID, name='作者', avatar=AVATAR)),
     im_respond, avatar=AVATAR)
WEB_URL = 'https://example.com/page?a=1&b=中 文#top'
case('im_share_web', logged(lambda a: DouyinAPI.send_share_web(a, CONV_ID, CONV_SHORT, 'fake-conv-ticket', WEB_URL)),
     im_respond, url=WEB_URL)

# ================================================================ 直播：千票榜、点赞次数
case('live_rank_thousand', logged(lambda a: DouyinAPI.get_live_thousand_ticket_rank(a, ROOM_ID, web_rid=WEB_RID)),
     room_id=ROOM_ID, web_rid=WEB_RID)
case('live_like_count', logged(lambda a: DouyinAPI.diggLiveRoom(a, ROOM_ID, '10')), room_id=ROOM_ID)

# ================================================================ 商品评价：分类计数与按标签筛选
case('product_comment_counter', logged(lambda a: DouyinAPI.get_product_comment_counter(a, '3622058069401408999', 'fakeShop01')))
case('product_comments_tag', logged(lambda a: DouyinAPI.get_product_comments(a, '3622058069401408999', 'fakeShop01', '0', tag_id='7')))

# ================================================================ 通知分组
case('notices_group', logged(lambda a: DouyinAPI.get_notice_list(a, '0', '0', notice_group='401')))

# ================================================================ 短信登录：login.douyin.com 的 SSO 链（DY_PHONE_LOGIN_PROFILE=sso）
SSO_CSRF = 'b1c2d3e4f5a60718293a4b5c6d7e8f90'
GFKADPD_HTML = '<html><script>var e = "2906", t = "33638";document.cookie="gfkadpd="+e+","+t;location.reload()</script></html>'


def sso_respond(state):
    def respond_fn(req):
        url = req['url']
        if url == 'https://login.douyin.com/':
            return {'status': 200, 'headers': {'content-type': 'text/html', 'set-cookie': [
                f'passport_csrf_token={SSO_CSRF}; Domain=douyin.com; Path=/',
                f'passport_csrf_token_default={SSO_CSRF}; Domain=douyin.com; Path=/']}, 'body': '<html>login</html>'}
        if 'send_activation_code' in url:
            state['send'] = state.get('send', 0) + 1
            if state['send'] == 1:
                return {'status': 200, 'headers': {'content-type': 'text/html'}, 'body': GFKADPD_HTML}
            return {'message': 'success', 'data': {'mobile_ticket': 'fake-sso-mobile-ticket', 'error_code': 0}}
        if 'quick_login' in url:
            return {'status': 200, 'headers': {'bd-ticket-guard-server-data': SERVER_DATA,
                                               'set-cookie': 'sessionid=fake-sso-session; Domain=douyin.com; Path=/'},
                    'body': {'message': 'success', 'data': {'redirect_url': 'https://www.douyin.com/passport/sso/login/callback/?ticket=sso'}}}
        if 'login/callback' in url:
            return {'status': 302, 'headers': {'location': 'https://www.douyin.com/', 'set-cookie': 'sessionid_ss=fake-ss; Domain=douyin.com; Path=/'},
                    'body': ''}
        if url == 'https://www.douyin.com/':
            return {'status': 200, 'headers': {'content-type': 'text/html'}, 'body': '<html></html>'}
        return respond(req)
    return respond_fn


def sms_sso_flow():
    api = DYLoginApi()
    auth = api.bootstrap_phone_auth()
    api.send_sms_code(auth, '13800000000')
    api.phone_login(auth, '13800000000', '123456')
    return {'cookies': dict(auth.cookie), 'ticket': auth.ticket, 'ts_sign': auth.ts_sign}


case('login_sms_sso', sms_sso_flow, sso_respond({}), phone='13800000000', code='123456')


# ================================================================ dtrait 设备档案（上游 fix-dtrait-blob）：没有 dtrait_blob 时按档案现算内层 blob
import copy  # noqa: E402

from tests.test_dtrait_profile import CAPTURED_BLOB  # noqa: E402
from utils.dtrait_features import build_blob, computed_features, js_number_to_str, murmur3_32  # noqa: E402
from utils.dtrait_profile import DEFAULT_PROFILE_PATH, _normalise_profile, load_dtrait_profile  # noqa: E402

# 自定义档案（JSON 形态，键是字符串）：bool 序号跨过 32（位图变长、n % 32 == 0 的分支）、非整数的数值字段、非 ASCII 的特征串
DEFAULT_PROFILE_JSON = json.loads(Path(DEFAULT_PROFILE_PATH).read_text(encoding='utf-8'))
CUSTOM_PROFILE = {
    **copy.deepcopy(DEFAULT_PROFILE_JSON),
    'source': 'catbus golden', 'reserved': 1, 'version': 3,
    'bools': {'0': True, '1': True, '2': False, '9': True, '10': True, '32': True, '40': False, '63': True},
    'render_hashes': {**DEFAULT_PROFILE_JSON['render_hashes'], '5': 4294967295, '13': 0},
    'downlink': 1.45, 'effective_type': '3g', 'language': 'en-US', 'languages': ['en-US', 'en'],
    'str16_list': ['PDF Viewer', 'Chrome PDF Viewer'], 'platform': 'MacIntel', 'str18_list': ['思源黑体', 'Arial'],
    'ua': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'locale': 'en-US', 'timezone': 'America/New_York', 'notification_permission': 'granted', 'str29_head': '9',
    'device_memory': 8, 'hardware_concurrency': 12, 'max_touch_points': 0,
    'avail_height': 1055, 'avail_left': 0, 'avail_top': 25, 'avail_width': 1920, 'screen_height': 1080, 'screen_width': 1920,
    'color_depth': 30, 'pixel_depth': 30, 'device_pixel_ratio': 2.5, 'hook_score': '0',
}
MURMUR_SAMPLES = ['', 'a', 'ab', 'abc', 'abcd', 'abcde', '中文', '10,4g', '𠀀 四字节 UTF-8']
JS_NUMBERS = [0.1 + 0.2, 1 / 3, 100.0, -0.0, 1e21, 123456789012345680000.0, 1e-7, 1.5e-6, -2.5e-7, 2.0 ** 53, 5e-324,
              1.7976931348623157e308, -1.4214488238747245]


def dtrait_blob():
    default = load_dtrait_profile()
    blob = build_blob(default)
    assert blob == CAPTURED_BLOB, '默认档案生成的 blob 与上游测试的 CAPTURED_BLOB 不一致：本机 libm 的 Math 指纹与 V8 不同？（见 gen.py 的 _V8_MATH）'
    custom = _normalise_profile(copy.deepcopy(CUSTOM_PROFILE))
    return {
        'default': blob,
        'default_features': {str(n): v for n, v in sorted(computed_features(default).items())},
        'custom': build_blob(custom),
        'custom_edge': build_blob(custom, access_type=1),
        'custom_features': {str(n): v for n, v in sorted(computed_features(custom).items())},
        'murmur3': [[s, murmur3_32(s)] for s in MURMUR_SAMPLES],
        'js_number': [[x, js_number_to_str(x)] for x in JS_NUMBERS],
    }


case('dtrait_blob', dtrait_blob, captured=CAPTURED_BLOB, custom_profile=CUSTOM_PROFILE)


def profile_auth(profile=None):
    """没有导入 dtrait_blob 的登录态：DouyinAuth 构造时已加载默认档案；给了 profile 时换成它（catbus 的 device.dtrait_profile）。"""
    auth = logged_auth()
    auth.dtrait_blob = None
    if profile is not None:
        auth.dtrait_profile = _normalise_profile(copy.deepcopy(profile))
    return auth


def creator_profile_auth():
    auth = profile_auth()
    auth.bootstrap_creator_session()
    return auth


case('comment_publish_profile', lambda: DouyinAPI.publish_comment(profile_auth(), AWEME, '默认档案'),
     aweme_id=AWEME, text='默认档案', dtrait_blob=None)
case('comment_publish_custom_profile', lambda: DouyinAPI.publish_comment(profile_auth(CUSTOM_PROFILE), AWEME, '自定义档案'),
     aweme_id=AWEME, text='自定义档案', dtrait_blob=None, dtrait_profile=CUSTOM_PROFILE)
case('post_images_profile', lambda: DouyinCreatorAPI.post_images(creator_profile_auth(), [PNG, PNG], title='标题', desc='默认档案', visibility=0),
     media_respond, title='标题', desc='默认档案', dtrait_blob=None)
# 严格短信登录：没有 DY_DTRAIT_BLOB 时不再拒绝，passport 请求带按默认档案现算的 x-tt-session-dtrait（820 字节）
case('login_sms_profile', sms_flow, login_respond({}), dtrait_blob=None, phone='13800000000', code='123456')
