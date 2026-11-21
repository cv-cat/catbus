import { mockDanmaku, mockMedia, mockSubtitles } from './mock/extras'
import { mockLive } from './mock/live'
import { call } from './client'
import type { Danmaku, Envelope, Item, Live, Media, Subtitle } from './types'
import { isDemo } from '@/stores/source'

/** 详情卡片的字幕、弹幕、媒体链接，直播间头部（AGENTS.md 7.9） */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function itemArgv(platform: string, resource: string, action: string, ref: string, account?: string | null) {
  const argv = [platform, resource, action, ref]
  if (account) argv.push('-a', account)
  return argv
}

export async function listSubtitles(platform: string, item: Item, account?: string | null): Promise<Envelope<Subtitle[]>> {
  if (isDemo()) return wait(400).then(() => mockSubtitles(item))
  return call<Subtitle[]>(itemArgv(platform, 'item', 'subtitles', item.url || item.id, account))
}

export async function listDanmaku(platform: string, item: Item, account?: string | null): Promise<Envelope<Danmaku[]>> {
  if (isDemo()) return wait(450).then(() => mockDanmaku(item))
  return call<Danmaku[]>(itemArgv(platform, 'danmaku', 'list', item.url || item.id, account))
}

export async function listMedia(platform: string, item: Item, account?: string | null): Promise<Envelope<Media[]>> {
  if (isDemo()) return wait(300).then(() => mockMedia(item))
  return call<Media[]>(itemArgv(platform, 'item', 'media', item.url || item.id, account))
}

/**
 * B 站的原生播放器（AGENTS.md 7.9「详情卡片」的「媒体」）：`item media --all-tracks --raw` 给出全部视频轨和音频轨的原始对象
 * （地址、mimeType、codecs、SegmentBase）；老稿件是整段的 durl。CLI 还不认识 `--all-tracks`（报 USAGE）时去掉它再取一次，
 * 只拿到最高画质的一路。演示模式不用，走嵌入播放器。
 */
export async function getRawMedia(platform: string, item: Item, account?: string | null, signal?: AbortSignal): Promise<Envelope<Record<string, any>[]>> {
  const argv = itemArgv(platform, 'item', 'media', item.url || item.id, account)
  const env = await call<Record<string, any>[]>([...argv, '--all-tracks', '--raw'], signal)
  if (env.ok || env.error?.code !== 'USAGE') return env
  return call<Record<string, any>[]>([...argv, '--raw'], signal)
}

/** 叠在 B 站原生播放器上的弹幕：`danmaku list --raw` 的原始字段带类型、颜色、字号 */
export async function getRawDanmaku(platform: string, item: Item, account?: string | null, signal?: AbortSignal): Promise<Envelope<Record<string, any>[]>> {
  return call<Record<string, any>[]>([...itemArgv(platform, 'danmaku', 'list', item.url || item.id, account), '--raw'], signal)
}

export async function getLive(platform: string, room: string, account?: string | null, signal?: AbortSignal): Promise<Envelope<Live>> {
  if (isDemo()) return wait(400).then(() => mockLive(platform, room))
  return call<Live>(itemArgv(platform, 'live', 'get', room, account), signal)
}

/** 直播页的播放器：直播流地址（`live media`）。演示模式没有真的直播流，返回空列表 */
export async function listLiveMedia(platform: string, room: string, account?: string | null, signal?: AbortSignal): Promise<Envelope<Media[]>> {
  if (isDemo()) return wait(300).then((): Envelope<Media[]> => ({ ok: true, data: [], page: null, error: null }))
  return call<Media[]>(itemArgv(platform, 'live', 'media', room, account), signal)
}
