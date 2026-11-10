/**
 * Comment.media：评论附带的图片 / 表情包 / 商品评价晒图。
 * 原始对象按 2026-11 真机响应的结构裁剪，地址、ID、用户都是合成的。
 */
import { describe, expect, it } from 'vitest'

import * as bili from '../src/platforms/bilibili/web/normalize.js'
import * as dy from '../src/platforms/douyin/web/normalize.js'
import * as jd from '../src/platforms/jd/web/normalize.js'
import * as tt from '../src/platforms/tiktok/web/normalize.js'
import * as wb from '../src/platforms/weibo/web/normalize.js'
import * as x from '../src/platforms/x/web/normalize.js'
import * as xhs from '../src/platforms/xhs/web/normalize.js'

const img = (url: string, width: number | null = null, height: number | null = null, id: string | null = null) => ({ id, type: 'image', url, width, height, duration: null })

describe('Comment.media', () => {
  it('xhs：pictures 取 url_default（WB_DFT），http 改成 https', () => {
    const c = xhs.comment(
      {
        id: 'c1',
        content: '晒图',
        create_time: 1700000000000,
        user_info: { user_id: 'u1', nickname: '测试' },
        pictures: [
          {
            info_list: [
              { image_scene: 'WB_PRV', url: 'http://sns-webpic-qc.xhscdn.com/fake/comment/pic1!nc_n_webp_mw_1' },
              { image_scene: 'WB_DFT', url: 'http://sns-webpic-qc.xhscdn.com/fake/comment/pic1!nd_whlt34_webp_wm_1' },
            ],
            width: 5712,
            height: 4284,
            url_pre: 'http://sns-webpic-qc.xhscdn.com/fake/comment/pic1!nc_n_webp_mw_1',
            url_default: 'http://sns-webpic-qc.xhscdn.com/fake/comment/pic1!nd_whlt34_webp_wm_1',
          },
          { info_list: [{ image_scene: 'WB_PRV', url: 'https://sns-webpic-qc.xhscdn.com/fake/comment/pic2!pre' }], width: 100, height: 100 },
        ],
      },
      'n1',
    )
    expect(c.media).toEqual([
      img('https://sns-webpic-qc.xhscdn.com/fake/comment/pic1!nd_whlt34_webp_wm_1', 5712, 4284),
      img('https://sns-webpic-qc.xhscdn.com/fake/comment/pic2!pre', 100, 100),
    ])
    expect(xhs.comment({ id: 'c2', content: '纯文字', pictures: [] }, 'n1').media).toEqual([])
  })

  it('douyin：image_list 取 origin_url，sticker 取 animate_url', () => {
    const c = dy.comment(
      {
        cid: '1',
        text: '',
        aweme_id: '7000000000000000001',
        image_list: [
          {
            origin_url: { uri: 'tos-cn-i-fake/img1', url_list: ['https://p3-sign.douyinpic.com/tos-cn-i-fake/img1~tplv-7.image?x-signature=fake'], width: 1080, height: 1337 },
            crop_url: { uri: 'tos-cn-i-fake/img1', url_list: ['https://p3-sign.douyinpic.com/tos-cn-i-fake/img1~tplv-1.image'], width: 1080, height: 1337 },
          },
        ],
        sticker: {
          id: 7200000000000000001,
          id_str: '7200000000000000001',
          width: 120,
          height: 120,
          static_url: { uri: 'tos-cn-i-fake/stk', url_list: ['https://p3-sign.douyinpic.com/obj/tos-cn-i-fake/stk?static'] },
          animate_url: { uri: 'tos-cn-i-fake/stk', url_list: ['https://p3-sign.douyinpic.com/obj/tos-cn-i-fake/stk?animate'] },
        },
      },
      '7000000000000000001',
    )
    expect(c.media).toEqual([
      img('https://p3-sign.douyinpic.com/tos-cn-i-fake/img1~tplv-7.image?x-signature=fake', 1080, 1337, 'tos-cn-i-fake/img1'),
      img('https://p3-sign.douyinpic.com/obj/tos-cn-i-fake/stk?animate', 120, 120, '7200000000000000001'),
    ])
    expect(dy.comment({ cid: '2', text: '好', image_list: null, sticker: null }, '7').media).toEqual([])
  })

  it('douyin 商品评价：Photos', () => {
    const c = dy.productComment({ CommentId: '9', Content: '好', Photos: [{ Url: 'https://p3-ecom.douyinpic.com/fake/p1.jpeg', Width: 800, Height: 600 }, 'https://p3-ecom.douyinpic.com/fake/p2.jpeg'] }, 'p1')
    expect(c.media).toEqual([img('https://p3-ecom.douyinpic.com/fake/p1.jpeg', 800, 600), img('https://p3-ecom.douyinpic.com/fake/p2.jpeg')])
  })

  it('tiktok：同 douyin 的 image_list / sticker 结构', () => {
    const c = tt.comment(
      { cid: '1', text: '', image_list: [{ origin_url: { uri: 'tos-fake/a', url_list: ['https://p16-sign.tiktokcdn-us.com/tos-fake/a~tplv.image'], width: 720, height: 960 } }] },
      '7300000000000000001',
    )
    expect(c.media).toEqual([img('https://p16-sign.tiktokcdn-us.com/tos-fake/a~tplv.image', 720, 960, 'tos-fake/a')])
    expect(tt.comment({ cid: '2', text: 'hi' }, '7').media).toEqual([])
  })

  it('bilibili：content.pictures 的 img_src，正文表情（emote）不算', () => {
    const c = bili.reply(
      {
        rpid: 1,
        content: {
          message: '装一个[doge]',
          emote: { '[doge]': { url: 'https://i0.hdslb.com/bfs/emote/fake.png' } },
          pictures: [{ img_src: 'http://i0.hdslb.com/bfs/new_dyn/fake1.jpg', img_width: 1500, img_height: 1500, img_size: 899.4 }, { img_src: 'http://i0.hdslb.com/bfs/new_dyn/fake2.jpg' }],
        },
        member: { mid: 1, uname: 'a' },
      },
      'BV1xx411c7mD',
    )
    expect(c.media).toEqual([img('https://i0.hdslb.com/bfs/new_dyn/fake1.jpg', 1500, 1500), img('https://i0.hdslb.com/bfs/new_dyn/fake2.jpg')])
    expect(bili.reply({ rpid: 2, content: { message: '[doge]', emote: { '[doge]': {} } } }, 'BV1').media).toEqual([])
  })

  it('weibo：url_struct 里的 pic_infos 与 m 站的 pic，按地址去重', () => {
    const pic = { pic_id: 'fakepid1', largest: { url: 'https://wx1.sinaimg.cn/large/fakepid1.jpg', width: 1080, height: 1920 } }
    const c = wb.comment(
      {
        idstr: '5000000000000001',
        text_raw: '图片评论 http://t.cn/fake',
        pic_infos: { fakepid1: pic },
        url_struct: [{ url_title: '查看图片', pic_ids: ['fakepid1'], pic_infos: { fakepid1: pic } }],
      },
      '5000000000000000',
    )
    expect(c.media).toEqual([img('https://wx1.sinaimg.cn/large/fakepid1.jpg', 1080, 1920, 'fakepid1')])
    const m = wb.comment({ id: 2, text: 'm 站', pic: { pid: 'fakepid2', large: { url: 'https://wx2.sinaimg.cn/large/fakepid2.jpg', geo: { width: 300, height: 200 } } } }, '5')
    expect(m.media).toEqual([img('https://wx2.sinaimg.cn/large/fakepid2.jpg', 300, 200, 'fakepid2')])
  })

  it('x：回复推文的 extended_entities 与推文同一套解析', () => {
    const c = x.comment(
      {
        __typename: 'Tweet',
        rest_id: '2001',
        legacy: {
          full_text: '@a 图',
          extended_entities: { media: [{ id_str: '3001', type: 'photo', media_url_https: 'https://pbs.twimg.com/media/fake.jpg', original_info: { width: 640, height: 480 } }] },
        },
      },
      '1000',
    )
    expect(c.media).toEqual([img('https://pbs.twimg.com/media/fake.jpg', 640, 480, '3001')])
  })

  it('jd 商品评价：pictureInfoList 的 largePicURL', () => {
    const [c] = jd.comments('100012043978', {
      commentInfoList: [{ commentId: 9, commentData: '好用', pictureInfoList: [{ largePicURL: '//img30.360buyimg.com/shaidan/fake1.jpg', picURL: '//img30.360buyimg.com/n0/fake1.jpg' }, { picURL: 'https://img30.360buyimg.com/n0/fake2.jpg' }] }],
    })
    expect(c!.media).toEqual([img('https://img30.360buyimg.com/shaidan/fake1.jpg'), img('https://img30.360buyimg.com/n0/fake2.jpg')])
  })
})
