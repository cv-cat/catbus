"""weibo 的对拍数据：用上游 WeiboApis 的代码构造请求（只用假凭证），记录请求序列。

运行：.golden/weibo/bin/python scripts/golden/weibo/gen.py（Windows：.golden/weibo/Scripts/python）
依赖：uv pip install requests beautifulsoup4 pandas loguru
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# 上游 import 了 pandas 但没用到。pandas 的 C 扩展在 datetime 被替换之后导入会栈溢出，所以先导入
import pandas  # noqa: E402, F401

import catbus_golden as g  # noqa: E402

out = g.setup('weibo', 'WeiboApis')

import apis.weibo_creator_apis as creator  # noqa: E402
from apis.weibo_apis import WeiboApis  # noqa: E402
from apis.weibo_mobile_apis import WeiboMobileApis  # noqa: E402

# post_weibo 引用的是模块级的 weiboCreaterApis（上游只在 __main__ 里定义）
creator.weiboCreaterApis = creator.WeiboCreaterApis()

# 只有假值
COOKIES = ('SCF=fake-scf; SUB=_2A25fakeSUB0000; SUBP=0033fakeSUBP; ALF=02_1790259200; '
           'WBPSESS=fake-wbpsess==; XSRF-TOKEN=fakeXsrfToken0123')
UID = '10001'
NICK = '测试昵称'
MID = '5073209014095008'
MEDIA_ID = '5078000000000001'
IMG1 = b'\xff\xd8\xff\xe0' + bytes(range(256)) + b'fake-jpeg-1'
IMG2 = b'\xff\xd8\xff\xe0' + bytes(reversed(range(256))) + b'fake-jpeg-2'
VIDEO = b'\x00\x00\x00\x18ftypmp42' + b'fake-video-' * 20

CONFIG_HTML = ('<!DOCTYPE html><html><head><script>try{window.$CONFIG = '
               + json.dumps({'user': {'id': int(UID), 'screen_name': NICK, 'watermark': {'nick': NICK}}}, ensure_ascii=False)
               + ';}catch(e){window.$CONFIG = {};}</script></head><body></body></html>')

MOBILE_STATUS = {
    'id': MID, 'mid': MID, 'bid': 'OuIv3hbiw', 'created_at': 'Fri Aug 30 23:12:27 +0800 2024',
    'text': '好艰难呐~<br />第二行 <span class="url-icon"><img alt="[老师好]" src="https://face.t.sinajs.cn/x.png" /></span> &amp; 结束',
    'user': {'id': 5266778656, 'screen_name': '雪菜'},
    'reposts_count': 1, 'comments_count': 10, 'attitudes_count': 8, 'pic_num': 1,
    'pics': [{'pid': 'fakepid0', 'url': 'https://wx4.sinaimg.cn/orj360/fakepid0.jpg',
              'large': {'url': 'https://wx4.sinaimg.cn/mw2000/fakepid0.jpg', 'geo': {'width': '1079', 'height': '442'}}}],
}
DETAIL_HTML = ('<html><body><script>\n  var $render_data = [' + json.dumps({'status': MOBILE_STATUS, 'call': 1}, ensure_ascii=False, indent=4)
               + '][0] || {};\n  var __wb_performance_data={v:"v8",m:"mainsite",pwa:1,sw:0};\n  </script></body></html>')

WEB_MBLOG = {
    'idstr': '5079000000000001', 'mid': '5079000000000001', 'mblogid': 'OwfakeBid', 'created_at': 'Sat Sep 26 14:08:46 +0800 2026',
    'text_raw': '测试 & 正文 #雀魂#', 'user': {'id': int(UID), 'idstr': UID, 'screen_name': NICK},
    'reposts_count': 0, 'comments_count': 0, 'attitudes_count': 0, 'visible': {'type': 1, 'list_id': 0},
    'pic_ids': ['fakepid1'], 'pic_num': 1,
    'pic_infos': {'fakepid1': {'pic_id': 'fakepid1', 'largest': {'url': 'https://wx1.sinaimg.cn/large/fakepid1.jpg', 'width': 100, 'height': 80}}},
}

state = {'pic': 0, 'output': 0}


def respond(req):
    url = req['url']
    if url == 'https://weibo.com/':
        return {'status': 200, 'headers': {'content-type': 'text/html; charset=utf-8'}, 'body': CONFIG_HTML}
    if 'm.weibo.cn/detail/' in url:
        return {'status': 200, 'headers': {'content-type': 'text/html; charset=utf-8'}, 'body': DETAIL_HTML}
    if 'profile/info' in url:
        return {'ok': 1, 'data': {'user': {'id': 1669879400, 'idstr': '1669879400', 'screen_name': 'Dear-迪丽热巴',
                                           'description': '简介', 'followers_count': 82549113, 'friends_count': 294,
                                           'statuses_count': 1931, 'status_total_counter': {'like_cnt': '3,226,113,282'}}}}
    if 'statuses/mymblog' in url:
        return {'ok': 1, 'data': {'since_id': '4937540924966431kp2', 'list': [WEB_MBLOG], 'total': 1931}}
    if 'buildComments' in url:
        return {'ok': 1, 'max_id': 138482687134666, 'total_number': 95, 'data': [
            {'id': 5073215159009296, 'idstr': '5073215159009296', 'rootid': 5073215159009296, 'rootidstr': '5073215159009296',
             'created_at': 'Fri Aug 30 23:36:51 +0800 2024', 'text': '都会好哒', 'text_raw': '都会好哒[比耶]',
             'user': {'id': 5658282146, 'screen_name': '米仔'}, 'like_counts': 3, 'total_number': 4}]}
    if 'container/getIndex' in url:
        return {'ok': 1, 'data': {'cardlistInfo': {'page': 2, 'total': 1000}, 'cards': [
            {'card_type': 9, 'mblog': MOBILE_STATUS},
            {'card_type': 11, 'card_group': [{'card_type': 9, 'mblog': dict(MOBILE_STATUS, id='5073209014095009', mid='5073209014095009', bid='OuIv3hbiX')}]}]}}
    if 'fileplatform/init.json' in url:
        return {'upload_id': 'fake-upload-id', 'media_id': MEDIA_ID, 'auth': 'fake-up-auth', 'strategy': {'chunk_size': 10240}}
    if 'picupload.weibo.com' in url:
        state['pic'] += 1
        return {'ret': True, 'pic': {'pid': f'fakepid{state["pic"]}', 'width': 100, 'height': 80}}
    if 'up.video.weibocdn.com' in url:
        return {'result': True}
    if 'fileplatform/check.json' in url:
        return {'result': True, 'media_id': MEDIA_ID}
    if 'multimedia/output' in url:
        state['output'] += 1
        # 第一次还没转完，第二次返回结果：覆盖轮询
        return {'ok': 1, 'data': {}} if state['output'] % 2 == 1 else {'ok': 1, 'data': {MEDIA_ID: {'screenshot': []}}}
    if 'statuses/update' in url:
        return {'ok': 1, 'data': WEB_MBLOG}
    return {'ok': 1, 'data': {}}


def case(name, fn, **input):
    state.update(pic=0, output=0)
    g.case(out, name, fn, input=input, respond=respond)


web = WeiboApis()
mobile = WeiboMobileApis()
cr = creator.weiboCreaterApis

# ---------------------------------------------------------------- WeiboApis（weibo.com，登录态）
case('self_info', lambda: web.get_self_info(COOKIES))
case('user_info', lambda: web.getUserInfo('1669879400', COOKIES), uid='1669879400')
case('user_posted_p1', lambda: web.getUserPosted('1669879400', '1', '', COOKIES), uid='1669879400', page='1')
case('user_posted_p2', lambda: web.getUserPosted('1669879400', '2', '4937540924966431kp2', COOKIES),
     uid='1669879400', page='2', since_id='4937540924966431kp2')
case('comments', lambda: web.getWordComments('5266778656', MID, COOKIES), uid='5266778656', mid=MID)

# ---------------------------------------------------------------- WeiboMobileApis（m.weibo.cn，不带 cookie）
case('mobile_detail', lambda: mobile.getWorkInfo(MID), id=MID)
case('mobile_search', lambda: mobile.searchSome('猫 咪&狗', 1), query='猫 咪&狗', page=1)
case('mobile_search_p2', lambda: mobile.searchSome('猫', 2), query='猫', page=2)

# ---------------------------------------------------------------- WeiboCreaterApis
case('video_init', lambda: cr.video_init(VIDEO, COOKIES), video=VIDEO)
case('upload_image', lambda: cr.upload_image_file(UID, NICK, IMG1, COOKIES), uid=UID, nick=NICK, image=IMG1)
case('upload_video', lambda: cr.upload_video_file('fake-upload-id', MEDIA_ID, VIDEO, 'fake-up-auth', COOKIES), video=VIDEO)
case('video_check', lambda: cr.video_check('fake-upload-id', MEDIA_ID, len(VIDEO), 'fake-up-auth', COOKIES), size=len(VIDEO))
case('video_output', lambda: cr.video_output(MEDIA_ID, COOKIES), media_id=MEDIA_ID)

# ---------------------------------------------------------------- 命令流程：media upload（上游没有这条命令，按 post_weibo 的上传步骤）
# 图片：get_self_info 取 uid / 昵称，再上传
case('media_upload_image', lambda: [web.get_self_info(COOKIES), cr.upload_image_file(UID, NICK, IMG1, COOKIES)], image=IMG1)


def media_upload_video():
    # 视频：init → 整个文件一次上传 → check，不等转码
    init = cr.video_init(VIDEO, COOKIES)
    cr.upload_video_file(init['upload_id'], init['media_id'], VIDEO, init['auth'], COOKIES)
    return cr.video_check(init['upload_id'], init['media_id'], len(VIDEO), init['auth'], COOKIES)


case('media_upload_video', media_upload_video, video=VIDEO)

# ---------------------------------------------------------------- 完整流程：post_weibo（图文 / 视频）
case('post_image', lambda: cr.post_weibo({
    'desc': '测试 & 正文', 'location': '北京', 'type': '1', 'media_type': 'image',
    'topics': ['雀魂', '麻将'], 'images': [IMG1, IMG2]}, COOKIES),
    text='测试 & 正文', poi='北京', visibility='private', topic=['雀魂', '麻将'], images=[IMG1, IMG2])
case('post_video', lambda: cr.post_weibo({
    'desc': '视频正文', 'location': '', 'type': '0', 'media_type': 'video', 'topics': ['南京'], 'video': VIDEO}, COOKIES),
    text='视频正文', visibility='public', topic=['南京'], video=VIDEO)
# 纯文字：图文分支、没有图片（pic_id 为 []）。type 6 朋友圈可见、10 粉丝可见
case('post_text_friends', lambda: cr.post_weibo({
    'desc': '朋友圈可见', 'location': '', 'type': '6', 'media_type': 'image', 'topics': [], 'images': []}, COOKIES),
    text='朋友圈可见', visibility='friends')
case('post_text_fans', lambda: cr.post_weibo({
    'desc': '粉丝可见', 'location': '', 'type': '10', 'media_type': 'image', 'topics': [], 'images': []}, COOKIES),
    text='粉丝可见', visibility='fans')
