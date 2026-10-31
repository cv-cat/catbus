import { spawn } from 'node:child_process'

// 复制与打开链接（AGENTS 4.13）。macOS 自带的 Terminal.app 不支持 OSC 52，Windows 的 clip.exe 默认按系统代码页读入、
// 中文会乱码，所以各系统用各自可靠的方式；都不行时才退回 OSC 52，再不行就只显示命令。

type Run = (cmd: string, args: string[], input?: string) => Promise<boolean>

/** 起一个子进程，可选地往 stdin 写内容；命令不存在、退出码非 0、超时都算失败。不经过 shell。 */
const run: Run = (cmd, args, input) =>
  new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true
        resolve(ok)
      }
    }
    try {
      const child = spawn(cmd, args, { stdio: [input == null ? 'ignore' : 'pipe', 'ignore', 'ignore'], windowsHide: true })
      const timer = setTimeout(() => {
        child.kill()
        done(false)
      }, 4000)
      child.on('error', () => done(false))
      child.on('close', (code) => {
        clearTimeout(timer)
        done(code === 0)
      })
      if (input != null) {
        child.stdin?.on('error', () => {})
        child.stdin?.end(input)
      }
    } catch {
      done(false)
    }
  })

export type CopyMethod = 'pbcopy' | 'powershell' | 'wl-copy' | 'xclip' | 'xsel' | 'osc52'

/** PowerShell 的命令：文字用 base64 传进去，避开 shell 引号和代码页两个坑。 */
export function powershellCopyArgs(text: string): string[] {
  const b64 = Buffer.from(text, 'utf8').toString('base64')
  const script = `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | Set-Clipboard`
  return ['-NoProfile', '-NonInteractive', '-Command', script]
}

export function osc52(text: string): string {
  return `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`
}

/** 复制到系统剪贴板，返回用了哪种方式；全部失败时返回 null。 */
export async function copyText(text: string, write: (s: string) => void = (s) => process.stdout.write(s), platform = process.platform): Promise<CopyMethod | null> {
  if (platform === 'darwin') {
    if (await run('pbcopy', [], text)) return 'pbcopy'
  } else if (platform === 'win32') {
    if (await run('powershell.exe', powershellCopyArgs(text))) return 'powershell'
  } else {
    if (process.env.WAYLAND_DISPLAY && (await run('wl-copy', [], text))) return 'wl-copy'
    if (await run('xclip', ['-selection', 'clipboard'], text)) return 'xclip'
    if (await run('xsel', ['--clipboard', '--input'], text)) return 'xsel'
  }
  // 终端自己支持 OSC 52 时有效（iTerm2、Windows Terminal、kitty 等）；不支持的会忽略，所以无法确认成功
  if (process.stdout.isTTY) {
    write(osc52(text))
    return 'osc52'
  }
  return null
}

/** 用系统默认的程序打开本地文件（二维码图片）。不经过 shell。 */
export async function openFile(path: string, platform = process.platform): Promise<boolean> {
  if (platform === 'darwin') return run('open', [path])
  if (platform === 'win32') return run('rundll32.exe', ['url.dll,FileProtocolHandler', path])
  return run('xdg-open', [path])
}

/** 在默认浏览器里打开链接。只接受 http(s)，避免把任意字符串交给系统的打开命令。 */
export async function openUrl(url: string, platform = process.platform): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false
  if (platform === 'darwin') return run('open', [url])
  // rundll32 不经 shell，所以链接里的 & 不会被 cmd 当成命令分隔符
  if (platform === 'win32') return run('rundll32.exe', ['url.dll,FileProtocolHandler', url])
  return run('xdg-open', [url])
}

