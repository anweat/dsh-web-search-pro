/**
 * In-flight de-duplication: concurrent callers with the same key share one
 * unit of work. Each caller keeps its own abort semantics — an aborted waiter
 * rejects with its own reason but the shared work is only cancelled once every
 * waiter has aborted.
 * @module web-search-pro/singleflight
 */
function abortReason(signal) {
    return signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
}
export class SingleFlight {
    flights = new Map();
    /** Number of distinct keys currently in flight. */
    get size() {
        return this.flights.size;
    }
    /**
     * Run `work` once per key; concurrent callers join the running flight.
     * `work` receives the SHARED signal (aborted only when all waiters abort).
     */
    do(key, work, signal) {
        if (signal?.aborted)
            return Promise.reject(abortReason(signal));
        let flight = this.flights.get(key);
        if (!flight)
            flight = this.start(key, work);
        flight.waiters++;
        return this.wait(key, flight, signal);
    }
    start(key, work) {
        const controller = new AbortController();
        const flight = { controller, waiters: 0, settled: false, promise: undefined };
        const release = () => {
            flight.settled = true;
            if (this.flights.get(key) === flight)
                this.flights.delete(key);
        };
        flight.promise = (async () => work(controller.signal))().then(value => { release(); return value; }, error => { release(); throw error; });
        // Waiters observe the outcome; this guards the case where all of them aborted.
        flight.promise.catch(() => { });
        this.flights.set(key, flight);
        return flight;
    }
    wait(key, flight, signal) {
        if (!signal)
            return flight.promise;
        return new Promise((resolve, reject) => {
            let done = false;
            const onAbort = () => {
                if (done)
                    return;
                done = true;
                flight.waiters--;
                // Last waiter gone: cancel the shared work and stop new callers joining it.
                if (flight.waiters <= 0 && !flight.settled) {
                    if (this.flights.get(key) === flight)
                        this.flights.delete(key);
                    flight.controller.abort(abortReason(signal));
                }
                reject(abortReason(signal));
            };
            signal.addEventListener('abort', onAbort, { once: true });
            flight.promise.then(value => { if (done)
                return; done = true; signal.removeEventListener('abort', onAbort); resolve(value); }, error => { if (done)
                return; done = true; signal.removeEventListener('abort', onAbort); reject(error); });
        });
    }
}
//# sourceMappingURL=singleflight.js.map