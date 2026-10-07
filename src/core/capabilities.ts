import { describeOption, FILTER_VALUES, flagName, PAGING, STANDARD_VALUES } from './options.js'
import { type AvailableEndpoint, type Command, type Platform, sortCommands, type Upstream } from './registry.js'
import { VOCAB } from './vocab.js'

/** 生成 docs/capabilities.md（web 端能力矩阵）。只由注册表决定，`npm run gen:capabilities` 写盘，测试检查是否最新。 */

const SYMBOL: Record<Upstream, string> = { full: '✓', partial: '◐', none: '○' }

interface Section {
  title: string
  resources: string[]
  intro?: string | ((platforms: Platform[]) => string)
  outro?: string
}

const SECTIONS: Section[] = [
  {
    title: 'auth',
    resources: ['auth'],
    intro: (platforms) =>
      `\`login\` 见上表。\`logout\` / \`list\` / \`use\` 由 core 实现，所有平台都有；服务端登出只有 ${platforms
        .filter((p) => web(p).logout)
        .map((p) => p.id)
        .join('、')}。`,
  },
  { title: 'user', resources: ['user'] },
  { title: 'item', resources: ['item'] },
  {
    title: 'product 与商品评价',
    resources: ['product'],
    outro:
      '商品评价用 `comment list <product>`（见下节）：传商品 URL 时自动识别，传纯 ID 时加 `--product`。\n\n' +
      '闲鱼、淘宝、京东的商品本身就是 item：商品详情用 `item get`，商品评价用 `comment list <item>`。',
  },
  { title: 'comment', resources: ['comment'] },
  { title: 'feed 与 keyword', resources: ['feed', 'keyword'] },
  { title: 'notice 与 msg', resources: ['notice', 'msg'] },
  { title: 'media、folder、series、history、topic、poi', resources: ['media', 'folder', 'series', 'history', 'topic', 'poi'] },
  { title: 'live', resources: ['live'] },
]

/** 不在命令表里出现的命令：login 有单独的表，list / use / logout 由 core 实现。 */
const OMITTED = new Set(['auth login', 'auth logout', 'auth list', 'auth use'])

const FILTERS = Object.keys(FILTER_VALUES)

function web(platform: Platform): AvailableEndpoint {
  const ep = platform.endpoints.web
  if (ep === 'planned') throw new Error(`${platform.id} 的 web 端是 planned`)
  return ep
}

function row(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

function header(first: string, platforms: Platform[]): string[] {
  return [row([first, ...platforms.map((p) => p.id)]), '|' + '---|'.repeat(platforms.length + 1)]
}

function loginTable(platforms: Platform[]): string[] {
  const logins = platforms.map((p) => web(p).login)
  const lines = [...header('', platforms)]
  for (const method of ['qrcode', 'sms', 'password', 'cookie'] as const) {
    lines.push(row([method, ...logins.map((l) => (l.methods.includes(method) ? '✓' : ''))]))
  }
  lines.push(row(['默认', ...logins.map((l) => (l.methods.length ? l.default : '—'))]))
  if (logins.some((l) => l.scopes?.length)) lines.push(row(['子站点', ...logins.map((l) => (l.scopes ?? []).join('、'))]))
  return lines
}

interface Row {
  label: string
  keys: string[]
  cells: string[]
  notes: (string | null)[]
}

function commandRows(platforms: Platform[], resources: string[]): Row[] {
  const rows: Row[] = []
  for (const key of Object.keys(VOCAB)) {
    const [resource, action] = key.split(' ') as [string, string]
    if (!resources.includes(resource) || OMITTED.has(key)) continue
    const commands = platforms.map((p) => web(p).commands.get(key))
    const cells = commands.map((c) => (c?.upstream ? SYMBOL[c.upstream] : '—'))
    const notes = commands.map((c) => c?.note ?? null)
    const prev = rows.at(-1)
    // 同一 resource 下相邻、各平台状态和说明都相同的命令合并成一行，例如 user followers / following
    if (prev && prev.keys[0]!.startsWith(resource + ' ') && prev.cells.join() === cells.join() && prev.notes.join() === notes.join()) {
      prev.keys.push(key)
      prev.label += ` / ${action}`
    } else {
      rows.push({ label: key, keys: [key], cells, notes })
    }
  }
  return rows
}

/** 表下的补充：◐ 的说明、筛选取值、平台私有选项。 */
function footnotes(platforms: Platform[], rows: Row[]): string[] {
  const lines: string[] = []
  for (const r of rows) {
    r.notes.forEach((note, i) => {
      if (note) lines.push(`- ${platforms[i]!.id} \`${r.label}\`：${note}`)
    })
  }
  for (const r of rows) {
    for (const key of r.keys) {
      const commands = platforms.map((p) => [p, web(p).commands.get(key)] as const).filter(([, c]) => c) as [Platform, Command][]
      // 词表给了、平台不支持的标准选项（用了报 UNSUPPORTED）
      const without = commands.filter(([, c]) => c.unsupported.length)
      if (without.length) {
        lines.push(`- \`${key}\` 不支持的标准选项：${without.map(([p, c]) => `${p.id} ${c.unsupported.map((o) => `--${flagName(o)}`).join(' ')}`).join('；')}`)
      }
      // 有标准取值、平台只支持其中一部分的选项（例如 --visibility）
      for (const option of Object.keys(VOCAB[key]!.options).filter((o) => STANDARD_VALUES[o] && o !== 'method')) {
        const dflt = describeOption(VOCAB[key]!.options[option]!).values
        const differ = commands.filter(([, c]) => option in c.options && describeOption(c.options[option]!).values?.join() !== dflt?.join())
        if (!differ.length) continue
        const values = differ.map(([p, c]) => `${p.id} ${describeOption(c.options[option]!).values?.join(' / ')}`)
        lines.push(`- \`${key} --${flagName(option)}\` 取值：默认 ${dflt?.join(' / ')}；${values.join('；')}`)
      }
      const base = new Set([...Object.keys(VOCAB[key]!.options), ...Object.keys(PAGING)])
      const extra = [...new Set(commands.flatMap(([, c]) => Object.keys(c.options)))].filter((o) => !base.has(o))
      for (const option of extra) {
        const has = commands.filter(([, c]) => option in c.options)
        if (FILTERS.includes(option) || (STANDARD_VALUES[option] && option !== 'method')) {
          const values = has.map(([p, c]) => `${p.id} ${describeOption(c.options[option]!).values?.join(' / ')}`)
          lines.push(`- \`${key} --${flagName(option)}\` 取值：${values.join('；')}`)
        } else {
          lines.push(`- \`${key} --${flagName(option)}\`：${has.map(([p]) => p.id).join('、')}`)
        }
      }
    }
  }
  return lines
}

function extensions(platforms: Platform[]): string[] {
  const lines = [row(['平台', '命令']), '|---|---|']
  for (const p of platforms) {
    const ext = sortCommands(web(p).commands.values()).filter((c) => c.extension)
    if (ext.length) lines.push(row([p.id, ext.map((c) => `\`${c.key}\` ${SYMBOL[c.upstream!]}`).join(' · ')]))
  }
  return lines
}

export function renderCapabilities(platforms: Platform[]): string {
  const out: string[] = [
    '# 能力矩阵',
    '',
    '各平台 web 端的能力。命令规范见 [AGENTS.md](../AGENTS.md) 第 4 节，上游代码位置见 [upstream-map.md](upstream-map.md)。',
    '',
    '- 本文件由注册表（`src/platforms/<p>/index.ts`）生成：`npm run gen:capabilities`。不要手改，测试会检查它是否最新。',
    '- app / pc 端目前全部是 planned，不在本表列出。',
    '',
    '| 符号 | 含义 | 注册表 status | 执行结果 |',
    '|---|---|---|---|',
    '| ✓ | 上游已有 | implemented | 正常执行 |',
    '| ◐ | 上游部分支持，限制写在注册表的 `note` 里 | implemented | 正常执行 |',
    '| ○ | 平台有这个概念，上游没有，规划中 | planned | `NOT_IMPLEMENTED`，退出码 4 |',
    '| — | 平台没有这个概念 | 不注册 | `UNSUPPORTED`，退出码 2 |',
    '',
    `列顺序：${platforms.map((p) => p.id).join(' · ')}。`,
    '',
    '## 登录方式',
    '',
    ...loginTable(platforms),
  ]
  for (const s of SECTIONS) {
    const rows = commandRows(platforms, s.resources)
    out.push('', `## ${s.title}`, '')
    if (s.intro) out.push(typeof s.intro === 'function' ? s.intro(platforms) : s.intro, '')
    out.push(...header('命令', platforms), ...rows.map((r) => row([r.label, ...r.cells])))
    const notes = footnotes(platforms, rows)
    if (notes.length) out.push('', ...notes)
    if (s.outro) out.push('', s.outro)
  }
  out.push('', '## 平台扩展', '', '命令定义见 AGENTS.md 4.7。', '', ...extensions(platforms))
  return out.join('\n') + '\n'
}
