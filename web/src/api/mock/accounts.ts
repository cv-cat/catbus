import type { Account, Envelope } from '../types'

const NICKS: Record<string, string[]> = {
  xhs: ['下一站去哪', '丸子是只柴', '露营可可', '小野玩户外', '倒拔垂杨柳'],
  douyin: ['catbus', '飞天', '蜡笔小新', '吴荔斌', '漫逛江南', '丸子是小号', '澄就YOUNG', '霞客湾', '一站一站', '山野来信', '江南小雨', '早睡早起', '周末去哪', '晚风'],
  bilibili: ['catbus'],
  weibo: ['catbus'],
  mteam: ['catbus', 'pt-小号'],
}
const DAY = 86_400_000
export const demoAccounts: Account[] = Object.entries(NICKS).flatMap(([platform, nicks]) =>
  nicks.map((name, i) => ({
    platform,
    endpoint: 'web',
    account: i === 0 ? 'default' : `acc-${i}`,
    current: i === 0,
    user: { id: String(i + 1), name, url: null, avatar: null },
    // M-Team 只有 API Key 和账号密码登录（AGENTS.md 4.7），两个演示账号各一种；其余平台演示扫码
    method: platform === 'mteam' ? (i === 0 ? 'apikey' : 'password') : 'qrcode',
    updated_at: new Date(Date.now() - i * 2 * DAY).toISOString(),
  })),
)

export function mockAccounts(): Envelope<Account[]> {
  return { ok: true, data: demoAccounts.map((a) => ({ ...a })), page: null, error: null }
}

export function mockLogout(platform: string, account: string) {
  const i = demoAccounts.findIndex((a) => a.platform === platform && a.account === account)
  if (i >= 0) demoAccounts.splice(i, 1)
}

export function mockUse(platform: string, account: string) {
  for (const a of demoAccounts) if (a.platform === platform) a.current = a.account === account
}

/**
 * 演示模式的筛选取值表（与 GET /api/filters 同结构，取值照各平台注册表里的声明），
 * `?demo` 下不请求服务端也能演示分类、时间筛选的置灰。
 */

/** 这个平台的当前演示账号（没有时取第一个），「我的」页的头部和作品作者用它 */
export function demoMe(platform: string) {
  const a = demoAccounts.find((x) => x.platform === platform && x.current) ?? demoAccounts.find((x) => x.platform === platform)
  return a?.user ?? null
}
