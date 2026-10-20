import { filter } from '../../core/options.js'
import { definePlatform, handlers } from '../../core/registry.js'

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const { impl } = handlers(() => import('./web/commands.js'))

const item = { name: 'item', summary: '回答 ID，article:<id> / pin:<id>，或回答、文章、想法的链接' }
const question = { name: 'question', summary: '问题：问题 ID、question:<id> 或问题链接' }

export default definePlatform({
  id: 'zhihu',
  name: '知乎',
  aliases: ['zh'],
  item: '内容',
  pageInterval: 1500,
  endpoints: {
    web: {
      login: { methods: ['cookie'], default: 'cookie' },
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('full', 'authStatus'),

        'user get': impl('full', 'userGet'),
        'user search': impl('full', 'userSearch'),
        'user items': impl('partial', 'userItems', {
          note: '回答（默认）或文章，不含想法和视频',
          options: { type: filter.type('text', 'article'), sort: filter.sort('latest', 'popular') },
        }),
        'user likes': 'none',
        'user followers': impl('full', 'userFollowers'),
        'user following': impl('full', 'userFollowing'),
        'user follow': impl('full', 'userFollow'),
        'user unfollow': impl('full', 'userUnfollow'),

        'item get': impl('full', 'itemGet', { args: [item] }),
        'item search': impl('partial', 'itemSearch', {
          note: '只返回回答、文章和想法，结果里的问题、视频、专题等不输出',
          options: {
            sort: filter.sort('general', 'popular', 'latest'),
            type: filter.type('all', 'text', 'article'),
            time: filter.time('all', 'day', 'week', 'month', 'half_year', 'year'),
          },
        }),
        'item related': 'none',
        'item list': 'none',
        'item media': 'none',
        'item download': 'none',
        'item like': impl('full', 'itemLike', { args: [item], summary: '赞同' }),
        'item unlike': impl('full', 'itemUnlike', { args: [item], summary: '取消赞同' }),
        'item collect': 'none',
        'item uncollect': 'none',
        'item publish': 'none',
        'item delete': 'none',

        'comment list': impl('partial', 'commentList', {
          args: [item],
          note: '--sort popular（默认，同网页）只能翻到前两百条左右，要全部一级评论用 --sort latest',
          options: { sort: filter.sort('popular', 'latest') },
        }),
        'comment replies': impl('full', 'commentReplies', { args: [item, { name: 'comment', summary: '一级评论 ID' }] }),
        'comment add': 'none',
        'comment delete': 'none',
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': impl('partial', 'feedList', {
          note: 'hot 是热榜，条目是问题（id 为 question:<id>），用 question get / answers 继续查看',
          options: { kind: filter.kind('recommend', 'hot', 'following') },
        }),

        'keyword suggest': impl('full', 'keywordSuggest'),
        'keyword hot': impl('full', 'keywordHot'),

        'notice list': 'none',
        'notice count': 'none',

        'msg list': 'none',
        'msg history': 'none',
        'msg send': 'none',
        'msg read': 'none',
        'msg delete': 'none',

        'media upload': 'none',

        'folder list': impl('full', 'folderList'),
        'folder items': impl('full', 'folderItems', { args: [{ name: 'folder', summary: '收藏夹 ID 或链接' }] }),
        'folder create': 'none',
        'folder update': 'none',
        'folder delete': 'none',

        'series list': 'none',
        'series items': 'none',

        'history list': 'none',
        'topic search': impl('full', 'topicSearch'),

        'question get': impl('full', 'questionGet', { summary: '问题详情', args: [question], auth: 'required', output: 'Question' }),
        'question answers': impl('full', 'questionAnswers', {
          summary: '问题下的回答',
          args: [question],
          auth: 'required',
          output: 'Item[]',
          paged: true,
          options: { sort: filter.sort('general', 'latest') },
        }),
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
