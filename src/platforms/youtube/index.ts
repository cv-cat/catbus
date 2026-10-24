import { filter } from '../../core/options.js'
import { definePlatform, handlers } from '../../core/registry.js'

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const { impl } = handlers(() => import('./web/commands.js'))

export default definePlatform({
  id: 'youtube',
  name: 'YouTube',
  aliases: ['yt'],
  item: '视频',
  endpoints: {
    web: {
      // 不登录也能看搜索、视频、评论、频道、播放列表和直播聊天（AGENTS 5.2）
      guest: true,
      // Google 账号登录无法自动化：只支持从浏览器导入 cookie
      login: { methods: ['cookie'], default: 'cookie' },
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('full', 'userGet', { note: '<user> 为频道 ID（UC…）、@handle 或频道链接' }),
        'user search': impl('full', 'userSearch'),
        'user items': impl('full', 'userItems', { note: '频道「视频」tab，不含 Shorts 和直播' }),
        'user likes': impl('full', 'userLikes', { note: '只能看自己的（me），即「已点赞的视频」播放列表' }),
        'user collects': impl('full', 'userCollects', { note: '只能看自己的（me），即「稍后观看」列表' }),
        'user following': impl('full', 'userFollowing', { note: '只能看自己的（me）订阅' }),
        'user follow': impl('full', 'userFollow', { note: '订阅频道' }),
        'user unfollow': impl('full', 'userUnfollow', { note: '取消订阅' }),

        'item get': impl('full', 'itemGet'),
        'item search': impl('full', 'itemSearch', {
          options: {
            sort: filter.sort('general', 'popular'),
            time: filter.time('all', 'day', 'week', 'month', 'year'),
            type: filter.type('all', 'video'),
          },
        }),
        'item related': impl('full', 'itemRelated'),
        'item list': { upstream: 'none', note: '要走 YouTube Studio 的接口，尚未实现' },
        'item media': impl('partial', 'itemMedia', { note: '最清晰的视频轨 + 音频轨（分轨）。走 ANDROID_VR 客户端、不带登录，同一出口 IP 请求过多会触发人机验证；年龄限制等视频拿不到' }),
        'item download': impl('partial', 'itemDownload', { note: '下载 item media 的视频轨和音频轨两个文件，不合流；只能完整下载 1 分钟以内的视频（没有 PO token 的地址只给前约 1 分钟）' }),
        'item like': impl('full', 'itemLike'),
        'item unlike': impl('full', 'itemUnlike', { note: '取消点赞（也会取消点踩）' }),
        'item collect': impl('full', 'itemCollect', { note: '加入稍后观看' }),
        'item uncollect': impl('full', 'itemUncollect', { note: '移出稍后观看' }),
        'item publish': { upstream: 'none', note: '要走 YouTube Studio 的分片上传，尚未实现' },
        'item delete': { upstream: 'none', note: '要走 YouTube Studio 的接口，尚未实现' },

        'comment list': impl('full', 'commentList'),
        'comment replies': impl('full', 'commentReplies', { note: '<comment> 为根评论 ID；YouTube 的回复只有一层' }),
        'comment add': impl('full', 'commentAdd', { note: '--reply-to 给根评论或某条回复，回复都挂在根评论下' }),
        'comment delete': impl('full', 'commentDelete', { note: '只能删自己的评论' }),
        'comment like': impl('full', 'commentLike'),
        'comment unlike': impl('full', 'commentUnlike'),

        'feed list': impl('full', 'feedList', {
          auth: 'required',
          options: { kind: filter.kind('recommend', 'following') },
          note: '首页推荐与订阅流；游客态首页为空，所以需要登录',
        }),

        'live get': impl('full', 'liveGet', { note: '<room> 为直播的视频 ID 或链接' }),
        'live search': impl('full', 'liveSearch'),
        'live listen': impl('full', 'liveListen', { note: '轮询直播聊天：文字消息、Super Chat、会员' }),
        'live history': impl('full', 'liveHistory'),
        'live send': { upstream: 'none', note: 'live_chat/send_message 尚未实现' },

        'keyword suggest': impl('full', 'keywordSuggest'),

        'notice list': impl('full', 'noticeList'),
        'notice count': impl('full', 'noticeCount', { note: '只有未读总数，不分类' }),

        'series list': impl('full', 'seriesList', { note: '频道公开的播放列表；me 为自己的全部播放列表（需要登录）' }),
        'series items': impl('full', 'seriesItems', { note: '<series> 为播放列表 ID（PL…）或带 list= 的链接' }),

        'history list': impl('full', 'historyList'),
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
