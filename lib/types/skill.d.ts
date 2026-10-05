/**
 * The bundled `dsh-web-search-pro` skill: usage guidance for the web_index / web_call tools.
 *
 * The skill is registered with the Host's skill registry when that service
 * exists. It must never be a hard dependency of the plugin: Cordis 4.0.4 treats
 * every declared `inject` as required, so a missing `skills` service would hang
 * the whole plugin. The plugin therefore asks for it through a scoped
 * `ctx.inject(['skills'], ...)` and works the same without it (the `web_index`
 * root then carries a compact guide).
 * @module web-search-pro/skill
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const SKILL_NAME = "dsh-web-search-pro";
/** `assets/skills/dsh-web-search-pro/`, resolved next to `src/` or the built `lib/`. */
export declare const SKILL_DIR: string;
/** Parse `name` and `description` out of a SKILL.md and return the body without the front matter. */
export declare function parseSkillFile(raw: string): {
    name: string;
    description: string;
    body: string;
};
export declare function readSkill(dir?: string): {
    name: string;
    description: string;
    body: string;
};
/**
 * A provider object shaped like the Host's `SkillProvider` (declared locally to avoid a build-time dependency).
 * It re-reads the packaged file on every call, so it is never stale.
 */
export declare function createSkillProvider(dir?: string): {
    name: string;
    list: () => Promise<{
        name: string;
        description: string;
        invocation: {
            modelInvocable: boolean;
            userInvocable: boolean;
        };
        provider: string;
        source: string;
        resourceBase: {
            kind: "directory";
            path: string;
        };
        rank: number;
        locator: string;
    }[]>;
    get: () => Promise<{
        name: string;
        description: string;
        invocation: {
            modelInvocable: boolean;
            userInvocable: boolean;
        };
        provider: string;
        source: string;
        resourceBase: {
            kind: "directory";
            path: string;
        };
        content: string;
    }>;
};
export interface SkillRegistration {
    /** Whether the skill is registered with the Host right now (false without a skill service). */
    isAvailable: () => boolean;
}
/**
 * Register the skill when the Host provides a skill registry, and track whether
 * it is registered so the index can fall back to its compact guide otherwise.
 */
export declare function registerSkillWhenAvailable(ctx: Context, dir?: string): SkillRegistration;
