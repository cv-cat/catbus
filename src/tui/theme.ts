// 配色（AGENTS 4.13）：Catppuccin Mocha / Latte，文字对三种底色（正文底、选中行底、顶栏底）的对比度都不低于 4.5:1。
// 两套色值是按对比度调过的，和 Catppuccin 官方值不完全一致。

export interface Palette {
  bg: string
  bar: string
  sel: string
  line: string
  dim: string
  sub: string
  fg: string
  accent: string
  mauve: string
  green: string
  yellow: string
  red: string
  blue: string
  teal: string
  pink: string
  sky: string
}

export const MOCHA: Palette = {
  bg: '#1e1e2e', bar: '#181825', sel: '#313244', line: '#45475a', dim: '#9aa1bb', sub: '#a6adc8', fg: '#cdd6f4',
  accent: '#fab387', mauve: '#cba6f7', green: '#a6e3a1', yellow: '#f9e2af', red: '#f38ba8', blue: '#89b4fa', teal: '#94e2d5',
  pink: '#f5c2e7', sky: '#89dceb',
}

export const LATTE: Palette = {
  bg: '#eff1f5', bar: '#e6e9ef', sel: '#dce0e8', line: '#9ca0b0', dim: '#555870', sub: '#4c4f69', fg: '#2c2f45',
  accent: '#a63f00', mauve: '#7a2fe0', green: '#226414', yellow: '#7a4f00', red: '#c00d33', blue: '#1556d6', teal: '#0f625e',
  pink: '#a82170', sky: '#0b6377',
}

export interface Env {
  NO_COLOR?: string
  CATBUS_TUI_THEME?: string
  CATBUS_TUI_ASCII?: string
  CATBUS_TUI_ANIMATE?: string
  /** Windows Terminal 会设置它；它的字体回退完整，盲文转圈能正常显示。 */
  WT_SESSION?: string
  COLORFGBG?: string
  [key: string]: string | undefined
}

export interface Look {
  palette: Palette
  /** NO_COLOR：不输出任何颜色，只用粗体、反色和符号区分。 */
  mono: boolean
  /** 纯 ASCII 边框和标记，用于把模糊宽度字符显示成 2 列的终端。 */
  ascii: boolean
  /** 吉祥物动画。Windows 控制台遇到整屏的帧会每帧清屏重绘，动画会闪，所以那里默认不动。 */
  animate: boolean
  /** 转圈用 | / - \\ 而不是盲文点阵：老的 Windows 控制台（conhost + Consolas）没有盲文字形，会显示成方块。 */
  plainSpinner: boolean
}

/**
 * 选主题：CATBUS_TUI_THEME=light|dark 优先；否则看 COLORFGBG（"前景;背景"，背景 7 和 15 是浅色，rxvt 系和部分终端会设置）；
 * 都没有就用深色。Windows Terminal 和 macOS Terminal.app 不设置 COLORFGBG，所以默认深色，浅色终端的用户设一次环境变量。
 */
export function pickLook(env: Env, platform: string = process.platform): Look {
  const mono = env.NO_COLOR !== undefined && env.NO_COLOR !== ''
  const ascii = env.CATBUS_TUI_ASCII !== undefined && env.CATBUS_TUI_ASCII !== '' && env.CATBUS_TUI_ASCII !== '0'
  const forced = env.CATBUS_TUI_THEME?.toLowerCase()
  let light = false
  if (forced === 'light' || forced === 'dark') light = forced === 'light'
  else if (env.COLORFGBG) {
    const bg = Number(env.COLORFGBG.split(';').at(-1))
    light = bg === 7 || bg === 15
  }
  const wanted = env.CATBUS_TUI_ANIMATE
  const animate = wanted !== undefined && wanted !== '' ? wanted !== '0' : platform !== 'win32'
  const plainSpinner = ascii || (platform === 'win32' && !env.WT_SESSION)
  return { palette: light ? LATTE : MOCHA, mono, ascii, animate, plainSpinner }
}

// ---- 符号：Unicode 与 ASCII 两套 ----

export interface Glyphs {
  dotOn: string
  dotOff: string
  caret: string
  open: string
  closed: string
  arrow: string
  sep: string
  more: string
  cursor: string
  box: 'round' | 'classic'
  spin: string[]
}

export const UNICODE: Glyphs = {
  dotOn: '●', dotOff: '○', caret: '▌', open: '▾', closed: '▸', arrow: '→', sep: '›', more: '…', cursor: '█', box: 'round',
  spin: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
}

export const PLAIN: Glyphs = {
  dotOn: '*', dotOff: 'o', caret: '>', open: 'v', closed: '>', arrow: '->', sep: '>', more: '...', cursor: '_', box: 'classic',
  spin: ['|', '/', '-', '\\'],
}
