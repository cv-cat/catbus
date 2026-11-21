import { describe, expect, it } from 'vitest'
import { requestKeyword } from '@/stores/discover'

describe('请求用的关键词（7.9「渠道缓存」「推荐流分类与时间筛选」）', () => {
  it('提交搜索时取输入框里的文字（去掉首尾空白）', () => {
    expect(requestKeyword('  露营 ', '猫', true)).toBe('露营')
    expect(requestKeyword('', '猫', true)).toBe('')
  })

  it('改筛选、换渠道、重试时沿用已提交的关键词，不读输入框草稿', () => {
    // 清空了输入框但没提交：仍按「露营」搜索，不会切到推荐流
    expect(requestKeyword('', '露营', false)).toBe('露营')
    expect(requestKeyword('还没打完', '露营', false)).toBe('露营')
    // 没提交过关键词：仍是推荐流
    expect(requestKeyword('猫', '', false)).toBe('')
  })
})
