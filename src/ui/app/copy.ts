import type { CommandMeta, EndpointName, JobSummary, OptionMeta, PlatformMeta } from '../shared/types.js'

/** 只调整界面文案，不改变注册表、请求参数和命令预览。 */
export function endpointLabel(endpoint: string, platform?: PlatformMeta): string {
  const meta = platform?.endpoints[endpoint as EndpointName]
  if (meta?.status === 'available' && meta.label) return meta.label
  return ({ web: '网页版', app: '手机 App', pc: '电脑客户端' } as Record<string, string>)[endpoint] ?? endpoint
}

const COMMAND_TITLES: Record<string, string> = {
  'auth status': '检查登录状态',
  'auth logout': '退出登录',
  'auth list': '已保存的账号',
  'auth use': '切换账号',
  'live listen': '实时查看弹幕与直播消息',
  'msg listen': '实时接收新消息',
  'gateway get': '查看实时连接地址',
  'gateway listen': '实时接收服务器通知',
  'device register': '关联当前设备',
  'friend add': '添加好友',
}

export function commandTitle(command: CommandMeta): string {
  if (command.summary.includes('即 --category') || command.summary.includes('即 feed list --category')) return command.summary.split('，')[0]!
  if (command.summary === '发弹幕，或用 --gift 送礼') return '发送直播消息'
  if (command.summary === '发私信；--item 表示联系商品的卖家或客服') return '发送消息'
  return COMMAND_TITLES[`${command.resource} ${command.action}`] ?? command.summary
}

/** 最近任务和任务列表先显示操作名称；完整命令仍可在任务详情查看和复制。 */
export function taskTitle(job: JobSummary, platform?: PlatformMeta): string {
  const ep = platform?.endpoints[job.request.endpoint]
  const command = ep?.status === 'available' ? ep.commands.find((c) => c.resource === job.request.resource && c.action === job.request.action) : null
  if (command) return commandTitle(command)
  return ({ doctor: '环境检查', version: '查看版本', config: '管理设置', auth: '管理账号' } as Record<string, string>)[job.request.resource] ?? '查看操作记录'
}

/** 保留使用限制，省去接口路径、源码字段和移植过程。 */
const COMMAND_NOTES: Record<string, string> = {
  'xhs.comment.list': '暂不支持查看商品评价。',
  'xhs.feed.list': '暂不支持查看关注内容。',
  'xhs.live.send': '暂不支持赠送礼物。',
  'xhs.msg.list': '包含私聊和群聊；群聊编号以 group: 开头。',
  'xhs.msg.history': '私聊填写对方的用户编号；群聊填写 group: 加群编号，例如 group:123。',
  'xhs.folder.list': '只能查看公开的收藏夹，暂不支持查看其中的笔记。',
  'douyin.item.search': '选择“视频”只搜索视频；选择“图文”只保留图文，其余类型使用综合搜索。',
  'douyin.item.list': '显示发布页中的作品预览；尚未发布的定时作品显示为“草稿”。',
  'douyin.product.get': '目前只提供商品标题、图片和价格，其他信息可能为空。',
  'douyin.feed.list': '暂不支持热门和关注内容。',
  'douyin.live.history': '只能查看进入直播间时获取的最近 15 条消息。',
  'douyin.live.send': '暂不支持赠送礼物。',
  'douyin.live.media': '查看当前直播的播放地址。',
  'tiktok.user.get': '查询当前账号的信息可能不完整，也可以填写用户编号查询。',
  'tiktok.item.media': '查看视频或图文中的图片地址。',
  'tiktok.item.download': '下载视频或图文中的图片。',
  'tiktok.live.list': '只显示已关注用户正在进行的直播；没有关注的用户开播时，列表为空。',
  'tiktok.live.history': '只能查看进入直播间时获取的弹幕。',
  'tiktok.live.send': '暂不支持赠送礼物。',
  'tiktok.live.media': '查看当前直播的播放地址。',
  'tiktok.msg.send': '只能发送文字，且只能发给已有聊天记录的用户。',
  'bilibili.user.update': '改昵称每次扣 6 个硬币，从未设置过昵称的账号可免费一次，提交前会再次确认。签名最多 70 字，修改后需审核；头像支持 PNG、JPG，大小不超过 2MB。',
  'bilibili.item.delete': '删除需要完成平台的人机验证，目前无法在面板中完成，请到 B 站操作。',
  'bilibili.item.edit': '只改标题等资料时，无需上传新视频。播放页封面为 16:9，列表页封面为 4:3；未填写的内容沿用原稿，提交后需重新审核。取消定时需在终端使用 --schedule none。',
  'bilibili.comment.list': '支持视频、专栏、纯文字动态、转发动态及图文动态的评论。',
  'bilibili.comment.replies': '支持视频、专栏和图文动态的评论回复；暂不支持纯文字和转发动态的评论回复。',
  'bilibili.comment.add': '支持视频、专栏、纯文字动态和转发动态；暂不支持图文动态。',
  'bilibili.comment.delete': '支持视频、专栏、纯文字动态和转发动态；暂不支持图文动态。',
  'bilibili.feed.list': '查看关注内容需要登录，且只显示关注用户的视频投稿。',
  'bilibili.folder.list': '显示用户自己创建的全部收藏夹。',
  'bilibili.folder.items': '只显示收藏夹里的视频稿件。',
  'kuaishou.item.search': '目前只能按关键词搜索，暂不支持排序、内容类型和时间筛选。',
  'kuaishou.item.publish': '可发布视频，或 1～31 张图片，每张不超过 15MB。暂不支持单独设置封面、提及用户、地点、分类和价格。',
  'kuaishou.comment.list': '暂不支持查看商品评价。',
  'kuaishou.comment.replies': '评论回复功能的验证范围有限，部分评论可能无法正确显示回复。',
  'kuaishou.feed.list': '关注内容只能查看最先加载的一批，暂不支持继续加载。',
  'weibo.item.search': '目前只能查看第一页搜索结果。',
  'weibo.comment.list': '只显示直接评论，暂不包含评论下的回复。',
  'xianyu.user.get': '目前只能查看当前登录账号，暂不支持查询其他用户。',
  'xianyu.msg.send': '填写收信人后，可以同时指定商品，围绕这件商品沟通；未指定商品时使用默认商品创建聊天。卖家也可以联系买家。',
  'taobao.auth.status': '通过客服连接检查能否继续使用账号，显示的昵称来自已保存的登录信息。',
  'taobao.user.get': '请填写淘宝、天猫商品链接或分享短链接，查看这件商品的卖家；暂不支持查看当前账号。',
  'taobao.msg.send': '填写商品链接联系卖家，或填写聊天编号回复已有会话；暂不支持直接按用户编号发起聊天。',
  'jd.auth.login': '短信登录的手机号可以带国际区号，例如 +85291234567。',
  'jd.item.related': '根据相关搜索词推荐商品。',
  'jd.comment.list': '目前只能查看第一页评价，可以指定本次获取的数量。',
  'x.item.search': '筛选视频或图片时，不能同时选择“最新”排序。',
  'x.item.publish': '正文超过平台的普通推文长度限制时，会发布为长推文，需要 Premium 会员。可以添加后续内容，连续发布为一组推文。',
  'x.feed.list': '暂不支持查看关注内容。',
  'x.msg.list': '只显示最近 20 个聊天，暂不支持继续加载。',
  'x.msg.history': '私信经过端到端加密，目前无法显示正文，只能显示消息记录。',
  'youtube.user.get': '填写频道编号、以 @ 开头的频道名称，或频道链接。',
  'youtube.user.items': '只显示频道“视频”页面的内容，不包含 Shorts 短视频和直播。',
  'youtube.user.likes': '只能查看当前账号已点赞的视频。',
  'youtube.user.collects': '只能查看当前账号的“稍后观看”列表。',
  'youtube.user.following': '只能查看当前账号订阅的频道。',
  'youtube.item.list': '查看自己频道上传的视频。',
  'youtube.item.media': '提供最高可用清晰度的视频和音频地址，两者分开。短时间内查询过多可能需要人机验证；暂不支持有年龄限制等访问要求的视频。',
  'youtube.item.download': '视频和音频会分别保存为两个文件，不会自动合并。',
  'youtube.item.publish': '请先创建 YouTube 频道，并准备好电脑上的 Chromium 浏览器以完成平台验证。定时视频在发布前仅自己可见，到时间后公开；上传封面需要先通过手机验证，开通自定义缩略图功能。',
  'youtube.item.delete': '只能删除自己上传的视频，需要电脑上的 Chromium 浏览器完成平台验证。',
  'youtube.comment.replies': '填写最初那条评论的编号，查看下面的全部回复。',
  'youtube.comment.add': '可以回复评论或其中某条回复，回复会显示在最初的评论下。',
  'youtube.feed.list': '登录后可查看首页推荐和订阅内容。',
  'youtube.live.get': '填写直播视频的编号或链接。',
  'youtube.live.listen': '实时查看直播中的文字聊天、付费留言和会员消息。',
  'youtube.live.send': '只能发送文字，暂不支持赠送礼物。',
  'youtube.notice.count': '只显示未读通知总数，不区分类型。',
  'youtube.series.list': '查看频道公开的播放列表；登录后填写 me，可查看自己的全部播放列表。',
  'youtube.series.items': '填写播放列表编号，或包含播放列表的链接。',
  'youtube.channel.create': '上传视频、发表评论和参与直播聊天都需要先创建频道。创建后，后续操作将使用这个频道身份。',
  'maoyan.auth.login': '请用大众点评 App 扫码。导入登录信息时，需包含大众点评的 dper Cookie。',
  'maoyan.item.get': '查看场次、场馆、票价和售卖状态。勾选查询实时票价和余票时，需要先登录。',
  'maoyan.feed.list': '显示所选城市的全部热门演出，可按分类筛选。',
  'maoyan.poi.search': '查找举办演出的城市，搜索结果中的城市编号可用于浏览该城市的演出。',
  'mteam.auth.login': '使用账号密码登录时，新设备需要邮箱验证码或验证器的动态验证码。查看站内信需使用账号密码登录，不能使用 API Key。',
  'mteam.user.get': '只能查看当前登录账号。需要上传量、下载量等详细数据时，在“更多设置”中勾选“查看未经整理的数据”。',
  'mteam.user.collects': '只能查看当前账号的收藏，可选择不同分区。',
  'mteam.item.download': '种子文件包含个人下载凭证，请勿分享。可将下载任务发送到本机的 qBittorrent，也可指定文件保存位置。',
  'mteam.msg.list': '需使用账号密码登录。可以查看收件箱、系统通知和发件箱，暂不支持发送站内信。',
  'mteam.msg.history': '填写站内信列表中的消息编号。查看后不会自动标记为已读。',
  'mteam.exam.get': '查看下载量、上传量和魔力值的考核进度及目标；没有进行中的考核时，列表为空。',
  'discord.auth.login': '支持扫码、账号密码和导入登录令牌。账号密码登录时，可在浏览器中完成人机验证，并使用验证器、短信或通行密钥完成二次验证。',
}

export function commandNote(platform: string, command: CommandMeta): string | null {
  if (command.note === '只支持 me') return '只能查看当前登录账号。'
  return COMMAND_NOTES[`${platform}.${command.resource}.${command.action}`] ?? command.note
}

/** 用户实际需要输入的编号、路径、格式仍保留，并用中文解释。 */
export function inputDescription(text: string): string {
  return text
    .replace(/comment list 输出的 id/g, '可从评论列表获取')
    .replace(/folder list 输出的 url/g, '收藏夹列表中的链接')
    .replace(/dynamic publish 输出的 id、url/g, '发布成功后显示的编号或链接')
    .replace(/article publish 返回的 id/g, '保存草稿后显示的编号')
    .replace(/train_no，如 /g, '可从车次查询结果获取，例如 ')
    .replace(/用户名或 me/g, '用户名；填写 me 表示当前账号')
    .replace(/默认 me/g, '留空使用当前账号')
    .replace(/Unicode Emoji 或自定义 Emoji 名称与 ID/g, '表情符号，或自定义表情的名称与编号')
    .replace(/UID/g, '用户编号')
    .replace(/ID|\bid\b/g, '编号')
    .replace(/URL/g, '链接')
    .replace(/（(?:sms|password|cookie|apikey)）/g, '')
    .replace(/缺省/g, '未填写时')
}

const OPTION_COPY: Record<string, { label: string; help?: string }> = {
  phone: { label: '手机号' },
  code: { label: '验证码' },
  username: { label: '用户名' },
  cursor: { label: '继续上次查询', help: '通常无需填写。需要手动继续时，填入上次“原始数据”中的 page.cursor 值。' },
  all: { label: '获取全部结果' },
  kind: { label: '推荐内容' },
  dir: { label: '下载文件夹' },
  overwrite: { label: '替换同名文件', help: '未勾选时跳过已经存在的文件。' },
  product: { label: '查看商品评价' },
  duration: { label: '持续接收多久', help: '填秒数，或用 10m 表示 10 分钟、1h 表示 1 小时。' },
  sso: { label: '使用抖音独立登录页', help: '短信登录时使用抖音的另一种登录方式。' },
  captcha: { label: '打开浏览器完成验证', help: '平台要求人机验证时，在浏览器中手动完成。' },
  'mfa-method': { label: '二次验证方式' },
  undelete: { label: '恢复正在注销的账号' },
  'order-by': { label: '排序方式' },
  asc: { label: '按从小到大或从早到晚排序' },
  mode: { label: '资源分区' },
  box: { label: '信箱' },
  status: { label: '下载与做种状态' },
  'channel-type': { label: '频道类型', help: '填写数字：0 文字、2 语音、4 分组、5 公告、13 舞台。' },
  parent: { label: '所属分组编号' },
  intents: { label: '通知权限设置', help: '填写 Discord 通知权限对应的数字；不确定时保持默认。' },
  reconnects: { label: '断线后最多重连几次' },
  events: { label: '接收哪些通知', help: '填写 Discord 事件名称，多个名称用逗号分隔；留空接收全部通知。' },
  shipping: { label: '运费方式' },
  postage: { label: '固定运费（元）', help: '选择“固定运费”时填写。' },
  'original-price': { label: '原价（元）', help: '需要同时填写商品售价。' },
  'font-size': { label: '弹幕字号', help: '18 为小号，25 为标准字号。' },
  position: { label: '弹幕位置' },
  'user-type': { label: '用户类型' },
  length: { label: '视频时长' },
  ranking: { label: '直播榜单' },
  group: { label: '通知类型' },
  bio: { label: '个人简介', help: '填写新的简介，未填写时保持原样。' },
  root: { label: '最初那条评论的编号', help: '回复评论下的某条回复时填写；还需填写实际要回复的那条评论编号。' },
  'allow-comment': { label: '允许评论' },
  'allow-duet': { label: '允许合拍', help: '视频默认关闭，图文默认开启。' },
  'allow-stitch': { label: '允许拼接', help: '视频默认关闭，图文默认开启。' },
  'allow-content-reuse': { label: '允许他人使用内容' },
  'allow-ai-remix': { label: '允许 AI 改编' },
  'from-no': { label: '出发站序号', help: '通常从车次结果点击“票价详情”会自动填写。' },
  'to-no': { label: '到达站序号', help: '通常从车次结果点击“票价详情”会自动填写。' },
  'seat-types': { label: '座位类型编码', help: '通常从车次结果点击“票价详情”会自动填写。' },
  thread: { label: '后续推文', help: '按添加顺序发布，每条回复上一条。' },
  city: { label: '演出城市', help: '填写城市名称或城市编号。' },
  'poi-name': { label: '地点名称' },
  gift: { label: '礼物编号', help: '可先查看该直播间的礼物列表。' },
  category: { label: '分类编号', help: '可先查看平台的分类列表；没有分类列表时，使用平台提供的编号。' },
  area: { label: '收货地区', help: '填写京东地区编码，例如 1_2800_55812_0；留空使用账号保存的地区。' },
}

export function optionCopy(option: OptionMeta): { label: string; help?: string } {
  if (option.flag === 'limit') return { label: option.description?.includes('关闭连接') ? '收到多少条后停止' : '最多获取多少条' }
  // 同名选项在不同操作中含义不同，保留注册表提供的具体说明。
  if (option.flag === 'category' && option.description?.includes('新分区')) return { label: '新分区编号', help: '留空沿用原分区。' }
  if (option.flag === 'category' && option.description?.includes('专栏')) return { label: '专栏分区编号', help: '填写数字，默认为 0；目前无法在这里查询专栏分区列表。' }
  if (option.flag === 'category' && option.description?.includes('多个')) return { label: '分类编号', help: '从分类列表中选择，多个编号用逗号分隔。' }
  if (option.flag === 'folder') return { label: '收藏夹', help: inputDescription(option.description ?? '').replace('取值来自 folder list', '可从收藏夹列表中查找') }
  if (option.flag === 'text') return {
    label: option.description?.includes('简介') ? '简介' : '正文',
    help: option.description?.includes('新简介') ? '留空沿用原简介。' : option.description?.includes('HTML') ? '支持 HTML 格式，可直接填写或用 @文件路径读取。' : option.description?.includes('Markdown') ? '使用 Markdown 排版，单独一行的 ![](图片路径) 可插入图片；也可用 @文件路径读取，相对图片路径以该文件所在文件夹为准。' : '直接填写正文，或用 @文件路径读取文件内容。',
  }
  if (option.flag === 'cover43') return { label: '列表页封面（4:3）', help: option.description?.includes('缺省') ? '未上传时保留原封面。' : '与播放页的 16:9 封面分别上传。' }
  if (option.flag === 'range') return { label: option.description?.includes('时间范围') ? '订单时间范围' : '搜索范围', help: option.description?.includes('时间范围') ? '填 3m 查看近三个月、this_year 查看今年，或填写四位年份，例如 2025。' : undefined }
  return OPTION_COPY[option.flag] ?? { label: inputDescription(option.description ?? option.flag) }
}
