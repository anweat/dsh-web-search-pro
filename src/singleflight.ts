/**
 * In-flight de-duplication: concurrent callers with the same key share one
 * unit of work. Each caller keeps its own abort semantics — an aborted waiter
 * rejects with its own reason but the shared work is only cancelled once every
 * waiter has aborted.
 * @module web-search-pro/singleflight
 */

interface Flight<T> {
  promise: Promise<T>
  controller: AbortController
  waiters: number
  settled: boolean
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
}

export class SingleFlight<T> {
  private readonly flights = new Map<string, Flight<T>>()

  /** Number of distinct keys currently in flight. */
  get size(): number {
    return this.flights.size
  }

  /**
   * Run `work` once per key; concurrent callers join the running flight.
   * `work` receives the SHARED signal (aborted only when all waiters abort).
   */
  do(key: string, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortReason(signal))
    let flight = this.flights.get(key)
    if (!flight) flight = this.start(key, work)
    flight.waiters++
    return this.wait(key, flight, signal)
  }

  private start(key: string, work: (signal: AbortSignal) => Promise<T>): Flight<T> {
    const controller = new AbortController()
    const flight: Flight<T> = { controller, waiters: 0, settled: false, promise: undefined as never }
    const release = (): void => {
      flight.settled = true
      if (this.flights.get(key) === flight) this.flights.delete(key)
    }
    flight.promise = (async () => work(controller.signal))().then(
      value => { release(); return value },
      error => { release(); throw error },
    )
    // Waiters observe the outcome; this guards the case where all of them aborted.
    flight.promise.catch(() => {})
    this.flights.set(key, flight)
    return flight
  }

  private wait(key: string, flight: Flight<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return flight.promise
    return new Promise<T>((resolve, reject) => {
      let done = false
      const onAbort = (): void => {
        if (done) return
        done = true
        flight.waiters--
        // Last waiter gone: cancel the shared work and stop new callers joining it.
        if (flight.waiters <= 0 && !flight.settled) {
          if (this.flights.get(key) === flight) this.flights.delete(key)
          flight.controller.abort(abortReason(signal))
        }
        reject(abortReason(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      flight.promise.then(
        value => { if (done) return; done = true; signal.removeEventListener('abort', onAbort); resolve(value) },
        error => { if (done) return; done = true; signal.removeEventListener('abort', onAbort); reject(error) },
      )
    })
  }
}
