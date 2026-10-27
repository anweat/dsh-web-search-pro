import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Frame, SaveBar, SummaryBar } from "./card-frame.js";
import { AdvancedGroup } from "./group-advanced.js";
import { CliGroup } from "./group-cli.js";
import { CommonGroup } from "./group-common.js";
import { JudgeGroup } from "./group-judge.js";
import { OrderGroup } from "./group-order.js";
import { RuntimeGroup } from "./group-runtime.js";
import { SourcesGroup } from "./group-sources.js";
import { NetworkGroup, RankingGroup, ReadingGroup, RouteGroup } from "./groups-basic.js";
export function SettingsCard(props) {
    // The one-liner the Plugins list shows. Without it the list falls back to the package's npm description.
    if (props.view === 'summary')
        return _jsx(_Fragment, { children: props.t('description') });
    return _jsxs(Frame, { card: props, children: [_jsx(SummaryBar, { card: props }), _jsx(CommonGroup, { card: props }), _jsx(OrderGroup, { card: props }), _jsx(SourcesGroup, { card: props }), _jsx(CliGroup, { card: props }), _jsx(ReadingGroup, { card: props }), _jsx(JudgeGroup, { card: props }), _jsx(RouteGroup, { card: props }), _jsx(RuntimeGroup, { card: props }), _jsx(NetworkGroup, { card: props }), _jsx(RankingGroup, { card: props }), _jsx(AdvancedGroup, { card: props }), _jsx(SaveBar, { card: props })] });
}
//# sourceMappingURL=SettingsCard.js.map