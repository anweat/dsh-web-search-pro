import { readBoundedBody } from "./safe-http.js";
import { assertSafePublicUrl } from "./safe-http.js";
function parseResults(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.results))
        throw new Error('Exa response is missing results');
    return value.results.flatMap((row) => {
        if (!row || typeof row !== 'object')
            return [];
        const r = row;
        if (typeof r.url !== 'string' || !/^https?:\/\//i.test(r.url))
            return [];
        return [{
                url: r.url,
                ...typeof r.title === 'string' ? { title: r.title } : {},
                ...typeof r.text === 'string' ? { text: r.text } : {},
                ...typeof r.publishedDate === 'string' ? { publishedDate: r.publishedDate } : {},
                ...Array.isArray(r.highlights) ? { highlights: r.highlights.filter((v) => typeof v === 'string') } : {},
            }];
    });
}
export class ExaClient {
    apiKey;
    fetchImpl;
    constructor(options) {
        if (!options.apiKey.trim())
            throw new Error('Exa API key is required');
        this.apiKey = options.apiKey;
        this.fetchImpl = options.fetch ?? fetch;
    }
    toString() { return '[ExaClient]'; }
    async post(path, body, signal) {
        const response = await this.fetchImpl('https://api.exa.ai' + path, {
            method: 'POST', signal, headers: { 'x-api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body),
        });
        const text = (await readBoundedBody(response, 4 * 1024 * 1024)).toString('utf8');
        if (!response.ok)
            throw new Error('Exa API HTTP ' + response.status + (text ? ': ' + text.slice(0, 200) : ''));
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw new Error('Exa API returned invalid JSON');
        }
        return parseResults(parsed);
    }
    search(request, signal) {
        const query = request.query.trim();
        if (!query)
            throw new Error('Exa query must be non-empty');
        const allowedTypes = ['instant', 'fast', 'auto', 'deep-lite', 'deep', 'deep-reasoning'];
        if (request.type && !allowedTypes.includes(request.type))
            throw new Error('unsupported Exa search type: ' + request.type);
        for (const domain of [...request.includeDomains ?? [], ...request.excludeDomains ?? []]) {
            if (!/^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/i.test(domain))
                throw new Error('invalid Exa domain filter: ' + domain);
        }
        for (const date of [request.startPublishedDate, request.endPublishedDate]) {
            if (date && Number.isNaN(Date.parse(date)))
                throw new Error('invalid Exa published date: ' + date);
        }
        return this.post('/search', {
            ...request,
            query,
            numResults: Math.min(Math.max(request.numResults ?? 10, 1), 100),
            contents: { text: false, highlights: true },
        }, signal);
    }
    contents(urls, signal) {
        const unique = [...new Set(urls)].slice(0, 100);
        if (!unique.length)
            throw new Error('Exa contents requires valid HTTP(S) URLs');
        unique.forEach(url => assertSafePublicUrl(url));
        return this.post('/contents', { urls: unique, text: true }, signal);
    }
}
//# sourceMappingURL=exa-client.js.map