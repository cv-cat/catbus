// 单行文本输入的编辑逻辑（AGENTS 4.13）：纯函数，不依赖 React。光标按“字素”移动，中文、emoji 不会被拆开。

export interface TextState {
  value: string
  /** 光标位置：字素下标，0..graphemes.length。 */
  cursor: number
}

const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const split = (s: string): string[] => [...seg.segment(s)].map((x) => x.segment)

export const graphemes = split

export function initial(value = ''): TextState {
  return { value, cursor: split(value).length }
}

export interface KeyLike {
  leftArrow?: boolean
  rightArrow?: boolean
  backspace?: boolean
  delete?: boolean
  home?: boolean
  end?: boolean
  ctrl?: boolean
  meta?: boolean
  return?: boolean
  tab?: boolean
  escape?: boolean
  upArrow?: boolean
  downArrow?: boolean
  pageUp?: boolean
  pageDown?: boolean
}

// 换行和制表符不算控制字符：粘贴的多行文字会带 \r\n（下面压成空格）；真正的 Enter / Tab 在上面由 key 判断
const printable = (s: string) => s.length > 0 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)

/**
 * 处理一次按键。返回新状态；不是编辑类按键时返回 null，交给调用方处理（Enter、Tab、方向键上下等）。
 * Windows 终端里退格常被报成 delete，所以 backspace 和 delete 都当作"删光标前一个"，
 * 真正的"向前删"只留给 Ctrl-D。
 */
export function edit(state: TextState, input: string, key: KeyLike): TextState | null {
  const g = split(state.value)
  const at = (n: number) => ({ value: g.join(''), cursor: Math.max(0, Math.min(g.length, n)) })
  if (key.ctrl) {
    switch (input) {
      case 'a': return at(0)
      case 'e': return at(g.length)
      case 'u': return { value: g.slice(state.cursor).join(''), cursor: 0 }
      case 'k': return { value: g.slice(0, state.cursor).join(''), cursor: state.cursor }
      case 'w': {
        let i = state.cursor
        while (i > 0 && g[i - 1] === ' ') i--
        while (i > 0 && g[i - 1] !== ' ') i--
        return { value: [...g.slice(0, i), ...g.slice(state.cursor)].join(''), cursor: i }
      }
      case 'd': return state.cursor < g.length ? { value: [...g.slice(0, state.cursor), ...g.slice(state.cursor + 1)].join(''), cursor: state.cursor } : state
      case 'b': return at(state.cursor - 1)
      case 'f': return at(state.cursor + 1)
    }
    return null
  }
  if (key.meta) return null
  if (key.leftArrow) return at(state.cursor - 1)
  if (key.rightArrow) return at(state.cursor + 1)
  if (key.home) return at(0)
  if (key.end) return at(g.length)
  if (key.backspace || key.delete) {
    if (state.cursor === 0) return state
    return { value: [...g.slice(0, state.cursor - 1), ...g.slice(state.cursor)].join(''), cursor: state.cursor - 1 }
  }
  if (key.return || key.tab || key.escape || key.upArrow || key.downArrow || key.pageUp || key.pageDown) return null
  if (!printable(input)) return null
  // 粘贴来的多行文字压成一行（命令参数是单行）
  const text = input.replace(/\r\n|\r|\n|\t/g, ' ')
  const add = split(text)
  return { value: [...g.slice(0, state.cursor), ...add, ...g.slice(state.cursor)].join(''), cursor: state.cursor + add.length }
}

/** 把值按光标切成“前、光标处字符、后”，渲染时给光标处字符反色。 */
export function splitAtCursor(state: TextState): [string, string, string] {
  const g = split(state.value)
  return [g.slice(0, state.cursor).join(''), g[state.cursor] ?? '', g.slice(state.cursor + 1).join('')]
}
