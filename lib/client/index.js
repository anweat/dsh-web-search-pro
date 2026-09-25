import { WebSearchSettingsController, } from "./form.js";
import { SettingsCard } from "./SettingsCard.js";
import { en, zh } from "./locales.js";
import { ensureStyles } from "./styles.js";
export const name = 'web-search-pro-client';
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'];
export const NS = 'web-search-pro.card';
export function apply(ctx) {
    ensureStyles();
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-search-pro: settings dictionaries');
    const form = ctx.configForms.get('web-search-pro');
    const controller = new WebSearchSettingsController(form, ctx);
    ctx.effect(() => () => { controller.dispose(); }, 'web-search-pro: settings controller');
    // The label thunk re-reads the active locale on every shell render, so no
    // re-registration is needed when the user switches languages.
    ctx.slots.inject('settings.plugins.tab', () => {
        const options = {
            name: 'settings.plugins.tab',
            id: 'web-search-pro',
            order: 10,
            label: () => (ctx.locale.getLocale().active === 'en' ? en.tab : zh.tab),
            locale: NS,
            inject: () => controller.inject(),
        };
        return ctx.slots.register(options, SettingsCard);
    });
    // Legacy Hosts (pre-0.1.7) expose the settings.plugin.item seat; register
    // there too so the card renders on both generations. The cast bypasses the
    // 0.1.7 SlotMap, which no longer declares that key.
    const legacySlots = ctx.slots;
    legacySlots.inject('settings.plugin.item', () => {
        return legacySlots.register({
            name: 'settings.plugin.item',
            key: 'web-search-pro',
            id: 'web-search-pro',
            locale: NS,
            inject: () => controller.inject(),
        }, SettingsCard);
    });
}
//# sourceMappingURL=index.js.map