"""x 的对拍数据：用上游 XApis 的代码构造请求（只用假凭证），记录请求序列。

运行：.golden/x/Scripts/python scripts/golden/x/gen.py
依赖：uv pip install curl_cffi requests

两处在这里补丁，不改框架：
- XCTID 素材固定用上游的 static/transaction_l1.json（ClientTransaction.from_cached），
  不走 from_network（它会去抓 /i/flow/login，对拍时不能发网络）；catbus 也只用这份缓存。
- 游客读接口带 x-guest-token：上游 graphql_get 不带，catbus 按浏览器未登录时的做法带上
  （XAuth.guest_token 惰性换取，并写入 gt cookie，都是上游已有的逻辑）。
"""

import base64
import hashlib
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catbus_golden as g  # noqa: E402

out = g.setup('x', 'XApis')

import builder.header as header_mod  # noqa: E402
from builder.auth import XAuth  # noqa: E402
from utils.transaction import ClientTransaction  # noqa: E402
from utils.article_util import markdown_to_content_state, split_title  # noqa: E402
from utils.x_util import tweet_weight  # noqa: E402
from x_apis.x_api import XAPI, graphql_get  # noqa: E402
from x_apis.x_article_api import XArticleAPI  # noqa: E402
from x_apis.x_dm_api import XChatAPI  # noqa: E402
from x_apis.x_media_api import XMediaAPI  # noqa: E402
from x_apis.x_write_api import XWriteAPI  # noqa: E402

_with_auth_type = header_mod.Header.with_auth_type


def _with_auth_type_and_guest(self, auth):
    _with_auth_type(self, auth)
    if not auth.is_logged_in and self._order is header_mod._GRAPHQL_ORDER:
        self.with_guest(auth)
    return self


header_mod.Header.with_auth_type = _with_auth_type_and_guest

# 只有假值
COOKIES = 'auth_token=fakeauthtoken000000000000000000000000000000; ct0=fakect0000000000000000000000000000000000000000; twid=u%3D10001; lang=en'
TWEET_ID = '1585341984679469056'
USER_ID = '44196397'
GUEST_TOKEN = '1790000000000000001'
MEDIA_ID = '1790000000000000100'
ARTICLE_ID = '1790000000000000200'
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489') + b'\x00fake-png\xff'
MP4 = b'\x00\x00\x00\x18ftypmp42' + b'fake-video-' * 8
# 权重 > 280 的正文：141 个汉字（每个算 2），网页端会按 Premium 长推（CreateNoteTweet）发
LONG_TEXT = '长' * 131 + ' https://example.com/a-very-long-url-that-counts-as-23 ' + '文' * 10

USER = {
    '__typename': 'User', 'rest_id': USER_ID,
    'core': {'created_at': 'Tue Jun 02 20:12:29 +0000 2009', 'name': 'Elon Musk', 'screen_name': 'elonmusk'},
    'avatar': {'image_url': 'https://pbs.twimg.com/profile_images/1/fake_normal.jpg'},
    'profile_bio': {'description': '简介 & bio'},
    'relationship_counts': {'followers': 241701251, 'following': 1412},
    'tweet_counts': {'media_tweets': 4724, 'tweets': 109119},
    'action_counts': {'favorites_count': 249608},
}
ME = {'__typename': 'User', 'rest_id': '10001', 'core': {'name': '测试账号', 'screen_name': 'catbus_test'}}
PEER = {'__typename': 'User', 'rest_id': '20002', 'core': {'name': 'Peer', 'screen_name': 'peer_user'}}
PHOTO = {'type': 'photo', 'id_str': '900', 'media_url_https': 'https://pbs.twimg.com/media/fake.jpg', 'original_info': {'width': 1200, 'height': 800}}
VIDEO = {
    'type': 'video', 'id_str': '901', 'media_url_https': 'https://pbs.twimg.com/ext_tw_video_thumb/901/pu/img/thumb.jpg',
    'original_info': {'width': 1920, 'height': 1080},
    'video_info': {'duration_millis': 9301, 'variants': [
        {'content_type': 'application/x-mpegURL', 'url': 'https://video.twimg.com/ext_tw_video/901/pu/pl/x.m3u8'},
        {'bitrate': 256000, 'content_type': 'video/mp4', 'url': 'https://video.twimg.com/ext_tw_video/901/pu/vid/480x270/low.mp4'},
        {'bitrate': 2176000, 'content_type': 'video/mp4', 'url': 'https://video.twimg.com/ext_tw_video/901/pu/vid/1280x720/high.mp4'},
    ]},
}


def tweet(tid, text, user=USER, media=None, reply_to=None, views='12345'):
    legacy = {
        'id_str': tid, 'full_text': text, 'created_at': 'Wed Oct 26 18:45:58 +0000 2022', 'lang': 'zh',
        'favorite_count': 11, 'reply_count': 22, 'bookmark_count': 33, 'retweet_count': 44, 'quote_count': 55,
        'user_id_str': user['rest_id'],
    }
    if reply_to:
        legacy['in_reply_to_status_id_str'] = reply_to
    if media:
        legacy['entities'] = {'media': media[:1]}
        legacy['extended_entities'] = {'media': media}
    return {'__typename': 'Tweet', 'rest_id': tid, 'core': {'user_results': {'result': user}},
            'views': {'count': views, 'state': 'EnabledWithCount'}, 'legacy': legacy}


def tweet_entry(tid, result):
    return {'entryId': f'tweet-{tid}', 'sortIndex': tid, 'content': {
        'entryType': 'TimelineTimelineItem', '__typename': 'TimelineTimelineItem',
        'itemContent': {'itemType': 'TimelineTweet', '__typename': 'TimelineTweet', 'tweet_results': {'result': result}}}}


def cursor_entry(kind, value):
    return {'entryId': f'cursor-{kind.lower()}-{value}', 'sortIndex': '0', 'content': {
        'entryType': 'TimelineTimelineCursor', '__typename': 'TimelineTimelineCursor', 'value': value, 'cursorType': kind}}


# 用户主页时间线：置顶 + 一条带图 + 一条带视频（包在 TweetWithVisibilityResults 里）+ 广告 + 游标
USER_TIMELINE = {'data': {'user': {'result': {'__typename': 'User', 'timeline': {'timeline': {'instructions': [
    {'type': 'TimelineClearCache'},
    {'type': 'TimelinePinEntry', 'entry': tweet_entry('1001', tweet('1001', '置顶推文'))},
    {'type': 'TimelineAddEntries', 'entries': [
        tweet_entry('1002', tweet('1002', '带图 https://t.co/x', media=[PHOTO])),
        tweet_entry('1003', {'__typename': 'TweetWithVisibilityResults', 'tweet': tweet('1003', '带视频', media=[VIDEO])}),
        {'entryId': 'promoted-tweet-1004', 'sortIndex': '1', 'content': {'itemContent': {'tweet_results': {'result': tweet('1004', '广告')}}}},
        cursor_entry('Top', 'CURSOR_TOP'),
        cursor_entry('Bottom', 'CURSOR_NEXT'),
    ]},
]}}}}}}

# 推文详情：焦点推文 + 一个对话串（直接回复 + 楼中楼 + 展开更多）+ 底部游标
DETAIL = {'data': {'threaded_conversation_with_injections_v2': {'instructions': [{'type': 'TimelineAddEntries', 'entries': [
    tweet_entry(TWEET_ID, tweet(TWEET_ID, '焦点推文', media=[VIDEO])),
    {'entryId': 'conversationthread-2001', 'sortIndex': '2', 'content': {
        'entryType': 'TimelineTimelineModule', '__typename': 'TimelineTimelineModule', 'items': [
            {'entryId': 'conversationthread-2001-tweet-2001', 'item': {'itemContent': {
                'itemType': 'TimelineTweet', 'tweet_results': {'result': tweet('2001', '@elonmusk 第一条回复', user=PEER, reply_to=TWEET_ID)}}}},
            {'entryId': 'conversationthread-2001-tweet-2002', 'item': {'itemContent': {
                'itemType': 'TimelineTweet', 'tweet_results': {'result': tweet('2002', '@peer_user 楼中楼', reply_to='2001')}}}},
            {'entryId': 'conversationthread-2001-cursor-showmore-1', 'item': {'itemContent': {
                'itemType': 'TimelineTimelineCursor', 'value': 'SHOWMORE', 'cursorType': 'ShowMore'}}},
        ]}},
    cursor_entry('Bottom', 'DETAIL_NEXT'),
]}]}}}



def article_payload(key, **extra):
    """ArticleEntity* 的响应：实体里带 rest_id 和 relay 全局 id（base64("ArticleEntity:<rest_id>")）。"""
    entity = {'rest_id': ARTICLE_ID, 'id': base64.b64encode(f'ArticleEntity:{ARTICLE_ID}'.encode()).decode(), **extra}
    return {'data': {key: entity}}


state = {'status': 0}


def respond(req):
    url = req['url']
    if 'guest/activate' in url:
        return {'guest_token': GUEST_TOKEN}
    if 'upload.x.com' in url:
        if 'command=INIT' in url:
            return {'media_id': int(MEDIA_ID), 'media_id_string': MEDIA_ID, 'expires_after_secs': 86399}
        if 'command=APPEND' in url:
            # 线上是 204；测试侧的 Response 不能构造带 body 的 204，这里用 200 空 body
            return {'status': 200, 'body': ''}
        if 'command=FINALIZE' in url:
            if 'video' in state.get('kind', ''):
                return {'media_id_string': MEDIA_ID, 'size': len(MP4), 'processing_info': {'state': 'pending', 'check_after_secs': 1}}
            return {'media_id_string': MEDIA_ID, 'size': len(PNG), 'image': {'image_type': 'image/png', 'w': 1, 'h': 1}}
        if 'command=STATUS' in url:
            state['status'] += 1
            done = state['status'] >= 2
            return {'media_id_string': MEDIA_ID, 'processing_info': {'state': 'succeeded' if done else 'in_progress', 'check_after_secs': 2, 'progress_percent': 100 if done else 40},
                    'video': {'video_type': 'video/mp4'}}
    if 'media/metadata/create' in url:
        return {'status': 200, 'body': ''}
    if '/UserByScreenName' in url or '/UserByRestId' in url:
        return {'data': {'user': {'result': USER}}}
    if '/TweetResultByRestId' in url:
        return {'data': {'tweetResult': {'result': tweet(TWEET_ID, '视频推文 https://t.co/v', media=[VIDEO])}}}
    if '/TweetDetail' in url:
        return DETAIL
    if '/UserTweets' in url or '/UserOriginalsTimeline' in url:
        return USER_TIMELINE
    if '/Viewer' in url:
        return {'data': {'viewer': {'user_results': {'result': ME}}}}
    if '/CreateTweet' in url or '/CreateNoteTweet' in url:
        # 每次发推给一个新 id（3001、3002……），thread 里后一条回复前一条
        state['tweets'] = state.get('tweets', 0) + 1
        tid = str(3000 + state['tweets'])
        media = [PHOTO] if 'media_entities":[{' in (req['body'] or '') else None
        created = tweet(tid, 'hello', user=ME, media=media, views=None)
        if '/CreateNoteTweet' in url:
            created['note_tweet'] = {'is_expandable': True, 'note_tweet_results': {'result': {'id': 'Tm90ZVR3ZWV0OjE=', 'text': LONG_TEXT}}}
            return {'data': {'notetweet_create': {'tweet_results': {'result': created}}}}
        return {'data': {'create_tweet': {'tweet_results': {'result': created}}}}
    if '/ArticleEntityDraftCreate' in url:
        return {'data': {'articleentity_draft_create': {'article_entity_results': {'result': article_payload('x')['data']['x']}}}}
    if '/ArticleEntityUpdateTitle' in url:
        return article_payload('articleentity_update_title', title='文章标题')
    if '/ArticleEntityUpdateContent' in url:
        return article_payload('articleentity_update_content')
    if '/ArticleEntityUpdateCoverMedia' in url:
        return article_payload('articleentity_update_cover_media')
    if '/ArticleEntityPublish' in url:
        return {'data': {'articleentity_publish': {'article_entity_results': {'result': {
            'rest_id': ARTICLE_ID, 'lifecycle_state': {'lifecycle': 'Published'},
            'metadata': {'tweet_results': {'result': {'rest_id': '4001'}}}}}}}}
    if '/ArticleEntityDelete' in url:
        return {'data': {'articleentity_delete': 'Done'}}
    if '/GetInitialXChatPageQuery' in url:
        return {'data': {'get_initial_chat_page': {'__typename': 'XChatInboxPage', 'items': [
            {'conversation_detail': {'conversation_id': '10001:20002', 'participants_results': [
                {'rest_id': '10001', 'result': ME}, {'rest_id': '20002', 'result': PEER}]},
             'latest_message_events': ['CAESBGZha2U=']},
            {'conversation_detail': {'conversation_id': 'g1790000000', 'participants_results': [
                {'rest_id': '10001', 'result': ME}, {'rest_id': '20002', 'result': PEER}],
                'group_metadata': {'group_name': '群聊', 'updated_at_msec': '1790000000123'}}},
        ]}}}
    if '/GetConversationPageQuery' in url:
        return {'data': {'get_conversation_page': {'encoded_message_events': ['CAESBGZha2U=', 'CAISBGZha2U='], 'has_more': False}}}
    return {'data': {}}


def logged():
    auth = XAuth().prepare_auth(COOKIES)
    auth._transaction = ClientTransaction.from_cached()
    return auth


def guest():
    auth = XAuth().prepare_auth('')
    auth._transaction = ClientTransaction.from_cached()
    return auth


def case(name, fn, **input):
    state.clear()
    state['status'] = 0
    state['kind'] = name
    g.case(out, name, fn, input=input, respond=respond)


def L(fn):
    return lambda: fn(logged())


tmp = Path(tempfile.mkdtemp(prefix='catbus-x-'))
(tmp / 'photo.png').write_bytes(PNG)
(tmp / 'clip.mp4').write_bytes(MP4)
b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731

# ---------------------------------------------------------------- XCTID 纯算（固定时间与随机字节）
case('xctid', lambda: [ClientTransaction.from_cached().generate('GET', '/i/api/graphql/KybxDj9RrADIITXlGG8kpw/UserByScreenName', time_now=t, random_byte=b)
                       for t, b in ((107075600, 0), (107075600, 58), (1, 255))])

# ---------------------------------------------------------------- 游客
case('guest_activate', lambda: XAuth().refresh_guest_token())
case('guest_user_get', lambda: XAPI.get_user_info(guest(), 'elonmusk'), user='elonmusk')
case('guest_item_get', lambda: XAPI.get_work_result(guest(), f'https://x.com/elonmusk/status/{TWEET_ID}'), item=f'https://x.com/elonmusk/status/{TWEET_ID}')


def guest_user_items():
    auth = guest()
    uid = XAPI.get_user_id(auth, '@ElonMusk')
    return XAPI.get_user_post_note(auth, uid, operation='UserTweets')


case('guest_user_items', guest_user_items, user='@ElonMusk')

# ---------------------------------------------------------------- 读接口
case('tweet_detail', L(lambda a: XAPI.get_work_comments(a, TWEET_ID)), item=TWEET_ID)
case('tweet_detail_cursor', L(lambda a: XAPI.get_work_info(a, f'https://twitter.com/elonmusk/status/{TWEET_ID}?s=20', cursor='DETAIL_NEXT')),
     item=TWEET_ID, cursor='DETAIL_NEXT')
case('tweet_detail_referrer', L(lambda a: XAPI.get_work_info(a, TWEET_ID, referrer='home')), item=TWEET_ID, referrer='home')
case('tweet_result', L(lambda a: XAPI.get_work_result(a, TWEET_ID)), item=TWEET_ID)
case('search_top', L(lambda a: XAPI.search_work(a, '猫 & dog #tag')), q='猫 & dog #tag')
case('search_latest_cursor', L(lambda a: XAPI.search_work(a, 'python', cursor='SEARCH_NEXT', product='Latest')), q='python', cursor='SEARCH_NEXT')
case('search_people', L(lambda a: XAPI.search_work(a, 'elon', product='People')), q='elon')
case('user_info', L(lambda a: XAPI.get_user_info(a, 'https://x.com/ElonMusk')), user='https://x.com/ElonMusk')
case('user_by_id', L(lambda a: graphql_get(a, 'UserByRestId', {'userId': USER_ID, 'withGrokTranslatedBio': True},
                                           referer=f'https://x.com/i/user/{USER_ID}')), user=USER_ID)
case('user_originals', L(lambda a: XAPI.get_user_post_note(a, USER_ID)), user=USER_ID)
case('user_originals_cursor', L(lambda a: XAPI.get_user_post_note(a, USER_ID, cursor='CURSOR_NEXT')), user=USER_ID, cursor='CURSOR_NEXT')
case('user_tweets', L(lambda a: XAPI.get_user_post_note(a, USER_ID, operation='UserTweets')), user=USER_ID)
case('home', L(lambda a: XAPI.get_home_timeline(a)))
case('home_cursor', L(lambda a: XAPI.get_home_timeline(a, cursor='HOME_NEXT')), cursor='HOME_NEXT')
case('home_seen', L(lambda a: XAPI.get_home_timeline(a, seen_tweet_ids=['1001', '1002'])), seen=['1001', '1002'])
case('viewer', L(lambda a: XAPI.get_viewer(a)))

# ---------------------------------------------------------------- 写接口
case('create_tweet', L(lambda a: XWriteAPI.create_tweet(a, '你好 "x" & <b>\n第二行')), text='你好 "x" & <b>\n第二行')
case('create_tweet_reply', L(lambda a: XWriteAPI.create_tweet(a, 'reply', reply_to='https://x.com/a/status/20')), text='reply', reply_to='20')
case('create_tweet_media', L(lambda a: XWriteAPI.create_tweet(a, 'pics', media_ids=['111', '222'], quote_url='https://x.com/a/status/20')),
     text='pics', media=['111', '222'], quote='https://x.com/a/status/20')
case('delete_tweet', L(lambda a: XWriteAPI.delete_tweet(a, TWEET_ID)), item=TWEET_ID)
case('favorite', L(lambda a: XWriteAPI.favorite_tweet(a, TWEET_ID)), item=TWEET_ID)
case('unfavorite', L(lambda a: XWriteAPI.unfavorite_tweet(a, TWEET_ID)), item=TWEET_ID)
case('retweet', L(lambda a: XWriteAPI.create_retweet(a, TWEET_ID)), item=TWEET_ID)
case('unretweet', L(lambda a: XWriteAPI.delete_retweet(a, TWEET_ID)), item=TWEET_ID)
case('bookmark', L(lambda a: XWriteAPI.create_bookmark(a, TWEET_ID)), item=TWEET_ID)
case('unbookmark', L(lambda a: XWriteAPI.delete_bookmark(a, TWEET_ID)), item=TWEET_ID)
case('follow', L(lambda a: XWriteAPI.follow_user(a, USER_ID)), user=USER_ID)
case('unfollow', L(lambda a: XWriteAPI.unfollow_user(a, USER_ID)), user=USER_ID)

# ---------------------------------------------------------------- 媒体上传
case('media_init', L(lambda a: XMediaAPI.init(a, 3, 'image/jpeg')), size=3, type='image/jpeg')
case('media_init_video', L(lambda a: XMediaAPI.init(a, 1000, 'video/mp4')), size=1000, type='video/mp4')
case('media_append', L(lambda a: XMediaAPI.append(a, MEDIA_ID, b'abc', 0) and None), media=MEDIA_ID, chunk='abc', index=0)
case('media_finalize', L(lambda a: XMediaAPI.finalize(a, MEDIA_ID, original_md5=hashlib.md5(b'abc').hexdigest())), media=MEDIA_ID)
case('media_status', L(lambda a: XMediaAPI.status(a, MEDIA_ID)), media=MEDIA_ID)
case('media_meta', L(lambda a: XMediaAPI.metadata_create(a, MEDIA_ID) and None), media=MEDIA_ID)
case('media_upload_image', L(lambda a: XMediaAPI.upload(a, str(tmp / 'photo.png'))), filename='photo.png', data=b64(PNG))
case('media_upload_video', L(lambda a: XMediaAPI.upload(a, str(tmp / 'clip.mp4'))), filename='clip.mp4', data=b64(MP4))

# ---------------------------------------------------------------- 私信（X Chat）
case('chat_initial', L(lambda a: XChatAPI.get_initial_chat_page(a)))
case('chat_conversation', L(lambda a: XChatAPI.get_conversation_page(a, '10001:20002')), conversation='10001:20002')

# ---------------------------------------------------------------- 命令流程：发推 = 传图 + CreateTweet
case('post_tweet', L(lambda a: XWriteAPI.post_tweet(a, 'hello', images=[str(tmp / 'photo.png')])[2]),
     text='hello', filename='photo.png', data=b64(PNG))

# ---------------------------------------------------------------- 长推 / thread（上游 3fe6ea7）
# twitter-text v3 权重：拉丁 1、CJK / emoji 2，链接一律 23；emoji 的 ZWJ / 变体选择符 / 肤色不单独计数
WEIGHT_TEXTS = [
    '', 'hello', '你好', 'a' * 280, 'a' * 281, '中' * 140, '中' * 141,
    '看这个 https://example.com/path?q=1，好的', 'HTTPS://EXAMPLE.COM/A 和 http://t.co/x。',
    '👍', '👍🏽', '👨\u200d👩\u200d👧', '❤️', '1\ufe0f\u20e3', 'é', '\u2013\u2018\u2032\u2014', '\u3000全角\uff01',
    'mixed 中文 🎉 text https://a.b/c\u3001next',
]
case('tweet_weight', lambda: [tweet_weight(t) for t in WEIGHT_TEXTS], texts=WEIGHT_TEXTS)
case('create_note_tweet', L(lambda a: XWriteAPI.create_note_tweet(a, LONG_TEXT, reply_to='20', quote_url='https://x.com/a/status/21')),
     text=LONG_TEXT, reply_to='20', quote='https://x.com/a/status/21')
# 命令流程：正文超过 280 权重时自动改走 CreateNoteTweet
case('post_long_tweet', L(lambda a: XWriteAPI.post_tweet(a, LONG_TEXT)[2]), text=LONG_TEXT)
# 命令流程：thread，第一条带图，第二条超长（自动长推），之后每条回复上一条
THREAD = ['第一条', LONG_TEXT, '第三条']
case('post_thread', L(lambda a: XWriteAPI.post_thread(a, THREAD, images=[[str(tmp / 'photo.png')]])),
     texts=THREAD, filename='photo.png', data=b64(PNG))

# ---------------------------------------------------------------- 文章（Article）
MARKDOWN = """# 文章标题

第一段 **粗体** 和 *斜体*，还有 ~~删除线~~ 与 [链接](https://example.com)。
emoji 👍👨\u200d👩\u200d👧 之后的 **BOLD** 仍按码点计 offset
**粗 *斜*** 嵌套，\\*转义\\*，**[粗链接](https://b.c)**

## 小标题
- 无序一
* 无序二
1. 有序一
2) 有序二
> 引用 *斜*
---
![图](photo.png)
```python
print("hi")
```
最后一行"""
MARKDOWN_NO_TITLE = "正文第一行\n\n### 三级标题\n+ 加号列表\n***\n~~~\ncode\n~~~"
# 正则边界：未闭合 / 相邻记号、链接里嵌粗体、六级标题、两位数序号、> 后不带空格、带 title 的图片、
# 行首尾的 Python 空白（\x1c、\u3000）、\r\n 换行、行内的 \r 与 \u2028
MARKDOWN_EDGE = ('###### 六级标题\r\n**未闭合 *a*b* ~~x~~~~y~~ [**粗**链接](https://e.f/g?h=1) `代码`\r\n'
                 '10. 十\n>紧贴引用\n![有标题](pic.png "标题")\n\x1c\u3000前后空白\u3000\n'
                 '行内\r回车与\u2028分隔 **a\\*b** *c\\*d* \\[不是链接](x)\n- \n-\n#不是标题\n``` \n未收尾的围栏')
MEDIA_IDS = iter(['9001', '9002', '9003'])


def content_states():
    upload = lambda path: next(MEDIA_IDS)  # noqa: E731
    title, body = split_title(MARKDOWN)
    return {
        'split': [title, body],
        'split_none': list(split_title(MARKDOWN_NO_TITLE)),
        'state': markdown_to_content_state(body, upload_image=upload),
        'state_no_title': markdown_to_content_state(MARKDOWN_NO_TITLE),
        'state_edge': markdown_to_content_state(MARKDOWN_EDGE, upload_image=upload),
    }


case('article_markdown', content_states, markdown=MARKDOWN, markdown_no_title=MARKDOWN_NO_TITLE, markdown_edge=MARKDOWN_EDGE)
STATE = {'blocks': [{'data': {}, 'text': '正文', 'key': 'abcde', 'type': 'unstyled', 'entity_ranges': [], 'inline_style_ranges': []}], 'entity_map': []}
case('article_draft', L(lambda a: XArticleAPI.create_draft(a)))
case('article_title', L(lambda a: XArticleAPI.update_title(a, ARTICLE_ID, '标题 "x" & <b>')), article=ARTICLE_ID, title='标题 "x" & <b>')
case('article_content', L(lambda a: XArticleAPI.update_content(a, ARTICLE_ID, STATE)), article=ARTICLE_ID, state=STATE)
case('article_cover', L(lambda a: XArticleAPI.update_cover(a, ARTICLE_ID, MEDIA_ID)), article=ARTICLE_ID, media=MEDIA_ID)
case('article_publish', L(lambda a: XArticleAPI.publish(a, ARTICLE_ID)), article=ARTICLE_ID)
case('article_delete', L(lambda a: XArticleAPI.delete(a, ARTICLE_ID)), article=ARTICLE_ID)
case('article_upload_image', L(lambda a: XArticleAPI.upload_image(a, str(tmp / 'photo.png'))), filename='photo.png', data=b64(PNG))
# 命令流程：Markdown → 传正文插图 → 建草稿 → 标题 → 正文 → 传封面 → 设封面 → 发布
case('post_article', L(lambda a: XArticleAPI.post_article(a, MARKDOWN, cover='photo.png', publish=True, base_dir=str(tmp))),
     markdown=MARKDOWN, filename='photo.png', data=b64(PNG))

shutil.rmtree(tmp, ignore_errors=True)
