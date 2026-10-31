import { Box } from 'ink'
import type { Platform } from '../core/registry.js'
import type { AuthStatus, AccountRow } from './login.js'
import { Keys, Pane, Row, T, useGlyphs } from './ui.js'
import { clip } from './text.js'

// 账号页（AGENTS 4.13）：本平台的账号，切换、检查、登出、登录新账号。

export interface AccountsState {
  rows: AccountRow[]
  selected: number
  /** 每个账号最近一次在线检查的结果。 */
  checked: Record<string, AuthStatus | 'checking' | 'failed'>
  /** 等待确认的登出：账号名。 */
  confirmLogout: string | null
  loading: boolean
}

const METHOD: Record<string, string> = { qrcode: '扫码', sms: '短信', password: '账密', cookie: 'cookie', guest: '游客' }

export function AccountsView({ platform, state, cols, rows, canLogin, note }: { platform: Platform; state: AccountsState; cols: number; rows: number; canLogin: boolean; note: string | null }) {
  const g = useGlyphs()
  const inner = cols - 2
  const list = state.rows
  return (
    <Pane title={`账号 ${g.sep} ${platform.name}`} cols={cols} rows={rows} focused>
      {state.loading ? (
        <Box paddingLeft={2} paddingTop={1}>
          <T c="dim">读取中…</T>
        </Box>
      ) : null}
      {!state.loading && list.length === 0 ? (
        <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
          <T>{canLogin ? `还没有登录 ${platform.name}。` : `${platform.name}不需要登录，没有账号。`}</T>
          {canLogin ? (
            <Box paddingTop={1}>
              <T c="dim">按 </T>
              <T c="accent">n</T>
              <T c="dim"> 登录一个账号。</T>
            </Box>
          ) : null}
        </Box>
      ) : null}
      {list.map((a, i) => {
        const status = <CheckStatus checked={state.checked[a.account]} />
        return (
          <Row
            key={a.account}
            cols={inner}
            selected={i === state.selected}
            right={METHOD[a.method ?? ''] ?? a.method ?? ''}
            left={
              <>
                <T c={a.active ? 'green' : 'dim'}>{a.active ? g.dotOn : g.dotOff}</T> {a.account}
                <T c="sub">{'  ' + clip(a.user?.name ?? a.user?.id ?? '（未知用户）', Math.max(6, inner - 36), g.more)}</T>
                {'  '}
                {status}
              </>
            }
          />
        )
      })}
      {state.confirmLogout ? (
        <Box paddingLeft={2} paddingTop={1}>
          <T c="yellow" bold>
            {`登出 ${state.confirmLogout}？`}
          </T>
          <T c="dim">{'  会删除本地凭证；平台支持时同时退出服务端。'}</T>
          <T c="accent">{'  按 y 确认，其他键取消'}</T>
        </Box>
      ) : null}
      {note ? (
        <Box paddingLeft={2} paddingTop={1}>
          <T c="green">{clip(note, cols - 6, g.more)}</T>
        </Box>
      ) : null}
    </Pane>
  )
}

/** 账号最近一次在线检查的结果。 */
function CheckStatus({ checked }: { checked: AccountsState['checked'][string] | undefined }) {
  const g = useGlyphs()
  if (checked === undefined) return <T c="dim">未检查</T>
  if (checked === 'checking') return <T c="dim">检查中…</T>
  if (checked === 'failed') return <T c="red">检查失败</T>
  if (checked.logged_in) return <T c="green">{`${g.dotOn} 有效`}</T>
  return <T c="yellow">{`${g.dotOff} 已失效，需重新登录`}</T>
}

export function accountKeys(cols: number, canLogin: boolean): React.ReactNode {
  return (
    <Keys
      cols={cols}
      items={[['↑↓', '选择'], ['Enter', '设为当前'], ['t', '检查'], ...(canLogin ? ([['n', '登录新账号']] as [string, string][]) : []), ['x', '登出'], ['Esc', '返回']]}
    />
  )
}
