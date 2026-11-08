import type { ArgMeta, CommandMeta, OptionMeta, OptionValue } from '../shared/types.js'
import { api } from './api.js'
import { inputDescription, optionCopy } from './copy.js'
import { type Child, h, uid } from './dom.js'
import { formatBytes } from './format.js'
import { icon } from './icons.js'
import { VALUE_LABELS } from './labels.js'
import { button } from './ui.js'

/**
 * 由注册表生成的命令表单（AGENTS 4.13「表单」）。字段的类型来自选项声明；
 * 敏感输入走 stdin，文件可以上传到面板的临时目录。
 */

export type FieldValue = string | string[] | boolean

export interface Field {
  /** 参数为 `arg:<name>`，选项为选项名。 */
  name: string
  element: HTMLElement
  required: boolean
  /** 敏感输入：值不进表单记忆，执行时走 stdin。 */
  secret: boolean
  get(): FieldValue
  set(value: FieldValue): void
  focus(): void
  setError(message: string | null): void
}

export interface Collected {
  args: string[]
  options: Record<string, OptionValue>
  stdin: string | null
  raw: boolean
  verbose: boolean
  proxy: string | null
}

/** 值是本地文件或 URL 的选项与参数：可以在页面上选文件上传。 */
const FILE_FLAGS = ['image', 'video', 'cover', 'cover43', 'avatar', 'file']
/** 布尔开关形式的 stdin 选项：勾上时从 stdin 读取，对应的输入框就是要读的内容。 */
const STDIN_FLAGS: Record<string, string> = { 'password-stdin': '密码', 'api-key-stdin': '访问密钥（API Key）', 'token-stdin': '登录令牌（Token）' }
/** cookie 从 stdin 读：`--cookie -`。 */
const COOKIE_FLAG = 'cookie'
const STDIN_MARK = '-'
/** 取值不多时用分段按钮，否则用下拉框。 */
const SEGMENTED_MAX = 4
/** 放进「高级」的选项：游标由「加载更多」管理。 */
const ADVANCED_FLAGS = ['cursor']

/**
 * 字段外框：标签行（标签、必填、选项名）、控件、说明、错误。
 */
function shell(options: { id: string; label: string; flag: string | null; required: boolean; help: Child; control: HTMLElement; inline?: boolean; group?: boolean }) {
  const helpId = `${options.id}-help`
  const errorId = `${options.id}-error`
  const error = h('p', { class: 'field-error', id: errorId, hidden: true }, icon('alert'), h('span', null))
  const labelRow = h(
    'div',
    { class: 'field-label-row' },
    options.group ? h('span', { class: 'field-label', id: `${options.id}-label` }, options.label) : h('label', { class: 'field-label', for: options.id }, options.label),
    options.required ? h('span', { class: 'field-required' }, '必填') : null,
  )
  const help = options.help ? h('p', { class: 'field-help', id: helpId }, options.help) : null
  const element = h('div', { class: `field ${options.inline ? 'field-inline' : ''}`.trim() }, options.inline ? null : labelRow, options.control, options.inline ? labelRow : null, help, error)
  const describe = [help ? helpId : null, errorId].filter(Boolean).join(' ')
  const inputs = [
    ...(options.control.matches('input, textarea, select') ? [options.control] : []),
    ...options.control.querySelectorAll('input, textarea, select'),
  ]
  const setError = (message: string | null) => {
    error.hidden = message == null
    error.querySelector('span')!.textContent = message ?? ''
    for (const input of inputs) {
      if (message) input.setAttribute('aria-invalid', 'true')
      else input.removeAttribute('aria-invalid')
    }
  }
  for (const input of inputs) input.setAttribute('aria-describedby', describe)
  return { element, setError }
}

/**
 * 单行或多行文本。
 */
function textField(name: string, spec: { label: string; flag: string | null; required: boolean; help: Child; multiline?: boolean; placeholder?: string; type?: string; secret?: boolean }): Field {
  const id = uid('f')
  const input = spec.multiline
    ? h('textarea', { id, class: 'input textarea', rows: spec.secret ? 4 : 3, placeholder: spec.placeholder ?? null, spellcheck: spec.secret ? 'false' : null, autocomplete: 'off' })
    : h('input', { id, class: 'input', type: spec.type ?? 'text', placeholder: spec.placeholder ?? null, autocomplete: spec.secret ? 'off' : null, spellcheck: 'false' })
  const { element, setError } = shell({ id, label: spec.label, flag: spec.flag, required: spec.required, help: spec.help, control: input })
  input.addEventListener('input', () => setError(null))
  return {
    name,
    element,
    required: spec.required,
    secret: spec.secret ?? false,
    get: () => input.value,
    set: (v) => (input.value = typeof v === 'string' ? v : ''),
    focus: () => input.focus(),
    setError,
  }
}

/**
 * 勾选框（表单提交时才生效，所以用 Checkbox 而不是 Switch）。
 */
function checkboxField(name: string, spec: { label: string; flag: string | null; help: Child }): Field {
  const id = uid('f')
  const input = h('input', { id, type: 'checkbox', class: 'checkbox' })
  const { element, setError } = shell({ id, label: spec.label, flag: spec.flag, required: false, help: spec.help, control: input, inline: true })
  return {
    name,
    element,
    required: false,
    secret: false,
    get: () => input.checked,
    set: (v) => (input.checked = v === true),
    focus: () => input.focus(),
    setError,
  }
}

/**
 * 枚举：取值少用分段单选，多用下拉框。可选且没有默认值时多一个「不指定」。
 */
function enumField(name: string, spec: { label: string; flag: string | null; required: boolean; help: Child; values: string[]; defaultValue: string | null; labels: Record<string, string> | undefined }): Field {
  const id = uid('f')
  const choices: [string, string][] = spec.values.map((v) => [v, spec.labels?.[v] ?? v])
  if (!spec.required && spec.defaultValue == null) choices.unshift(['', '不指定'])
  if (choices.length <= SEGMENTED_MAX + 1) {
    const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': `${id}-label` })
    const radios = choices.map(([value, label], i) => {
      const radio = h('input', { type: 'radio', name: id, value, id: i === 0 ? id : null, class: 'segmented-input' })
      group.append(h('label', { class: 'segmented-option' }, radio, h('span', null, label)))
      return radio
    })
    const { element, setError } = shell({ id, label: spec.label, flag: spec.flag, required: spec.required, help: spec.help, control: group, group: true })
    const set = (v: FieldValue) => {
      const target = typeof v === 'string' ? v : ''
      for (const r of radios) r.checked = r.value === target
      if (!radios.some((r) => r.checked)) radios[0]!.checked = !spec.required
    }
    set(spec.defaultValue ?? '')
    return {
      name,
      element,
      required: spec.required,
      secret: false,
      get: () => radios.find((r) => r.checked)?.value ?? '',
      set,
      focus: () => (radios.find((r) => r.checked) ?? radios[0]!).focus(),
      setError,
    }
  }
  const select = h('select', { id, class: 'input select' }, choices.map(([value, label]) => h('option', { value }, label)))
  if (spec.required && spec.defaultValue == null) select.prepend(h('option', { value: '', disabled: true, selected: true }, '请选择'))
  const { element, setError } = shell({ id, label: spec.label, flag: spec.flag, required: spec.required, help: spec.help, control: select })
  if (spec.defaultValue != null) select.value = spec.defaultValue
  select.addEventListener('change', () => setError(null))
  return {
    name,
    element,
    required: spec.required,
    secret: false,
    get: () => select.value,
    set: (v) => (select.value = typeof v === 'string' ? v : ''),
    focus: () => select.focus(),
    setError,
  }
}

/**
 * 可重复的值（标签、话题、图片）：回车添加，每项可以单独移除；可选上传文件。
 * 输入法组合输入时的回车不添加。
 */
function listField(name: string, spec: { label: string; flag: string | null; required: boolean; help: Child; files: boolean; placeholder: string }): Field {
  const id = uid('f')
  let values: string[] = []
  const chips = h('ul', { class: 'token-list', 'aria-label': `${spec.label}：已添加` })
  const input = h('input', { id, class: 'input', type: 'text', placeholder: spec.placeholder, autocomplete: 'off', spellcheck: 'false' })
  const render = () => {
    chips.replaceChildren(
      ...values.map((v, i) =>
        h(
          'li',
          { class: 'token' },
          h('span', { class: 'token-text', title: v }, v),
          h('button', { type: 'button', class: 'token-remove', 'aria-label': `移除 ${v}`, on: { click: () => ((values = values.filter((_, j) => j !== i)), render()) } }, icon('close')),
        ),
      ),
    )
    chips.hidden = values.length === 0
  }
  const add = (v: string) => {
    const t = v.trim()
    if (t) values = [...values, t]
    render()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      add(input.value)
      input.value = ''
    }
  })
  const row = h('div', { class: 'input-row' }, input)
  const status = h('p', { class: 'upload-status', 'aria-live': 'polite' })
  if (spec.files) row.append(uploadButton(true, (paths) => paths.forEach(add), status))
  const control = h('div', { class: 'token-field' }, chips, row, status)
  const { element, setError } = shell({ id, label: spec.label, flag: spec.flag, required: spec.required, help: spec.help, control })
  render()
  return {
    name,
    element,
    required: spec.required,
    secret: false,
    get: () => (input.value.trim() ? [...values, input.value.trim()] : values),
    set: (v) => {
      values = Array.isArray(v) ? [...v] : []
      input.value = ''
      render()
    },
    focus: () => input.focus(),
    setError,
  }
}

/**
 * 选文件并上传到面板的临时目录，回调本机路径（AGENTS 4.13「文件」）。
 */
function uploadButton(multiple: boolean, onDone: (paths: string[]) => void, status: HTMLElement): HTMLElement {
  const picker = h('input', { type: 'file', multiple, class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' })
  const btn = button('选择文件', { variant: 'secondary', icon: 'upload' })
  btn.addEventListener('click', () => picker.click())
  picker.addEventListener('change', async () => {
    const files = [...(picker.files ?? [])]
    if (!files.length) return
    btn.disabled = true
    status.textContent = `正在上传 ${files.length} 个文件…`
    try {
      const results = []
      for (const file of files) results.push(await api.upload(file))
      status.textContent = `已上传：${results.map((r) => `${r.name}（${formatBytes(r.size)}）`).join('、')}`
      onDone(results.map((r) => r.path))
    } catch (err) {
      status.textContent = `上传失败：${err instanceof Error ? err.message : String(err)}`
    } finally {
      btn.disabled = false
      picker.value = ''
    }
  })
  return h('span', { class: 'upload' }, btn, picker)
}

/**
 * 单个本地文件或 URL：可以直接填，也可以选文件上传。
 */
function fileField(name: string, spec: { label: string; flag: string | null; required: boolean; help: Child }): Field {
  const id = uid('f')
  const input = h('input', { id, class: 'input', type: 'text', placeholder: '填写文件位置或链接，也可以选择文件', autocomplete: 'off', spellcheck: 'false' })
  const status = h('p', { class: 'upload-status', 'aria-live': 'polite' })
  const control = h('div', null, h('div', { class: 'input-row' }, input, uploadButton(false, ([path]) => (input.value = path ?? ''), status)), status)
  const { element, setError } = shell({ id, label: spec.label, flag: spec.flag, required: spec.required, help: spec.help, control })
  input.addEventListener('input', () => setError(null))
  return {
    name,
    element,
    required: spec.required,
    secret: false,
    get: () => input.value,
    set: (v) => (input.value = typeof v === 'string' ? v : ''),
    focus: () => input.focus(),
    setError,
  }
}

/**
 * 本地时间 → 带时区的 ISO 8601（AGENTS 6.2「时间用带时区的 ISO 8601」）。
 */
export function localToIso(value: string): string {
  const date = new Date(value)
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const seconds = value.length === '2026-01-01T00:00'.length ? ':00' : ''
  return `${value}${seconds}${sign}${pad(offset / 60)}:${pad(offset % 60)}`
}

/**
 * 参数的字段。
 */
export function argField(arg: ArgMeta): Field {
  const name = `arg:${arg.name}`
  const help = arg.default === 'me' ? '留空时使用当前登录账号。' : arg.default != null ? `留空时为 ${arg.default}` : null
  const base = { label: inputDescription(arg.summary), flag: `<${arg.name}>`, required: !arg.optional, help }
  if (arg.name === 'file') return fileField(name, base)
  return textField(name, { ...base, multiline: arg.name === 'text' || arg.name === 'messages' })
}

/**
 * 选项的字段：按声明的类型与取值选择控件。
 */
export function optionField(option: OptionMeta, context: { cwd: string }): Field {
  const flag = option.flag
  const copy = optionCopy(option)
  const label = copy.label
  const flagText = `--${flag}`
  const labels = VALUE_LABELS[flag] ?? (option.values?.every((v) => v === 'on' || v === 'off') ? { on: '开启', off: '关闭' } : undefined)
  const defaultText = option.default != null ? `默认：${labels?.[String(option.default)] ?? String(option.default)}` : null
  const base = { label, flag: flagText, required: option.required, help: [copy.help, defaultText].filter(Boolean).join(' ') || null }
  if (flag in STDIN_FLAGS) {
    return textField(flag, { ...base, label: STDIN_FLAGS[flag]!, required: false, type: 'password', secret: true, help: '仅用于完成登录，不会显示在命令预览或任务记录中。' })
  }
  if (flag === COOKIE_FLAG) {
    return textField(flag, { ...base, label: '浏览器登录信息（Cookie）', multiline: true, secret: true, placeholder: '粘贴从已登录的浏览器复制或导出的 Cookie', help: '仅用于登录，不会显示在命令预览或任务记录中。' })
  }
  if (option.values) return enumField(flag, { ...base, values: option.values, defaultValue: option.default == null ? null : String(option.default), labels })
  if (option.kind === 'boolean') return checkboxField(flag, base)
  if (option.kind === 'array') return listField(flag, { ...base, files: FILE_FLAGS.includes(flag), placeholder: FILE_FLAGS.includes(flag) ? '填写文件位置或链接，回车添加' : '输入后回车添加' })
  if (option.kind === 'number') return textField(flag, { ...base, type: 'number' })
  if (FILE_FLAGS.includes(flag)) return fileField(flag, base)
  if (flag === 'schedule') return textField(flag, { ...base, label: '定时发布时间', type: 'datetime-local', help: '按这台电脑的时区选择日期和时间。' })
  if (flag === 'dir') return textField(flag, { ...base, placeholder: context.cwd, help: `留空时保存到启动面板的目录：${context.cwd}` })
  return textField(flag, { ...base, multiline: flag === 'text' })
}

/**
 * 从字段收集参数、选项与 stdin。validate 为 true 时标出错误并聚焦第一个，有错返回 null。
 */
export function collectFields(fields: Field[], options: OptionMeta[], validate: boolean): Collected | null {
  const byFlag = new Map(options.map((o) => [o.flag, o]))
  const errors: [Field, string][] = []
  const args: string[] = []
  const collectedOptions: Record<string, OptionValue> = {}
  let stdin: string | null = null
  let gap: Field | null = null

  for (const field of fields) {
    field.setError(null)
    const value = field.get()
    if (field.name.startsWith('arg:')) {
      const text = typeof value === 'string' ? value : ''
      if (!text.trim()) {
        if (field.required) errors.push([field, '这一项必填'])
        gap ??= field
        args.push('')
        continue
      }
      if (gap) errors.push([gap, '填写后面的内容时，也需要填写这一项'])
      gap = null
      args.push(text)
      continue
    }
    const option = byFlag.get(field.name)
    if (!option) continue
    if (field.secret) {
      const text = typeof value === 'string' ? value : ''
      if (!text) continue
      if (stdin != null) errors.push([field, '密码、密钥或登录信息请只填写一种'])
      stdin = text
      collectedOptions[option.flag] = option.kind === 'boolean' ? true : STDIN_MARK
      continue
    }
    if (option.kind === 'boolean') {
      if (value === true) collectedOptions[option.flag] = true
      continue
    }
    if (option.kind === 'array') {
      const items = Array.isArray(value) ? value : []
      if (items.length) collectedOptions[option.flag] = items
      else if (option.required) errors.push([field, '至少添加一项'])
      continue
    }
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text || (option.default != null && text === String(option.default))) {
      if (!text && option.required) errors.push([field, '这一项必填'])
      continue
    }
    if (option.kind === 'number') {
      const n = Number(text)
      if (!Number.isFinite(n)) errors.push([field, '需要一个数字'])
      else collectedOptions[option.flag] = n
      continue
    }
    collectedOptions[option.flag] = option.flag === 'schedule' ? localToIso(text) : text
  }
  while (args.length && args.at(-1) === '') args.pop()
  if (validate && errors.length) {
    for (const [field, message] of errors) field.setError(message)
    errors[0]![0].focus()
    return null
  }
  return { args, options: collectedOptions, stdin, raw: false, verbose: false, proxy: null }
}

export interface CommandForm {
  element: HTMLElement
  fields: Field[]
  collect(validate: boolean): Collected | null
  values(): Record<string, FieldValue>
  restore(values: Record<string, FieldValue>): void
}

/**
 * 字段分区的小标题。
 */
function section(title: string, ...children: Child[]): HTMLElement {
  return h('fieldset', { class: 'form-section' }, h('legend', { class: 'form-section-title' }, title), h('div', { class: 'form-grid' }, ...children))
}

/**
 * 整条命令的表单：参数 → 选项（必填在前）→ 翻页 → 高级（游标、原始数据、调试日志、代理）。
 */
export function commandForm(command: CommandMeta, context: { cwd: string }): CommandForm {
  const argFields = command.args.map(argField)
  const visible = command.options.filter((o) => !ADVANCED_FLAGS.includes(o.flag))
  const paging = visible.filter((o) => o.group === 'paging')
  const regular = visible.filter((o) => o.group !== 'paging').sort((a, b) => Number(b.required) - Number(a.required))
  const advanced = command.options.filter((o) => ADVANCED_FLAGS.includes(o.flag))
  const regularFields = regular.map((o) => optionField(o, context))
  const pagingFields = paging.map((o) => optionField(o, context))
  const advancedFields = advanced.map((o) => optionField(o, context))
  const raw = checkboxField('global:raw', { label: '查看未经整理的数据', flag: '--raw', help: '保留平台提供的全部信息，以表格或原始数据展示，适合查看更详细的内容。' })
  const verbose = checkboxField('global:verbose', { label: '记录更多运行详情', flag: '-v', help: '在“运行记录”中显示更多连接信息，帮助排查问题；敏感信息会被隐藏。' })
  const proxy = textField('global:proxy', { label: '本次使用的代理', flag: '--proxy', required: false, help: '留空时按设置里的代理', placeholder: 'http://127.0.0.1:7890' })
  const fields = [...argFields, ...regularFields, ...pagingFields, ...advancedFields]
  const extras = [raw, verbose, proxy]

  const element = h(
    'div',
    { class: 'form-sections' },
    argFields.length ? section('填写内容', argFields.map((f) => f.element)) : null,
    regularFields.length ? section('设置', regularFields.map((f) => f.element)) : null,
    pagingFields.length ? section('结果数量', pagingFields.map((f) => f.element)) : null,
    h('details', { class: 'advanced' }, h('summary', null, icon('chevronRight', 'icon advanced-chevron'), '更多设置'), h('div', { class: 'form-grid' }, [...advancedFields, ...extras].map((f) => f.element))),
  )
  if (!argFields.length && !regularFields.length && !pagingFields.length) {
    element.prepend(h('p', { class: 'form-empty' }, '无需填写内容，点击“运行”即可。'))
  }

  return {
    element,
    fields,
    collect(validate) {
      const collected = collectFields(fields, command.options, validate)
      if (!collected) return null
      const p = proxy.get()
      return { ...collected, raw: raw.get() === true, verbose: verbose.get() === true, proxy: typeof p === 'string' && p.trim() ? p.trim() : null }
    },
    values() {
      const out: Record<string, FieldValue> = {}
      for (const f of [...fields, ...extras]) if (!f.secret) out[f.name] = f.get()
      return out
    },
    restore(values) {
      for (const f of [...fields, ...extras]) if (f.name in values) f.set(values[f.name]!)
    },
  }
}
