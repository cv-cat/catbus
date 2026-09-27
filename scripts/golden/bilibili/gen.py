"""bilibili 的对拍数据：用上游 BilibiliApis 的代码构造请求（只用假凭证），记录请求序列。

运行：.golden/bilibili/Scripts/python scripts/golden/bilibili/gen.py
依赖：uv pip install curl_cffi cryptography qrcode brotli websocket-client
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catbus_golden as g  # noqa: E402

out = g.setup('bilibili', 'BilibiliApis')

from apis.bili_apis import BiliApi  # noqa: E402
from apis.bili_creator_apis import BiliCreatorApi  # noqa: E402
from apis.bili_interact_apis import BiliInteractApi  # noqa: E402
from apis.bili_live_apis import BiliLiveApi  # noqa: E402
from apis.bili_login_apis import BiliLoginApi  # noqa: E402
from builder.auth import BiliAuth  # noqa: E402

# 只有假值
COOKIES = ('buvid3=FAKE-BUVID3-0000infoc; b_nut=1789990000; _uuid=FAKE-UUID-0000infoc; buvid4=FAKE-BUVID4-0000; '
           'buvid_fp=0123456789abcdef0123456789abcdef; SESSDATA=fake-sessdata; bili_jct=fakecsrf0123456789abcdef01234567; '
           'DedeUserID=10001; DedeUserID__ckMd5=fakeckmd5; bili_ticket=fake.ticket; bili_ticket_expires=1790259200; rpdid=fake|rpdid')
MIXIN = 'ea1db124af3c7062474693fa704f4ff8'
IMG = 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png'
SUB = 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'
BVID = 'BV1GJ411x7h7'

VIEW = {'code': 0, 'message': '0', 'data': {
    'bvid': BVID, 'aid': 80433022, 'cid': 137649199, 'title': '测试视频', 'desc': '简介', 'pic': 'http://i0.hdslb.com/x.jpg',
    'pubdate': 1577835803, 'duration': 213, 'owner': {'mid': 10001, 'name': 'UP'},
    'stat': {'view': 1000, 'danmaku': 3, 'reply': 5, 'favorite': 7, 'coin': 9, 'share': 11, 'like': 13},
    'pages': [{'cid': 137649199, 'page': 1, 'duration': 213}]}}


def respond(req):
    url = req['url']
    if 'finger/spi' in url:
        return {'code': 0, 'data': {'b_3': 'FAKE-SPI-B3infoc', 'b_4': 'FAKE-SPI-B4'}}
    if 'GenWebTicket' in url:
        return {'code': 0, 'data': {'ticket': 'fake.guest.ticket', 'created_at': 1790000000, 'ttl': 259200,
                                     'nav': {'img': IMG, 'sub': SUB}}}
    if 'web-interface/nav' in url:
        return {'code': 0, 'data': {'isLogin': True, 'mid': 10001, 'uname': '测试', 'wbi_img': {'img_url': IMG, 'sub_url': SUB}}}
    if 'wbi/view' in url:
        return VIEW
    if 'room_init' in url:
        return {'code': 0, 'data': {'room_id': 21452505, 'uid': 10002, 'live_status': 1}}
    return {'code': 0, 'message': '0', 'data': {}}


def login_auth():
    auth = BiliAuth.from_cookie(COOKIES, fill_device=False)
    auth._mixin_key = MIXIN
    auth._mixin_ts = g.NOW_MS / 1000
    return auth


def case(name, fn, **input):
    g.case(out, name, fn, input=input, respond=respond)


# ---------------------------------------------------------------- 游客：匿名设备初始化 + 稿件详情
def guest_item_get():
    auth = BiliAuth.anonymous()
    return BiliApi.get_video_info(auth, bvid=BVID)


case('guest_item_get', guest_item_get, bvid=BVID)


# ---------------------------------------------------------------- 登录态下的各接口
def logged(fn):
    return lambda: fn(login_auth())


case('search_video', logged(lambda a: BiliApi.search_type(a, '编程 入门', 'click', 2, 'video')), keyword='编程 入门', order='click', page=2, type='video')
case('search_user', logged(lambda a: BiliApi.search_type(a, 'bilibili', 'totalrank', 1, 'bili_user')), keyword='bilibili', type='bili_user')
case('video_info_nav', lambda: BiliApi.get_video_info(BiliAuth.from_cookie(COOKIES, fill_device=False), bvid=BVID), bvid=BVID)
case('user_info', logged(lambda a: BiliApi.get_user_info(a, '2')), mid='2')
case('user_videos', logged(lambda a: BiliApi.get_user_videos(a, '2', page=3, order='click')), mid='2', page=3, order='click')
case('replies_p1', logged(lambda a: BiliApi.get_replies(a, 80433022)), oid=80433022, page=1)
case('replies_p2', logged(lambda a: BiliApi.get_replies(a, 80433022, page=2)), oid=80433022, page=2)
case('rcmd_feed', logged(lambda a: BiliApi.get_rcmd_feed(a, fresh_idx=2)), fresh_idx=2)
case('popular', logged(lambda a: BiliApi.get_popular(a, page=3)), page=3)
case('play_url', logged(lambda a: BiliApi.get_play_url(a, BVID, 137649199)), bvid=BVID, cid=137649199)
case('player_info', logged(lambda a: BiliApi.get_player_info(a, 80433022, 137649199)), aid=80433022, cid=137649199)
case('danmaku_seg', logged(lambda a: BiliApi.get_danmaku_seg(a, 80433022, 137649199, 2)), aid=80433022, cid=137649199, segment=2)
case('nav', logged(lambda a: BiliApi.get_nav(a)))

case('like', logged(lambda a: BiliInteractApi.like(a, BVID, True)), bvid=BVID, like=True)
case('unlike', logged(lambda a: BiliInteractApi.like(a, BVID, False)), bvid=BVID, like=False)
case('coin', logged(lambda a: BiliInteractApi.add_coin(a, BVID, 2)), bvid=BVID, num=2)
case('favour_add', logged(lambda a: BiliInteractApi.favour(a, 80433022, add_media_ids='123')), aid='80433022', add='123')
case('favour_del', logged(lambda a: BiliInteractApi.favour(a, 80433022, del_media_ids='123,456')), aid='80433022', dele='123,456')
case('fav_folders', logged(lambda a: BiliInteractApi.get_fav_folders(a)))
case('triple', logged(lambda a: BiliInteractApi.triple(a, BVID)), bvid=BVID)
case('reply_add', logged(lambda a: BiliInteractApi.add_reply(a, 80433022, '好看！ & ok')), oid='80433022', message='好看！ & ok')
case('reply_add_sub', logged(lambda a: BiliInteractApi.add_reply(a, 80433022, '回复', root=555, parent=555)), oid='80433022', message='回复', root=555)
case('reply_delete', logged(lambda a: BiliInteractApi.delete_reply(a, 80433022, 555)), oid='80433022', rpid='555')
case('video_danmaku', logged(lambda a: BiliInteractApi.send_danmaku(a, 80433022, 137649199, '弹幕', progress=12500)),
     aid='80433022', cid=137649199, message='弹幕', progress=12500)

case('archive_pre', logged(lambda a: BiliCreatorApi.get_archive_pre(a)))
case('my_archives', logged(lambda a: BiliCreatorApi.get_my_archives(a, page=2)), page=2)
case('submit_archive', logged(lambda a: BiliCreatorApi.submit_archive(
    a, [{'filename': 'n230101abc', 'biz_id': 999}], title='标题', tid=17, tag='a,b', cover='https://x/c.jpg', desc='描述', private=False)))
case('delete_archive', logged(lambda a: BiliCreatorApi.delete_archive(a, 80433022)), aid='80433022')
case('remove_dynamic', logged(lambda a: BiliCreatorApi.remove_dynamic(a, '987654321')), id='987654321')
case('post_dynamic', logged(lambda a: BiliCreatorApi.post_dynamic(a, '动态正文')), text='动态正文')
case('article_draft', logged(lambda a: BiliCreatorApi.save_article_draft(a, '专栏', '<p>正文</p>', category=2)), title='专栏', content='<p>正文</p>', category=2)
case('article_submit', logged(lambda a: BiliCreatorApi.submit_article(a, 777, '专栏', '<p>正文</p>', category=2)), aid='777', title='专栏', content='<p>正文</p>', category=2)

case('room_init', logged(lambda a: BiliLiveApi.get_room_init(a, 6)), room='6')
case('room_by_mid', logged(lambda a: BiliLiveApi.get_room_by_mid(a, 10001)), mid='10001')
case('room_info', logged(lambda a: BiliLiveApi.get_room_info(a, 21452505)), room=21452505)
case('room_play_info', logged(lambda a: BiliLiveApi.get_room_play_info(a, 21452505)), room=21452505)
case('danmu_info', logged(lambda a: BiliLiveApi.get_danmu_info(a, 21452505)), room=21452505)
case('danmaku_history', logged(lambda a: BiliLiveApi.get_danmaku_history(a, 21452505)), room=21452505)
case('gift_list', logged(lambda a: BiliLiveApi.get_gift_list(a, 21452505, 2, 86, 10002)), room=21452505, parent=2, area=86, ruid=10002)
case('area_list', logged(lambda a: BiliLiveApi.get_area_list(a)))
case('bag_list', logged(lambda a: BiliLiveApi.get_bag_list(a, 21452505)), room=21452505)
case('send_gift_gold', logged(lambda a: BiliLiveApi.send_gift(a, 21452505, 10002, 31036, gift_num=2, coin_type='gold', price=100)),
     room=21452505, ruid=10002, gift=31036, num=2, coin='gold', price=100)
case('send_gift_bag', logged(lambda a: BiliLiveApi.send_gift(a, 21452505, 10002, 1, gift_num=1, bag_id=555)),
     room=21452505, ruid=10002, gift=1, num=1, bag=555)
case('live_danmaku', logged(lambda a: BiliLiveApi.send_danmaku(a, 21452505, '直播弹幕')), room=21452505, msg='直播弹幕')
case('start_live', logged(lambda a: BiliLiveApi.start_live(a, 21452505, 86)), room=21452505, area=86)
case('stop_live', logged(lambda a: BiliLiveApi.stop_live(a, 21452505)), room=21452505)

case('qrcode_generate', logged(lambda a: BiliLoginApi.qrcode_generate(a)))
case('qrcode_poll', logged(lambda a: BiliLoginApi.qrcode_poll(a, 'fakeqrkey')[0]), key='fakeqrkey')
case('captcha', logged(lambda a: BiliLoginApi.get_captcha(a)))
case('sms_send', logged(lambda a: BiliLoginApi.sms_send(a, '13800000000', {'token': 'tk', 'challenge': 'ch', 'validate': 'va'})),
     tel='13800000000', token='tk', challenge='ch', validate='va')
case('login_key', logged(lambda a: BiliLoginApi.get_login_key(a)))
case('cookie_info', logged(lambda a: BiliLoginApi.cookie_info(a)))
case('confirm_refresh', logged(lambda a: BiliLoginApi.confirm_refresh(a, 'old-refresh-token')), old='old-refresh-token')
case('logout', logged(lambda a: BiliLoginApi.logout(a)))
