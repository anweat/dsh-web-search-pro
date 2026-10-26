/**
 * "Scoring model": the optional model judge (mode, provider, coverage judge, usage caps), its custom providers as a JSON list,
 * and the judge prompts (rubrics) as a list: a row each (name, active version, default or overridden) and an edit dialog that
 * puts the built-in text beside your override. The dialog edits the same staged entry the rest of the card writes on save.
 * @module web-search-pro/client/group-judge
 */
import { BUILTIN_RUBRIC_IDS } from '../pipeline/rubrics-spec.ts';
import { type Card } from './field-rows.tsx';
/** The controls of one rubric override: each is a view of the one staged entry; the built-in text sits beside it. */
export declare function RubricForm({ card, id }: {
    card: Card;
    id: string;
}): import("react").JSX.Element;
export { BUILTIN_RUBRIC_IDS };
export declare function JudgeGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
