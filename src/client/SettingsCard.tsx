/**
 * The Web Search Pro settings card, as the Plugins page renders it.
 *
 * The page owns the card frame (its title, disclosure and artwork come from the slot registration), so this component renders
 * only what goes inside: the one-liner for `view: 'summary'`, and for `view: 'page'` a status summary, eleven groups (only
 * "Common" open) and a save bar that stays in view.
 *
 *   Common · Search order · Sources · Custom CLI · Reading and evidence · Scoring model · Built-in web tool route ·
 *   Runtime and backends · Network and cache · Ranking weights · Advanced: text mode and raw JSON
 *
 * Each group is its own module (`group-*.tsx`) built from the controls in `ui-kit.tsx`: the Host's own switches, buttons,
 * badges, dialogs and help bubbles, plus the few controls the Host has no component for. Every public config field has
 * exactly one entry in the groups (test/settings-card-render.test.ts counts them); the text of the last group is a view of
 * the same fields, not a second place they live.
 * @module web-search-pro/client/SettingsCard
 */

import type { SettingsCardProps } from './index.ts'
import { Frame, SaveBar, SummaryBar } from './card-frame.tsx'
import { AdvancedGroup } from './group-advanced.tsx'
import { CliGroup } from './group-cli.tsx'
import { CommonGroup } from './group-common.tsx'
import { JudgeGroup } from './group-judge.tsx'
import { OrderGroup } from './group-order.tsx'
import { RuntimeGroup } from './group-runtime.tsx'
import { SourcesGroup } from './group-sources.tsx'
import { NetworkGroup, RankingGroup, ReadingGroup, RouteGroup } from './groups-basic.tsx'

export function SettingsCard(props: SettingsCardProps) {
  // The one-liner the Plugins list shows. Without it the list falls back to the package's npm description.
  if (props.view === 'summary') return <>{props.t('description')}</>
  return <Frame card={props}>
    <SummaryBar card={props} />
    <CommonGroup card={props} />
    <OrderGroup card={props} />
    <SourcesGroup card={props} />
    <CliGroup card={props} />
    <ReadingGroup card={props} />
    <JudgeGroup card={props} />
    <RouteGroup card={props} />
    <RuntimeGroup card={props} />
    <NetworkGroup card={props} />
    <RankingGroup card={props} />
    <AdvancedGroup card={props} />
    <SaveBar card={props} />
  </Frame>
}
