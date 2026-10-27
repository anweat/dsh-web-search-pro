/**
 * Conservative parsing of the time texts CLI tools print (a field source `{ time }` of the adapter spec): an exact format is
 * turned into an ISO date or timestamp, anything else gives nothing, so a result never carries a guessed time. Pure; the clock is
 * a parameter. Chinese relative and calendar texts are read in China time (UTC+8), which is what the sites print.
 *  - ISO 8601 (`2026-10-27T08:38:08Z`, with or without a zone offset or fraction) -> normalized timestamp;
 *  - the `created_at` of the X API (`Tue Oct 27 08:38:08 +0000 2026`) -> timestamp;
 *  - `YYYY-MM-DD` -> that date; `MM-DD` -> the latest such date that is not after today (a date in the future means last year);
 *  - `N分钟前` / `N小时前` -> timestamp (now minus N); `N天前` -> date; `昨天 HH:MM` -> timestamp (China time).
 * @module web-search-pro/cli/time-text
 */

const CN_OFFSET_MS = 8 * 3600_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number): string => String(n).padStart(2, '0')

/** Whether `y-m-d` is a real calendar date. */
function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z')
/** `YYYY-MM-DD` of an instant in China time. */
const cnDate = (ms: number): string => new Date(ms + CN_OFFSET_MS).toISOString().slice(0, 10)

/** The text as an ISO date (`YYYY-MM-DD`) or timestamp, or undefined when it is not one of the formats above. */
export function normalizeTimeText(raw: string, now: number = Date.now()): string | undefined {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (!text) return undefined
  let m: RegExpExecArray | null

  if ((m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text))) {
    const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number]
    const sec = m[6] === undefined ? 0 : Number(m[6])
    if (!validDate(y, mo, d) || h > 23 || mi > 59 || sec > 59) return undefined
    const zone = m[7]
    const offsetMin = zone === undefined || zone === 'Z' ? 0 : (zone.startsWith('-') ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.replace(':', '').slice(3, 5)))
    return iso(Date.UTC(y, mo - 1, d, h, mi, sec) - offsetMin * 60_000)
  }

  if ((m = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4}) (\d{4})$/.exec(text))) {
    const month = MONTHS.indexOf(m[1]!) + 1
    const [d, h, mi, s, y] = [m[2], m[3], m[4], m[5], m[7]].map(Number) as [number, number, number, number, number]
    if (!month || !validDate(y, month, d) || h > 23 || mi > 59 || s > 59) return undefined
    const offsetMin = (m[6]!.startsWith('-') ? -1 : 1) * (Number(m[6]!.slice(1, 3)) * 60 + Number(m[6]!.slice(3, 5)))
    return iso(Date.UTC(y, month - 1, d, h, mi, s) - offsetMin * 60_000)
  }

  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number]
    return validDate(y, mo, d) ? y + '-' + pad(mo) + '-' + pad(d) : undefined
  }

  if ((m = /^(\d{1,2})-(\d{1,2})$/.exec(text))) {
    const [mo, d] = [Number(m[1]), Number(m[2])] as [number, number]
    const today = cnDate(now)
    const thisYear = Number(today.slice(0, 4))
    // Latest year, not after today, in which the date exists (29 February skips back to a leap year).
    for (let y = thisYear; y > thisYear - 5; y--) {
      if (!validDate(y, mo, d)) continue
      const candidate = y + '-' + pad(mo) + '-' + pad(d)
      if (candidate <= today) return candidate
    }
    return undefined
  }

  if ((m = /^(\d{1,3})分钟前$/.exec(text))) return iso(now - Number(m[1]) * 60_000)
  if ((m = /^(\d{1,3})小时前$/.exec(text))) return iso(now - Number(m[1]) * 3600_000)
  if ((m = /^(\d{1,3})天前$/.exec(text))) return cnDate(now - Number(m[1]) * 86_400_000)

  if ((m = /^昨天 (\d{1,2}):(\d{2})$/.exec(text))) {
    const [h, mi] = [Number(m[1]), Number(m[2])] as [number, number]
    if (h > 23 || mi > 59) return undefined
    return cnDate(now - 86_400_000) + 'T' + pad(h) + ':' + pad(mi) + ':00+08:00'
  }
  return undefined
}
