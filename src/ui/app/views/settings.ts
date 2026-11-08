import { runQuiet } from '../api.js'
import { confirmDialog } from '../dialog.js'
import { append, h, replace, uid } from '../dom.js'
import { icon } from '../icons.js'
import { isObject, type JsonObject } from '../json.js'
import type { Route } from '../router.js'
import { getMeta } from '../state.js'
import { button, callout, card, pageHeader, platformLogo, spinner } from '../ui.js'

/**
 * 设置（AGENTS 5.5）：全局代理、超时、各平台代理、YouTube / Discord 用的本地 Chromium。
 * 每一项单独保存，保存时由 catbus config set 校验；清空即 config unset。
 */

const BROWSER_PLATFORMS = ['youtube', 'discord']

interface SettingSpec {
  key: string
  label: string
  help: string
  placeholder: string
  type?: string
}

/**
 * 一项设置：输入框 + 保存 / 清除，原位反馈结果。
 */
function settingRow(spec: SettingSpec, value: string): HTMLElement {
  const id = uid('setting')
  const input = h('input', { id, class: 'input', value, placeholder: spec.placeholder, type: spec.type ?? 'text', autocomplete: 'off', spellcheck: 'false' })
  const save = button('保存', { variant: 'secondary', size: 'sm' })
  const clear = button('清除', { variant: 'ghost', size: 'sm' })
  const feedback = h('p', { class: 'setting-feedback', 'aria-live': 'polite' })
  let saved = value
  const sync = () => {
    save.disabled = input.value.trim() === saved
    clear.disabled = saved === ''
  }
  sync()
  input.addEventListener('input', () => {
    feedback.textContent = ''
    feedback.className = 'setting-feedback'
    sync()
  })
  const apply = async (unset: boolean) => {
    if (unset) {
      const ok = await confirmDialog({ title: `清除“${spec.label}”？`, confirmLabel: '清除', body: [h('p', null, '清除后恢复默认设置。')] })
      if (!ok) return
    }
    save.disabled = clear.disabled = true
    feedback.textContent = '保存中…'
    feedback.className = 'setting-feedback'
    const env = await runQuiet({ platform: null, resource: 'config', action: unset ? 'unset' : 'set', args: unset ? [spec.key] : [spec.key, input.value.trim()] }).catch((err: unknown) => ({ ok: false, error: { code: 'ERROR', message: err instanceof Error ? err.message : String(err), hint: null, detail: null } }))
    if (env.ok) {
      saved = unset ? '' : input.value.trim()
      input.value = saved
      feedback.textContent = unset ? '已清除' : '已保存'
      feedback.className = 'setting-feedback is-success'
    } else {
      feedback.textContent = `${env.error?.message ?? '保存失败'}${env.error?.hint ? `（${env.error.hint}）` : ''}`
      feedback.className = 'setting-feedback is-error'
      input.setAttribute('aria-invalid', 'true')
      input.focus()
    }
    sync()
  }
  save.addEventListener('click', () => void apply(false))
  clear.addEventListener('click', () => void apply(true))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && !save.disabled) void apply(false)
  })
  return h(
    'div',
    { class: 'setting' },
    h('div', { class: 'setting-text' }, h('label', { for: id, class: 'field-label' }, spec.label), h('p', { class: 'field-help' }, spec.help)),
    h('div', { class: 'setting-control' }, h('div', { class: 'input-row' }, input, save, clear), feedback),
  )
}

/**
 * 设置页。
 */
export function settingsView(main: HTMLElement, _route: Route): void {
  document.title = '设置 · catbus'
  const body = h('div', { class: 'loading-block' }, spinner(), '正在读取设置…')
  append(main, pageHeader({ crumbs: [{ label: '首页', href: '#/' }, { label: '设置' }], title: '设置', subtitle: '调整网络连接和辅助浏览器，保存后会用于接下来的操作。' }), body)
  void runQuiet({ platform: null, resource: 'config', action: 'list' }).then(
    (env) => {
      const values: JsonObject = env.ok && isObject(env.data) ? env.data : {}
      const get = (key: string) => {
        const v = values[key]
        return v == null ? '' : String(v)
      }
      const meta = getMeta()
      const proxyHelp = '填写代理软件提供的连接地址，例如 http://127.0.0.1:7890。'
      body.replaceWith(
        h(
          'div',
          { class: 'settings' },
          env.ok ? null : callout('danger', '读取设置失败', h('p', null, env.error?.message ?? '')),
          card(
            null,
            h('h2', { class: 'card-title' }, '网络'),
            settingRow({ key: 'proxy', label: '默认代理地址', help: `${proxyHelp} 未设置时直接连接，不会自动使用系统代理。`, placeholder: 'http://127.0.0.1:7890' }, get('proxy')),
            settingRow({ key: 'timeout', label: '最长等待时间（秒）', help: '每次连接平台最多等待多久，默认 30 秒。', placeholder: '30', type: 'number' }, get('timeout')),
          ),
          card(
            null,
            h('h2', { class: 'card-title' }, '为平台单独设置代理'),
            h('p', { class: 'muted' }, '单独设置后，该平台会使用这里的地址；若某次操作另外填写了代理，则以那次填写的为准。'),
            h('details', { class: 'advanced' }, h('summary', null, icon('chevronRight', 'icon advanced-chevron'), '展开全部平台'), meta.platforms.map((p) => h('div', { class: 'setting-platform' }, platformLogo(p.id, 'sm'), settingRow({ key: `${p.id}.proxy`, label: `${p.name}的代理地址`, help: proxyHelp, placeholder: '留空使用默认代理' }, get(`${p.id}.proxy`))))),
          ),
          card(
            null,
            h('h2', { class: 'card-title' }, '用于平台验证的浏览器'),
            h('p', { class: 'muted' }, '发布或删除 YouTube 视频、使用 Discord 通行密钥时，需要电脑上的 Chromium 浏览器协助验证。通常可以留空；提示找不到浏览器时，再填写程序位置。'),
            BROWSER_PLATFORMS.map((id) => settingRow({ key: `${id}.browser`, label: `${meta.platforms.find((p) => p.id === id)?.name ?? id}的浏览器位置`, help: '填写 Chromium 浏览器程序的完整文件路径。', placeholder: '浏览器程序的完整路径' }, get(`${id}.browser`))),
            h('details', { class: 'advanced' }, h('summary', null, icon('chevronRight', 'icon advanced-chevron'), '安装与查找浏览器'), h('p', { class: 'field-help' }, '可在终端运行 ', h('code', null, 'npx playwright install chromium'), ' 安装。未指定路径时，catbus 会自动查找通过这种方式安装的 Chromium。')),
          ),
        ),
      )
    },
    (err: unknown) => replace(body, callout('danger', '读取设置失败', h('p', null, err instanceof Error ? err.message : String(err)))),
  )
}
