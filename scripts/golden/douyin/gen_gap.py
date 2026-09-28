"""douyin 对拍数据的第三部分：补齐上游已有、第一轮没移植的能力。由 gen.py 在末尾 exec，共用 gen.py / gen_more.py 的全局变量。

搜索筛选与视频频道、直播千票榜、商品评价的标签、通知分组。
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

# ================================================================ 直播：千票榜
case('live_rank_thousand', logged(lambda a: DouyinAPI.get_live_thousand_ticket_rank(a, ROOM_ID, web_rid=WEB_RID)),
     room_id=ROOM_ID, web_rid=WEB_RID)

# ================================================================ 商品评价：分类计数与按标签筛选
case('product_comment_counter', logged(lambda a: DouyinAPI.get_product_comment_counter(a, '3622058069401408999', 'fakeShop01')))
case('product_comments_tag', logged(lambda a: DouyinAPI.get_product_comments(a, '3622058069401408999', 'fakeShop01', '0', tag_id='7')))

# ================================================================ 通知分组
case('notices_group', logged(lambda a: DouyinAPI.get_notice_list(a, '0', '0', notice_group='401')))
