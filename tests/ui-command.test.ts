/// <reference lib="dom" />
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { panelMeta } from '../src/ui/meta.js'
import { confirmDialog } from '../src/ui/app/dialog.js'
import { startJob } from '../src/ui/app/job.js'
import { ResultPanel } from '../src/ui/app/result.js'
import { setMeta } from '../src/ui/app/state.js'
import { commandView } from '../src/ui/app/views/command.js'

vi.mock('../src/ui/app/dialog.js', () => ({ confirmDialog: vi.fn() }))
vi.mock('../src/ui/app/job.js', () => ({ startJob: vi.fn(), attachJob: vi.fn() }))

describe('操作页退出登录', () => {
  let main: HTMLElement
  let cleanup: (() => void) | void
  beforeEach(() => {
    vi.mocked(confirmDialog).mockReset()
    vi.mocked(startJob).mockReset()
    setMeta(panelMeta('/tmp'))
    main = document.createElement('main')
    document.body.append(main)
    cleanup = commandView(main, { path: ['p', 'bilibili', 'auth', 'logout'], query: new URLSearchParams() })
  })
  afterEach(() => {
    cleanup?.()
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('取消确认时不启动退出任务，也不删除登录信息', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(false)
    main.querySelector<HTMLButtonElement>('.run-button')!.click()
    await vi.waitFor(() => expect(main.textContent).toContain('已取消退出'))
    expect(confirmDialog).toHaveBeenCalledOnce()
    expect(startJob).not.toHaveBeenCalled()
  })

  it('确认后才提交退出任务', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(true)
    vi.mocked(startJob).mockResolvedValue({ id: 'fake-logout' } as Awaited<ReturnType<typeof startJob>>)
    vi.spyOn(ResultPanel.prototype, 'track').mockResolvedValue({ envelope: { ok: false } } as Awaited<ReturnType<ResultPanel['track']>>)
    main.querySelector<HTMLButtonElement>('.run-button')!.click()
    await vi.waitFor(() => expect(startJob).toHaveBeenCalledOnce())
    expect(startJob).toHaveBeenCalledWith(expect.objectContaining({ resource: 'auth', action: 'logout', yes: true }), null)
  })
})
