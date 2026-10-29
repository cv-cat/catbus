import { Box, Text } from 'ink'
import { useMemo } from 'react'
import type { LoginMethod } from '../core/options.js'
import type { Platform } from '../core/registry.js'
import { splitAtCursor, type TextState } from './input.js'
import { fieldsFor, type LoginView as View } from './login.js'
import { qrCells, qrSize } from './qr.js'
import { Keys, Pane, T, useGlyphs, useLook } from './ui.js'
import { clip } from './text.js'

// 登录页（AGENTS 4.13）：选方式、填账号名和必要字段，然后显示二维码或验证码输入。

const METHOD_LABEL: Record<LoginMethod, string> = {
  qrcode: '扫码',
  sms: '短信验证码',
  password: '账号密码',
  cookie: '导入 cookie',
  oauth: '浏览器授权',
}

export interface SetupState {
  methods: LoginMethod[]
  method: number
  account: string
  scopes: string[]
  scope: number
  /** 方式需要的字段值。 */
  values: Record<string, string>
  /** 焦点：0 方式，1 账号名，2 子站点（有才有），之后是方式的字段。 */
  focus: number
}

/** 表单里依次有哪些行：方式、账号名、（子站点）、方式的字段。 */
export function setupRows(s: SetupState): { id: string; label: string }[] {
  const rows = [
    { id: 'method', label: '登录方式' },
    { id: 'account', label: '账号名' },
  ]
  if (s.scopes.length) rows.push({ id: 'scope', label: '子站点' })
  for (const f of fieldsFor(s.methods[s.method]!)) rows.push({ id: f.name, label: f.label })
  return rows
}

export function SetupView({ platform, state, editor, cols, rows, error }: { platform: Platform; state: SetupState; editor: TextState; cols: number; rows: number; error: string | null }) {
  const g = useGlyphs()
  const list = setupRows(state)
  const method = state.methods[state.method]!
  const labelW = 10
  const valueW = Math.max(10, cols - 6 - labelW)
  return (
    <Pane title={`登录 ${g.sep} ${platform.name}`} cols={cols} rows={rows} focused>
      <Box paddingLeft={2} paddingTop={1}>
        <T c="dim">账号会保存在 ~/.catbus，不带账号名时登录到当前账号，没有就是 default。</T>
      </Box>
      <Box height={1} />
      {list.map((r, i) => {
        const on = state.focus === i
        let shown: React.ReactNode
        if (r.id === 'method') {
          shown = (
            <>
              {state.methods.map((m, j) => (
                <T key={m} bg={j === state.method ? 'dim' : undefined} c={j === state.method ? undefined : 'dim'}>
                  {j === state.method ? ` ${METHOD_LABEL[m]} ` : ` ${METHOD_LABEL[m]}`}
                </T>
              ))}
            </>
          )
        } else if (r.id === 'scope') {
          shown = (
            <>
              {['main', ...state.scopes].map((sc, j) => {
                const name = sc === 'main' ? '主站' : sc
                const picked = j === state.scope
                return (
                  <T key={sc} bg={picked ? 'dim' : undefined} c={picked ? undefined : 'dim'}>
                    {picked ? ` ${name} ` : ` ${name}`}
                  </T>
                )
              })}
            </>
          )
        } else {
          const raw = r.id === 'account' ? state.account : (state.values[r.id] ?? '')
          const hidden = fieldsFor(method).find((f) => f.name === r.id)?.hidden
          if (on) {
            const [a, c, b] = splitAtCursor(editor)
            const mask = (t: string) => (hidden ? '*'.repeat([...t].length) : t)
            shown = (
              <>
                <T c="accent">{mask(a)}</T>
                <T bg="accent">{c === '' ? ' ' : hidden ? '*' : c}</T>
                <T c="accent">{mask(b)}</T>
              </>
            )
          } else {
            const text = hidden ? '*'.repeat(Math.min(12, [...raw].length)) : raw
            shown = text ? <T c="accent">{clip(text, valueW, g.more)}</T> : <T c="dim">{r.id === 'account' ? '留空 = 当前账号或 default' : '必填'}</T>
          }
        }
        return (
          <Box key={r.id}>
            <T c="accent">{on ? g.caret : ' '}</T>
            <T c={on ? 'fg' : 'dim'}>{(' ' + r.label).padEnd(labelW)}</T>
            <Box width={valueW} overflow="hidden">
              {shown}
            </Box>
          </Box>
        )
      })}
      <Box height={1} />
      <Box paddingLeft={2}>
        <T bg="green" bold>
          {' Enter 开始登录 '}
        </T>
      </Box>
      {method === 'cookie' ? (
        <Box paddingLeft={2} paddingTop={1}>
          <T c="dim">cookie 从浏览器开发者工具里复制；粘贴时用终端的粘贴快捷键。</T>
        </Box>
      ) : null}
      {error ? (
        <Box paddingLeft={2} paddingTop={1}>
          <T c="red">{clip(error, cols - 6, g.more)}</T>
        </Box>
      ) : null}
    </Pane>
  )
}

export function SetupKeys({ cols }: { cols: number }) {
  return <Keys cols={cols} items={[['↑↓ Tab', '换项'], ['←→', '选方式'], ['Enter', '开始'], ['Esc', '返回']]} />
}

// ---- 进行中 ----

export function ProgressView({
  platform,
  view,
  editor,
  cols,
  rows,
  spin,
  log,
}: {
  platform: Platform
  view: View
  editor: TextState
  cols: number
  rows: number
  spin: string
  log: string | null
}) {
  const g = useGlyphs()
  return (
    <Pane title={`登录 ${g.sep} ${platform.name}`} cols={cols} rows={rows} focused>
      {view.type === 'working' ? (
        <Box paddingLeft={2} paddingTop={1}>
          <T c="accent">{spin}</T>
          <T>{'  ' + view.text}</T>
        </Box>
      ) : null}
      {view.type === 'qrcode' ? <QrBlock content={view.content} png={view.png} hint={view.hint} cols={cols - 2} rows={rows - 2} spin={spin} /> : null}
      {view.type === 'link' ? (
        <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
          <T bold>需要在浏览器里完成人机验证</T>
          <Box paddingTop={1}>
            <T c="sub">{view.hint}</T>
          </Box>
          <Box paddingTop={1}>
            <T c="sky">{view.url}</T>
          </Box>
          <Box paddingTop={1}>
            <T c="accent">{spin}</T>
            <T>{'  等待你在浏览器里完成…'}</T>
          </Box>
          <Box paddingTop={1}>
            <T c="dim">按 o 在默认浏览器打开；复制链接请选中上面这行。</T>
          </Box>
        </Box>
      ) : null}
      {view.type === 'prompt' ? (
        <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
          <T bold>{view.question.replace(/[：:]\s*$/, '')}</T>
          <Box height={1} />
          <PromptBox editor={editor} hidden={view.hidden} width={Math.min(cols - 8, 40)} />
          {log ? (
            <Box paddingTop={1}>
              <T c="dim">{clip(log, cols - 8, g.more)}</T>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Pane>
  )
}

function PromptBox({ editor, hidden, width }: { editor: TextState; hidden: boolean; width: number }) {
  const [a, c, b] = splitAtCursor(editor)
  const mask = (t: string) => (hidden ? '*'.repeat([...t].length) : t)
  return (
    <Box width={width}>
      <T c="accent">{'> '}</T>
      <T>{mask(a)}</T>
      <T bg="accent">{c === '' ? ' ' : hidden ? '*' : c}</T>
      <T>{mask(b)}</T>
    </Box>
  )
}

function QrBlock({ content, png, hint, cols, rows, spin }: { content: string; png: string; hint: string; cols: number; rows: number; spin: string }) {
  const look = useLook()
  const size = useMemo(() => qrSize(content), [content])
  // 并排还是上下排：宽度够就把说明放在二维码右边（只需要二维码本身的行数），否则说明排在下面（再留 9 行）
  const side = cols >= size.cols + 4 + 34
  // 紧凑排法：只有二维码和下面一行状态，说明文字都省掉（窗口再小就只能用图片）
  const compact = !side && size.cols + 2 <= cols && size.rows + 3 <= rows
  const fits = side || compact || (size.cols + 4 <= cols && size.rows + 9 <= rows)
  const cells = useMemo(() => (fits ? qrCells(content) : null), [fits, content])
  if (compact && cells) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        {cells.lines.map((row, y) => (
          <Box key={y}>
            {row.map((run, i) => (
              <Text key={i} color={run.fg} backgroundColor={run.bg}>
                {run.text}
              </Text>
            ))}
          </Box>
        ))}
        <Box>
          <T c="accent">{spin}</T>
          <T>{' ' + clip(hint, cols - 22, '…')}</T>
          <T c="dim">{'  o 看图片'}</T>
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection={side ? 'row' : 'column'} paddingLeft={2} paddingTop={1} gap={3}>
      {cells ? (
        <Box flexDirection="column" width={cells.cols}>
          {cells.lines.map((row, y) => (
            <Box key={y}>
              {row.map((run, i) => (
                // 二维码必须是“黑码白底”，不随主题、也不受 NO_COLOR 影响：没有颜色就扫不出来
                <Text key={i} color={run.fg} backgroundColor={run.bg}>
                  {run.text}
                </Text>
              ))}
            </Box>
          ))}
        </Box>
      ) : (
        <Box flexDirection="column">
          <T c="yellow" bold>
            窗口放不下二维码
          </T>
          <T c="dim">{`这张码要 ${Math.max(80, size.cols + 4)} × ${size.rows + 8} 的窗口才画得下；放大窗口，或按 o 打开图片扫码。`}</T>
        </Box>
      )}
      <Box flexDirection="column" width={Math.max(24, side ? cols - size.cols - 9 : cols - 6)}>
        <T bold>{hint}</T>
        <Box height={1} />
        <Box>
          <T c="accent">{spin}</T>
          <T>{'  等待扫码和确认'}</T>
        </Box>
        <Box height={1} />
        <T c="dim">二维码图片</T>
        <T c="sky">{png}</T>
        {look.ascii ? (
          <Box paddingTop={1}>
            <T c="dim">ASCII 模式下二维码仍用方块字符；显示不全时请用图片。</T>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

export function ProgressKeys({ cols, view }: { cols: number; view: View }) {
  const items: [string, string][] = view.type === 'link' ? [['o', '打开浏览器'], ['Esc', '取消']] : view.type === 'qrcode' ? [['o', '打开图片'], ['r', '换一张码'], ['Esc', '取消']] : view.type === 'prompt' ? [['Enter', '提交'], ['Esc', '取消']] : [['Esc', '取消']]
  return <Keys cols={cols} items={items} />
}

export function ResultView({ platform, view, cols, rows }: { platform: Platform; view: Extract<View, { type: 'done' | 'error' }>; cols: number; rows: number }) {
  const g = useGlyphs()
  if (view.type === 'done') {
    const a = view.account
    return (
      <Pane title={`登录成功 ${g.sep} ${platform.name}`} cols={cols} rows={rows} focused>
        <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
          <T c="green" bold>
            已登录
          </T>
          <Box height={1} />
          <Box>
            <T c="dim">{'用户    '}</T>
            <T>{a.user?.name ?? a.user?.id ?? '-'}</T>
          </Box>
          <Box>
            <T c="dim">{'账号名  '}</T>
            <T>{a.account}</T>
            <T c="dim">{a.current ? '（当前账号）' : ''}</T>
          </Box>
          <Box>
            <T c="dim">{'方式    '}</T>
            <T>{a.method ?? '-'}</T>
          </Box>
        </Box>
      </Pane>
    )
  }
  const e = view.error
  const risk = e.code === 'RISK_CONTROL'
  return (
    <Pane title={`登录失败 ${g.sep} ${platform.name} · ${e.code}`} cols={cols} rows={rows} focused>
      <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <T c={risk ? 'yellow' : 'red'} bold>
          {risk ? '触发验证码或风控' : '没有登录成功'}
        </T>
        <T>{clip(e.message, cols - 6, g.more)}</T>
        {e.hint ? (
          <Box paddingTop={1}>
            <T c="dim">{'建议：'}</T>
            <T c="accent">{clip(e.hint, cols - 14, g.more)}</T>
          </Box>
        ) : null}
        {risk ? (
          <Box paddingTop={1}>
            <T c="dim">验证码自动过不了时，换扫码登录，或稍等几分钟再试。</T>
          </Box>
        ) : null}
      </Box>
    </Pane>
  )
}
