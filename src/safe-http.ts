import dns from 'node:dns/promises'
import net from 'node:net'

function privateIpv4(value: string): boolean {
  const p = value.split('.').map(Number)
  if (p.length !== 4 || p.some(v => !Number.isInteger(v) || v < 0 || v > 255)) return true
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224
    || (p[0] === 169 && p[1] === 254)
    || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    || (p[0] === 192 && p[1] === 168)
    || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    || (p[0] === 198 && (p[1] === 18 || p[1] === 19))
}

function privateIp(value: string): boolean {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, '')
  if (net.isIP(normalized) === 4) return privateIpv4(normalized)
  if (net.isIP(normalized) !== 6) return false
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
  return mapped ? privateIpv4(mapped[1]!) : false
}

export function assertSafePublicUrl(raw: string | URL): URL {
  let url: URL
  try { url = raw instanceof URL ? new URL(raw.href) : new URL(raw) } catch { throw new Error('URL is not valid') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only public HTTP(S) URLs are allowed')
  if (url.username || url.password) throw new Error('URL credentials are not allowed')
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || privateIp(host)) {
    throw new Error('private or local network targets are not allowed')
  }
  return url
}

export async function assertResolvedPublicUrl(raw: string | URL): Promise<URL> {
  const url = assertSafePublicUrl(raw)
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) return url
  let addresses: { address: string }[]
  try { addresses = await dns.lookup(url.hostname, { all: true, verbatim: true }) } catch (error) {
    throw new Error('hostname resolution failed for ' + url.hostname + ': ' + String(error).slice(0, 160))
  }
  if (!addresses.length || addresses.some(v => privateIp(v.address))) throw new Error('hostname does not resolve exclusively to public addresses')
  return url
}

export async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('HTTP response exceeds ' + maxBytes + ' bytes')
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new Error('HTTP response exceeds ' + maxBytes + ' bytes')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {})
    throw error
  }
  return Buffer.concat(chunks.map(v => Buffer.from(v)), total)
}

export function stripSensitiveHeadersForRedirect(headers: Record<string, string>, from: URL, to: URL): Record<string, string> {
  if (from.origin === to.origin) return { ...headers }
  const sensitive = new Set(['authorization', 'proxy-authorization', 'cookie', 'x-api-key'])
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !sensitive.has(name.toLowerCase())))
}
