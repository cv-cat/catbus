import * as n from '../../../core/normalize.js'

export function profileUrl(user: any): string {
  return `https://www.zhihu.com/people/${encodeURIComponent(String(user.url_token))}`
}

export function userRef(user: any) {
  return n.userRef({ id: user?.id, name: user?.name, url: user?.url_token ? profileUrl(user) : null })
}

export function user(user: any) {
  return n.user(
    {
      id: n.id(user?.id),
      name: n.str(user?.name),
      handle: n.str(user?.url_token),
      avatar: n.url(user?.avatar_url),
      url: user?.url_token ? profileUrl(user) : null,
      bio: n.str(user?.headline),
      stats: {
        items: n.count(user?.creation_count),
        likes: n.count(user?.voteup_count),
      },
    },
    user,
  )
}
