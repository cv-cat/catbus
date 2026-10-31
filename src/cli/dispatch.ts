import { z } from 'zod'
import { resolveNetwork } from '../core/config.js'
import { CatbusError, toCatbusError } from '../core/errors.js'
import { createLogger, type Logger } from '../core/log.js'
import { flagName, parseDuration } from '../core/options.js'
import { ENDPOINTS, type Endpoint, type HandlerContext, type Page, type Platform } from '../core/registry.js'
import * as rand from '../core/rand.js'
import { VOCAB } from '../core/vocab.js'
import { findPlatform, PLATFORMS } from '../platforms/index.js'
import { collectOptionKinds, type Parsed, parseArgv } from './argv.js'
import { allAccounts } from './commands/auth.js'
import { config } from './commands/config.js'
import { platformInfo } from './commands/platforms.js'
import { version } from './commands/version.js'
import { confirm } from './confirm.js'
import { createHandlerContext, credentialSnapshot, persistCredential, readFileOptions, resolveIdentity, splitCursor, validate } from './exec.js'
import { nativeHint } from './hints.js'
import { commandHelp, GLOBAL_HELP, platformHelp, resourceHelp, rootHelp } from './help.js'
import { FORMATS, type Format, Output } from './output.js'

z.config(z.locales.zhCN())

const GLOBAL_COMMANDS = ['platforms', 'doctor', 'auth', 'config', 'version', 'tui']

function printHelp(text: string): number {
  process.stdout.write(text + '\n')
  return 0
}

/** 执行一次 catbus 调用，返回退出码。结果和错误都以信封写到 stdout（jsonl 时摘要写到 stderr）。 */
export async function run(argv: string[]): Promise<number> {
  const out = new Output()
  try {
    const parsed = parseArgv(argv, collectOptionKinds(PLATFORMS))
    const g = parsed.global
    if (g.output != null) {
      if (!FORMATS.includes(g.output as Format)) throw new CatbusError('USAGE', `不支持的输出格式：${g.output}`, { hint: '-o json 或 -o jsonl' })
      out.format = g.output as Format
    }
    out.raw = g.raw ?? false
    const log = createLogger({ verbose: g.verbose, quiet: g.quiet })

    const [first, ...rest] = parsed.positionals
    if (first == null) {
      if (g.version && !g.help) return await runGlobal('version', [], parsed, out)
      return printHelp(rootHelp())
    }
    if (GLOBAL_COMMANDS.includes(first)) return await runGlobal(first, rest, parsed, out)
    const platform = findPlatform(first)
    if (!platform) {
      throw new CatbusError('USAGE', `未知的平台或命令：${first}`, { hint: 'catbus platforms 列出所有平台；catbus --help 查看用法' })
    }
    return await runPlatform(platform, rest, parsed, out, log)
  } catch (err) {
    const e = toCatbusError(err)
    out.fail(e)
    return e.exitCode
  }
}

async function runGlobal(name: string, words: string[], parsed: Parsed, out: Output): Promise<number> {
  const action = words[0] ?? null
  out.meta = { platform: null, endpoint: null, resource: name, action: null, account: null }
  if (parsed.global.help) return printHelp(GLOBAL_HELP[name]!)
  const extra = Object.keys(parsed.options)
  if (extra.length) throw new CatbusError('USAGE', `catbus ${name} 不接受选项 --${flagName(extra[0]!)}`, { hint: `catbus ${name} --help` })
  const noArgs = () => {
    if (words.length) throw new CatbusError('USAGE', `多余的参数：${words.join(' ')}`, { hint: `catbus ${name} --help` })
  }

  switch (name) {
    case 'tui': {
      noArgs()
      // 全屏界面：画在 stdout 的备用屏幕上，退出后终端恢复原样（AGENTS 4.13）
      const { runTui } = await import('../tui/index.js')
      return runTui()
    }
    case 'version':
      noArgs()
      out.result(version())
      return 0
    case 'platforms': {
      if (words.length > 1) throw new CatbusError('USAGE', `多余的参数：${words.slice(1).join(' ')}`, { hint: 'catbus platforms --help' })
      if (action == null) {
        out.result(PLATFORMS.map(platformInfo))
        return 0
      }
      const platform = findPlatform(action)
      if (!platform) throw new CatbusError('USAGE', `未知的平台：${action}`, { hint: 'catbus platforms' })
      out.result(platformInfo(platform))
      return 0
    }
    case 'doctor': {
      noArgs()
      const { doctor } = await import('./commands/doctor.js')
      const checks = await doctor()
      const failed = checks.filter((c) => !c.ok)
      if (!failed.length) {
        out.result(checks)
        return 0
      }
      const error = new CatbusError('ERROR', `${failed.length} 项检查未通过：${failed.map((c) => c.name).join('、')}`)
      out.result(checks, { error })
      return error.exitCode
    }
    case 'auth':
      if (action == null) return printHelp(GLOBAL_HELP.auth!)
      out.meta.action = action
      if (action !== 'list') {
        throw new CatbusError('USAGE', `auth ${action} 需要指定平台`, { hint: `catbus <platform> auth ${action}` })
      }
      if (words.length > 1) throw new CatbusError('USAGE', `多余的参数：${words.slice(1).join(' ')}`, { hint: 'catbus auth --help' })
      out.result(await allAccounts())
      return 0
    case 'config':
      if (action == null) return printHelp(GLOBAL_HELP.config!)
      out.meta.action = action
      out.result(await config(action, words.slice(1)))
      return 0
  }
  throw new CatbusError('ERROR', `未处理的全局命令：${name}`)
}

function parseEndpoint(value: string | undefined): Endpoint {
  if (value == null) return 'web'
  if (!(ENDPOINTS as readonly string[]).includes(value)) {
    throw new CatbusError('USAGE', `不支持的端：${value}`, { hint: '-e web、-e app 或 -e pc' })
  }
  return value as Endpoint
}

/** 该平台任何可用端上声明过的扩展命令。端为 planned 时，词表命令和扩展命令都报 NOT_IMPLEMENTED。 */
function isExtension(platform: Platform, key: string): boolean {
  return ENDPOINTS.some((e) => {
    const ep = platform.endpoints[e]
    return ep !== 'planned' && ep.commands.get(key)?.extension === true
  })
}

function hasResource(platform: Platform, resource: string): boolean {
  return ENDPOINTS.some((e) => {
    const ep = platform.endpoints[e]
    return ep !== 'planned' && [...ep.commands.values()].some((c) => c.resource === resource)
  })
}

function unsupported(platform: Platform, endpoint: Endpoint, resource: string, action: string | undefined): CatbusError {
  const p = platform.id
  const key = action == null ? resource : `${resource} ${action}`
  const message = action == null ? `${p} 没有 ${resource} 这类命令` : `${p} (${endpoint}) 不支持 ${key}`
  const other = ENDPOINTS.find((e) => {
    const ep = platform.endpoints[e]
    return e !== endpoint && ep !== 'planned' && ep.commands.has(key)
  })
  const hint = other
    ? `这个命令在 ${other} 端：catbus ${p} ${key} ... -e ${other}`
    : (nativeHint(p, resource, action) ??
      (hasResource(platform, resource) ? `catbus ${p} ${resource} --help` : `catbus ${p} --help`))
  return new CatbusError('UNSUPPORTED', message, { hint })
}

async function runPlatform(platform: Platform, words: string[], parsed: Parsed, out: Output, log: Logger): Promise<number> {
  const g = parsed.global
  const endpoint = parseEndpoint(g.endpoint)
  const p = platform.id
  const [resource, action, ...argWords] = words
  out.meta = { platform: p, endpoint, resource: resource ?? null, action: action ?? null, account: null }

  // 命令不完整或带 -h 时，输出已到达层级的帮助
  if (resource == null) return printHelp(platformHelp(platform, endpoint))
  const ep = platform.endpoints[endpoint]
  const known = hasResource(platform, resource)
  if (action == null || g.help) {
    const listed = ep === 'planned' ? platform.endpoints.web : ep
    const found = action != null && listed !== 'planned' ? listed.commands.get(`${resource} ${action}`) : undefined
    if (found) return printHelp(commandHelp(platform, endpoint, found))
    if (known) return printHelp(resourceHelp(platform, endpoint, resource))
    if (g.help) return printHelp(platformHelp(platform, endpoint))
    throw unsupported(platform, endpoint, resource, undefined)
  }

  const key = `${resource} ${action}`
  if (ep === 'planned') {
    if (VOCAB[key] || isExtension(platform, key)) {
      throw new CatbusError('NOT_IMPLEMENTED', `${p} 的 ${endpoint} 端尚未实现`, { detail: { endpoint, status: 'planned' } })
    }
    throw unsupported(platform, endpoint, resource, action)
  }
  const command = ep.commands.get(key)
  if (!command) throw unsupported(platform, endpoint, resource, action)

  const { args, options } = validate(platform, command, argWords, parsed.options)
  if (command.status === 'planned') {
    throw new CatbusError('NOT_IMPLEMENTED', `${p} (${endpoint}) 的 ${key} 尚未实现`, {
      detail: { upstream: command.upstream },
    })
  }

  const identity = await resolveIdentity(platform, endpoint, command, args, g, log)
  // auth login 没有当前账号时登录到 default（AGENTS 5.3），信封里写实际登录的账号
  out.meta.account = identity.account ?? (key === 'auth login' ? 'default' : null)

  const needConfirm = typeof command.confirm === 'function' ? command.confirm(options) : command.confirm === true
  if (needConfirm) await confirm(`catbus ${p} ${key} ${argWords.join(' ')}`.trim(), g.yes ?? false)

  await readFileOptions(options)
  const network = await resolveNetwork(p, g.proxy)
  log.debug(`${p} (${endpoint}) ${key}`, { account: identity.account, ...network })
  const handler = await command.handler!()
  const controller = new AbortController()
  const ctx = createHandlerContext({ platform, endpoint, command, args, options, identity, network, log, raw: out.raw, signal: controller.signal })

  // 不支持游客态的端上，游客凭证只在内存里（见 resolveIdentity）
  const snapshot = credentialSnapshot(ctx.credential, ep)
  try {
    if (command.stream) {
      out.format = 'jsonl'
      await runStream(ctx, handler(ctx) as AsyncIterable<unknown>, controller, out)
    } else if (command.paged) {
      await runPaged(platform, ctx, handler, out)
    } else {
      out.result(await handler(ctx))
    }
  } finally {
    await persistCredential(ctx.credential, snapshot)
  }
  return 0
}

/** 分页：默认一页；--limit N 翻到取满 N 条；--all 翻到没有更多。jsonl 时边翻边输出。 */
async function runPaged(platform: Platform, ctx: HandlerContext, handler: (ctx: HandlerContext) => unknown, out: Output) {
  const { limit, all } = ctx.options as { limit?: number; all?: boolean }
  const target = limit ?? (all ? Infinity : null)
  const collected: unknown[] = []
  let count = 0
  let { cursor, skip } = splitCursor(ctx.cursor)
  let page: Page
  for (;;) {
    const result = (await handler({ ...ctx, cursor })) as { data: unknown[]; page: Page }
    let items = result.data.slice(skip)
    const offset = skip
    skip = 0
    page = result.page
    if (target != null && count + items.length > target) {
      // --limit 截在一页中间：游标指回这一页，续翻时跳过已经输出的，剩下的不丢
      const take = target - count
      items = items.slice(0, take)
      page = { cursor: `${cursor ?? ''}#skip=${offset + take}`, has_more: true }
    }
    count += items.length
    if (out.format === 'jsonl') items.forEach((v) => out.item(v))
    else collected.push(...items)
    if (target == null || count >= target || !page.has_more || page.cursor == null) break
    // 服务端把同一个游标又返回一遍：再翻只会重复拿到同一页，停在这里
    if (page.cursor === cursor) {
      ctx.log.warn(`翻页游标没有变化（${page.cursor}），停止翻页`)
      page = { ...page, has_more: false }
      break
    }
    cursor = page.cursor
    ctx.log.debug(`翻页：已取 ${count} 条`)
    await rand.sleep(platform.pageInterval)
  }
  out.result(collected, { page, streamed: out.format === 'jsonl' })
}

/** 长连接：逐条输出 jsonl，直到 Ctrl-C 或 --duration 到期（退出码 0）。 */
async function runStream(ctx: HandlerContext, iterable: AsyncIterable<unknown>, controller: AbortController, out: Output) {
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  const duration = ctx.options.duration as string | undefined
  const timer = duration ? setTimeout(stop, parseDuration(duration)) : null
  const aborted = new Promise<null>((resolve) => controller.signal.addEventListener('abort', () => resolve(null), { once: true }))
  const it = iterable[Symbol.asyncIterator]()
  try {
    for (;;) {
      const next = await Promise.race([it.next(), aborted])
      if (next == null || next.done) break
      out.item(next.value)
    }
  } finally {
    if (timer) clearTimeout(timer)
    process.off('SIGINT', stop)
    controller.abort()
    // 生成器可能正卡在 await 上，return() 要等它恢复才会完成；不等它，免得进程挂住
    void Promise.resolve(it.return?.()).catch(() => {})
  }
  out.result(undefined, { streamed: true })
}
