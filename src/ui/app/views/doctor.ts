import { runQuiet } from '../api.js'
import { append, h, replace } from '../dom.js'
import { icon } from '../icons.js'
import { type Json, str } from '../json.js'
import type { Route } from '../router.js'
import { getMeta } from '../state.js'
import { button, callout, card, chip, pageHeader, spinner } from '../ui.js'

const CHECK_LABELS: Record<string, string> = {
  node: '运行环境', home: '本地文件读写', vm: '平台请求验证', http: '网络连接组件',
  canvas: '图片处理组件', onnx: '验证码识别组件', 'assets-jd': '京东验证资源', 'assets-ocr': '文字识别资源',
}

/**
 * 环境检查（catbus doctor、catbus version）：逐项列出结果，不通过的项给出原因。
 */

/**
 * 检查结果的一行。
 */
function checkRow(check: Json): HTMLElement {
  const ok = typeof check === 'object' && check !== null && !Array.isArray(check) && check.ok === true
  const name = str(check, 'name') ?? ''
  return h(
    'li',
    { class: `check ${ok ? 'is-ok' : 'is-fail'}` },
    h('span', { class: 'check-icon' }, icon(ok ? 'check' : 'alert')),
    h('div', { class: 'row-main' }, h('p', { class: 'row-title' }, CHECK_LABELS[name] ?? name), h('p', { class: 'row-text' }, ok ? '已就绪' : '需要处理，请展开详情查看原因。'), h('details', { class: 'advanced' }, h('summary', null, '查看详情'), h('p', { class: 'field-help' }, str(check, 'message') ?? ''))),
    chip(ok ? '通过' : '未通过', ok ? 'success' : 'danger'),
  )
}

/**
 * 环境检查页。
 */
export function doctorView(main: HTMLElement, _route: Route): void {
  document.title = '环境检查 · catbus'
  const body = h('div', null)
  const versionBox = h('p', { class: 'muted' }, `catbus v${getMeta().version}`)
  const again = button('重新检查', { variant: 'secondary', icon: 'refresh', size: 'sm' })
  append(main, pageHeader({ crumbs: [{ label: '首页', href: '#/' }, { label: '环境检查' }], title: '环境检查', subtitle: versionBox, actions: [again] }), body)

  const load = async () => {
    again.disabled = true
    replace(body, card(null, h('div', { class: 'loading-block' }, spinner(), '正在检查运行环境、所需组件和本地文件是否可用…')))
    const [doctor, version] = await Promise.all([runQuiet({ platform: null, resource: 'doctor', action: null }), runQuiet({ platform: null, resource: 'version', action: null })]).catch((err: unknown) => {
      replace(body, callout('danger', '检查没能运行', h('p', null, err instanceof Error ? err.message : String(err))))
      return [null, null] as const
    })
    again.disabled = false
    if (!doctor) return
    if (version?.ok) versionBox.textContent = `catbus v${str(version.data, 'version')} · Node ${str(version.data, 'node')} · ${str(version.data, 'platform')}-${str(version.data, 'arch')}`
    const checks = Array.isArray(doctor.data) ? doctor.data : []
    const failed = checks.filter((c) => typeof c === 'object' && c !== null && !Array.isArray(c) && c.ok !== true).length
    replace(
      body,
      failed ? callout('warning', `${failed} 项检查未通过`, h('p', null, doctor.error?.message ?? '')) : callout('success', '一切就绪', h('p', null, '运行环境检查全部通过，可以出发了。')),
      card(null, h('ul', { class: 'checks' }, checks.map(checkRow))),
    )
  }
  again.addEventListener('click', () => void load())
  void load()
}
