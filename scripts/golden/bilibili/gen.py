"""bilibili 的对拍数据：用上游 BilibiliApis 的代码构造请求（只用假凭证），记录请求序列。

运行：.golden/bilibili/Scripts/python scripts/golden/bilibili/gen.py
依赖：uv pip install -r references/BilibiliApis/requirements.txt（极验点选识别要其中的 ddddocr、scipy、numpy、Pillow）
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
case('search_article', logged(lambda a: BiliApi.search_type(a, '专栏 写作', 'pubdate', 2, 'article')), keyword='专栏 写作', order='pubdate', page=2, type='article')
case('video_info_nav', lambda: BiliApi.get_video_info(BiliAuth.from_cookie(COOKIES, fill_device=False), bvid=BVID), bvid=BVID)
case('video_detail', logged(lambda a: BiliApi.get_video_detail(a, bvid=BVID)), bvid=BVID)
case('user_info', logged(lambda a: BiliApi.get_user_info(a, '2')), mid='2')
case('user_videos', logged(lambda a: BiliApi.get_user_videos(a, '2', page=3, order='click')), mid='2', page=3, order='click')
case('user_videos_keyword', logged(lambda a: BiliApi.get_user_videos(a, '2', keyword='教程 入门')), mid='2', keyword='教程 入门')
case('replies_p1', logged(lambda a: BiliApi.get_replies(a, 80433022)), oid=80433022, page=1)
case('replies_p2', logged(lambda a: BiliApi.get_replies(a, 80433022, page=2)), oid=80433022, page=2)
case('replies_article_latest', logged(lambda a: BiliApi.get_replies(a, 12345, type_=12, mode=2)), oid=12345, type=12, mode=2)
case('replies_dynamic_p2', logged(lambda a: BiliApi.get_replies(a, '987654321098765432', type_=17, page=2)), oid='987654321098765432', type=17, page=2)
case('rcmd_feed', logged(lambda a: BiliApi.get_rcmd_feed(a, fresh_idx=2)), fresh_idx=2)
case('rcmd_feed_showlist', logged(lambda a: BiliApi.get_rcmd_feed(a, fresh_idx=3, last_showlist='av_113,av_114')), fresh_idx=3, last_showlist='av_113,av_114')
case('popular', logged(lambda a: BiliApi.get_popular(a, page=3)), page=3)
case('play_url', logged(lambda a: BiliApi.get_play_url(a, BVID, 137649199)), bvid=BVID, cid=137649199)
case('player_info', logged(lambda a: BiliApi.get_player_info(a, 80433022, 137649199)), aid=80433022, cid=137649199)
case('danmaku_seg', logged(lambda a: BiliApi.get_danmaku_seg(a, 80433022, 137649199, 2)), aid=80433022, cid=137649199, segment=2)
case('nav', logged(lambda a: BiliApi.get_nav(a)))

case('like', logged(lambda a: BiliInteractApi.like(a, BVID, True)), bvid=BVID, like=True)
case('unlike', logged(lambda a: BiliInteractApi.like(a, BVID, False)), bvid=BVID, like=False)
case('coin', logged(lambda a: BiliInteractApi.add_coin(a, BVID, 2)), bvid=BVID, num=2)
case('coin_like', logged(lambda a: BiliInteractApi.add_coin(a, BVID, 1, also_like=True)), bvid=BVID, num=1, also_like=True)
case('favour_add', logged(lambda a: BiliInteractApi.favour(a, 80433022, add_media_ids='123')), aid='80433022', add='123')
case('favour_del', logged(lambda a: BiliInteractApi.favour(a, 80433022, del_media_ids='123,456')), aid='80433022', dele='123,456')
case('fav_folders', logged(lambda a: BiliInteractApi.get_fav_folders(a)))
case('triple', logged(lambda a: BiliInteractApi.triple(a, BVID)), bvid=BVID)
case('reply_add', logged(lambda a: BiliInteractApi.add_reply(a, 80433022, '好看！ & ok')), oid='80433022', message='好看！ & ok')
case('reply_add_sub', logged(lambda a: BiliInteractApi.add_reply(a, 80433022, '回复', root=555, parent=555)), oid='80433022', message='回复', root=555)
case('reply_add_nested', logged(lambda a: BiliInteractApi.add_reply(a, 80433022, '楼中楼', root=555, parent=666)), oid='80433022', message='楼中楼', root=555, parent=666)
case('reply_add_article', logged(lambda a: BiliInteractApi.add_reply(a, 12345, '专栏评论', type_=12)), oid='12345', message='专栏评论', type=12)
case('reply_delete', logged(lambda a: BiliInteractApi.delete_reply(a, 80433022, 555)), oid='80433022', rpid='555')
case('reply_delete_dynamic', logged(lambda a: BiliInteractApi.delete_reply(a, '987654321098765432', 777, type_=17)), oid='987654321098765432', rpid='777', type=17)
case('video_danmaku', logged(lambda a: BiliInteractApi.send_danmaku(a, 80433022, 137649199, '弹幕', progress=12500)),
     aid='80433022', cid=137649199, message='弹幕', progress=12500)
# 与上一条共用会话内的 rnd 序号（第 2 条）
case('video_danmaku_style', logged(lambda a: BiliInteractApi.send_danmaku(a, 80433022, 137649199, '顶部红字', progress=1000, color=16711680, fontsize=18, mode=5)),
     aid='80433022', cid=137649199, message='顶部红字', progress=1000, color=16711680, fontsize=18, mode=5)

case('archive_pre', logged(lambda a: BiliCreatorApi.get_archive_pre(a)))
case('my_archives', logged(lambda a: BiliCreatorApi.get_my_archives(a, page=2)), page=2)
case('submit_archive', logged(lambda a: BiliCreatorApi.submit_archive(
    a, [{'filename': 'n230101abc', 'biz_id': 999}], title='标题', tid=17, tag='a,b', cover='https://x/c.jpg', desc='描述', private=False)))
case('submit_archive_repost', logged(lambda a: BiliCreatorApi.submit_archive(
    a, [{'filename': 'n230101abc', 'biz_id': 999}, {'filename': 'n230101def', 'title': 'P2', 'biz_id': 1000}], title='标题', tid=17, tag='a',
    copyright_=2, source='https://example.com/v', private=False, dynamic='同步到动态', no_reprint=0)))
case('delete_archive', logged(lambda a: BiliCreatorApi.delete_archive(a, 80433022)), aid='80433022')
case('delete_archive_validate', logged(lambda a: BiliCreatorApi.delete_archive(a, 80433022, validate='va', challenge='ch')), aid='80433022', validate='va', challenge='ch')
case('remove_dynamic', logged(lambda a: BiliCreatorApi.remove_dynamic(a, '987654321')), id='987654321')
case('post_dynamic', logged(lambda a: BiliCreatorApi.post_dynamic(a, '动态正文')), text='动态正文')
case('article_draft', logged(lambda a: BiliCreatorApi.save_article_draft(a, '专栏', '<p>正文</p>', category=2)), title='专栏', content='<p>正文</p>', category=2)
case('article_submit', logged(lambda a: BiliCreatorApi.submit_article(a, 777, '专栏', '<p>正文</p>', category=2)), aid='777', title='专栏', content='<p>正文</p>', category=2)
case('article_draft_full', logged(lambda a: BiliCreatorApi.save_article_draft(a, '专栏', '<p>正文</p>', category=2, tags='a,b', summary='摘要', aid=777)),
     title='专栏', content='<p>正文</p>', category=2, tags='a,b', summary='摘要', aid='777')
case('article_submit_full', logged(lambda a: BiliCreatorApi.submit_article(a, 777, '专栏', '<p>正文</p>', category=2, tags='a,b', summary='摘要')),
     aid='777', title='专栏', content='<p>正文</p>', category=2, tags='a,b', summary='摘要')
case('article_draft_view', logged(lambda a: BiliCreatorApi.get_article_draft(a, 777)), aid='777')
case('article_draft_delete', logged(lambda a: BiliCreatorApi.delete_article_draft(a, 777)), aid='777')

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
case('live_danmaku_style', logged(lambda a: BiliLiveApi.send_danmaku(a, 21452505, '回复你', color=65280, fontsize=18, mode=4, reply_mid=10003, reply_uname='观众')),
     room=21452505, msg='回复你', color=65280, fontsize=18, mode=4, reply_mid=10003, reply_uname='观众')
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


# ---------------------------------------------------------------- 极验 v3：w 加密、无感通道、点选全链路与识别
#
# 点选识别额外依赖 ddddocr、scipy、numpy、Pillow（上游 requirements.txt 已列出）。
# 题图是用 PIL 现画的合成图（不用真实抓来的图），需要一个中文字体，见 FONTS。
import base64  # noqa: E402
import hashlib  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import tempfile  # noqa: E402

from utils import geetest_w  # noqa: E402

FONTS = ['/System/Library/Fonts/STHeiti Medium.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc',
         'C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf',
         '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc']


def deterministic_rsa(key: str) -> str:
    """cryptography 的 PKCS#1 v1.5 填充用 OpenSSL 的随机数，对拍时换成框架的确定性随机字节，其余不变。

    非零填充字节逐个取（取到 0 就重取），TS 侧 rsaEncryptKey 用 rand.bytes(1) 以同样的顺序取。
    """
    m = key.encode()
    k = (int(geetest_w.RSA_N_HEX, 16).bit_length() + 7) // 8
    ps = bytearray()
    while len(ps) < k - len(m) - 3:
        b = g._urandom(1)[0]
        if b:
            ps.append(b)
    em = int.from_bytes(b'\x00\x02' + bytes(ps) + b'\x00' + m, 'big')
    return pow(em, geetest_w.RSA_E, int(geetest_w.RSA_N_HEX, 16)).to_bytes(k, 'big').hex()


def _check_rsa_padding():
    """同一套填充换一把自己生成的密钥，用 cryptography 的 PKCS1v15 解密，确认填充格式与标准一致。"""
    from cryptography.hazmat.primitives.asymmetric import padding as apad
    from cryptography.hazmat.primitives.asymmetric import rsa
    priv = rsa.generate_private_key(public_exponent=65537, key_size=1024)
    n = priv.public_key().public_numbers().n
    saved = geetest_w.RSA_N_HEX
    geetest_w.RSA_N_HEX = format(n, 'x')
    try:
        c = bytes.fromhex(deterministic_rsa('0123456789abcdef'))
    finally:
        geetest_w.RSA_N_HEX = saved
    assert priv.decrypt(c, apad.PKCS1v15()) == b'0123456789abcdef'


_check_rsa_padding()
geetest_w.rsa_encrypt_key = deterministic_rsa


def synth_sprite(chars, hint, seed, positions) -> bytes:
    """合成一张 344×384 的点选题图：上面 344×344 是彩色背景上带描边、旋转的候选字，底部 40px 是提示条。"""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    font_path = next((f for f in FONTS if os.path.exists(f)), None)
    if not font_path:
        raise SystemExit(f'找不到中文字体，请在 FONTS 里加一个：{FONTS}')
    # 框架替换了 random 模块，画图用 numpy 自己的生成器
    import numpy as np
    gen = np.random.default_rng(seed)
    rng = type('Rng', (), {'randint': staticmethod(lambda a, b: int(gen.integers(a, b + 1)))})
    w, h = 344, 344
    img = Image.new('RGB', (w, h + 40))
    d = ImageDraw.Draw(img)
    c1 = [rng.randint(60, 200) for _ in range(3)]
    c2 = [rng.randint(60, 200) for _ in range(3)]
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(c1, c2)))
    for _ in range(6):
        x, y, r = rng.randint(0, w), rng.randint(0, h), rng.randint(20, 70)
        d.ellipse((x - r, y - r, x + r, y + r), fill=tuple(rng.randint(40, 220) for _ in range(3)))
    img.paste(img.crop((0, 0, w, h)).filter(ImageFilter.GaussianBlur(6)), (0, 0))
    font = ImageFont.truetype(font_path, 46)
    for ch, (x, y, angle) in zip(chars, positions):
        layer = Image.new('RGBA', (80, 80), (0, 0, 0, 0))
        color = tuple(rng.randint(0, 255) for _ in range(3)) + (255,)
        ImageDraw.Draw(layer).text((40, 40), ch, font=font, fill=color, anchor='mm',
                                   stroke_width=3, stroke_fill=(255, 255, 255, 255))
        layer = layer.rotate(angle, resample=Image.BICUBIC)
        img.paste(layer, (x - 40, y - 40), layer)
    d.rectangle((0, h, w, h + 40), fill=(238, 238, 238))
    hint_font = ImageFont.truetype(font_path, 26)
    for i, ch in enumerate(hint):
        d.text((8 + 30 * i, h + 20), ch, font=hint_font, fill=(60, 60, 60), anchor='lm')
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


SPRITES = [
    synth_sprite('金钱豪菇酒', '豪金菇钱', 1, [(70, 80, 12), (250, 70, -15), (170, 170, 8), (80, 260, -6), (260, 250, 18)]),
    synth_sprite('春风明月山', '月山春', 2, [(90, 250, -10), (240, 90, 14), (60, 90, 5), (180, 200, -18), (280, 280, 9)]),
]
GT = '0123456789abcdef0123456789abcdef'
CHALLENGE = 'fedcba9876543210fedcba9876543210'
GT_TOKEN = 'fake-geetest-token-0001'
C = [12, 58, 98, 36, 43, 95, 62, 15, 12]
S = '3f6b2a1c'
PIC1 = '/captcha_v3/batch/v3/0000/2026-09-28T18/word/fakepic0001.jpg'
PIC2 = '/captcha_v3/batch/v3/0000/2026-09-28T18/word/fakepic0002.jpg'
VALIDATE = 'fakevalidate0123456789abcdef0123'
# 上游把题图和会话落在这个目录。要在用例外面建：tempfile 取随机名字会消耗（被框架替换的）随机数
WORKDIR = tempfile.mkdtemp(prefix='catbus-gt-')


def jsonp(data) -> str:
    return f'geetest_{g.NOW_MS}({json.dumps(data, ensure_ascii=False)})'


def geetest_respond(ajax_results):
    """按 URL 回复极验链路；ajax.php 依次回复 ajax_results 里的 data。"""
    ajax = iter(ajax_results)

    def respond_(req):
        url = req['url']
        if 'passport-login/captcha' in url:
            return {'code': 0, 'message': '0', 'data': {'type': 'geetest', 'token': GT_TOKEN, 'geetest': {'gt': GT, 'challenge': CHALLENGE}}}
        if 'gettype.php' in url:
            return jsonp({'status': 'success', 'data': {'type': 'fullpage', 'static_servers': ['static.geetest.com/', 'static.geevisit.com/'],
                                                        'fullpage': '/static/js/fullpage.9.2.0-guwyxh.js', 'click': '/static/js/click.3.1.2.js'}})
        if 'get.php' in url and 'is_next=true' in url:
            return {'headers': {'set-cookie': ['GeeTestUser=fake-user-2; Path=/; Domain=.geetest.com']},
                    'body': jsonp({'status': 'success', 'data': {'pic': PIC1, 'pic_type': 'word', 'c': C, 's': S,
                                                                 'static_servers': ['static.geetest.com/', 'static.geevisit.com/']}})}
        if 'get.php' in url:
            return {'headers': {'set-cookie': ['GeeTestUser=fake-user-1; Path=/; Domain=.geetest.com']},
                    'body': jsonp({'status': 'success', 'data': {'theme': 'wind', 'c': C, 's': S, 'api_server': 'api.geetest.com'}})}
        if 'ajax.php' in url:
            data = next(ajax)
            headers = {'set-cookie': ['GeeTestAjaxUser=fake-ajax-1; Path=/; Domain=.geetest.com']} if data.get('result') == 'click' else {}
            return {'headers': headers, 'body': jsonp({'status': 'success', 'data': data})}
        if 'refresh.php' in url:
            return {'headers': {'set-cookie': ['GeeTestAjaxUser=fake-ajax-2; Path=/; Domain=.geetest.com']},
                    'body': jsonp({'status': 'success', 'data': {'pic': PIC2, 'c': C, 's': S,
                                                                 'image_servers': ['static.geetest.com/', 'static.geevisit.com/']}})}
        if PIC1.split('/')[-1] in url:
            return {'headers': {'content-type': 'image/jpeg'}, 'body': SPRITES[0]}
        if PIC2.split('/')[-1] in url:
            return {'headers': {'content-type': 'image/jpeg'}, 'body': SPRITES[1]}
        return respond(req)
    return respond_


def geetest_w_case():
    """w 的确定性部分：自定义 base64、tt 混淆、三种明文载荷、点击坐标编码、AES+RSA 组装。"""
    payload = geetest_w.build_payload(GT, CHALLENGE, 800, c=C, s=S)
    click = geetest_w.build_click_payload(GT, CHALLENGE, '4913_2297,1977_7558', PIC1, 3615, c=C, s=S)
    key = geetest_w.gen_aes_key()
    return {
        'b64': [geetest_w.custom_b64(bytes(range(n))) for n in (0, 1, 2, 3, 4, 5, 64)],
        'tt': geetest_w.cs_cipher(geetest_w.EMPTY_TRACK, C, S),
        'init_payload': geetest_w.build_init_payload(GT, CHALLENGE),
        'fullpage_payload': payload,
        'click_payload': click,
        'click_payload_no_a': geetest_w.build_click_payload(GT, CHALLENGE, '', PIC1, 0),
        'a': [geetest_w.encode_click_a_from_ratio(r) for r in (
            [(169 / 344, 169 / 344), (68 / 344, 79 / 344)],
            [(0.00005, 0.99995), (0.12345, 0.5)],
            [(1 / 3, 2 / 3), (0, 1)],
        )],
        'key': key,
        'w_rsa': geetest_w.build_w(click, key=key, with_rsa=True),
        'w_plain': geetest_w.build_w(payload, key=key, with_rsa=False),
    }


case('geetest_w', geetest_w_case)


def geetest_fullpage():
    """无感通道：fullpage 判定直接放行，拿到 validate。"""
    from tools.geetest_solve import fetch
    return fetch(WORKDIR, auth=login_auth())


g.case(out, 'geetest_fullpage', geetest_fullpage,
       respond=geetest_respond([{'result': 'success', 'validate': VALIDATE, 'score': '1'}]))


def geetest_click():
    """降级到点选：识别 → 提交（fail）→ refresh.php 换题 → 识别 → 提交（通过）。"""
    from tools.geetest_solve import solve
    return solve(WORKDIR, attempts=4, auth=login_auth())


g.case(out, 'geetest_click', geetest_click,
       respond=geetest_respond([{'result': 'click'}, {'result': 'fail', 'msg': []},
                                {'result': 'success', 'validate': VALIDATE, 'score': '3'}]))


def geetest_vision():
    """点选识别（上游 utils/geetest_hybrid.solve）在合成图上的中间结果，外加几个纯算法的边界用例。"""
    import numpy as np
    from PIL import Image
    from scipy.optimize import linear_sum_assignment
    from utils.geetest_hybrid import solve as hybrid_solve
    from utils.geetest_metric import PAD, _crop, merge_duplicate_boxes
    from utils.geetest_ocr import _split_overlaps, split_sprite
    import ddddocr

    det = ddddocr.DdddOcr(det=True, show_ad=False).detection_engine
    md5 = lambda b: hashlib.md5(b).hexdigest()  # noqa: E731

    def ocr_input(img):
        """ddddocr 识别前的预处理：等比缩放到高 64（LANCZOS）后转灰度。"""
        img = Image.open(io.BytesIO(_png(img)))
        size = (int(img.size[0] * (64 / img.size[1])), 64)
        gray = img.resize(size, Image.LANCZOS).convert('L')
        return {'size': list(gray.size), 'md5': md5(gray.tobytes())}

    sprites = []
    for png in SPRITES:
        sprite = Image.open(io.BytesIO(png))
        r = hybrid_solve(sprite)
        puzzle, hint = split_sprite(sprite)
        det_inputs = []
        for part in (puzzle, hint):
            import cv2
            im = cv2.imdecode(np.frombuffer(_png(part), np.uint8), cv2.IMREAD_COLOR)
            padded, ratio = det.preproc(im, (416, 416))
            # preproc 返回的是 CHW，记成 HWC（贴好灰底、还没转置的样子）
            det_inputs.append({'ratio': ratio, 'md5': md5(np.ascontiguousarray(padded.transpose(1, 2, 0)).astype(np.uint8).tobytes())})
        sprites.append({
            'image': base64.b64encode(png).decode(),
            'det_inputs': det_inputs,
            'raw_puzzle_boxes': r['raw_puzzle_boxes'],
            'puzzle_boxes': r['puzzle_boxes'],
            'hint_boxes': r['hint_boxes'],
            'hint_inputs': [ocr_input(_crop(hint, b, 2)) for b in r['hint_boxes']],
            'puzzle_inputs': [ocr_input(_crop(puzzle, b, PAD)) for b in r['puzzle_boxes']],
            'hint_text': r['hint_text'],
            'cand_chars': r['cand_chars'],
            'score_matrix': r['score_matrix'],
            'match': r['match'],
            'order': r['order'],
            'ordered_chars': r['ordered_chars'],
            'warnings': r['warnings'],
            'a': geetest_w.encode_click_a_from_ratio([(x / r['puzzle_size'][0], y / r['puzzle_size'][1]) for x, y in r['order']]),
        })

    boxes = [[10, 10, 60, 60], [12, 8, 58, 62], [100, 10, 150, 60], [55, 50, 90, 90], [200, 0, 240, 30], [230, 5, 280, 40]]
    matrices = [
        [[1, 2, 3], [2, 4, 6], [3, 6, 9]],
        [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]],
        [[4, 1, 3], [2, 0, 5], [3, 2, 2], [1, 1, 1]],
        [[-0.9, -0.1, -0.2, -0.8], [-0.1, -0.95, -0.3, -0.1], [-0.2, -0.2, -0.2, -0.7]],
        [[0.0, 0.0], [0.0, 0.0]],
    ]
    return {
        'sprites': sprites,
        'merge': [merge_duplicate_boxes(boxes), merge_duplicate_boxes(boxes, threshold=0.75)],
        'split': _split_overlaps([[5, 3, 36, 33], [33, 4, 63, 32], [60, 3, 94, 34], [94, 3, 124, 32]]),
        'lsa': [[x.tolist() for x in linear_sum_assignment(np.asarray(m, dtype=np.float32))] for m in matrices],
        'lsa_input': matrices,
    }


def _png(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


case('geetest_vision', geetest_vision)
