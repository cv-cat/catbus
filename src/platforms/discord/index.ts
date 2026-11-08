import { z } from 'zod'
import { DOWNLOAD, STREAM } from '../../core/options.js'
import { type CommandDecl, definePlatform, handlers } from '../../core/registry.js'
import { type ArgSpec, checkMsgSend } from '../../core/vocab.js'

const { h, impl } = handlers(() => import('./pc/commands.js'))
const argument = (name: string, summary: string, optional = false): ArgSpec => ({ name, summary, ...(optional ? { optional } : {}) })
const guild = argument('guild', '服务器 ID')
const channel = argument('channel', '频道 ID')
const conversation = argument('conversation', '频道或私信会话 ID')
const message = argument('message', '消息 ID')
const emoji = argument('emoji', 'Unicode Emoji 或自定义 Emoji 名称与 ID')
const user = argument('user', '用户 ID')
const channelOutput = '{id guild_id name type topic}'
const wsOptions = {
  ...STREAM,
  limit: z.number().int().positive().optional().describe('输出指定条数后关闭连接'),
  reconnects: z.number().int().nonnegative().optional().describe('断线后的重连次数，默认 5'),
  intents: z.number().int().min(0).max(2 ** 31 - 1).optional().describe('Bot Gateway intents 位掩码'),
}

function extension(name: Parameters<typeof h>[0], summary: string, args: ArgSpec[], output = '{id}', extra: Partial<CommandDecl> = {}) {
  return impl('full', name, { summary, args, output, auth: 'required', ...extra })
}

export default definePlatform({
  id: 'discord', name: 'Discord', aliases: [], item: '消息', defaultEndpoint: 'pc',
  endpoints: {
    web: 'planned',
    app: 'planned',
    pc: {
      label: 'macOS 桌面端',
      login: { methods: ['qrcode', 'password', 'token'], default: 'qrcode' },
      logout: h('authLogout'),
      commands: {
        'auth login': impl('partial', 'authLogin', {
          supports: ['username', 'passwordStdin', 'code'],
          note: '扫码、账密与凭证导入。账密支持浏览器人机验证、TOTP、短信和 WebAuthn',
          options: {
            tokenFile: z.string().min(1).optional().describe('从文件读取 Authorization 凭证'),
            tokenStdin: z.boolean().optional().describe('从 stdin 读取 Authorization 凭证'),
            mfaMethod: z.enum(['totp', 'sms', 'webauthn']).optional().describe('账密 MFA 方式，默认 totp'),
            undelete: z.boolean().optional().describe('请求恢复待删除账号'),
            captcha: z.boolean().optional().describe('在非交互式调用中启用浏览器人机验证'),
          },
          check: (_args, options) => {
            if (options.tokenFile && options.tokenStdin) return '--token-file 与 --token-stdin 只能用一个'
            if (options.method !== 'token' && (options.tokenFile || options.tokenStdin)) return '导入凭证需要 --method token'
            if (options.method !== 'password' && (options.username || options.passwordStdin || options.code || options.mfaMethod || options.undelete || options.captcha)) {
              return '账密和 MFA 选项需要 --method password'
            }
            if (options.mfaMethod === 'webauthn' && options.code != null) return 'WebAuthn 使用通行密钥或安全密钥，无需 --code'
          },
        }),
        'auth status': impl('full', 'authStatus'),
        'user get': impl('full', 'userGet', { args: [{ ...user, summary: '用户 ID，默认 me', optional: true, default: 'me' }] }),
        'account settings': extension('accountSettings', '读取账号设置', [], '{settings}'),
        'device register': extension('deviceRegister', '注册账号设备 ID', [], '{id client_uuid}'),
        'guild list': extension('guildList', '列出加入的服务器', [], '{id name icon}[]', { paged: true }),
        'guild get': extension('guildGet', '查看服务器详情', [guild], '{id name icon}'),
        'guild leave': extension('guildLeave', '退出服务器', [guild], '{id}', { confirm: true }),
        'channel list': extension('channelList', '列出服务器频道', [guild], `${channelOutput}[]`),
        'channel get': extension('channelGet', '查看频道详情', [channel], channelOutput),
        'channel create': extension('channelCreate', '创建服务器频道', [guild, argument('name', '频道名')], channelOutput, {
          options: {
            channelType: z.number().int().refine((n) => [0, 2, 4, 5, 13].includes(n)).default(0).describe('0 文本，2 语音，4 分组，5 公告，13 舞台'),
            channelTopic: z.string().optional().describe('频道主题'),
            parent: z.string().optional().describe('父频道 ID'),
            channelPosition: z.number().int().optional().describe('频道位置'),
          },
        }),
        'channel update': extension('channelUpdate', '编辑频道名称或主题', [channel], channelOutput, {
          options: { name: z.string().optional().describe('频道名'), channelTopic: z.string().optional().describe('频道主题') },
          check: (_args, options) => options.name == null && options.channelTopic == null ? '--name 与 --channel-topic 至少给一个' : undefined,
        }),
        'channel delete': extension('channelDelete', '删除频道', [channel], '{id}', { confirm: true }),
        'msg list': impl('full', 'msgList', { summary: '列出私信会话', paged: false }),
        'msg history': impl('full', 'msgHistory', { summary: '列出频道或私信的历史消息', args: [conversation] }),
        'msg send': impl('full', 'msgSend', {
          summary: '向频道或用户发送消息', supports: ['to', 'conversation'],
          options: { file: z.string().optional().describe('本地附件，最多 25 MiB'), replyTo: z.string().optional().describe('回复消息 ID') },
          check: (args, options) => checkMsgSend(args, options, { content: ['file'] }),
        }),
        'msg read': impl('full', 'msgRead', { args: [conversation], options: { message: z.string().describe('最后已读消息 ID') } }),
        'msg revoke': impl('full', 'msgRevoke', { args: [conversation, message] }),
        'msg listen': impl('full', 'msgListen', { options: { ...wsOptions, conversation: z.string().optional().describe('只接收指定频道的消息') } }),
        'msg get': extension('msgGet', '查看单条消息', [conversation, message], 'Message'),
        'msg update': extension('msgUpdate', '编辑消息', [conversation, message, argument('text', '新消息内容')], 'Message'),
        'msg purge': extension('msgPurge', '批量删除消息', [conversation, argument('messages', '逗号分隔的 2 至 100 个消息 ID')], '{ids}', { confirm: true }),
        'msg typing': extension('msgTyping', '发送正在输入状态', [conversation]),
        'msg pins': extension('msgPins', '列出置顶消息', [conversation], 'Message[]'),
        'msg pin': extension('msgPin', '置顶消息', [conversation, message]),
        'msg unpin': extension('msgUnpin', '取消置顶消息', [conversation, message]),
        'reaction list': extension('reactionList', '列出添加反应的用户', [conversation, message, emoji], 'User[]', { paged: true }),
        'reaction add': extension('reactionAdd', '添加 Emoji 反应', [conversation, message, emoji]),
        'reaction delete': extension('reactionDelete', '移除 Emoji 反应', [conversation, message, emoji], '{id}', {
          options: { userId: z.string().optional().describe('移除指定用户的反应，需要管理权限') }, confirm: true,
        }),
        'reaction clear': extension('reactionClear', '清空指定 Emoji 或全部反应', [conversation, message, { ...emoji, optional: true }], '{id}', { confirm: true }),
        'friend add': extension('friendAdd', '按 ID 或用户名添加好友', [argument('target', '用户 ID、用户名或旧式 name#0001')], '{id target}', {
          options: { captcha: z.boolean().optional().describe('在非交互式调用中启用浏览器人机验证') },
        }),
        'friend delete': extension('friendDelete', '移除好友或取消请求', [user], '{id}', { confirm: true }),
        'friend accept': extension('friendAccept', '接受好友请求', [user]),
        'friend block': extension('friendBlock', '屏蔽用户', [user]),
        'friend unblock': extension('friendUnblock', '取消屏蔽用户', [user]),
        'attachment download': extension('attachmentDownload', '下载附件到本地', [argument('url', '附件 HTTPS URL')], '{path filename size}', { options: DOWNLOAD }),
        'gateway get': extension('gatewayGet', '获取 Gateway 地址', [], '{url}'),
        'gateway listen': extension('gatewayListen', '接收 Gateway 实时事件', [], '{event data}', {
          stream: true, options: { ...wsOptions, events: z.string().optional().describe('逗号分隔的事件名') },
        }),
      },
    },
  },
})
