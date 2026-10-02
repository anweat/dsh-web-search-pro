/**
 * Errors of the judge layer.
 * @module web-search-pro/pipeline/judges/errors
 */

export class JudgeError extends Error {
  constructor(message: string, readonly status?: number, readonly fatal = false) {
    super(message)
    this.name = 'JevError'
  }
}

/** A model call was refused because a usage cap would be exceeded (the stage falls back to the rule scorer). */
export class BudgetExceededError extends JudgeError {
  constructor(readonly reason: string) {
    super('model budget exceeded: ' + reason)
    this.name = 'BudgetExceededError'
  }
}
