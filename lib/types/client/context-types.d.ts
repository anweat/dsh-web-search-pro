import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { zh } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'web-search-pro.card': keyof typeof zh;
    }
}
export type Context = ClientContext;
