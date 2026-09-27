/** 平台原生叫法 → 规范词（AGENTS 4.6）。原生叫法不做别名，只在 UNSUPPORTED 的 hint 里提示。 */

type Canonical = string | ((platform: string) => string)

const RESOURCE_WORDS: Record<string, Canonical> = {
  note: 'item',
  aweme: 'item',
  video: 'item',
  photo: 'item',
  work: 'item',
  post: 'item',
  status: 'item',
  tweet: 'item',
  goods: 'item',
  sku: 'item',
  board: 'folder',
  collection: (p) => (p === 'tiktok' ? 'folder' : p === 'kuaishou' ? 'series' : 'folder 或 series'),
  mix: 'series',
  playlist: 'series',
  reply: 'comment',
  dm: 'msg',
  im: 'msg',
  location: 'poi',
  playurl: 'item media',
}

const ACTION_WORDS: Record<string, Canonical> = {
  digg: 'like',
  favorite: (p) => (p === 'x' ? 'like' : 'collect'),
  favour: 'collect',
  bookmark: 'collect',
  retweet: 'repost',
  watch: 'listen',
  playurl: 'media',
}

function lookup(words: Record<string, Canonical>, word: string, platform: string): string | null {
  const c = words[word]
  return c == null ? null : typeof c === 'string' ? c : c(platform)
}

function canonicalAction(word: string, platform: string): string | null {
  // un- 形式：undigg → unlike、unretweet → unrepost
  if (word.startsWith('un')) {
    const base = lookup(ACTION_WORDS, word.slice(2), platform)
    if (base) return `un${base}`
  }
  return lookup(ACTION_WORDS, word, platform)
}

/** 用了原生叫法时，给出改用规范词的建议；没用原生叫法时返回 null。 */
export function nativeHint(platform: string, resource: string, action: string | undefined): string | null {
  const r = lookup(RESOURCE_WORDS, resource, platform)
  const a = action == null ? null : canonicalAction(action, platform)
  if (!r && !a) return null
  // playurl 作 resource 时已经带上 action：playurl → item media
  const words = r?.includes(' ') ? r : [r ?? resource, ...(action == null ? [] : [a ?? action])].join(' ')
  return words.includes('或') ? `规范词是 ${words}` : `用规范词：catbus ${platform} ${words}`
}
