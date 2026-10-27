import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { fill } from "./fill.js";
import { formatTime } from "./overlay-ops.js";
import { styles as css } from "./styles.js";
import { AgentTag } from "./ui-kit.js";
/** The overlay item of a key in the card's state, or undefined. */
export function useOverlayItem(card, key) {
    return card.useWebSearchPro(snapshot => snapshot.server.overlay.view?.items.find(item => item.key === key));
}
/** One sentence for the tooltip: the value the agent set, the one in the configuration, the reason, who and when. */
export function agentTip(t, item) {
    const who = item.actor === 'user' ? t('agentActorUser') : t('agentActorAgent');
    return fill(t('agentTip'), { value: item.summary, baseline: item.baseline, reason: item.reason ?? t('agentNoReason'), at: item.at ? formatTime(item.at) : '', who });
}
/**
 * `compact` shows the tag only (list rows have no room for buttons; the "Agent changes" group holds them); otherwise the tag is followed
 * by "Adopt into configuration" and "Revoke".
 */
export function AgentMark({ card, itemKey, compact }) {
    const { t } = card;
    const item = useOverlayItem(card, itemKey);
    const busy = card.useWebSearchPro(snapshot => !snapshot.writable || snapshot.saving || snapshot.server.overlay.busy);
    if (!item)
        return null;
    return _jsxs("span", { className: "wsp-agent", "data-wsp-agent": itemKey, children: [_jsx(AgentTag, { label: t('agentBadge'), tip: agentTip(t, item) }), compact ? null : _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: css.link, disabled: busy, onClick: () => card.adoptOverlay(itemKey), "data-wsp-agent-adopt": itemKey, children: t('agentAdopt') }), _jsx("button", { type: "button", className: css.link, disabled: busy, onClick: () => card.revokeOverlay([itemKey]), "data-wsp-agent-revoke": itemKey, children: t('agentRevoke') })] })] });
}
//# sourceMappingURL=agent-mark.js.map