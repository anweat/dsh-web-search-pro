import { WebSearchSettingsController, } from "./form.js";
import { SettingsCard } from "./SettingsCard.js";
import { en, zh } from "./locales.js";
import { ensureStyles } from "./styles.js";
export const name = 'web-search-pro-client';
export const inject = ['slots', 'locale', 'connection', 'settingsScope'];
export const NS = 'web-search-pro.card';
export function apply(ctx) {
    ensureStyles();
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-search-pro: settings dictionaries');
    const { api } = ctx.get('connection');
    const scope = ctx.settingsScope.bind({ namespace: 'web-search-pro' });
    const controller = new WebSearchSettingsController(scope, api);
    ctx.effect(() => () => { controller.dispose(); }, 'web-search-pro: settings controller');
    ctx.slots.inject('settings.plugin.item', () => {
        const options = {
            name: 'settings.plugin.item',
            key: 'web-search-pro',
            id: 'web-search-pro',
            locale: NS,
            inject: () => controller.inject(),
        };
        return ctx.slots.register(options, SettingsCard);
    });
}
//# sourceMappingURL=index.js.map