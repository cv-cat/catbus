import { createInterface } from 'node:readline/promises'
import { CatbusError } from '../core/errors.js'

/**
 * 危险操作确认（AGENTS 4.11）：stdin 和 stderr 都是 TTY 时在 stderr 上问 y/N；
 * 否则必须带 -y，不带时报 CONFIRM_REQUIRED。
 */
export async function confirm(question: string, yes: boolean): Promise<void> {
  if (yes) return
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new CatbusError('CONFIRM_REQUIRED', `危险操作需要确认：${question}`, { hint: '确认无误后加 -y 重新执行' })
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await rl.question(`[catbus] ${question}？[y/N] `)
    if (!/^y(es)?$/i.test(answer.trim())) throw new CatbusError('CONFIRM_REQUIRED', '已取消')
  } finally {
    rl.close()
  }
}
