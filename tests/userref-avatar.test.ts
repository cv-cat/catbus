import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as n from '../src/core/normalize.js'
import * as bilibili from '../src/platforms/bilibili/web/normalize.js'
import * as douyin from '../src/platforms/douyin/web/normalize.js'
import * as jd from '../src/platforms/jd/web/normalize.js'
import * as kuaishou from '../src/platforms/kuaishou/web/normalize.js'
import * as tiktok from '../src/platforms/tiktok/web/normalize.js'
import * as weibo from '../src/platforms/weibo/web/normalize.js'
import * as xhs from '../src/platforms/xhs/web/normalize.js'
import * as xianyu from '../src/platforms/xianyu/web/normalize.js'
import * as youtube from '../src/platforms/youtube/web/normalize.js'

/** UserRef 的头像（AGENTS 6.2）：从同一个原始对象里取，统一成 https 绝对地址，取不到时为 null。全部是假数据。 */

const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'youtube', name), 'utf8'))

describe('core：n.userRef 的 avatar', () => {
  it('不给时为 null；// 与 http:// 统一成 https；相对地址为 null', () => {
    expect(n.userRef({ id: '1', name: 'a' })).toEqual({ id: '1', name: 'a', url: null, avatar: null })
    expect(n.userRef({ id: '1', avatar: '//cdn.example/a.jpg' })!.avatar).toBe('https://cdn.example/a.jpg')
    expect(n.userRef({ id: '1', avatar: 'http://cdn.example/a.jpg' })!.avatar).toBe('https://cdn.example/a.jpg')
    expect(n.userRef({ id: '1', avatar: '/default.png' })!.avatar).toBeNull()
  })
})

describe('xhs', () => {
  it('笔记卡片 / 详情的作者取 user.avatar', () => {
    const card = xhs.card({ id: 'n1', xsec_token: 't', note_card: { type: 'normal', display_title: 'x', user: { user_id: 'u1', nickname: '甲', avatar: 'https://sns-avatar.xhscdn.com/a1.jpg' } } })
    expect(card.author).toEqual({ id: 'u1', name: '甲', url: 'https://www.xiaohongshu.com/user/profile/u1', avatar: 'https://sns-avatar.xhscdn.com/a1.jpg' })
    const note = xhs.note({ id: 'n2', note_card: { type: 'normal', user: { user_id: 'u2', nickname: '乙', avatar: 'https://sns-avatar.xhscdn.com/a2.jpg' } } })
    expect(note.author?.avatar).toBe('https://sns-avatar.xhscdn.com/a2.jpg')
  })

  it('评论者取 user_info.image', () => {
    const c = xhs.comment({ id: 'c1', content: '好', user_info: { user_id: 'u3', nickname: '丙', image: 'https://sns-avatar.xhscdn.com/a3.jpg' } }, 'n1')
    expect(c.author?.avatar).toBe('https://sns-avatar.xhscdn.com/a3.jpg')
  })

  it('没有头像字段时为 null', () => {
    expect(xhs.ref({ user_id: 'u4', nickname: '丁' })!.avatar).toBeNull()
  })
})

describe('douyin', () => {
  it('作品作者取 author.avatar_thumb.url_list[0]', () => {
    const it = douyin.aweme({
      aweme_id: '7001',
      desc: 'x',
      author: { sec_uid: 'MS4wLjABAAAAfake', nickname: '作者', avatar_thumb: { url_list: ['https://p3.douyinpic.com/thumb.jpg', 'https://p9.douyinpic.com/thumb.jpg'] } },
    })
    expect(it.author).toEqual({
      id: 'MS4wLjABAAAAfake',
      name: '作者',
      url: 'https://www.douyin.com/user/MS4wLjABAAAAfake',
      avatar: 'https://p3.douyinpic.com/thumb.jpg',
    })
  })

  it('评论者取 user.avatar_thumb，没有时退到 avatar_medium', () => {
    const c = douyin.comment({ cid: '1', text: '好', user: { sec_uid: 'MS4wLjABAAAAc', nickname: '评', avatar_medium: { url_list: ['https://p3.douyinpic.com/m.jpg'] } } }, '7001')
    expect(c.author?.avatar).toBe('https://p3.douyinpic.com/m.jpg')
  })
})

describe('bilibili', () => {
  it('稿件作者取 owner.face，搜索卡片取 upic', () => {
    const v = bilibili.video({ bvid: 'BV1fake', title: 't', owner: { mid: 10001, name: 'UP', face: 'http://i0.hdslb.com/bfs/face/up.jpg' }, stat: {} })
    expect(v.author).toEqual({ id: '10001', name: 'UP', url: 'https://space.bilibili.com/10001', avatar: 'https://i0.hdslb.com/bfs/face/up.jpg' })
    const s = bilibili.searchVideo({ bvid: 'BV2fake', title: 't', mid: 10002, author: 'UP2', upic: '//i1.hdslb.com/bfs/face/up2.jpg' })
    expect(s.author?.avatar).toBe('https://i1.hdslb.com/bfs/face/up2.jpg')
  })

  it('评论者取 member.avatar', () => {
    const c = bilibili.reply({ rpid: 1, member: { mid: '10003', uname: '评', avatar: 'https://i2.hdslb.com/bfs/face/c.jpg' }, content: { message: '好' } }, 'BV1fake')
    expect(c.author?.avatar).toBe('https://i2.hdslb.com/bfs/face/c.jpg')
  })

  it('空间投稿列表没有头像：为 null', () => {
    expect(bilibili.spaceVideo({ bvid: 'BV3fake', mid: 10004, author: 'UP4' }).author?.avatar).toBeNull()
  })
})

describe('其他平台', () => {
  it('tiktok：作品作者 avatarThumb，评论者 avatar_thumb.url_list', () => {
    expect(tiktok.item({ id: '1', author: { id: '9', uniqueId: 'u', nickname: 'U', avatarThumb: 'https://p16.tiktokcdn.com/a.jpeg' } }).author?.avatar).toBe('https://p16.tiktokcdn.com/a.jpeg')
    expect(tiktok.comment({ cid: '2', user: { uid: '9', unique_id: 'u', avatar_thumb: { url_list: ['https://p16.tiktokcdn.com/b.jpeg'] } } }, '1').author?.avatar).toBe(
      'https://p16.tiktokcdn.com/b.jpeg',
    )
  })

  it('kuaishou：作品作者 headerUrl，评论者 headurl', () => {
    expect(kuaishou.feed({ photo: { id: 'p1' }, author: { id: 'a1', name: 'A', headerUrl: 'https://p1.a.yximgs.com/h.jpg' } }).author?.avatar).toBe('https://p1.a.yximgs.com/h.jpg')
    expect(kuaishou.comment({ commentId: 'c1', authorId: 'a2', authorName: 'B', headurl: 'https://p2.a.yximgs.com/h.jpg' }, 'p1').author?.avatar).toBe('https://p2.a.yximgs.com/h.jpg')
  })

  it('weibo：作者取 profile_image_url', () => {
    expect(weibo.ref({ idstr: '100', screen_name: 'W', profile_image_url: 'https://tvax1.sinaimg.cn/crop.0.0.50.50/a.jpg' })!.avatar).toBe('https://tvax1.sinaimg.cn/crop.0.0.50.50/a.jpg')
  })

  it('jd：评价者取 userImgURL，没有协议头时补 https', () => {
    const [c] = jd.comments('100', { commentInfoList: [{ commentId: '1', userNickName: 'j***x', commentData: '好', userImgURL: 'storage.360buyimg.com/i.imageUpload/fake.jpg' }] })
    expect(c!.author?.avatar).toBe('https://storage.360buyimg.com/i.imageUpload/fake.jpg')
    expect(jd.shopRef('1000', '店')!.avatar).toBeNull()
  })

  it('xianyu：卖家取 sellerDO.portraitUrl', () => {
    expect(xianyu.item({ itemDO: { itemId: '1', title: 't' }, sellerDO: { sellerId: '2', nick: 'S', portraitUrl: 'https://img.alicdn.com/s.jpg' } }).author?.avatar).toBe('https://img.alicdn.com/s.jpg')
  })

  it('youtube：搜索结果的频道头像、评论者头像（真实响应裁剪的 fixture）', () => {
    const items = youtube.videos(fixture('search.json'))
    expect(items.some((v) => v.author?.avatar?.startsWith('https://yt3.ggpht.com/'))).toBe(true)
    const comments = youtube.comments(fixture('comments.json'), 'vid')
    expect(comments[0]!.author?.avatar).toMatch(/^https:\/\/yt3\.ggpht\.com\//)
  })
})
