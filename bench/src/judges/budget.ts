/**
 * Spend / balance guard for paid DeepSeek calls (dev-plan §6.5): stop as soon
 * as spend since start reaches the cap or the balance falls below the floor.
 * Pure logic over an injected balance source so it is testable with mock balances.
 * @module bench/judges/budget
 */

import { BudgetStopError } from './types.ts'

export interface BudgetStatus {
  ok: boolean
  balance: number
  startBalance: number
  spend: number
  reason?: string
}

export interface BudgetOptions {
  getBalance: () => Promise<number>
  maxSpend: number
  minBalance: number
}

export class BudgetGuard {
  startBalance?: number
  lastStatus?: BudgetStatus
  constructor(private readonly opts: BudgetOptions) {}

  /** Read the start balance and decide whether we may begin at all. */
  async start(): Promise<BudgetStatus> {
    const balance = await this.opts.getBalance()
    this.startBalance = balance
    return this.evaluate(balance)
  }

  /** Re-read the balance and decide whether to continue. */
  async check(): Promise<BudgetStatus> {
    if (this.startBalance === undefined) return this.start()
    return this.evaluate(await this.opts.getBalance())
  }

  /** Like `check`, but throws BudgetStopError when the guard says stop. */
  async assertOk(): Promise<BudgetStatus> {
    const status = await this.check()
    if (!status.ok) throw new BudgetStopError(status.reason ?? 'budget guard stopped')
    return status
  }

  evaluate(balance: number): BudgetStatus {
    const startBalance = this.startBalance ?? balance
    const spend = Math.round((startBalance - balance) * 1e6) / 1e6
    let reason: string | undefined
    if (spend >= this.opts.maxSpend) reason = 'spend ' + spend.toFixed(4) + ' CNY reached max ' + this.opts.maxSpend
    else if (balance < this.opts.minBalance) reason = 'balance ' + balance.toFixed(4) + ' CNY below minimum ' + this.opts.minBalance
    this.lastStatus = { ok: !reason, balance, startBalance, spend, reason }
    return this.lastStatus
  }
}
