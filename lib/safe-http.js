import dns from 'node:dns/promises';
import net from 'node:net';
function privateIpv4(value) {
    const p = value.split('.').map(Number);
    if (p.length !== 4 || p.some(v => !Number.isInteger(v) || v < 0 || v > 255))
        return true;
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224
        || (p[0] === 169 && p[1] === 254)
        || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
        || (p[0] === 192 && p[1] === 168)
        || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
        || (p[0] === 198 && (p[1] === 18 || p[1] === 19));
}
function privateIp(value) {
    const normalized = value.toLowerCase().replace(/^\[|\]$/g, '');
    if (net.isIP(normalized) === 4)
        return privateIpv4(normalized);
    if (net.isIP(normalized) !== 6)
        return false;
    if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized))
        return true;
    // 2001:2::/48 is the RFC 5180 benchmarking block: never globally routed, and a common TUN fake-IP range.
    if (ipv6Groups(normalized).slice(0, 3).every((group, index) => group === [0x2001, 0x0002, 0][index]))
        return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    return mapped ? privateIpv4(mapped[1]) : false;
}
function proxyFakeIp(value) {
    const normalized = value.toLowerCase().replace(/^\[|\]$/g, '');
    if (net.isIP(normalized) === 4) {
        const [first, second] = normalized.split('.').map(Number);
        return first === 198 && (second === 18 || second === 19);
    }
    if (net.isIP(normalized) !== 6)
        return false;
    const groups = ipv6Groups(normalized);
    if (groups.length !== 8)
        return false;
    // mihomo/Clash default fake-ip-range6 (fdfe:dcba:9876::/64) and the 2001:2::/48 TUN range.
    return groups.slice(0, 4).every((group, index) => group === [0xfdfe, 0xdcba, 0x9876, 0][index])
        || groups.slice(0, 3).every((group, index) => group === [0x2001, 0x0002, 0][index]);
}
/** Expand an IPv6 literal into 8 numeric groups (empty when malformed). */
function ipv6Groups(value) {
    if (net.isIP(value) !== 6 || value.includes('.'))
        return [];
    const [left = '', right = ''] = value.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const groups = value.includes('::')
        ? [...leftGroups, ...Array.from({ length: 8 - leftGroups.length - rightGroups.length }, () => '0'), ...rightGroups]
        : leftGroups;
    return groups.length === 8 ? groups.map(group => Number.parseInt(group, 16)) : [];
}
export function assertSafePublicUrl(raw) {
    let url;
    try {
        url = raw instanceof URL ? new URL(raw.href) : new URL(raw);
    }
    catch {
        throw new Error('URL is not valid');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new Error('only public HTTP(S) URLs are allowed');
    if (url.username || url.password)
        throw new Error('URL credentials are not allowed');
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || privateIp(host)) {
        throw new Error('private or local network targets are not allowed');
    }
    return url;
}
export async function assertResolvedPublicUrl(raw, options = {}) {
    const url = assertSafePublicUrl(raw);
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')))
        return url;
    let addresses;
    try {
        addresses = options.lookup
            ? await options.lookup(url.hostname)
            : await dns.lookup(url.hostname, { all: true, verbatim: true });
    }
    catch (error) {
        throw new Error('hostname resolution failed for ' + url.hostname + ': ' + String(error).slice(0, 160));
    }
    const blocked = addresses.filter(({ address }) => privateIp(address) && !(options.allowProxyFakeIp && proxyFakeIp(address)));
    if (!addresses.length)
        throw new Error('hostname does not resolve exclusively to public addresses');
    if (blocked.length) {
        const hint = !options.allowProxyFakeIp && blocked.every(({ address }) => proxyFakeIp(address))
            ? ' (resolved to proxy fake-IP ' + blocked[0].address + '; if a Clash/TUN proxy is in use, enable allowProxyFakeIp)'
            : '';
        throw new Error('hostname does not resolve exclusively to public addresses' + hint);
    }
    return url;
}
export async function readBoundedBody(response, maxBytes) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes)
        throw new Error('HTTP response exceeds ' + maxBytes + ' bytes');
    if (!response.body)
        return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > maxBytes)
                throw new Error('HTTP response exceeds ' + maxBytes + ' bytes');
            chunks.push(value);
        }
    }
    catch (error) {
        await reader.cancel(error).catch(() => { });
        throw error;
    }
    return Buffer.concat(chunks.map(v => Buffer.from(v)), total);
}
export function stripSensitiveHeadersForRedirect(headers, from, to) {
    if (from.origin === to.origin)
        return { ...headers };
    const sensitive = new Set(['authorization', 'proxy-authorization', 'cookie', 'x-api-key']);
    return Object.fromEntries(Object.entries(headers).filter(([name]) => !sensitive.has(name.toLowerCase())));
}
//# sourceMappingURL=safe-http.js.map