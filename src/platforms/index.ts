import type { Platform } from '../core/registry.js'
import bilibili from './bilibili/index.js'
import douyin from './douyin/index.js'
import jd from './jd/index.js'
import kuaishou from './kuaishou/index.js'
import taobao from './taobao/index.js'
import tiktok from './tiktok/index.js'
import train from './train/index.js'
import weibo from './weibo/index.js'
import x from './x/index.js'
import xhs from './xhs/index.js'
import xianyu from './xianyu/index.js'

/** 注册表：平台声明只含元数据，handler 按需懒加载。顺序即帮助和文档里的列顺序。 */
export const PLATFORMS: Platform[] = [xhs, douyin, tiktok, bilibili, kuaishou, weibo, xianyu, taobao, jd, x, train]

const byName = new Map(PLATFORMS.flatMap((p) => [p.id, ...p.aliases].map((n) => [n, p] as const)))

/** 按规范 id 或别名查找平台。 */
export function findPlatform(name: string): Platform | undefined {
  return byName.get(name.toLowerCase())
}
