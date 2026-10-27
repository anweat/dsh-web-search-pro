window.__ModuleLoader__.load({
	id: "dsh-web-search-pro",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/config-fillers.ts
		/**
		* Removal of the empty containers the Host's schema parser fills in (see the comment on `withoutFillers`). Pure and free of
		* imports: the server's config resolution and the settings card's validation (client bundle) use the same functions.
		* @module web-search-pro/config-fillers
		*/
		/**
		* The Host parses the plugin config with the schema above, and schemastery fills every optional nested container it was not
		* given with an empty one (`calibration: { points: [] }`, `price: {}`, `limits: {}`, `criteria: []`, `thresholds: {}`).
		* The validators of the judge settings (providers, rubric overrides, coverage thresholds) read "present" as "given", so
		* those fillers would reject every custom provider / rubric override and report empty thresholds as invalid. They are
		* removed here, on exactly the keys the schema fills, and nowhere inside user data (`extraBody` is passed through as is).
		*/
		const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
		const isEmptyContainer = (value) => Array.isArray(value) ? value.length === 0 : isPlain(value) && Object.keys(value).length === 0;
		function withoutFillers(value, keys) {
			if (!isPlain(value)) return value;
			const out = { ...value };
			for (const key of keys) if (key in out && isEmptyContainer(out[key])) delete out[key];
			return out;
		}
		function normalizeJudge(judge) {
			const base = withoutFillers(judge, ["providers"]);
			if (!isPlain(base) || !isPlain(base.providers)) return base;
			const providers = {};
			for (const [id, entry] of Object.entries(base.providers)) {
				let next = withoutFillers(entry, [
					"limits",
					"extraBody",
					"price",
					"calibration"
				]);
				if (isPlain(next) && isPlain(next.calibration)) {
					const calibration = withoutFillers(next.calibration, ["points"]);
					const rest = { ...next };
					if (Object.keys(calibration).length > 0) rest.calibration = calibration;
					else delete rest.calibration;
					next = rest;
				}
				providers[id] = next;
			}
			return {
				...base,
				providers
			};
		}
		function normalizeRubrics(rubrics) {
			if (!isPlain(rubrics)) return rubrics;
			return Object.fromEntries(Object.entries(rubrics).map(([id, entry]) => [id, withoutFillers(entry, ["criteria"])]));
		}
		function normalizeCoverage(coverage) {
			return withoutFillers(coverage, ["thresholds"]);
		}
		//#endregion
		//#region src/pipeline/rubrics-spec.ts
		/**
		* The pure part of the judge rubrics (dev-plan M10): the variable whitelist, limits, the built-in definitions and the
		* validation rules of an override. No Node imports, so the settings panel (client bundle) and the server validate a
		* rubric override with the very same code; hashing and resolution live in ./rubrics.ts.
		* @module web-search-pro/pipeline/rubrics-spec
		*/
		/** Variables a template may use; anything else rejects the rubric. */
		const RUBRIC_VARIABLES = [
			"task",
			"need",
			"constraint",
			"candidate"
		];
		const RUBRIC_LIMITS = {
			versionPattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/,
			instructionsChars: 2e3,
			criteriaMin: 2,
			criteriaMax: 10,
			criterionChars: 200,
			stateChars: [20, 2e3],
			candidateChars: [100, 8e3]
		};
		const BUILTIN = [
			{
				id: "score.support",
				version: "v1",
				lang: "zh",
				kind: "score",
				description: "(需求, 文本块) 对：文本块对需求的支撑程度，0–3。",
				instructions: "下面的文本块对该需求的支撑程度如何？\n需求：{need}\n文本块：{candidate}",
				state: "搜索任务：{task}",
				criteria: [
					"无关或只有同名词",
					"同主题但不回答",
					"部分回答",
					"直接回答且含可定位证据"
				],
				maxStateChars: 200,
				maxCandidateChars: 1200,
				allowed: [
					"task",
					"need",
					"candidate"
				],
				required: ["need", "candidate"]
			},
			{
				id: "gate.relevance",
				version: "v1",
				lang: "zh",
				kind: "noul",
				description: "只问主题相关，忽略约束。",
				instructions: "候选材料的主题是否与下列需求相关？只看主题，不考虑版本、时间、来源等限制条件。\n需求：{need}\n候选：{candidate}",
				maxStateChars: 200,
				maxCandidateChars: 1200,
				allowed: [
					"task",
					"need",
					"candidate"
				],
				required: ["need", "candidate"]
			},
			{
				id: "gate.constraint",
				version: "v1",
				lang: "zh",
				kind: "noul",
				description: "逐条语义约束：候选是否满足该约束；材料中看不出时应偏向否定。",
				instructions: "候选材料是否满足下面这条约束？只判断这一条约束，不判断其他方面。\n约束：{constraint}\n候选：{candidate}",
				maxStateChars: 200,
				maxCandidateChars: 1200,
				allowed: [
					"task",
					"constraint",
					"candidate"
				],
				required: ["constraint", "candidate"]
			},
			{
				id: "cover.sufficient",
				version: "v1",
				lang: "zh",
				kind: "noul",
				description: "(需求, 证据视图) 对：这些摘录本身是否足以回答需求（M9 覆盖判定）。",
				instructions: "下面的证据摘录本身是否已经明确给出了该需求的答案？只提到相同主题、相关名词或相邻内容不算。如果需求问的是某事物是否存在、是否被支持，摘录中明确说“有”或明确说“没有”都算足够。\n需求：{need}\n证据摘录：{candidate}",
				state: "搜索任务：{task}",
				maxStateChars: 200,
				maxCandidateChars: 2400,
				allowed: [
					"task",
					"need",
					"candidate"
				],
				required: ["need", "candidate"]
			}
		];
		const BUILTIN_RUBRIC_IDS = BUILTIN.map((r) => r.id);
		const variablesOf = (template) => [...template.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]);
		const isInt = (n) => typeof n === "number" && Number.isInteger(n);
		/** Problems of a candidate rubric content; empty = valid. `base` supplies the kind and the allowed variables. */
		function rubricProblems(base, fields) {
			const out = [];
			if (typeof fields.version !== "string" || !RUBRIC_LIMITS.versionPattern.test(fields.version)) out.push("version must be a label like \"v2\" (letters, digits, . _ -, at most 32 characters)");
			if (fields.instructions !== void 0) {
				const t = fields.instructions;
				if (typeof t !== "string" || !t.trim()) out.push("instructions must be a non-empty string");
				else {
					if (t.length > RUBRIC_LIMITS.instructionsChars) out.push("instructions longer than " + RUBRIC_LIMITS.instructionsChars + " characters");
					const used = new Set(variablesOf(t));
					for (const name of used) if (!RUBRIC_VARIABLES.includes(name)) out.push("unknown variable {" + name + "} (allowed: " + base.allowed.map((v) => "{" + v + "}").join(" ") + ")");
					else if (!base.allowed.includes(name)) out.push("variable {" + name + "} is not available in " + base.id + " (allowed: " + base.allowed.map((v) => "{" + v + "}").join(" ") + ")");
					for (const name of base.required) if (!used.has(name)) out.push("instructions must contain {" + name + "}");
				}
			}
			if (fields.criteria !== void 0) {
				const c = fields.criteria;
				if (base.kind !== "score") out.push("criteria only apply to score rubrics");
				else if (!Array.isArray(c) || c.length < RUBRIC_LIMITS.criteriaMin || c.length > RUBRIC_LIMITS.criteriaMax) out.push("criteria needs " + RUBRIC_LIMITS.criteriaMin + "-" + RUBRIC_LIMITS.criteriaMax + " levels, lowest first");
				else if (c.some((x) => typeof x !== "string" || !x.trim() || x.length > RUBRIC_LIMITS.criterionChars)) out.push("each criterion must be a non-empty string of at most " + RUBRIC_LIMITS.criterionChars + " characters");
			}
			for (const [name, range] of [["maxStateChars", RUBRIC_LIMITS.stateChars], ["maxCandidateChars", RUBRIC_LIMITS.candidateChars]]) {
				const n = fields[name];
				if (n !== void 0 && (!isInt(n) || n < range[0] || n > range[1])) out.push(name + " must be an integer in " + range[0] + ".." + range[1]);
			}
			return out;
		}
		/** The built-in definition of a rubric id, if it is one. */
		const builtinDef = (id) => BUILTIN.find((r) => r.id === id);
		/** Keys an override may carry. */
		const RUBRIC_OVERRIDE_KEYS = [
			"version",
			"instructions",
			"criteria",
			"maxStateChars",
			"maxCandidateChars"
		];
		/** Whether an override changes anything the question is made of, compared with the built-in. */
		function changesContent(base, f) {
			return f.instructions !== void 0 && f.instructions !== base.instructions || f.criteria !== void 0 && JSON.stringify(f.criteria) !== JSON.stringify(base.criteria ?? null) || f.maxStateChars !== void 0 && f.maxStateChars !== base.maxStateChars || f.maxCandidateChars !== void 0 && f.maxCandidateChars !== base.maxCandidateChars;
		}
		/**
		* Every reason an override entry of rubric `id` would be ignored; empty = it takes effect. The one rule set behind
		* `resolveRubric` (server) and the settings panel's rubric editor.
		*/
		function overrideProblems(id, raw) {
			const base = builtinDef(id);
			if (!base) return ["unknown rubric id \"" + id + "\" (known: " + BUILTIN_RUBRIC_IDS.join(", ") + ")"];
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return ["not an object"];
			const o = raw;
			const problems = [...Object.keys(o).filter((k) => !RUBRIC_OVERRIDE_KEYS.includes(k)).map((k) => "unknown field \"" + k + "\""), ...rubricProblems(base, o)];
			if (!problems.length && o.version === base.version && changesContent(base, o)) problems.push("changed content needs a new version (not \"" + base.version + "\")");
			return problems;
		}
		//#endregion
		//#region src/config-enums.ts
		/**
		* Closed value lists of the plugin configuration, with no imports so the settings panel (client bundle) offers
		* exactly the values the server accepts. config.ts re-exports them.
		* @module web-search-pro/config-enums
		*/
		/** `evidence.judge.mode` / the legacy `evidence.jevMode`. */
		const JUDGE_MODES = [
			"off",
			"shadow",
			"control",
			"hybrid"
		];
		const PROVIDER_EVIDENCE_MODES = ["auto", "off"];
		/** `indexed` registers web_index + web_call; `flat` registers one tool per action (comparison and debugging only). */
		const TOOL_SURFACES = ["indexed", "flat"];
		/**
		* `evidence.sourcePolicy`: `default` plans from what the user configured and ranked, else the anonymous / free defaults;
		* `anonymous-only` never uses a source that needs a key, account or login even when one is configured (explicit `engines` still win).
		*/
		const SOURCE_POLICIES = ["default", "anonymous-only"];
		//#endregion
		//#region src/pipeline/coverage.ts
		const COVERAGE_MODES = [
			"off",
			"shadow",
			"control"
		];
		/**
		* Thresholds fitted on the v1 CALIBRATION split (bench/README, dev-plan M9: false weak <= 5% of the truly covered claims,
		* then the most false claims removed; `covered` = lowest probability from which the standing claims reach 85% precision),
		* keyed `provider|rubric@version`. Another provider, model or rubric version has no entry: it needs `evidence.coverage.thresholds`.
		* Shipping them does not turn the judge on: `evidence.coverage.mode` stays `off` until set.
		*/
		const CALIBRATED_THRESHOLDS = { "bocha-jev|cover.sufficient@v1": {
			weak: .0512,
			covered: .313
		} };
		const thresholdKey = (providerId, rubric) => providerId + "|" + rubric.id + "@" + rubric.version;
		/** Problems of a thresholds object; empty = valid. */
		function thresholdsProblems(raw) {
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return ["thresholds must be an object { weak, covered }"];
			const out = [];
			const t = raw;
			for (const k of Object.keys(t)) if (k !== "weak" && k !== "covered") out.push("unknown threshold \"" + k + "\"");
			const num = (k) => {
				const v = t[k];
				if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
					out.push("thresholds." + k + " must be a number in 0..1");
					return;
				}
				return v;
			};
			const weak = num("weak");
			const covered = num("covered");
			if (weak !== void 0 && covered !== void 0 && weak > covered) out.push("thresholds.weak must not exceed thresholds.covered");
			return out;
		}
		//#endregion
		//#region src/pipeline/budget-spec.ts
		const DEFAULT_BUDGET = {
			perSearchInputTokens: 6e4,
			dailyInputTokens: 1e6
		};
		const isCap = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
		/** Validate the budget settings; invalid values fall back to the defaults and are reported. */
		function resolveBudget(input) {
			const diagnostics = [];
			const pick = (value, fallback, name) => {
				if (value === void 0 || value === null) return fallback;
				if (isCap(value)) return Math.floor(value);
				diagnostics.push("evidence.budget." + name + " ignored: must be a number >= 0");
				return fallback;
			};
			let timezone;
			if (input?.timezone !== void 0 && input.timezone !== null && input.timezone !== "") try {
				new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone });
				timezone = input.timezone;
			} catch {
				diagnostics.push("evidence.budget.timezone \"" + input.timezone + "\" is not a time zone: the system zone is used");
			}
			const providers = {};
			for (const [id, raw] of Object.entries(input?.providers ?? {})) {
				if (raw === null || typeof raw !== "object") {
					diagnostics.push("evidence.budget.providers." + id + " ignored: not an object");
					continue;
				}
				const perSearch = pick(raw.perSearchInputTokens, void 0, "providers." + id + ".perSearchInputTokens");
				const daily = pick(raw.dailyInputTokens, void 0, "providers." + id + ".dailyInputTokens");
				providers[id] = {
					...perSearch !== void 0 ? { perSearchInputTokens: perSearch } : {},
					...daily !== void 0 ? { dailyInputTokens: daily } : {}
				};
			}
			return {
				caps: {
					perSearchInputTokens: pick(input?.perSearchInputTokens, DEFAULT_BUDGET.perSearchInputTokens, "perSearchInputTokens"),
					dailyInputTokens: pick(input?.dailyInputTokens, DEFAULT_BUDGET.dailyInputTokens, "dailyInputTokens"),
					...timezone ? { timezone } : {},
					providers
				},
				diagnostics
			};
		}
		//#endregion
		//#region src/pipeline/judges/calibration-spec.ts
		/**
		* Validation of a provider calibration, with no Node imports so the settings panel validates it too.
		* @module web-search-pro/pipeline/judges/calibration-spec
		*/
		const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
		/** Problems of a calibration definition; empty = valid. */
		function calibrationProblems(c) {
			if (c === null || typeof c !== "object" || Array.isArray(c)) return ["calibration must be an object { version, points }"];
			const out = [];
			const { version, points } = c;
			if (typeof version !== "string" || !VERSION.test(version)) out.push("calibration.version must be a label like \"v1\" (letters, digits, . _ -, at most 32 characters)");
			if (!Array.isArray(points) || points.length < 2 || points.length > 32) {
				out.push("calibration.points needs 2-32 [raw, grade] pairs");
				return out;
			}
			let prev;
			points.forEach((p, i) => {
				if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === "number" && Number.isFinite(n))) {
					out.push("calibration.points[" + i + "] must be [raw, grade] with finite numbers");
					return;
				}
				const [x, g] = p;
				if (g < 0 || g > 3) out.push("calibration.points[" + i + "] grade must be within 0..3");
				if (prev) {
					if (x <= prev[0]) out.push("calibration.points[" + i + "] raw value must be greater than the previous one");
					if (g < prev[1]) out.push("calibration.points[" + i + "] grade must not decrease");
				}
				prev = [x, g];
			});
			return out;
		}
		//#endregion
		//#region src/pipeline/judges/types.ts
		const PROTOCOLS = [
			"systemone",
			"rerank",
			"llm"
		];
		//#endregion
		//#region src/pipeline/judges/providers-spec.ts
		/**
		* The pure part of the judge provider registry (dev-plan M10): built-in presets, the validation of a provider
		* definition and the catalog resolution. No Node imports and no protocol code, so the settings panel (client bundle)
		* runs the very validation the server runs; the scorer factories live in ./providers.ts.
		* @module web-search-pro/pipeline/judges/providers-spec
		*/
		/** Credentials ref / environment variable holding the Bocha Jev key. */
		const JEV_KEY_REF = "BOCHA_JEV_API_KEY";
		const JEV_BASE_URL = "https://jev.bocha.cn";
		const JEV_MODEL = "bocha-jev-v1";
		const DEFAULT_PROVIDER_ID = "bocha-jev";
		/** Built-in presets. Only `bocha-jev` is exercised by the plugin's own experiments; the others are unverified starting points. */
		const PRESETS = {
			"bocha-jev": {
				id: "bocha-jev",
				protocol: "systemone",
				baseUrl: JEV_BASE_URL,
				model: JEV_MODEL,
				keyRef: JEV_KEY_REF,
				label: "Jev",
				recordedId: "jev",
				notes: "Hosted Bocha Jev (the default when a model scorer is switched on)."
			},
			"typesafe-jev": {
				id: "typesafe-jev",
				protocol: "systemone",
				baseUrl: "https://typesafe-jev.invalid",
				model: "typesafe-jev-v1",
				keyRef: "TYPESAFE_JEV_API_KEY",
				label: "TypeSafe Jev",
				unverified: true,
				placeholders: ["baseUrl", "model"],
				notes: "Placeholder: another hosted Jev deployment. Set baseUrl and model (evidence.judge.providers.typesafe-jev) before use; never called by the plugin authors."
			},
			"laya-local": {
				id: "laya-local",
				protocol: "systemone",
				baseUrl: "http://127.0.0.1:8765",
				model: "multilingual",
				label: "Laya",
				tokenModel: "plain",
				extraBody: { max_len: 1024 },
				limits: { blockChars: 700 },
				notes: "Local Laya sidecar (experiments/laya, Jev-compatible). Experiment r1 found it near random with the current prompts: it needs a calibration fitted on your own labels (calibration.points) before it is trusted for control."
			},
			"jina-rerank": {
				id: "jina-rerank",
				protocol: "rerank",
				baseUrl: "https://api.jina.ai/v1",
				model: "jina-reranker-v2-base-multilingual",
				keyRef: "JINA_API_KEY",
				label: "Jina rerank",
				extraBody: { return_documents: false },
				unverified: true,
				notes: "Jina-style rerank API; never called by the plugin authors. Needs calibration.points: relevance scores are not grades."
			},
			"cohere-rerank": {
				id: "cohere-rerank",
				protocol: "rerank",
				baseUrl: "https://api.cohere.com/v2",
				model: "rerank-v3.5",
				keyRef: "COHERE_API_KEY",
				label: "Cohere rerank",
				unverified: true,
				notes: "Cohere-style rerank API; never called by the plugin authors. Needs calibration.points: relevance scores are not grades."
			}
		};
		const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,47}$/;
		/** Scorer ids the pipeline gives meaning to. */
		const RESERVED_PROVIDER_IDS = [
			"rule",
			"hybrid",
			"none"
		];
		const KEY_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/;
		const PROVIDER_LIMIT_KEYS = [
			"maxQuestionsPerRequest",
			"requestTokenBudget",
			"blockChars",
			"maxNeedChars",
			"maxStateChars",
			"maxBodyBytes",
			"maxDocumentsPerRequest",
			"maxRetries",
			"timeoutMs",
			"requestCap"
		];
		const PROVIDER_FIELDS = [
			"protocol",
			"baseUrl",
			"model",
			"keyRef",
			"path",
			"limits",
			"calibration",
			"rubricId",
			"extraBody",
			"price",
			"tokenModel",
			"label"
		];
		const RESERVED_BODY_KEYS = [
			"model",
			"state",
			"questions",
			"query",
			"documents",
			"messages"
		];
		const isLoopback = (host) => host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || host === "[::1]";
		/** Problems of a complete provider definition; empty = usable. */
		function providerProblems(p) {
			const out = [];
			if (typeof p.protocol !== "string" || !PROTOCOLS.includes(p.protocol)) out.push("protocol must be one of " + PROTOCOLS.join(", "));
			if (typeof p.model !== "string" || !p.model.trim()) out.push("model must be a non-empty string");
			if (typeof p.baseUrl !== "string") out.push("baseUrl must be a URL string");
			else {
				let url;
				try {
					url = new URL(p.baseUrl);
				} catch {
					out.push("baseUrl \"" + p.baseUrl + "\" is not a URL");
				}
				if (url) {
					if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) out.push("baseUrl must be https (http is only allowed for localhost: the API key would travel in clear text)");
					if (url.username || url.password) out.push("baseUrl must not carry credentials: use keyRef");
					if (url.search || url.hash) out.push("baseUrl must not carry a query or fragment");
				}
			}
			if (p.keyRef !== void 0 && (typeof p.keyRef !== "string" || !KEY_REF_PATTERN.test(p.keyRef))) out.push("keyRef must be a credentials ref / environment variable name (not the key itself)");
			if (p.path !== void 0 && (typeof p.path !== "string" || !/^\/[A-Za-z0-9._~\/-]*$/.test(p.path))) out.push("path must look like /v1/endpoint");
			if (p.tokenModel !== void 0 && p.tokenModel !== "expanded" && p.tokenModel !== "plain") out.push("tokenModel must be expanded or plain");
			if (p.label !== void 0 && (typeof p.label !== "string" || !p.label.trim() || p.label.length > 40)) out.push("label must be a short string");
			if (p.rubricId !== void 0) {
				if (typeof p.rubricId !== "string" || !BUILTIN_RUBRIC_IDS.includes(p.rubricId)) out.push("rubricId must be a known rubric (" + BUILTIN_RUBRIC_IDS.join(", ") + ")");
				else if (builtinDef(p.rubricId)?.kind !== "score") out.push("rubricId " + p.rubricId + " is not a score rubric");
				else if (p.protocol === "rerank") out.push("rubricId does not apply to the rerank protocol (the need text is the query)");
			}
			if (p.limits !== void 0) {
				if (p.limits === null || typeof p.limits !== "object" || Array.isArray(p.limits)) out.push("limits must be an object");
				else for (const [k, v] of Object.entries(p.limits)) if (!PROVIDER_LIMIT_KEYS.includes(k)) out.push("unknown limit \"" + k + "\" (known: " + PROVIDER_LIMIT_KEYS.join(", ") + ")");
				else if (typeof v !== "number" || !Number.isInteger(v) || v < 1) out.push("limits." + k + " must be a positive integer");
			}
			if (p.calibration !== void 0) out.push(...calibrationProblems(p.calibration));
			if (p.extraBody !== void 0) {
				if (p.extraBody === null || typeof p.extraBody !== "object" || Array.isArray(p.extraBody)) out.push("extraBody must be an object");
				else for (const k of Object.keys(p.extraBody)) if (RESERVED_BODY_KEYS.includes(k)) out.push("extraBody must not set \"" + k + "\" (the protocol owns it)");
			}
			if (p.price !== void 0) {
				const price = p.price;
				if (price === null || typeof price !== "object" || typeof price.inputPerMTokens !== "number" || !(price.inputPerMTokens >= 0) || typeof price.currency !== "string" || !price.currency || price.outputPerMTokens !== void 0 && !(typeof price.outputPerMTokens === "number" && price.outputPerMTokens >= 0)) out.push("price must be { inputPerMTokens, outputPerMTokens?, currency } with non-negative numbers");
			}
			return out;
		}
		/** Preset (when `id` names one) overlaid with the user's fields; limits and extraBody merge key by key. */
		function merge(id, raw) {
			const base = PRESETS[id];
			const out = {
				...base,
				...raw,
				id
			};
			if (base) {
				if (base.limits || raw.limits) out.limits = {
					...base.limits,
					...raw.limits
				};
				if (base.extraBody || raw.extraBody) out.extraBody = {
					...base.extraBody,
					...raw.extraBody
				};
				const placeholders = (base.placeholders ?? []).filter((f) => raw[f] === void 0);
				if (placeholders.length) out.placeholders = placeholders;
				else delete out.placeholders;
			}
			return out;
		}
		/** Every usable provider: the presets, overridden / extended by `settings.providers`. */
		function resolveProviders(settings) {
			const providers = new Map(Object.entries(PRESETS));
			const diagnostics = [];
			for (const [id, raw] of Object.entries(settings?.providers ?? {})) {
				const where = "evidence.judge.providers." + id;
				if (!PROVIDER_ID_PATTERN.test(id) || RESERVED_PROVIDER_IDS.includes(id)) {
					diagnostics.push(where + " ignored: the id must be lowercase letters, digits, . _ - (at most 48 characters) and not rule / hybrid / none");
					continue;
				}
				if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
					diagnostics.push(where + " ignored: not an object");
					continue;
				}
				const unknown = Object.keys(raw).filter((k) => !PROVIDER_FIELDS.includes(k));
				const merged = merge(id, raw);
				const problems = [...unknown.map((k) => "unknown field \"" + k + "\""), ...providerProblems(merged)];
				if (problems.length) {
					diagnostics.push(where + " ignored" + (PRESETS[id] ? ", the built-in preset is kept" : "") + ": " + problems.join("; "));
					continue;
				}
				providers.set(id, merged);
			}
			return {
				providers,
				diagnostics
			};
		}
		function unusableReason(p, settings) {
			if (p.placeholders?.length) return "provider " + p.id + " is a placeholder preset: set " + p.placeholders.join(" and ") + " in evidence.judge.providers." + p.id;
			if (p.protocol === "rerank" && !p.calibration) return "provider " + p.id + " is a rerank provider: set calibration.points (raw score -> grade 0..3), its scores are not grades";
			if (p.protocol === "llm" && settings?.allowLlm !== true) return "provider " + p.id + " uses the llm protocol, which is off: set evidence.judge.allowLlm to true";
		}
		//#endregion
		//#region src/providers/keyed-meta.ts
		/**
		* Which sources are keyed and the default environment variable of each key: data only, shared by the adapters and the
		* settings panel (client bundle), hence no imports.
		* @module web-search-pro/providers/keyed-meta
		*/
		/** Default environment variable names of each keyed source's API key, first one preferred (route id -> names). */
		const KEYED_SOURCE_ENVS = Object.freeze({
			deepseek: ["DEEPSEEK_API_KEY"],
			tavily: ["TAVILY_API_KEY"],
			brave: ["BRAVE_API_KEY"],
			linkup: ["LINKUP_API_KEY"],
			serper: ["SERPER_API_KEY"],
			metaso: ["METASO_API_KEY"],
			zhipu: ["ZHIPU_API_KEY"],
			"baidu-qianfan": ["QIANFAN_API_KEY", "BAIDU_API_KEY"]
		});
		const KEYED_SOURCE_IDS = Object.freeze(Object.keys(KEYED_SOURCE_ENVS));
		/**
		* The "常用" (common) sources: a test pins this list to the registry descriptors that set `common: true`. Data only, for the
		* settings panel (client bundle), which cannot import the descriptors.
		*/
		const COMMON_SOURCE_IDS = Object.freeze(["deepseek"]);
		//#endregion
		//#region src/client/form-specs.ts
		/**
		* Field specs of the settings card: how each control converts between the stored value and the draft text, and where
		* the value lives in the plugin config.
		*
		* The Host writes TOP-LEVEL config fields, so a nested option (`evidence.maxRounds`, `keyedSources.tavily.baseUrl`) is
		* a "path field": a view of one entry inside the staged object of its root (`evidence`, `provider`, `keyedSources`).
		* The controller applies the path ops of every staged field of a root to the raw user layer of that root and writes the
		* root once, so siblings the card knows nothing about (a literal `apiKey`, an unknown key) are carried through.
		*
		* Pure: no Host, no DOM, no Node, and only shared pure modules, so the client bundle stays free of server code.
		* @module web-search-pro/client/form-specs
		*/
		const isPathSpec = (spec) => "root" in spec;
		const isRecord$2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
		function getAt(root, path) {
			let node = root;
			for (const key of path) {
				if (!isRecord$2(node)) return void 0;
				node = node[key];
			}
			return node;
		}
		function hasAt(root, path) {
			let node = root;
			for (const key of path) {
				if (!isRecord$2(node) || !Object.hasOwn(node, key)) return false;
				node = node[key];
			}
			return true;
		}
		/** Apply ops to `root` in place; an `unset` also removes the parents it leaves empty. */
		function applyOps(root, ops) {
			for (const op of ops) {
				if (op.op === "set") {
					let node = root;
					for (const key of op.path.slice(0, -1)) {
						const next = node[key];
						node = isRecord$2(next) ? next : node[key] = {};
					}
					node[op.path[op.path.length - 1]] = structuredClone(op.value);
					continue;
				}
				const trail = [root];
				let node = root;
				for (const key of op.path.slice(0, -1)) {
					node = isRecord$2(node) ? node[key] : void 0;
					if (!isRecord$2(node)) break;
					trail.push(node);
				}
				if (trail.length !== op.path.length) continue;
				delete trail[trail.length - 1][op.path[op.path.length - 1]];
				for (let depth = trail.length - 1; depth > 0; depth--) if (Object.keys(trail[depth]).length === 0) delete trail[depth - 1][op.path[depth - 1]];
			}
		}
		/** Recursive merge, `over` winning; arrays and scalars are replaced (how a user layer sits on its base). */
		function deepMerge(base, over) {
			if (!isRecord$2(base) || !isRecord$2(over)) return over === void 0 ? base : over;
			const out = { ...base };
			for (const [key, value] of Object.entries(over)) out[key] = key in base ? deepMerge(base[key], value) : value;
			return out;
		}
		const isHttpUrl = (text) => {
			try {
				const url = new URL(text);
				return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !url.hash;
			} catch {
				return false;
			}
		};
		const textField = (field, options = {}) => ({
			field,
			format: (value) => typeof value === "string" ? value : "",
			parse(text) {
				const value = text.trim();
				if (value.length === 0) return options.required ? void 0 : { kind: "clear" };
				if (options.pattern && !options.pattern.test(value)) return void 0;
				if (options.url && !isHttpUrl(value)) return void 0;
				if (options.email && !/^[^\s@]+@[^\s@]+$/.test(value)) return void 0;
				return {
					kind: "set",
					value
				};
			}
		});
		const numberField = (field, options = {}) => ({
			field,
			format: (value) => typeof value === "number" && Number.isFinite(value) ? String(value) : "",
			parse(text) {
				if (text.trim() === "") return { kind: "clear" };
				const value = Number(text);
				if (!Number.isFinite(value)) return void 0;
				if (options.integer && !Number.isInteger(value)) return void 0;
				if (options.min !== void 0 && value < options.min) return void 0;
				if (options.max !== void 0 && value > options.max) return void 0;
				return {
					kind: "set",
					value
				};
			}
		});
		const booleanField = (field, fallback = false) => ({
			field,
			format: (value) => (value === void 0 ? fallback : value === true) ? "true" : "false",
			parse: (text) => text === "true" || text === "false" ? {
				kind: "set",
				value: text === "true"
			} : void 0
		});
		/** A closed list of values; with `allowEmpty` the empty draft clears the field (the default applies). */
		const enumField = (field, values, fallback, allowEmpty = false) => ({
			field,
			format: (value) => typeof value === "string" ? value : fallback ?? "",
			parse(text) {
				if (text === "") return allowEmpty ? { kind: "clear" } : void 0;
				return values.includes(text) ? {
					kind: "set",
					value: text
				} : void 0;
			}
		});
		const csvField = (field, required = false) => ({
			field,
			format: (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string").join(", ") : "",
			parse(text) {
				const values = [...new Set(text.split(",").map((item) => item.trim()).filter(Boolean))];
				if (values.length === 0 && required) return void 0;
				return {
					kind: "set",
					value: values
				};
			}
		});
		const jsonField = (field, required = false) => ({
			field,
			format: (value) => isRecord$2(value) ? JSON.stringify(value, null, 2) : "",
			parse(text) {
				if (text.trim() === "") return required ? void 0 : { kind: "clear" };
				try {
					const value = JSON.parse(text);
					return isRecord$2(value) ? {
						kind: "set",
						value
					} : void 0;
				} catch {
					return;
				}
			}
		});
		const path = (spec, root, at, extra = {}) => ({
			...spec,
			root,
			path: at,
			...extra
		});
		const DEFAULTS = {
			evidence: {
				autoProviders: true,
				sourcePolicy: "default",
				maxRounds: 2,
				maxQueries: 4,
				hybridBorderline: false,
				maxJevQuestions: 64,
				scorer: "rule",
				jevMode: "off"
			},
			judge: { allowLlm: false },
			coverage: { mode: "off" },
			provider: {
				evidence: "auto",
				deadlineMs: 25e3
			},
			budget: { ...DEFAULT_BUDGET },
			toolSurface: "indexed",
			bochaApiKeyEnv: "BOCHA_SEARCH_API_KEY",
			twitterAuthTokenEnv: "TWITTER_AUTH_TOKEN",
			twitterCt0Env: "TWITTER_CT0",
			bochaBaseUrl: "https://api.bocha.cn",
			bochaSummary: true,
			deepseekFetch: false
		};
		/** Top-level fields, in display order. */
		const FIELD_SPECS = [
			csvField("engines", true),
			booleanField("parallelEngines"),
			numberField("searchMaxResults", {
				min: 1,
				max: 20,
				integer: true
			}),
			numberField("timeoutMs", {
				min: 1e3,
				integer: true
			}),
			numberField("fetchDefaultChars", {
				min: 1e3,
				max: 5e5,
				integer: true
			}),
			numberField("exaContentsPerUrlChars", {
				min: 500,
				integer: true
			}),
			numberField("exaContentsTotalChars", {
				min: 1e3,
				integer: true
			}),
			textField("exaApiKeyEnv", { required: true }),
			textField("jinaApiKeyEnv", { required: true }),
			textField("githubTokenEnv", { required: true }),
			textField("twitterAuthTokenEnv", { pattern: KEY_REF_PATTERN }),
			textField("twitterCt0Env", { pattern: KEY_REF_PATTERN }),
			textField("bochaApiKeyEnv", { pattern: KEY_REF_PATTERN }),
			textField("bochaBaseUrl", { url: true }),
			booleanField("bochaSummary", true),
			booleanField("deepseekFetch"),
			textField("searxngUrl", { url: true }),
			textField("openalexMailto", { email: true }),
			booleanField("enableCliBackends"),
			booleanField("opencliEnabled"),
			booleanField("agentReachEnabled"),
			textField("providerId", { required: true }),
			booleanField("registerProvider"),
			enumField("toolSurface", TOOL_SURFACES, DEFAULTS.toolSurface),
			jsonField("playwright", true),
			numberField("ttlSeconds", {
				min: 0,
				integer: true
			}),
			numberField("memoryCacheEntries", {
				min: 1,
				integer: true
			}),
			numberField("rrfConstant", { min: 1 }),
			numberField("freshnessBoost", {
				min: 0,
				max: 1
			}),
			numberField("freshnessDays", { min: 1 }),
			numberField("authorityBoost", {
				min: 0,
				max: 1
			}),
			csvField("authorityDomains"),
			textField("dbPath"),
			booleanField("allowProxyFakeIp"),
			jsonField("platformRules"),
			jsonField("customPlatforms"),
			jsonField("browserBindings"),
			jsonField("platformBackends"),
			jsonField("cliAdapters"),
			booleanField("verbose")
		];
		/** The effective judge mode: the neutral `judge.mode` wins over the legacy `jevMode`. */
		const judgeModeOf = (ev) => {
			const mode = getAt(ev, ["judge", "mode"]) ?? ev.jevMode;
			return typeof mode === "string" ? mode : DEFAULTS.evidence.jevMode;
		};
		/**
		* Editing the mode keeps the legacy pair in step, so a settings file read by an older plugin version or by a person means
		* the same thing: `judge.mode` and `jevMode` both get the mode, and `scorer` is `jev` exactly for `control` (the legacy
		* control needs it; any other mode ignores it, so a stale `jev` is put back to `rule`). Clearing reverts all three.
		*/
		const modeOps = (write, ctx) => {
			if (write.kind === "clear") return [
				{
					op: "unset",
					path: ["judge", "mode"]
				},
				{
					op: "unset",
					path: ["jevMode"]
				},
				{
					op: "unset",
					path: ["scorer"]
				}
			];
			const mode = write.value;
			const ops = [{
				op: "set",
				path: ["judge", "mode"],
				value: mode
			}, {
				op: "set",
				path: ["jevMode"],
				value: mode
			}];
			if (mode === "control") ops.push({
				op: "set",
				path: ["scorer"],
				value: "jev"
			});
			else if (ctx.resolved.scorer === "jev") ops.push({
				op: "set",
				path: ["scorer"],
				value: "rule"
			});
			return ops;
		};
		const E = "evidence";
		/** Fields inside `evidence` and `provider`, in display order. */
		const PATH_SPECS = [
			path(booleanField("evidence.autoProviders", DEFAULTS.evidence.autoProviders), E, ["autoProviders"]),
			path(enumField("evidence.sourcePolicy", SOURCE_POLICIES, DEFAULTS.evidence.sourcePolicy), E, ["sourcePolicy"]),
			path(numberField("evidence.maxRounds", {
				min: 1,
				integer: true
			}), E, ["maxRounds"], { read: (ev) => ev.maxRounds ?? DEFAULTS.evidence.maxRounds }),
			path(numberField("evidence.maxQueries", {
				min: 1,
				integer: true
			}), E, ["maxQueries"], { read: (ev) => ev.maxQueries ?? DEFAULTS.evidence.maxQueries }),
			path(enumField("evidence.judge.mode", JUDGE_MODES, DEFAULTS.evidence.jevMode), E, ["judge", "mode"], {
				read: judgeModeOf,
				ops: modeOps,
				stored: (user) => hasAt(user, ["judge", "mode"]) || hasAt(user, ["jevMode"])
			}),
			path(booleanField("evidence.hybridBorderline", DEFAULTS.evidence.hybridBorderline), E, ["hybridBorderline"]),
			path(textField("evidence.judge.provider"), E, ["judge", "provider"]),
			path(numberField("evidence.maxJevQuestions", {
				min: 1,
				integer: true
			}), E, ["maxJevQuestions"], { read: (ev) => ev.maxJevQuestions ?? DEFAULTS.evidence.maxJevQuestions }),
			path(booleanField("evidence.judge.allowLlm", DEFAULTS.judge.allowLlm), E, ["judge", "allowLlm"]),
			path(jsonField("evidence.judge.providers"), E, ["judge", "providers"]),
			path(enumField("evidence.coverage.mode", COVERAGE_MODES, DEFAULTS.coverage.mode), E, ["coverage", "mode"]),
			path(textField("evidence.coverage.provider"), E, ["coverage", "provider"]),
			path(numberField("evidence.coverage.thresholds.weak", {
				min: 0,
				max: 1
			}), E, [
				"coverage",
				"thresholds",
				"weak"
			]),
			path(numberField("evidence.coverage.thresholds.covered", {
				min: 0,
				max: 1
			}), E, [
				"coverage",
				"thresholds",
				"covered"
			]),
			path(numberField("evidence.budget.perSearchInputTokens", {
				min: 0,
				integer: true
			}), E, ["budget", "perSearchInputTokens"], { read: (ev) => getAt(ev, ["budget", "perSearchInputTokens"]) ?? DEFAULTS.budget.perSearchInputTokens }),
			path(numberField("evidence.budget.dailyInputTokens", {
				min: 0,
				integer: true
			}), E, ["budget", "dailyInputTokens"], { read: (ev) => getAt(ev, ["budget", "dailyInputTokens"]) ?? DEFAULTS.budget.dailyInputTokens }),
			path(textField("evidence.budget.timezone"), E, ["budget", "timezone"]),
			path(jsonField("evidence.budget.providers"), E, ["budget", "providers"]),
			path(enumField("provider.evidence", PROVIDER_EVIDENCE_MODES, DEFAULTS.provider.evidence), "provider", ["evidence"]),
			path(numberField("provider.deadlineMs", {
				min: 100,
				integer: true
			}), "provider", ["deadlineMs"], { read: (p) => getAt(p, ["deadlineMs"]) ?? DEFAULTS.provider.deadlineMs }),
			path(csvField("sources.priority"), "sources", ["priority"]),
			path(csvField("sources.disabled"), "sources", ["disabled"])
		];
		const KEYED_SPECS = KEYED_SOURCE_IDS.map((id) => ({
			id,
			defaultEnv: KEYED_SOURCE_ENVS[id][0]
		})).flatMap(({ id }) => [path(textField(`keyedSources.${id}.apiKeyEnv`, { pattern: KEY_REF_PATTERN }), "keyedSources", [id, "apiKeyEnv"]), path(textField(`keyedSources.${id}.baseUrl`, { url: true }), "keyedSources", [id, "baseUrl"])]);
		const BUDGET_SPECS = ["bocha", ...KEYED_SOURCE_IDS].flatMap((id) => ["total", "daily"].map((axis) => path(numberField(`sources.budget.${id}.${axis}`, {
			min: 0,
			integer: true
		}), "sources", [
			"budget",
			id,
			axis
		])));
		/** `sources.confidence.<id>`: a number 0..1; empty = the default (1 for a built-in source, the spec's own for a custom CLI). */
		const confidenceSpec = (id) => path(numberField(`sources.confidence.${id}`, {
			min: 0,
			max: 1
		}), "sources", ["confidence", id]);
		const confidenceField = (id) => `sources.confidence.${id}`;
		const CONFIDENCE_PREFIX = "sources.confidence.";
		/** The spec of a rubric override entry: the whole object as one JSON draft, which the rubric editor builds field by field. */
		const rubricSpec = (id) => path(jsonField(`evidence.rubrics.${id}`), E, ["rubrics", id]);
		const rubricField = (id) => `evidence.rubrics.${id}`;
		/** Fields that a Host write can never take as text (credentials go through the credentials remote). */
		const CREDENTIAL_IDS = [
			"exa",
			"jina",
			"github",
			"bocha",
			"twitter-auth-token",
			"twitter-ct0",
			...KEYED_SOURCE_IDS.map((id) => `keyed:${id}`)
		];
		/** The settings field holding the credentials ref / environment variable name of each credential, and its default name. */
		function credentialRef(id) {
			switch (id) {
				case "exa": return {
					field: "exaApiKeyEnv",
					default: "EXA_API_KEY"
				};
				case "jina": return {
					field: "jinaApiKeyEnv",
					default: "JINA_API_KEY"
				};
				case "github": return {
					field: "githubTokenEnv",
					default: "GITHUB_TOKEN"
				};
				case "bocha": return {
					field: "bochaApiKeyEnv",
					default: DEFAULTS.bochaApiKeyEnv
				};
				case "twitter-auth-token": return {
					field: "twitterAuthTokenEnv",
					default: DEFAULTS.twitterAuthTokenEnv
				};
				case "twitter-ct0": return {
					field: "twitterCt0Env",
					default: DEFAULTS.twitterCt0Env
				};
				default: {
					const source = id.slice(6);
					return {
						field: `keyedSources.${source}.apiKeyEnv`,
						default: KEYED_SOURCE_ENVS[source][0]
					};
				}
			}
		}
		//#endregion
		//#region src/rpc-types.ts
		/** The channel prefix this plugin registers with the Host transport (Browser registers `/dsh-browser-assets` the same way). */
		const RPC_CHANNEL = "/dsh-web-search-pro";
		//#endregion
		//#region src/client/overlay-ops.ts
		/** The ops that write an overlay item into the configuration; undefined for a key that is none of the overridable ones. */
		function adoptionOf(item) {
			const value = structuredClone(item.value);
			switch (item.kind) {
				case "engines": return {
					ops: [{
						op: "set",
						path: ["engines"],
						value
					}],
					drop: ["engines"]
				};
				case "priority": return {
					ops: [{
						op: "set",
						path: ["sources", "priority"],
						value
					}],
					drop: ["sources.priority"]
				};
				case "disabled": return {
					ops: [{
						op: "set",
						path: ["sources", "disabled"],
						value
					}],
					drop: ["sources.disabled"]
				};
				case "confidence": return item.target ? {
					ops: [{
						op: "set",
						path: [
							"sources",
							"confidence",
							item.target
						],
						value
					}],
					drop: ["sources.confidence." + item.target]
				} : void 0;
				case "platform": return item.target ? {
					ops: [{
						op: "set",
						path: ["platformBackends", item.target],
						value
					}],
					drop: ["platformBackends"]
				} : void 0;
				case "cli": return item.target ? {
					ops: [{
						op: "set",
						path: ["cliAdapters", item.target],
						value
					}],
					drop: ["cliAdapters"]
				} : void 0;
			}
		}
		/** The overlay key a card field is the baseline of (the row that shows it carries the "changed by the agent" mark), or undefined. */
		function overlayKeyOfField(field) {
			return field === "engines" || field === "sources.priority" || field === "sources.disabled" ? field : void 0;
		}
		const two = (n) => String(n).padStart(2, "0");
		/** `2026-10-27 22:35` in the viewer's time zone; the text itself when it is no date. */
		function formatTime(iso) {
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return iso;
			return date.getFullYear() + "-" + two(date.getMonth() + 1) + "-" + two(date.getDate()) + " " + two(date.getHours()) + ":" + two(date.getMinutes());
		}
		/**
		* The custom CLIs an overlay item leans on that only the overlay holds: an engine list or a platform chain that names `custom-cli:<id>`
		* where `cliAdapters.<id>` is itself an overlay entry. Adopting such an item alone would leave the configuration naming a CLI it does not
		* define, so the card says to adopt the CLI too.
		*/
		function overlayCliDependencies(item, items) {
			if (item.kind !== "engines" && item.kind !== "platform" && item.kind !== "priority" || !Array.isArray(item.value)) return [];
			const held = new Set(items.map((entry) => entry.key));
			return item.value.filter((id) => typeof id === "string" && id.startsWith("custom-cli:") && held.has("cliAdapters." + id.slice(11))).map((id) => id.slice(11));
		}
		//#endregion
		//#region src/restart.ts
		/** Why each field is read at start-up only (shown in the docs and the card's `?` text). */
		const RESTART_FIELDS = {
			toolSurface: "the tools (web_index + web_call, or one tool per action) are registered at start-up",
			"playwright.snapshotDir": "the snapshot folder of read.snapshot is resolved at start-up",
			providerId: "the id of the ctx.web provider is given to the Host at registration",
			registerProvider: "the ctx.web provider is registered at start-up",
			timeoutMs: "the per-action deadlines and the Host tool ceiling are fixed at start-up (the cooperative time budget of a search reads it live)",
			memoryCacheEntries: "the in-process LRU cache is sized at start-up",
			dbPath: "the SQLite store and the overlay file are opened at start-up",
			verbose: "the load marker is written at start-up"
		};
		/** The field names, in the order of the configuration groups (config-groups.ts). */
		const RESTART_FIELD_LIST = Object.keys(RESTART_FIELDS);
		const isRestartField = (field) => Object.hasOwn(RESTART_FIELDS, field);
		//#endregion
		//#region src/pipeline/sources-spec.ts
		const isCount = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
		function idList(value, name, diagnostics, known) {
			if (value === void 0 || value === null) return [];
			if (!Array.isArray(value)) {
				diagnostics.push("sources." + name + " ignored: must be a list of source ids");
				return [];
			}
			const out = [];
			for (const raw of value) {
				const id = typeof raw === "string" ? raw.trim() : "";
				if (!id || /[\s,]/.test(id)) {
					diagnostics.push("sources." + name + ": \"" + String(raw) + "\" is not a source id");
					continue;
				}
				if (known && !known(id)) {
					diagnostics.push("sources." + name + ": \"" + id + "\" is not a registered source (ignored)");
					continue;
				}
				if (!out.includes(id)) out.push(id);
			}
			return out;
		}
		/**
		* Validate the preferences; invalid entries are dropped and reported, never thrown. `known` (optional) tells whether an
		* id is a registered provider: unknown ids are reported and dropped, so a typo cannot silently disable nothing.
		*/
		function resolveSources(input, known, knownBackend) {
			const diagnostics = [];
			const priority = idList(input?.priority, "priority", diagnostics, known);
			const disabled = idList(input?.disabled, "disabled", diagnostics, known);
			for (const id of priority.filter((id) => disabled.includes(id))) diagnostics.push("sources: \"" + id + "\" is both prioritised and disabled: disabled wins");
			const budget = {};
			const raw = input?.budget;
			if (raw !== void 0 && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) diagnostics.push("sources.budget ignored: must be an object keyed by source id");
			else for (const [id, entry] of Object.entries(raw ?? {})) {
				if (known && !known(id)) {
					diagnostics.push("sources.budget." + id + " ignored: not a registered source");
					continue;
				}
				if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
					diagnostics.push("sources.budget." + id + " ignored: not an object");
					continue;
				}
				const cap = (value, axis) => {
					if (value === void 0 || value === null) return void 0;
					if (isCount(value)) return Math.floor(value);
					diagnostics.push("sources.budget." + id + "." + axis + " ignored: must be a number >= 0");
				};
				const total = cap(entry.total, "total");
				const daily = cap(entry.daily, "daily");
				if (total !== void 0 || daily !== void 0) budget[id] = {
					...total !== void 0 ? { total } : {},
					...daily !== void 0 ? { daily } : {}
				};
			}
			const confidence = {};
			const rawConfidence = input?.confidence;
			if (rawConfidence !== void 0 && rawConfidence !== null && (typeof rawConfidence !== "object" || Array.isArray(rawConfidence))) diagnostics.push("sources.confidence ignored: must be an object keyed by source id");
			else for (const [id, value] of Object.entries(rawConfidence ?? {})) {
				if (known && !known(id) && !knownBackend?.(id)) {
					diagnostics.push("sources.confidence." + id + " ignored: not a registered source or platform backend");
					continue;
				}
				if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
					diagnostics.push("sources.confidence." + id + " ignored: must be a number 0..1");
					continue;
				}
				confidence[id] = value;
			}
			return {
				priority,
				disabled,
				budget,
				confidence,
				diagnostics
			};
		}
		//#endregion
		//#region src/cli/opencli-sites.ts
		/** Platform -> site of the standalone OpenCLI (`opencli <site> search`). */
		const OPENCLI_SITE_OF = {
			xiaohongshu: "xiaohongshu",
			twitter: "twitter",
			reddit: "reddit",
			instagram: "instagram",
			facebook: "facebook",
			zhihu: "zhihu",
			weibo: "weibo",
			douban: "douban",
			tieba: "tieba",
			douyin: "douyin",
			bilibili: "bilibili",
			youtube: "youtube",
			wechat: "weixin"
		};
		/** Generic field mapping over the columns OpenCLI commands emit (rank, title, url, summary, ...), for the sites without a measured or documented mapping below. */
		const FIELDS = {
			url: [
				"url",
				"link",
				"href",
				"projectUrl",
				"item_url"
			],
			title: [
				"title",
				"name",
				"text",
				"desc",
				"label"
			],
			snippet: [
				"summary",
				"snippet",
				"description",
				"desc",
				"content",
				"selftext",
				"abstract",
				"author",
				"user"
			],
			publishedAt: [
				"published_at",
				"publish_time",
				"created_at",
				"date",
				"time",
				"published",
				"postTime"
			]
		};
		[...FIELDS.url], [...FIELDS.title], [...FIELDS.snippet], [...FIELDS.publishedAt];
		const CHECKED = {
			version: "1.8.8",
			date: "2026-10-27"
		};
		({ ...CHECKED }), { ...CHECKED }, { ...CHECKED }, { ...CHECKED };
		({ ...CHECKED });
		//#endregion
		//#region src/cli/spec.ts
		/**
		* Declarative CLI adapter spec (dev-plan M12): what a standalone command-line tool is, which of its commands the plugin
		* may run, and how its output maps to search sources. Pure data plus validation, no Node imports, so the settings card
		* (client bundle) validates `cliAdapters` with the very function the server uses.
		*
		* The read-only guarantee lives here and applies to built-in and user-defined specs alike:
		*  - argv is an array of tokens, never a shell string (the runner spawns without a shell);
		*  - a spec declares `allowedSubcommands`, and every command word its argv uses (the leading literal tokens before the
		*    first flag or placeholder) must be in that list;
		*  - no command word, declared subcommand or flag may match the global deny-list (login, post, delete*, like, ...,
		*    and the flags that make a CLI read browser cookies or carry secrets in argv).
		* @module web-search-pro/cli/spec
		*/
		const OUTPUT_FORMATS = [
			"json",
			"ndjson",
			"yaml",
			"text"
		];
		/** How far a spec has been checked against the real tool (recorded in the spec and shown in `sources.status`). */
		const CLI_VERIFICATIONS = [
			"live",
			"contract-only",
			"docs-only"
		];
		/** Confidence of a custom CLI whose spec gives none: below the built-in sources (1), because nothing here checked its output. */
		const DEFAULT_CUSTOM_CONFIDENCE = .5;
		/** Default and largest size of a whole-output result's text, in characters (`output.lines.maxChars`). */
		const WHOLE_OUTPUT_DEFAULT_CHARS = 2e3;
		/** Command words that write, log in, or change local or remote state. Matched exactly, or as `<word>-...` / `<word>_...`. */
		const DENIED_SUBCOMMANDS = [
			"login",
			"logout",
			"signin",
			"signout",
			"sign-in",
			"sign-out",
			"auth",
			"whoami-login",
			"post",
			"comment",
			"reply",
			"publish",
			"ask",
			"article",
			"pin",
			"draft",
			"upload",
			"send",
			"create",
			"edit",
			"write",
			"add",
			"like",
			"unlike",
			"dislike",
			"upvote",
			"downvote",
			"vote",
			"follow",
			"unfollow",
			"subscribe",
			"unsubscribe",
			"favorite",
			"unfavorite",
			"bookmark",
			"unbookmark",
			"save",
			"unsave",
			"retweet",
			"unretweet",
			"quote",
			"share",
			"block",
			"unblock",
			"mute",
			"accept",
			"forward",
			"setup",
			"init",
			"install",
			"uninstall",
			"update",
			"upgrade",
			"config",
			"configure",
			"register",
			"set",
			"import",
			"export",
			"bridge",
			"daemon",
			"plugin",
			"adapter",
			"external",
			"profile",
			"mcp",
			"serve"
		];
		/** Command words denied by prefix alone (`delete`, `delete-note`, `deleteNote`, `remove...`). */
		const DENIED_PREFIXES = [
			"delete",
			"remove",
			"destroy",
			"drop",
			"purge",
			"revoke"
		];
		/** Flags (without leading dashes) that read browser cookies or carry credentials in argv. */
		const DENIED_FLAGS = [
			"cookie-source",
			"cookie",
			"cookies",
			"cookies-from-browser",
			"browser-cookies",
			"from-browser",
			"browser",
			"password",
			"passwd",
			"secret",
			"token",
			"access-token",
			"auth-token",
			"api-key",
			"apikey",
			"key",
			"username",
			"user-token",
			"ap-password",
			"netrc",
			"client-secret",
			"authorization",
			"auth"
		];
		function matchesDeniedSubcommand(word) {
			const w = word.toLowerCase();
			if (DENIED_PREFIXES.some((prefix) => w.startsWith(prefix))) return true;
			return DENIED_SUBCOMMANDS.some((denied) => w === denied || w.startsWith(denied + "-") || w.startsWith(denied + "_"));
		}
		const flagName = (token) => token.replace(/^-+/, "").split("=")[0].toLowerCase();
		const isFlag = (token) => token.startsWith("-") && token.length > 1;
		const hasPlaceholder = (token) => /\{[A-Za-z0-9_.]+\}/.test(token);
		/** The command words of an argv: leading literal tokens before the first flag or placeholder token. */
		function commandWords(argv) {
			const words = [];
			for (const token of argv) {
				if (isFlag(token) || hasPlaceholder(token)) break;
				words.push(token);
			}
			return words;
		}
		/** Problems of one argv template with respect to the read-only guard (empty = fine). */
		function argvProblems(argv, allowed, where) {
			const problems = [];
			for (const word of commandWords(argv)) if (matchesDeniedSubcommand(word)) problems.push(where + ": \"" + word + "\" is a write / login command (read-only guard)");
			else if (!allowed.includes(word)) problems.push(where + ": command word \"" + word + "\" is not in allowedSubcommands");
			for (const token of argv) if (isFlag(token) && DENIED_FLAGS.includes(flagName(token))) problems.push(where + ": flag \"" + token + "\" reads cookies or carries credentials (read-only guard)");
			return problems;
		}
		const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
		const isStr = (v, max = 200) => typeof v === "string" && v.length > 0 && v.length <= max;
		const strList = (v, maxItems, maxLen = 200) => Array.isArray(v) && v.length <= maxItems && v.every((x) => isStr(x, maxLen));
		const ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
		const BIN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
		const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
		const PATH_RE = /^[A-Za-z0-9_$-]+(=[A-Za-z0-9_$-]+)?(\.[A-Za-z0-9_$-]+(=[A-Za-z0-9_$-]+)?)*$/;
		const VERSION_RE = /^\d+(\.\d+){0,3}$/;
		const PLACEHOLDERS = /* @__PURE__ */ new Set([
			"query",
			"count",
			"url",
			"terms"
		]);
		const MAX_TIMEOUT_MS = 18e4;
		const MAX_OUTPUT_BYTES = 16777216;
		const SPEC_KEYS = /* @__PURE__ */ new Set([
			"id",
			"bins",
			"packageNote",
			"platforms",
			"engine",
			"confidence",
			"probe",
			"allowedSubcommands",
			"search",
			"searches",
			"read",
			"env",
			"needsLogin",
			"login",
			"timeoutMs",
			"maxOutputBytes",
			"verification"
		]);
		const PROBE_KEYS = /* @__PURE__ */ new Set([
			"versionArgs",
			"minVersion",
			"helpArgs",
			"mustContain",
			"contractHint"
		]);
		const SEARCH_KEYS = /* @__PURE__ */ new Set([
			"argv",
			"maxCount",
			"overfetch",
			"output",
			"emptyWhen",
			"notLoggedInPatterns",
			"errorCodes"
		]);
		const ERROR_CODES_KEYS = /* @__PURE__ */ new Set([
			"codePath",
			"messagePath",
			"notLoggedIn",
			"notLoggedInExit",
			"empty",
			"blocked",
			"blockedPatterns",
			"unavailable",
			"timeout",
			"usage"
		]);
		const OUTPUT_KEYS = /* @__PURE__ */ new Set([
			"format",
			"itemsPath",
			"expect",
			"errorPaths",
			"skipWhen",
			"lines",
			"fields",
			"stripTags",
			"emptyValues",
			"snippetMax",
			"titleMax",
			"requireTitle"
		]);
		const FIELD_KEYS$1 = /* @__PURE__ */ new Set([
			"url",
			"title",
			"snippet",
			"publishedAt"
		]);
		const ENV_KEYS = /* @__PURE__ */ new Set([
			"required",
			"passthrough",
			"set"
		]);
		const LOGIN_KEYS = /* @__PURE__ */ new Set([
			"command",
			"hint",
			"savedCredentialPaths",
			"readsBrowserCookiesWithoutLogin"
		]);
		function closed(obj, keys, where, errors) {
			for (const key of Object.keys(obj)) if (!keys.has(key)) errors.push(where + "." + key + " is not a spec field");
		}
		function templateProblems(text, where, allowedPlaceholders, errors) {
			for (const match of text.matchAll(/\{([^}]*)\}/g)) {
				const name = match[1];
				if (allowedPlaceholders ? !allowedPlaceholders.has(name) : !PATH_RE.test(name)) errors.push(where + ": unknown placeholder {" + name + "}");
			}
			if (/\{[^}]*$/.test(text) || /^[^{]*\}/.test(text)) errors.push(where + ": unbalanced brace");
		}
		function checkFieldSource(value, where, errors) {
			if (typeof value === "string") {
				if (!PATH_RE.test(value)) errors.push(where + ": \"" + value + "\" is not a dotted path");
				return;
			}
			if (Array.isArray(value)) {
				if (!value.length || value.length > 12) errors.push(where + ": a source list needs 1..12 entries");
				for (const entry of value) if (typeof entry === "string") {
					if (!PATH_RE.test(entry)) errors.push(where + ": \"" + entry + "\" is not a dotted path");
				} else if (isObject(entry) && typeof entry.template === "string") checkFieldSource(entry, where, errors);
				else errors.push(where + ": list entries are paths or { template, when? }");
				return;
			}
			if (!isObject(value)) {
				errors.push(where + " must be a path, a list, { template }, { join }, { epoch }, { date } or { time }");
				return;
			}
			const keys = Object.keys(value);
			if (keys.length === 1 && (keys[0] === "epoch" || keys[0] === "date" || keys[0] === "time")) {
				if (typeof value[keys[0]] !== "string" || !PATH_RE.test(value[keys[0]])) errors.push(where + "." + keys[0] + " must be a dotted path");
				return;
			}
			if (keys.every((k) => k === "template" || k === "when") && "template" in value) {
				if (!isStr(value.template, 300)) errors.push(where + ".template must be a string");
				else templateProblems(value.template, where + ".template", void 0, errors);
				if (value.when !== void 0) {
					const w = value.when;
					if (!(isObject(w) && typeof w.path === "string" && PATH_RE.test(w.path) && [
						"string",
						"number",
						"boolean"
					].includes(typeof w.equals) && Object.keys(w).every((k) => k === "path" || k === "equals"))) errors.push(where + ".when must be { path, equals }");
				}
				return;
			}
			if (keys.every((k) => k === "join" || k === "sep") && Array.isArray(value.join)) {
				if (!value.join.length || value.join.length > 8) errors.push(where + ".join needs 1..8 parts");
				for (const part of value.join) if (typeof part === "string") {
					if (!PATH_RE.test(part)) errors.push(where + ".join: \"" + part + "\" is not a dotted path");
				} else if (isObject(part) && typeof part.template === "string" && Object.keys(part).length === 1) {
					if (!isStr(part.template, 300)) errors.push(where + ".join: a template part must be a string");
					else templateProblems(part.template, where + ".join.template", void 0, errors);
				} else if (isObject(part) && (typeof part.path === "string" ? PATH_RE.test(part.path) : typeof part.time === "string" && PATH_RE.test(part.time)) && Object.keys(part).every((k) => [
					typeof part.path === "string" ? "path" : "time",
					"prefix",
					"suffix"
				].includes(k))) {
					for (const k of ["prefix", "suffix"]) if (part[k] !== void 0 && !(typeof part[k] === "string" && part[k].length <= 40)) errors.push(where + ".join." + k + " must be a short string");
				} else errors.push(where + ".join: each part is a path, { template }, { time } or { path, prefix?, suffix? }");
				if (value.sep !== void 0 && !(typeof value.sep === "string" && value.sep.length <= 16)) errors.push(where + ".sep must be a short string");
				return;
			}
			errors.push(where + " must be a path, a list, { template }, { join }, { epoch }, { date } or { time }");
		}
		function checkOutput(value, where, errors) {
			if (!isObject(value)) {
				errors.push(where + " must be an object");
				return;
			}
			closed(value, OUTPUT_KEYS, where, errors);
			if (!OUTPUT_FORMATS.includes(value.format)) errors.push(where + ".format must be one of " + OUTPUT_FORMATS.join("|"));
			if (value.itemsPath !== void 0 && !(typeof value.itemsPath === "string" && PATH_RE.test(value.itemsPath))) errors.push(where + ".itemsPath must be a dotted path");
			if (value.expect !== void 0) {
				if (!Array.isArray(value.expect) || value.expect.length > 8) errors.push(where + ".expect must be a list of { path, equals }");
				else for (const e of value.expect) if (!(isObject(e) && typeof e.path === "string" && PATH_RE.test(e.path) && [
					"string",
					"number",
					"boolean"
				].includes(typeof e.equals) && Object.keys(e).every((k) => k === "path" || k === "equals"))) errors.push(where + ".expect entries are { path, equals }");
			}
			if (value.errorPaths !== void 0 && !(Array.isArray(value.errorPaths) && value.errorPaths.length <= 6 && value.errorPaths.every((p) => typeof p === "string" && PATH_RE.test(p)))) errors.push(where + ".errorPaths must be dotted paths");
			if (value.skipWhen !== void 0) {
				const k = value.skipWhen;
				if (!(isObject(k) && typeof k.path === "string" && PATH_RE.test(k.path) && [
					"string",
					"number",
					"boolean"
				].includes(typeof k.equals) && Object.keys(k).every((key) => key === "path" || key === "equals"))) errors.push(where + ".skipWhen must be { path, equals }");
			}
			const whole = isObject(value.lines) && value.lines.mode === "whole";
			if (value.lines !== void 0) {
				const l = value.lines;
				if (isObject(l) && l.mode === "url-lines" && Object.keys(l).length === 1) {} else if (isObject(l) && l.mode === "whole" && Object.keys(l).every((k) => k === "mode" || k === "maxChars")) {
					if (l.maxChars !== void 0 && !(Number.isInteger(l.maxChars) && l.maxChars >= 200 && l.maxChars <= 8e3)) errors.push(where + ".lines.maxChars must be an integer 200..8000");
				} else if (isObject(l) && l.mode === "tsv" && strList(l.columns, 24, 40) && l.columns.length >= 2 && l.columns.every((c) => /^[A-Za-z0-9_]+$/.test(c)) && Object.keys(l).every((k) => k === "mode" || k === "columns")) {} else errors.push(where + ".lines must be { mode: \"url-lines\" }, { mode: \"tsv\", columns: [...] } or { mode: \"whole\" }");
			}
			if (value.format === "text" && value.lines === void 0) errors.push(where + ".lines is required for format text");
			if (value.format !== "text" && value.lines !== void 0) errors.push(where + ".lines is only for format text");
			if (value.fields === void 0 && whole) {} else if (!isObject(value.fields)) errors.push(where + ".fields must be an object");
			else {
				closed(value.fields, FIELD_KEYS$1, where + ".fields", errors);
				if (value.fields.url === void 0 && !whole) errors.push(where + ".fields.url is required");
				for (const key of Object.keys(value.fields)) if (FIELD_KEYS$1.has(key)) checkFieldSource(value.fields[key], where + ".fields." + key, errors);
			}
			if (value.stripTags !== void 0 && typeof value.stripTags !== "boolean") errors.push(where + ".stripTags must be a boolean");
			if (value.emptyValues !== void 0 && !strList(value.emptyValues, 8, 20)) errors.push(where + ".emptyValues must be short strings");
			for (const key of ["snippetMax", "titleMax"]) if (value[key] !== void 0 && !(Number.isInteger(value[key]) && value[key] >= 40 && value[key] <= 2e3)) errors.push(where + "." + key + " must be an integer 40..2000");
			if (value.requireTitle !== void 0 && typeof value.requireTitle !== "boolean") errors.push(where + ".requireTitle must be a boolean");
		}
		function checkSearch(value, where, allowed, errors) {
			if (!isObject(value)) {
				errors.push(where + " must be an object");
				return;
			}
			closed(value, SEARCH_KEYS, where, errors);
			if (!Array.isArray(value.argv) || !value.argv.length || value.argv.length > 24 || !value.argv.every((t) => typeof t === "string" && t.length > 0 && t.length <= 200)) errors.push(where + ".argv must be an array of 1..24 non-empty strings (never a shell string)");
			else {
				const argv = value.argv;
				argv.forEach((token) => templateProblems(token, where + ".argv", PLACEHOLDERS, errors));
				if (!argv.some((t) => /\{(query|url|terms)\}/.test(t))) errors.push(where + ".argv must carry a {query} (or {url} / {terms}) placeholder");
				for (const token of argv) if (token.includes("{terms}") && token !== "{terms}") errors.push(where + ".argv: {terms} must be a token of its own");
				errors.push(...argvProblems(argv, allowed, where + ".argv"));
			}
			if (value.maxCount !== void 0 && !(Number.isInteger(value.maxCount) && value.maxCount >= 1 && value.maxCount <= 100)) errors.push(where + ".maxCount must be an integer 1..100");
			if (value.overfetch !== void 0 && !(Number.isInteger(value.overfetch) && value.overfetch >= 0 && value.overfetch <= 10)) errors.push(where + ".overfetch must be an integer 0..10");
			checkOutput(value.output, where + ".output", errors);
			for (const key of ["emptyWhen", "notLoggedInPatterns"]) if (value[key] !== void 0 && !strList(value[key], 12, 120)) errors.push(where + "." + key + " must be a list of short strings");
			if (value.errorCodes !== void 0) checkErrorCodes(value.errorCodes, where + ".errorCodes", errors);
		}
		function checkErrorCodes(value, where, errors) {
			if (!isObject(value)) {
				errors.push(where + " must be an object");
				return;
			}
			closed(value, ERROR_CODES_KEYS, where, errors);
			if (!(typeof value.codePath === "string" && PATH_RE.test(value.codePath))) errors.push(where + ".codePath must be a dotted path");
			if (value.messagePath !== void 0 && !(typeof value.messagePath === "string" && PATH_RE.test(value.messagePath))) errors.push(where + ".messagePath must be a dotted path");
			for (const key of [
				"notLoggedIn",
				"empty",
				"blocked",
				"blockedPatterns",
				"unavailable",
				"timeout",
				"usage"
			]) if (value[key] !== void 0 && !strList(value[key], 16, 80)) errors.push(where + "." + key + " must be a list of short strings");
			if (value.notLoggedInExit !== void 0 && !(Array.isArray(value.notLoggedInExit) && value.notLoggedInExit.length <= 8 && value.notLoggedInExit.every((c) => Number.isInteger(c) && c > 0 && c < 256))) errors.push(where + ".notLoggedInExit must be exit codes 1..255");
		}
		/**
		* Validate one adapter spec (built-in or user-defined). Never throws. A user-defined spec (`origin: 'user'`) may not carry a
		* `verification` (it is unverified by definition) and its `platforms` are ignored: it is registered as `custom-cli:<id>`.
		*/
		function validateCliAdapterSpec(raw, origin = "user") {
			const errors = [];
			if (!isObject(raw)) return {
				ok: false,
				errors: ["spec must be an object"]
			};
			const at = "cliAdapters." + (typeof raw.id === "string" ? raw.id : "(no id)");
			closed(raw, SPEC_KEYS, at, errors);
			if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) errors.push(at + ".id must match " + String(ID_RE));
			if (!Array.isArray(raw.bins) || !raw.bins.length || raw.bins.length > 4 || !raw.bins.every((b) => typeof b === "string" && BIN_RE.test(b))) errors.push(at + ".bins must be 1..4 command names (no paths)");
			if (!isStr(raw.packageNote, 240)) errors.push(at + ".packageNote must be a short string (what the package is called, which can differ from the command)");
			const noPlatforms = origin === "user" && raw.engine === true;
			if (!strList(raw.platforms, 8, 40) || !raw.platforms.length && !noPlatforms) errors.push(at + (origin === "user" ? ".platforms must list 1..8 platform ids (or be empty with \"engine\": true)" : ".platforms must list 1..8 platform ids"));
			for (const key of ["engine", "confidence"]) if (raw[key] !== void 0 && origin !== "user") errors.push(at + "." + key + " is for user-defined specs only");
			if (raw.engine !== void 0 && typeof raw.engine !== "boolean") errors.push(at + ".engine must be a boolean");
			if (raw.confidence !== void 0 && !(typeof raw.confidence === "number" && Number.isFinite(raw.confidence) && raw.confidence >= 0 && raw.confidence <= 1)) errors.push(at + ".confidence must be a number 0..1");
			if (typeof raw.needsLogin !== "boolean") errors.push(at + ".needsLogin must be a boolean");
			if (!(Number.isInteger(raw.timeoutMs) && raw.timeoutMs >= 1e3 && raw.timeoutMs <= MAX_TIMEOUT_MS)) errors.push(at + ".timeoutMs must be an integer 1000..180000");
			if (!(Number.isInteger(raw.maxOutputBytes) && raw.maxOutputBytes >= 1024 && raw.maxOutputBytes <= MAX_OUTPUT_BYTES)) errors.push(at + ".maxOutputBytes must be an integer 1024..16777216");
			const allowed = strList(raw.allowedSubcommands, 12, 60) ? raw.allowedSubcommands : void 0;
			if (!allowed) errors.push(at + ".allowedSubcommands must list the command words the spec uses (up to 12; empty for a tool without subcommands)");
			else for (const word of allowed) if (matchesDeniedSubcommand(word)) errors.push(at + ".allowedSubcommands: \"" + word + "\" is a write / login command (read-only guard)");
			if (!isObject(raw.probe)) errors.push(at + ".probe must be an object");
			else {
				const p = raw.probe;
				closed(p, PROBE_KEYS, at + ".probe", errors);
				for (const key of ["versionArgs", "helpArgs"]) if (!Array.isArray(p[key]) || !p[key].every((t) => typeof t === "string" && t.length > 0 && t.length <= 80) || p[key].length > 6) errors.push(at + ".probe." + key + " must be an array of short strings");
				else if (allowed) errors.push(...argvProblems(p[key], allowed, at + ".probe." + key));
				if (!(Array.isArray(p.helpArgs) && p.helpArgs.length)) errors.push(at + ".probe.helpArgs must not be empty");
				if (p.minVersion !== void 0 && !(typeof p.minVersion === "string" && VERSION_RE.test(p.minVersion))) errors.push(at + ".probe.minVersion must look like 1.2.3");
				if (!strList(p.mustContain, 12, 80)) errors.push(at + ".probe.mustContain must be a list of short strings (the subcommands / flags that prove the contract)");
				if (p.contractHint !== void 0 && !isStr(p.contractHint, 200)) errors.push(at + ".probe.contractHint must be a short string");
			}
			const searchWhere = (key) => at + "." + key;
			if (allowed) {
				checkSearch(raw.search, searchWhere("search"), allowed, errors);
				if (raw.searches !== void 0) {
					if (!isObject(raw.searches)) errors.push(at + ".searches must be an object keyed by platform id");
					else for (const [platform, s] of Object.entries(raw.searches)) {
						if (!ID_RE.test(platform)) errors.push(at + ".searches: \"" + platform + "\" is not a platform id");
						checkSearch(s, at + ".searches." + platform, allowed, errors);
					}
				}
				if (raw.read !== void 0) checkSearch(raw.read, searchWhere("read"), allowed, errors);
			}
			if (!isObject(raw.env)) errors.push(at + ".env must be an object");
			else {
				closed(raw.env, ENV_KEYS, at + ".env", errors);
				for (const key of ["required", "passthrough"]) {
					const list = raw.env[key];
					if (list !== void 0 && !(Array.isArray(list) && list.length <= 16 && list.every((n) => typeof n === "string" && ENV_RE.test(n)))) errors.push(at + ".env." + key + " must be environment variable NAMES (never values)");
				}
				if (raw.env.set !== void 0) {
					const set = raw.env.set;
					if (!isObject(set) || Object.keys(set).length > 8 || !Object.entries(set).every(([k, val]) => ENV_RE.test(k) && typeof val === "string" && val.length <= 80)) errors.push(at + ".env.set must be a few NAME: short literal pairs");
					else if (Object.keys(set).some((k) => /key|token|secret|password|cookie/i.test(k))) errors.push(at + ".env.set must not set credentials: name them in env.required / env.passthrough and keep the value in your environment");
				}
			}
			if (raw.login !== void 0) {
				const l = raw.login;
				if (!isObject(l)) errors.push(at + ".login must be an object");
				else {
					closed(l, LOGIN_KEYS, at + ".login", errors);
					if (l.command === void 0 && l.hint === void 0) errors.push(at + ".login needs a command (what the user runs themselves) or a hint (what the user does)");
					if (l.command !== void 0 && !isStr(l.command, 120)) errors.push(at + ".login.command must be a short string (what the user runs themselves)");
					if (l.hint !== void 0 && !isStr(l.hint, 200)) errors.push(at + ".login.hint must be a short string (what the user does)");
					if (l.savedCredentialPaths !== void 0 && !(strList(l.savedCredentialPaths, 4, 160) && l.savedCredentialPaths.every((p) => /^~\/[^\0]+$/.test(p) && !p.includes("..")))) errors.push(at + ".login.savedCredentialPaths must be paths starting with ~/ (no ..)");
					if (l.readsBrowserCookiesWithoutLogin !== void 0 && typeof l.readsBrowserCookiesWithoutLogin !== "boolean") errors.push(at + ".login.readsBrowserCookiesWithoutLogin must be a boolean");
					if (l.readsBrowserCookiesWithoutLogin === true && !(Array.isArray(l.savedCredentialPaths) && l.savedCredentialPaths.length)) errors.push(at + ".login: a tool that reads browser cookies without a login needs savedCredentialPaths, so the plugin can refuse to run it without one");
				}
			}
			if (raw.needsLogin === true && !isObject(raw.login) && !(isObject(raw.env) && Array.isArray(raw.env.required) && raw.env.required.length)) errors.push(at + ": needsLogin without login.command or env.required gives the user nothing to run");
			if (raw.verification !== void 0) {
				const v = raw.verification;
				if (origin === "user") errors.push(at + ".verification is for built-in specs only");
				else if (!(isObject(v) && CLI_VERIFICATIONS.includes(v.status) && Object.keys(v).every((k) => [
					"status",
					"version",
					"date",
					"note"
				].includes(k)))) errors.push(at + ".verification must be { status, version?, date?, note? }");
				else if (v.status === "live" && !(isStr(v.version, 40) && typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date))) errors.push(at + ".verification: live needs the verified version and a YYYY-MM-DD date");
			}
			if (errors.length) return {
				ok: false,
				errors
			};
			return {
				ok: true,
				errors: [],
				spec: raw
			};
		}
		/** Validate the `cliAdapters` setting: the valid specs by id and the problems of the rest (an invalid entry is ignored, never fatal). */
		function resolveCliAdapters(input) {
			const specs = /* @__PURE__ */ new Map();
			const diagnostics = [];
			if (input === void 0 || input === null) return {
				specs,
				diagnostics
			};
			if (!isObject(input)) return {
				specs,
				diagnostics: ["cliAdapters must be an object keyed by adapter id"]
			};
			for (const [key, raw] of Object.entries(input)) {
				if (isObject(raw) && raw.id !== void 0 && raw.id !== key) {
					diagnostics.push("cliAdapters." + key + " ignored: its id \"" + String(raw.id) + "\" must equal its key");
					continue;
				}
				const result = validateCliAdapterSpec(isObject(raw) ? {
					...raw,
					id: key
				} : raw, "user");
				if (!result.ok) {
					diagnostics.push("cliAdapters." + key + " ignored: " + result.errors.slice(0, 4).join("; ") + (result.errors.length > 4 ? " (+" + (result.errors.length - 4) + " more)" : ""));
					continue;
				}
				specs.set(key, result.spec);
			}
			return {
				specs,
				diagnostics
			};
		}
		/** `platformBackends`: ordered backend ids per platform. Pure shape check; ids are checked against the known backends by the caller. */
		function platformBackendProblems(input) {
			if (input === void 0 || input === null) return [];
			if (!isObject(input)) return ["platformBackends must be an object: { <platform>: [backend ids] }"];
			const problems = [];
			for (const [platform, ids] of Object.entries(input)) {
				if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/.test(platform)) problems.push("platformBackends: \"" + platform + "\" is not a platform id");
				if (!(Array.isArray(ids) && ids.length <= 12 && ids.every((id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/.test(id)))) problems.push("platformBackends." + platform + " must be a list of backend ids");
				else if (new Set(ids).size !== ids.length) problems.push("platformBackends." + platform + " lists a backend twice");
			}
			return problems;
		}
		//#endregion
		//#region src/cli/builtin-specs.ts
		const BILI_CLI_VERSION = "0.6.2";
		const BILI_CLI_SOURCE = `git+https://github.com/public-clis/bilibili-cli@489607468f967e0e11f3cdff6efc022d011e982a`;
		`${BILI_CLI_SOURCE}`, `${BILI_CLI_SOURCE}`, `${BILI_CLI_SOURCE}`;
		/** The date of the checks recorded below. */
		const SPEC_CHECK_DATE = "2026-10-06";
		const MB = 1048576;
		/** The versioned `{ ok, schema_version, data }` envelope of the agent-friendly Python CLIs (bili, xhs, rdt). */
		const ENVELOPE = [{
			path: "ok",
			equals: true
		}, {
			path: "schema_version",
			equals: "1"
		}];
		/** Why a login-needing CLI is gated on its saved login files: it reads the browser's cookies by itself when it has none. */
		const NOT_LOGGED_IN = [
			"not authenticated",
			"not_authenticated",
			"not logged in",
			"login required",
			"please log in",
			"no 'a1' cookie",
			"no cookies"
		];
		const bili = {
			id: "bili",
			bins: ["bili"],
			packageNote: `bilibili-cli from public-clis/bilibili-cli ${BILI_CLI_VERSION} (the PyPI package of the same name has another contract; sources.deps shows the pinned install)`,
			platforms: ["bilibili"],
			probe: {
				versionArgs: ["--version"],
				minVersion: BILI_CLI_VERSION,
				helpArgs: ["search", "--help"],
				mustContain: [
					"--type",
					"--max",
					"--json"
				]
			},
			allowedSubcommands: ["search"],
			search: {
				argv: [
					"search",
					"{query}",
					"--type",
					"video",
					"--max",
					"{count}",
					"--json"
				],
				maxCount: 10,
				overfetch: 3,
				output: {
					format: "json",
					itemsPath: "data",
					expect: ENVELOPE,
					errorPaths: ["message", "error"],
					stripTags: true,
					snippetMax: 300,
					fields: {
						url: [
							{ template: "https://www.bilibili.com/video/{bvid}" },
							"url",
							"link",
							"arcurl"
						],
						title: "title",
						snippet: { join: [
							{
								path: "author",
								prefix: "UP: "
							},
							{
								path: "play",
								prefix: "播放: "
							},
							"duration"
						] }
					}
				}
			},
			env: {},
			needsLogin: false,
			timeoutMs: 3e4,
			maxOutputBytes: 4 * MB,
			verification: {
				status: "live",
				version: BILI_CLI_VERSION,
				date: "2026-10-26",
				note: "zh / en / special-character searches parsed (fixtures live-bili-*); about one entry in five is a course / series without a bvid and link, so the adapter asks for 3 more than the count (overfetch) and a count of 3 stays 3. `bili search` never reads credentials or browser cookies (checked in bili_cli/auth.py and commands/user_search.py)"
			}
		};
		const ytDlp = {
			id: "yt-dlp",
			bins: ["yt-dlp"],
			packageNote: "yt-dlp (uv tool install yt-dlp)",
			platforms: ["youtube"],
			probe: {
				versionArgs: ["--version"],
				helpArgs: ["--help"],
				mustContain: [
					"--flat-playlist",
					"--print",
					"--skip-download"
				]
			},
			allowedSubcommands: [],
			search: {
				argv: [
					"ytsearch{count}:{query}",
					"--flat-playlist",
					"--skip-download",
					"--no-warnings",
					"--print",
					"%(id)s	%(title)s	%(channel)s	%(view_count)s	%(duration>%H:%M:%S)s"
				],
				maxCount: 10,
				output: {
					format: "text",
					lines: {
						mode: "tsv",
						columns: [
							"id",
							"title",
							"channel",
							"view_count",
							"duration"
						]
					},
					emptyValues: ["NA", "None"],
					requireTitle: true,
					fields: {
						url: { template: "https://www.youtube.com/watch?v={id}" },
						title: "title",
						snippet: { join: [
							"channel",
							{
								path: "view_count",
								suffix: " views"
							},
							"duration"
						] }
					}
				}
			},
			env: {},
			needsLogin: false,
			timeoutMs: 6e4,
			maxOutputBytes: 4 * MB,
			verification: {
				status: "live",
				version: "2026.08.19",
				date: "2026-10-26",
				note: "zh / en / special-character / empty / live-stream searches parsed (fixtures live-yt-dlp-*). Live streams have no view count or duration: yt-dlp prints NA for them (the 2026-10-11 spec listed only None, so snippets read \"NA views | NA\"); duration is now H:M:S (duration_string printed a bare \"11\" for an 11 s video). Stdout held only the records, the Python 3.10 deprecation notice went to stderr"
			}
		};
		const twitter = {
			id: "twitter",
			bins: ["twitter"],
			packageNote: "twitter-cli (PyPI twitter-cli; the command is `twitter`; Agent-Reach alone does not provide it)",
			platforms: ["twitter"],
			probe: {
				versionArgs: ["--version"],
				helpArgs: ["search", "--help"],
				mustContain: ["--json", "--max"],
				contractHint: "twitter-cli 0.8.5 is the oldest version known to offer --json on search"
			},
			allowedSubcommands: ["search"],
			search: {
				argv: [
					"search",
					"{query}",
					"-n",
					"{count}",
					"--json"
				],
				maxCount: 10,
				output: {
					format: "json",
					itemsPath: "data",
					expect: ENVELOPE,
					errorPaths: ["error.message"],
					titleMax: 200,
					fields: {
						url: { template: "https://x.com/{author.screenName}/status/{id}" },
						title: ["text", { template: "{author.name} (@{author.screenName})" }],
						snippet: {
							join: [
								{ template: "{author.name} (@{author.screenName})" },
								{
									path: "metrics.likes",
									prefix: "likes "
								},
								{
									path: "metrics.retweets",
									prefix: "retweets "
								},
								{
									path: "metrics.views",
									prefix: "views "
								},
								"createdAtISO"
							],
							sep: " · "
						},
						publishedAt: "createdAtISO"
					}
				},
				notLoggedInPatterns: [
					"not_authenticated",
					"not authenticated",
					"no twitter cookies",
					"cookie expired or invalid"
				]
			},
			env: { required: ["TWITTER_AUTH_TOKEN", "TWITTER_CT0"] },
			needsLogin: true,
			timeoutMs: 45e3,
			maxOutputBytes: 4 * MB,
			verification: {
				status: "contract-only",
				version: "0.8.5",
				date: "2026-10-11",
				note: "contract from the installed twitter-cli 0.8.5 source (`--json` envelope, tweet_to_dict fields, error payload) plus the real output reported in issue #38; the plugin itself has not run a search (it needs your tokens). Before 0.2.2 the spec parsed the default output, which is YAML when piped (issue #38)"
			}
		};
		const xhs = {
			id: "xhs",
			bins: ["xhs"],
			packageNote: "xiaohongshu-cli (PyPI xiaohongshu-cli; the command is `xhs`)",
			platforms: ["xiaohongshu"],
			probe: {
				versionArgs: ["--version"],
				helpArgs: ["search", "--help"],
				mustContain: [
					"keyword",
					"--json",
					"--sort"
				]
			},
			allowedSubcommands: ["search"],
			search: {
				argv: [
					"search",
					"{query}",
					"--json"
				],
				output: {
					format: "json",
					itemsPath: "data.items",
					expect: ENVELOPE,
					errorPaths: ["error.message"],
					skipWhen: {
						path: "model_type",
						equals: "hot_query"
					},
					fields: {
						url: { template: "https://www.xiaohongshu.com/explore/{id}?xsec_token={xsec_token}&xsec_source=pc_search" },
						title: ["note_card.display_title", "note_card.title"],
						snippet: { join: [{
							path: "note_card.user.nickname",
							prefix: "作者: "
						}, {
							path: "note_card.interact_info.liked_count",
							prefix: "赞: "
						}] },
						publishedAt: { time: "note_card.corner_tag_info.type=publish_time.text" }
					}
				},
				notLoggedInPatterns: NOT_LOGGED_IN
			},
			env: {},
			needsLogin: true,
			login: {
				command: "xhs login",
				savedCredentialPaths: ["~/.xiaohongshu-cli/cookies.json"],
				readsBrowserCookiesWithoutLogin: true
			},
			timeoutMs: 45e3,
			maxOutputBytes: 4 * MB,
			verification: {
				status: "live",
				version: "0.6.4",
				date: "2026-10-27",
				note: "a real `xhs search --json` run with the user's own saved login and parsed (fixture live-xhs-search.json, synthetic content in the real shape): 22 items for a count of 3, two of the 22 are hot_query suggestion cards (skipped by model_type); the publish time is in note_card.corner_tag_info (MM-DD or YYYY-MM-DD). Without a saved login the tool reads browser cookies by itself, so the plugin never runs it then"
			}
		};
		const zhihu = {
			id: "zhihu",
			bins: ["zhihu"],
			packageNote: "zhihu-cli (PyPI pyzhihu-cli, BAIGUANGMEI/zhihu-cli; the command is `zhihu`; not the Access-Secret \"zhihu-cli\" of dawnswwwww)",
			platforms: ["zhihu"],
			probe: {
				versionArgs: ["--version"],
				helpArgs: ["search", "--help"],
				mustContain: [
					"query",
					"--json",
					"--limit",
					"--type"
				]
			},
			allowedSubcommands: ["search"],
			search: {
				argv: [
					"search",
					"{query}",
					"--limit",
					"{count}",
					"--answers",
					"0",
					"--json"
				],
				maxCount: 20,
				output: {
					format: "json",
					itemsPath: "data",
					stripTags: true,
					fields: {
						url: [
							{
								template: "https://www.zhihu.com/question/{object.question.id}/answer/{object.id}",
								when: {
									path: "object.type",
									equals: "answer"
								}
							},
							{
								template: "https://zhuanlan.zhihu.com/p/{object.id}",
								when: {
									path: "object.type",
									equals: "article"
								}
							},
							{
								template: "https://www.zhihu.com/question/{object.id}",
								when: {
									path: "object.type",
									equals: "question"
								}
							}
						],
						title: [
							"object.title",
							"object.question.name",
							"object.name"
						],
						snippet: ["object.excerpt", "object.content"],
						publishedAt: { epoch: "object.created_time" }
					}
				},
				notLoggedInPatterns: ["not authenticated", "zhihu login"]
			},
			env: {},
			needsLogin: true,
			login: {
				command: "zhihu login",
				savedCredentialPaths: ["~/.zhihu-cli/cookies.json"]
			},
			timeoutMs: 45e3,
			maxOutputBytes: 4 * MB,
			verification: {
				status: "contract-only",
				version: "0.2.4",
				date: SPEC_CHECK_DATE,
				note: "help probed; output shape (`data[].object`) from the installed package source; the tool never reads browser cookies itself; no search was run (needs your login)"
			}
		};
		const rdt = {
			id: "rdt",
			bins: ["rdt"],
			packageNote: "rdt-cli (public-clis/rdt-cli; the command is `rdt`)",
			platforms: ["reddit"],
			probe: {
				versionArgs: ["--version"],
				helpArgs: ["search", "--help"],
				mustContain: [
					"query",
					"--json",
					"--compact",
					"--limit"
				]
			},
			allowedSubcommands: ["search"],
			search: {
				argv: [
					"search",
					"{query}",
					"--limit",
					"{count}",
					"--compact",
					"--json"
				],
				maxCount: 25,
				output: {
					format: "json",
					itemsPath: "data",
					expect: ENVELOPE,
					errorPaths: ["error.message"],
					fields: {
						url: { template: "https://www.reddit.com{permalink}" },
						title: "title",
						snippet: { join: [
							{
								path: "subreddit",
								prefix: "r/"
							},
							{
								path: "score",
								prefix: "score "
							},
							{
								path: "num_comments",
								suffix: " comments"
							},
							"selftext"
						] },
						publishedAt: { epoch: "created_utc" }
					}
				},
				notLoggedInPatterns: NOT_LOGGED_IN
			},
			env: {},
			needsLogin: true,
			login: {
				command: "rdt login",
				savedCredentialPaths: ["~/.config/rdt-cli/credential.json"],
				readsBrowserCookiesWithoutLogin: true
			},
			timeoutMs: 45e3,
			maxOutputBytes: 4 * MB,
			verification: {
				status: "contract-only",
				version: "0.4.2",
				date: SPEC_CHECK_DATE,
				note: "help probed; `--compact --json` output (post dicts in the `data` envelope) from the installed package source; no search was run: without a saved login it reads browser cookies"
			}
		};
		const OMNIREACH_OUTPUT = {
			format: "json",
			itemsPath: "results",
			errorPaths: ["errors.0.error"],
			stripTags: true,
			emptyValues: ["-"],
			fields: {
				url: "url",
				title: "title",
				snippet: "content",
				publishedAt: "ts"
			}
		};
		/** The `wechat` platform's two tools and the multi-source `omnireach` platform come from the same specs; ids are the backend ids. */
		const BUILTIN_CLI_SPECS = [
			bili,
			ytDlp,
			twitter,
			xhs,
			zhihu,
			rdt,
			{
				id: "omnireach",
				bins: ["omnireach"],
				packageNote: "omnireach (Python, Daily-AC/omnireach; uv tool install from its repository)",
				platforms: ["omnireach", "wechat"],
				probe: {
					versionArgs: ["--version"],
					minVersion: "0.19.0",
					helpArgs: ["search", "--help"],
					mustContain: [
						"--on",
						"--limit",
						"--json"
					]
				},
				allowedSubcommands: ["search"],
				search: {
					argv: [
						"search",
						"{query}",
						"--on",
						"hackernews,youtube,github,wechat,bilibili",
						"--limit",
						"{count}",
						"--json"
					],
					maxCount: 20,
					output: OMNIREACH_OUTPUT
				},
				searches: { wechat: {
					argv: [
						"search",
						"{query}",
						"--on",
						"wechat",
						"--limit",
						"{count}",
						"--json"
					],
					maxCount: 10,
					output: OMNIREACH_OUTPUT
				} },
				env: {},
				needsLogin: false,
				timeoutMs: 6e4,
				maxOutputBytes: 8 * MB,
				verification: {
					status: "live",
					version: "0.19.0-alpha",
					date: "2026-10-26",
					note: "`--on wechat` (2026-10-06, fixture omnireach-wechat.json) and the multi-source command with an explicit `--on hackernews,youtube,github,wechat,bilibili` (fixtures live-omnireach-multi-*.json) parsed. Its automatic routing added browser-backed google / twitter sources through opencli (they drive the user's Chrome), so the adapter never uses it"
				}
			},
			{
				id: "gh",
				bins: ["gh"],
				packageNote: "GitHub CLI (https://cli.github.com; brew install gh / winget install GitHub.cli)",
				platforms: [
					"github",
					"github-issues",
					"github-code"
				],
				probe: {
					versionArgs: ["--version"],
					helpArgs: [
						"search",
						"repos",
						"--help"
					],
					mustContain: [
						"--json",
						"--limit",
						"stargazersCount"
					]
				},
				allowedSubcommands: [
					"search",
					"repos",
					"issues",
					"code"
				],
				search: {
					argv: [
						"search",
						"repos",
						"--json",
						"fullName,description,url,stargazersCount,language,updatedAt,forksCount",
						"--limit",
						"{count}",
						"--sort",
						"stars",
						"--order",
						"desc",
						"--",
						"{terms}"
					],
					maxCount: 15,
					output: {
						format: "json",
						stripTags: false,
						fields: {
							url: "url",
							title: "fullName",
							publishedAt: { date: "updatedAt" },
							snippet: { join: [
								"description",
								{
									path: "stargazersCount",
									prefix: "⭐"
								},
								{
									path: "language",
									prefix: "[",
									suffix: "]"
								},
								{
									path: "forksCount",
									prefix: "forks "
								}
							] }
						}
					},
					notLoggedInPatterns: [
						"gh auth login",
						"not logged in",
						"authentication required"
					]
				},
				searches: {
					"github-issues": {
						argv: [
							"search",
							"issues",
							"--json",
							"title,url,state,repository,commentsCount,updatedAt",
							"--limit",
							"{count}",
							"--sort",
							"updated",
							"--order",
							"desc",
							"--",
							"{terms}"
						],
						maxCount: 15,
						output: {
							format: "json",
							fields: {
								url: "url",
								title: "title",
								publishedAt: { date: "updatedAt" },
								snippet: {
									join: [
										{
											path: "state",
											prefix: "[",
											suffix: "]"
										},
										"repository.nameWithOwner",
										{
											path: "commentsCount",
											suffix: " comments"
										}
									],
									sep: " · "
								}
							}
						},
						notLoggedInPatterns: [
							"gh auth login",
							"not logged in",
							"authentication required"
						]
					},
					"github-code": {
						argv: [
							"search",
							"code",
							"--json",
							"path,repository,url",
							"--limit",
							"{count}",
							"--",
							"{terms}"
						],
						maxCount: 15,
						output: {
							format: "json",
							fields: {
								url: "url",
								title: { template: "{repository.nameWithOwner} / {path}" },
								snippet: { template: "仓库: {repository.nameWithOwner}" }
							}
						},
						notLoggedInPatterns: [
							"gh auth login",
							"not logged in",
							"authentication required"
						]
					}
				},
				env: { passthrough: [
					"GH_TOKEN",
					"GITHUB_TOKEN",
					"GH_HOST",
					"GH_CONFIG_DIR"
				] },
				needsLogin: true,
				login: { command: "gh auth login" },
				timeoutMs: 3e4,
				maxOutputBytes: 4 * MB,
				verification: {
					status: "live",
					version: "2.101.0",
					date: "2026-10-26",
					note: "repos, issues and code searches run (zh / en / qualifier / empty) and parsed (fixtures live-gh-*); the query is passed as separate words ({terms}) because gh quotes a one-token query as an exact phrase (found nothing for four-word queries, broke `repo:x words`). Needs the user's own gh login (a token, never a browser cookie)"
				}
			},
			{
				id: "wx-search-cli",
				bins: ["wx-search-cli"],
				packageNote: "wx-search-cli (npm i -g wx-search-cli, tjx666/wx-search-cli; the command is `wx-search-cli`)",
				platforms: ["wechat"],
				probe: {
					versionArgs: ["--version"],
					helpArgs: ["--help"],
					mustContain: ["search <query>", "sogou"]
				},
				allowedSubcommands: ["search"],
				search: {
					argv: ["search", "{query}"],
					output: {
						format: "json",
						fields: {
							url: "real_url",
							title: "title",
							publishedAt: "publish_time"
						}
					}
				},
				env: {},
				needsLogin: false,
				timeoutMs: 45e3,
				maxOutputBytes: 2 * MB,
				verification: {
					status: "live",
					version: "0.1.0",
					date: "2026-10-26",
					note: "`search` run for Chinese, English and special-character / nonsense queries and parsed (fixtures live-wx-search-cli-*): a JSON array of 10 { title, link, real_url, publish_time, page } per page, whatever the requested count (the adapter cuts it). Sogou anti-spider answers `[]` with exit 0 in this mode, indistinguishable from no hits"
				}
			},
			{
				id: "tanso",
				bins: ["tanso"],
				packageNote: "tanso (npm i -g @geekjourneyx/tanso, geekjourneyx/tanso; a Go binary; needs your Bocha / Zhihu keys in its own config)",
				platforms: ["tanso"],
				probe: {
					versionArgs: ["version"],
					helpArgs: ["--help"],
					mustContain: [
						"bocha",
						"zhihu",
						"--json"
					]
				},
				allowedSubcommands: ["version"],
				search: {
					argv: [
						"{query}",
						"--json",
						"--source",
						"bocha_web",
						"--source",
						"zhihu_search"
					],
					output: {
						format: "json",
						itemsPath: "results",
						errorPaths: ["errors.0.message", "errors.0"],
						fields: {
							url: "url",
							title: "title",
							snippet: "snippet"
						}
					},
					notLoggedInPatterns: [
						"credential",
						"api_key",
						"access_secret",
						"config error"
					]
				},
				env: { passthrough: [
					"BOCHA_API_KEY",
					"ZHIHU_ACCESS_SECRET",
					"ZHIHU_API_KEY",
					"TANSO_CONFIG",
					"XDG_CONFIG_HOME"
				] },
				needsLogin: true,
				login: { command: "tanso config init" },
				timeoutMs: 6e4,
				maxOutputBytes: 2 * MB,
				verification: {
					status: "docs-only",
					version: "2.0.2",
					date: SPEC_CHECK_DATE,
					note: "not installed here; from the upstream README (envelope with results[].{source,title,url,snippet}); --limit is not documented and not used"
				}
			}
		];
		for (const spec of BUILTIN_CLI_SPECS) {
			const result = validateCliAdapterSpec(spec, "builtin");
			if (!result.ok) throw new Error("built-in CLI spec " + spec.id + " is invalid: " + result.errors.join("; "));
		}
		//#endregion
		//#region src/cli/chains-spec.ts
		/**
		* The static facts of the platform backend chains (dev-plan M12), free of Node imports so the settings card validates
		* `platformBackends` with the same code the server resolves it with: the default chain of each platform, which backend
		* ids exist and which platforms each can serve.
		* @module web-search-pro/cli/chains-spec
		*/
		/**
		* The default chain of each platform: first usable backend answers, empty or failing ones fall through in order. The platforms
		* that need a login (xiaohongshu, reddit, twitter, zhihu) try the standalone OpenCLI first: it reads the login of the user's
		* own day-to-day Chrome through the OpenCLI Browser Bridge, so nothing is logged in by the plugin. The standalone CLIs
		* (xhs, rdt, twitter, zhihu) stay as the optional fallback for users who logged them in themselves.
		*/
		const DEFAULT_CHAINS = {
			xiaohongshu: [
				"opencli",
				"xhs",
				"browser-opencli"
			],
			reddit: [
				"opencli",
				"rdt",
				"browser-opencli"
			],
			twitter: [
				"opencli",
				"twitter",
				"browser-opencli"
			],
			zhihu: [
				"opencli",
				"zhihu",
				"browser-search"
			],
			bilibili: ["bili"],
			youtube: ["yt-dlp"],
			github: ["rest", "gh"],
			"github-issues": ["rest", "gh"],
			"github-code": ["rest", "gh"],
			wechat: ["omnireach", "wx-search-cli"],
			omnireach: ["omnireach"],
			tanso: ["tanso"],
			instagram: ["browser-opencli"],
			facebook: ["browser-opencli"],
			weibo: ["browser-search"],
			douban: ["browser-search"],
			tieba: ["browser-search"],
			douyin: ["browser-search"],
			kuaishou: ["browser-search"]
		};
		/** Platforms whose provider is a chain (everything in the default table). */
		const CHAIN_PLATFORMS = Object.keys(DEFAULT_CHAINS);
		/** Platforms the dsh-browser OpenCLI bridge has a site adapter for (pinned to engines.ts by a test). */
		const BROWSER_OPENCLI_PLATFORMS = [
			"xiaohongshu",
			"twitter",
			"reddit",
			"instagram",
			"facebook"
		];
		/** Platforms with a built-in rendered-search-page spec in dsh-browser's searchResults (pinned to platform-search.ts by a test). */
		const BROWSER_SEARCH_PLATFORMS = [
			"zhihu",
			"weibo",
			"douban",
			"tieba",
			"douyin",
			"kuaishou"
		];
		/** Platforms the plugin's own REST client serves. */
		const REST_PLATFORMS = [
			"github",
			"github-issues",
			"github-code"
		];
		/** Backend ids that are not CLI specs. */
		const FIXED_BACKENDS = [
			"opencli",
			"browser-opencli",
			"browser-search",
			"rest"
		];
		/**
		* Whether backend `id` can serve `platform`. `specPlatforms` maps a CLI spec id (built-in, or `custom-cli:<id>` of the user)
		* to the platforms it lists; a user spec serves any platform its chain names.
		*/
		function backendServes(id, platform, specPlatforms) {
			if (id === "opencli") return OPENCLI_SITE_OF[platform] ? { ok: true } : {
				ok: false,
				why: "has no site for platform " + platform
			};
			if (id === "browser-opencli") return BROWSER_OPENCLI_PLATFORMS.includes(platform) ? { ok: true } : {
				ok: false,
				why: "does not serve platform " + platform
			};
			if (id === "browser-search") return BROWSER_SEARCH_PLATFORMS.includes(platform) ? { ok: true } : {
				ok: false,
				why: "does not serve platform " + platform
			};
			if (id === "rest") return REST_PLATFORMS.includes(platform) ? { ok: true } : {
				ok: false,
				why: "does not serve platform " + platform
			};
			const platforms = specPlatforms.get(id);
			if (!platforms) return {
				ok: false,
				why: "is not a known backend (built-in ids: " + [...specPlatforms.keys()].filter((k) => !k.startsWith("custom-cli:")).join(", ") + ", " + FIXED_BACKENDS.join(", ") + ")"
			};
			if (id === platform) return { ok: true };
			if (!platforms.includes(platform)) return {
				ok: false,
				why: "does not serve platform " + platform + (platforms.length ? " (it serves " + platforms.join(", ") + ")" : " (it declares no platform" + (id.startsWith("custom-cli:") ? ": add " + platform + " to its \"platforms\"" : "") + ")")
			};
			return { ok: true };
		}
		/** The CLI specs a chain may name: the built-ins by id and the user's valid `cliAdapters` as `custom-cli:<id>`. */
		function specPlatformsOf(cliAdapters) {
			const platforms = new Map(BUILTIN_CLI_SPECS.map((spec) => [spec.id, spec.platforms]));
			const user = resolveCliAdapters(cliAdapters);
			for (const [id, spec] of user.specs) platforms.set("custom-cli:" + id, spec.platforms);
			return {
				platforms,
				diagnostics: user.diagnostics
			};
		}
		/** The declared platforms of the user's CLI adapters that no backend chain exists for (the spec would serve nothing there). */
		function customCliPlatformIssues(cliAdapters) {
			const { specs } = resolveCliAdapters(cliAdapters);
			const out = [];
			for (const [id, spec] of specs) {
				const unknown = spec.platforms.filter((platform) => !CHAIN_PLATFORMS.includes(platform));
				if (unknown.length) out.push("cliAdapters." + id + ".platforms: no backend chain exists for " + unknown.join(", ") + " (platforms with a chain: " + CHAIN_PLATFORMS.join(", ") + ")");
			}
			return out;
		}
		/**
		* Every problem of the `platformBackends` setting (shape, unknown platform, unknown or foreign backend id) given the
		* `cliAdapters` setting. The settings card and `sources.status` both call this.
		*/
		function platformBackendIssues(platformBackends, cliAdapters) {
			const shape = platformBackendProblems(platformBackends);
			if (shape.length || !platformBackends || typeof platformBackends !== "object") return shape;
			const { platforms } = specPlatformsOf(cliAdapters);
			const known = /* @__PURE__ */ new Set([...CHAIN_PLATFORMS, ...[...platforms.keys()].filter((id) => id.startsWith("custom-cli:"))]);
			const out = [];
			for (const [platform, ids] of Object.entries(platformBackends)) {
				if (!known.has(platform)) {
					out.push("platformBackends." + platform + ": no such platform with a backend chain (known: " + [...known].join(", ") + ")");
					continue;
				}
				for (const id of ids) {
					const served = backendServes(id, platform, platforms);
					if (!served.ok) out.push("platformBackends." + platform + ": \"" + id + "\" " + served.why);
				}
			}
			return out;
		}
		//#endregion
		//#region src/client/validators.ts
		/**
		* Validation behind the settings card. Every rule that has a server counterpart is the server's own function
		* (providers-spec, rubrics-spec, coverage, budget-spec): the card calls it, it does not restate it. Pure and free of
		* Node imports, so it ships in the client bundle.
		* @module web-search-pro/client/validators
		*/
		/** Key names that mean "a secret lives here": a provider definition carries a `keyRef` name, never the key. */
		const SECRET_KEY = /(^|[^a-z])(api[-_]?key|apikey|token|secret|password|passwd|authorization|bearer)([^a-z]|$)/i;
		function secretPaths(value, trail, out) {
			if (Array.isArray(value)) {
				value.forEach((item, index) => {
					secretPaths(item, trail + "[" + index + "]", out);
				});
				return;
			}
			if (!isRecord$2(value)) return;
			for (const [key, entry] of Object.entries(value)) {
				const here = trail ? trail + "." + key : key;
				if (key !== "keyRef" && SECRET_KEY.test(key)) out.push(here);
				else secretPaths(entry, here, out);
			}
		}
		/**
		* `evidence.judge.providers`: the server's own `resolveProviders` over the draft, plus a refusal to carry secrets in a
		* definition (the card never shows or stores a key value: `keyRef` names the environment variable / credentials entry).
		*/
		function customProviders(providers) {
			if (providers === void 0) return {
				problems: [],
				ids: []
			};
			if (!isRecord$2(providers)) return {
				problems: ["evidence.judge.providers must be an object keyed by provider id"],
				ids: []
			};
			const { providers: catalog, diagnostics } = resolveProviders({ providers });
			const problems = [...diagnostics];
			const secret = /* @__PURE__ */ new Set();
			for (const [id, entry] of Object.entries(providers)) {
				const found = [];
				secretPaths(entry, "", found);
				for (const where of found) problems.push("evidence.judge.providers." + id + "." + where + " looks like a secret: keep the key in the environment or DSH credentials and name it with keyRef");
				if (found.length) secret.add(id);
			}
			const ignored = (id) => diagnostics.some((message) => message.startsWith("evidence.judge.providers." + id + " ignored"));
			return {
				problems,
				ids: Object.keys(providers).filter((id) => catalog.has(id) && !secret.has(id) && !ignored(id))
			};
		}
		/** Ids the judge provider selects can name: the presets and the valid custom entries. */
		function providerChoices(providers) {
			return [.../* @__PURE__ */ new Set([...Object.keys(PRESETS), ...customProviders(providers).ids])];
		}
		/** The version a new override of a rubric starts with: the built-in label counted up (`v1` -> `v2`). */
		function nextVersion(version) {
			const match = /^(.*?)(\d+)$/.exec(version);
			return match ? match[1] + String(Number(match[2]) + 1) : version + "2";
		}
		/**
		* Problems of one rubric override entry: the server's `overrideProblems`, plus the card's stricter rule that the version
		* label must differ from the built-in one (an override on the shipped label is indistinguishable from the default in logs).
		*/
		function rubricEntryProblems(id, entry) {
			const problems = overrideProblems(id, entry);
			const base = builtinDef(id);
			if (base && isRecord$2(entry) && entry.version === base.version && !problems.some((p) => p.startsWith("changed content"))) problems.push("version must differ from the built-in \"" + base.version + "\"");
			return problems;
		}
		/** The rubric entries of an evidence object that carry any problem, by rubric id. */
		function rubricIssues(rubrics) {
			const out = {};
			if (!isRecord$2(rubrics)) return out;
			for (const [id, entry] of Object.entries(rubrics)) {
				const problems = rubricEntryProblems(id, entry);
				if (problems.length) out[id] = problems;
			}
			return out;
		}
		/**
		* Everything wrong or doubtful in an effective `evidence` object, per control. Errors are values the server would
		* ignore; warnings are accepted values that cannot do what the mode asks (a placeholder provider, no thresholds).
		*/
		function evidenceIssues(ev) {
			const issues = [];
			const add = (field, message, level = "error", related) => {
				issues.push({
					field,
					message,
					level,
					...related ? { related } : {}
				});
			};
			const judge = isRecord$2(ev.judge) ? ev.judge : {};
			const custom = customProviders(judge.providers);
			if (custom.problems.length) add("evidence.judge.providers", custom.problems.join("\n"));
			const settings = {
				...typeof judge.provider === "string" ? { provider: judge.provider } : {},
				allowLlm: judge.allowLlm === true,
				...isRecord$2(judge.providers) ? { providers: judge.providers } : {}
			};
			const catalog = resolveProviders(settings).providers;
			const selected = typeof judge.provider === "string" && judge.provider ? judge.provider : DEFAULT_PROVIDER_ID;
			const mode = typeof getAt(ev, ["judge", "mode"]) === "string" ? getAt(ev, ["judge", "mode"]) : ev.jevMode;
			if (typeof judge.provider === "string" && judge.provider && !catalog.has(judge.provider)) add("evidence.judge.provider", "provider \"" + judge.provider + "\" is not defined (known: " + [...catalog.keys()].join(", ") + ")", "error", ["evidence.judge.providers"]);
			else if (mode !== void 0 && mode !== "off") {
				const why = unusableReason(catalog.get(selected), settings);
				if (why) add("evidence.judge.provider", why, "warning");
			}
			const coverage = isRecord$2(ev.coverage) ? ev.coverage : {};
			const thresholds = coverage.thresholds;
			if (thresholds !== void 0) {
				const problems = thresholdsProblems(thresholds);
				const both = ["evidence.coverage.thresholds.weak", "evidence.coverage.thresholds.covered"];
				for (const problem of problems) {
					const fields = problem.includes("exceed") ? both : [problem.includes("thresholds.weak") ? both[0] : both[1]];
					for (const field of fields) add(field, problem, "error", both);
				}
			}
			if (coverage.mode === "shadow" || coverage.mode === "control") {
				const providerId = typeof coverage.provider === "string" && coverage.provider ? coverage.provider : selected;
				const provider = catalog.get(providerId);
				if (typeof coverage.provider === "string" && coverage.provider && !provider) add("evidence.coverage.provider", "provider \"" + coverage.provider + "\" is not defined (known: " + [...catalog.keys()].join(", ") + ")", "error", ["evidence.judge.providers"]);
				else if (provider && provider.protocol !== "systemone") add("evidence.coverage.provider", "the coverage judge needs a provider speaking the systemone protocol; " + providerId + " speaks " + provider.protocol, "warning");
				if (thresholds === void 0) {
					const rubric = isRecord$2(ev.rubrics) && isRecord$2(ev.rubrics["cover.sufficient"]) && rubricEntryProblems("cover.sufficient", ev.rubrics["cover.sufficient"]).length === 0 ? String(ev.rubrics["cover.sufficient"].version) : builtinDef("cover.sufficient").version;
					const key = thresholdKey(providerId, {
						id: "cover.sufficient",
						version: rubric
					});
					if (!CALIBRATED_THRESHOLDS[key]) add("evidence.coverage.thresholds.weak", "no calibrated thresholds for " + key + ": set both thresholds (fitted on your own labels) or the judge stays off", "warning");
				}
			}
			if (ev.budget !== void 0) {
				const diagnostics = resolveBudget(isRecord$2(ev.budget) ? ev.budget : {}).diagnostics;
				for (const message of diagnostics) add(message.includes(".timezone") ? "evidence.budget.timezone" : message.includes(".providers") ? "evidence.budget.providers" : message.includes("dailyInputTokens") ? "evidence.budget.dailyInputTokens" : "evidence.budget.perSearchInputTokens", message);
			}
			for (const [id, problems] of Object.entries(rubricIssues(ev.rubrics))) add(rubricField(id), problems.join("\n"));
			return issues;
		}
		/**
		* Problems of the effective `sources` object (priority / disabled / budget), from the server's own `resolveSources`. A source that is
		* both prioritised and disabled is accepted (disabled wins) but is probably not what was meant.
		*/
		function sourcesIssues(sources) {
			const issues = [];
			for (const message of resolveSources(sources).diagnostics) {
				if (message.includes("both prioritised and disabled")) {
					for (const field of ["sources.priority", "sources.disabled"]) issues.push({
						field,
						message,
						level: "warning",
						related: ["sources.priority", "sources.disabled"]
					});
					continue;
				}
				const confidence = /^sources\.confidence\.(\S+) ignored/.exec(message);
				if (confidence) {
					issues.push({
						field: `sources.confidence.${confidence[1]}`,
						message,
						level: "error"
					});
					continue;
				}
				const budget = /^sources\.budget\.([^.\s]+)\.(total|daily)\b/.exec(message);
				const field = budget ? `sources.budget.${budget[1]}.${budget[2]}` : message.includes("sources.disabled") ? "sources.disabled" : "sources.priority";
				issues.push({
					field,
					message,
					level: "error"
				});
			}
			return issues;
		}
		/** Rubric override ids in a settings object that name no built-in rubric (the server ignores them). */
		function unknownRubricIds(rubrics) {
			return isRecord$2(rubrics) ? Object.keys(rubrics).filter((id) => !BUILTIN_RUBRIC_IDS.includes(id)) : [];
		}
		/**
		* Problems of the CLI adapter settings, from the server's own functions: `cliAdapters` entries the server would ignore
		* (read-only guard, bad argv, secrets in env) and `platformBackends` that name an unknown platform or a backend that
		* cannot serve it.
		*/
		function cliIssues(platformBackends, cliAdapters) {
			const issues = [];
			for (const message of resolveCliAdapters(cliAdapters).diagnostics) issues.push({
				field: "cliAdapters",
				message,
				level: "error"
			});
			for (const message of customCliPlatformIssues(cliAdapters)) issues.push({
				field: "cliAdapters",
				message,
				level: "error"
			});
			for (const message of platformBackendIssues(platformBackends, cliAdapters)) issues.push({
				field: "platformBackends",
				message,
				level: "error",
				related: ["cliAdapters"]
			});
			return issues;
		}
		//#endregion
		//#region src/client/form.ts
		const ROOTS = [
			"evidence",
			"provider",
			"keyedSources",
			"sources"
		];
		/** Top-level fields that are objects whose keys, not the object, are the live (volatile) settings of the plugin schema. */
		const CONTAINER_FIELDS = ["playwright"];
		function stable(value) {
			if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
			if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
			return JSON.stringify(value);
		}
		function same(left, right) {
			return stable(left) === stable(right);
		}
		const SPECS = [
			...FIELD_SPECS,
			...PATH_SPECS,
			...KEYED_SPECS,
			...BUDGET_SPECS,
			...BUILTIN_RUBRIC_IDS.map(rubricSpec)
		];
		/** Every field spec of the form model, in display order. */
		const ALL_SPECS = SPECS;
		const SPEC_BY_FIELD = new Map(SPECS.map((spec) => [spec.field, spec]));
		/** The dynamic fields (one `sources.confidence.<id>` per source id) made so far: a field is the same object every time it is asked for. */
		const DYNAMIC_SPECS = /* @__PURE__ */ new Map();
		/** The spec of a field that is not in the fixed list: `sources.confidence.<id>`; undefined for any other name. */
		function dynamicSpec(field) {
			if (!field.startsWith("sources.confidence.") || field.length === 19) return void 0;
			const known = DYNAMIC_SPECS.get(field);
			if (known) return known;
			const spec = confidenceSpec(field.slice(19));
			DYNAMIC_SPECS.set(field, spec);
			return spec;
		}
		/** The specs of the dynamic fields among `fields` (the text view prints them next to the fixed ones). */
		function dynamicSpecsOf(fields) {
			return Object.keys(fields).filter((field) => !SPEC_BY_FIELD.has(field)).flatMap((field) => dynamicSpec(field) ?? []);
		}
		function createLocalStore(initial) {
			let snapshot = initial;
			const listeners = /* @__PURE__ */ new Set();
			return {
				getSnapshot: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				set(next) {
					snapshot = next;
					for (const listener of listeners) listener();
				},
				update(updater) {
					const draft = structuredClone(snapshot);
					updater(draft);
					snapshot = draft;
					for (const listener of listeners) listener();
				}
			};
		}
		const emptyCredentials = () => Object.fromEntries(CREDENTIAL_IDS.map((id) => [id, {
			configured: false,
			writable: true,
			loading: true
		}]));
		var WebSearchSettingsController = class {
			scope;
			ctx;
			staged = /* @__PURE__ */ new Map();
			secretDrafts = /* @__PURE__ */ new Map();
			/** The criteria textarea of a rubric as typed: blank lines must survive while the person is still typing. */
			criteriaRaw = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			store;
			unsubscribe;
			saving = false;
			failed = false;
			credentialGeneration = 0;
			credentialRefSignature = "";
			credentialStates = emptyCredentials();
			server = {
				available: false,
				loading: false,
				failed: false,
				trial: { state: "idle" },
				overlay: {
					loading: false,
					failed: false,
					busy: false
				}
			};
			trialGeneration = 0;
			constructor(scope, ctx) {
				this.scope = scope;
				this.ctx = ctx;
				this.store = createLocalStore(this.project());
				this.unsubscribe = scope.subscribe(() => {
					this.publish();
					if (stable(this.credentialRefs()) !== this.credentialRefSignature) this.refreshCredentials();
				});
				this.refreshCredentials();
				this.refreshStatus();
				this.refreshOverlay();
			}
			/** The Host's RPC client, read when it is used (the service may arrive after the card was registered); undefined where there is none. */
			rpc() {
				try {
					const root = this.ctx;
					const connection = root.get?.("connection") ?? root.connection;
					return typeof connection?.rpc?.call === "function" ? connection.rpc : void 0;
				} catch {
					return;
				}
			}
			/** Ask the plugin what is ready now (the same local probes as `sources.status`). Silent when the Host has no transport. */
			async refreshStatus() {
				const rpc = this.rpc();
				if (!rpc) {
					this.server = {
						...this.server,
						available: false,
						loading: false
					};
					this.publish();
					return;
				}
				this.server = {
					...this.server,
					available: true,
					loading: true
				};
				this.publish();
				try {
					const result = await rpc.call(RPC_CHANNEL, "status", {});
					if (!result.ok) throw new Error(result.error.message);
					this.server = {
						...this.server,
						available: true,
						loading: false,
						failed: false,
						status: result.value
					};
				} catch {
					this.server = {
						...this.server,
						loading: false,
						failed: true
					};
				}
				this.publish();
			}
			setOverlay(patch) {
				this.server = {
					...this.server,
					overlay: {
						...this.server.overlay,
						...patch
					}
				};
				this.publish();
			}
			/** Read what the agent overlay holds (once when the panel opens, and on the refresh button). Silent where the Host has no transport. */
			async refreshOverlay() {
				const rpc = this.rpc();
				if (!rpc) {
					this.setOverlay({
						loading: false,
						failed: true
					});
					return;
				}
				this.setOverlay({ loading: true });
				try {
					const result = await rpc.call(RPC_CHANNEL, "overlay", { limit: 20 });
					if (!result.ok) throw new Error(result.error.message);
					this.setOverlay({
						loading: false,
						failed: false,
						view: result.value
					});
				} catch {
					this.setOverlay({
						loading: false,
						failed: true
					});
				}
			}
			/** Drop overlay entries (keys, or `'all'`) as the user. The plugin audits it; the card shows the overlay as it is afterwards. */
			async revokeOverlay(keys, adopted = false) {
				const rpc = this.rpc();
				if (!rpc) {
					this.setOverlay({ error: {
						key: "agentRevokeFailed",
						why: "unavailable"
					} });
					return false;
				}
				this.setOverlay({
					busy: true,
					error: void 0
				});
				try {
					const result = await rpc.call(RPC_CHANNEL, "overlay.revoke", {
						keys: keys === "all" ? "all" : [...keys],
						...adopted ? { adopted: true } : {}
					});
					if (!result.ok) throw new Error(result.error.message);
					this.setOverlay({
						busy: false,
						failed: false,
						view: result.value
					});
					this.refreshStatus();
					return true;
				} catch (error) {
					this.setOverlay({
						busy: false,
						error: {
							key: "agentRevokeFailed",
							why: error instanceof Error ? error.message : String(error)
						}
					});
					return false;
				}
			}
			/**
			* "Adopt into configuration": write the overlay item's value into the profile with the Host's atomic `mutate` (the same call the save bar
			* makes, at the leaf the item is about), and only when that landed ask the plugin to drop the entry. A failed write leaves both as they were.
			*/
			async adoptOverlay(key) {
				const item = this.server.overlay.view?.items.find((entry) => entry.key === key);
				const adoption = item ? adoptionOf(item) : void 0;
				if (!item || !adoption || this.saving || !this.scope.getSnapshot().writable) return false;
				this.setOverlay({
					busy: true,
					error: void 0
				});
				let landed = false;
				try {
					landed = await this.scope.mutate(adoption.ops);
				} catch {
					landed = false;
				}
				if (!landed) {
					this.setOverlay({
						busy: false,
						error: { key: "agentAdoptFailed" }
					});
					return false;
				}
				for (const field of adoption.drop) this.staged.delete(field);
				this.publish();
				const dropped = await this.revokeOverlay([key], true);
				if (!dropped) this.setOverlay({ error: {
					key: "agentAdoptHalf",
					why: this.server.overlay.error?.why
				} });
				return dropped;
			}
			/** Run one search of a custom CLI draft (rpc-types.ts `trial`). The outcome lands in `server.trial`. */
			async runTrial(request) {
				const rpc = this.rpc();
				const generation = ++this.trialGeneration;
				if (!rpc) {
					this.server = {
						...this.server,
						trial: {
							state: "failed",
							id: request.id,
							error: "unavailable"
						}
					};
					this.publish();
					return;
				}
				this.server = {
					...this.server,
					trial: {
						state: "running",
						id: request.id
					}
				};
				this.publish();
				let trial;
				try {
					const result = await rpc.call(RPC_CHANNEL, "trial", request);
					trial = result.ok ? {
						state: "done",
						id: request.id,
						result: result.value
					} : {
						state: "failed",
						id: request.id,
						error: result.error.message
					};
				} catch (error) {
					trial = {
						state: "failed",
						id: request.id,
						error: error instanceof Error ? error.message : String(error)
					};
				}
				if (generation !== this.trialGeneration) return;
				this.server = {
					...this.server,
					trial
				};
				this.publish();
			}
			clearTrial() {
				this.trialGeneration += 1;
				this.server = {
					...this.server,
					trial: { state: "idle" }
				};
				this.publish();
			}
			inject() {
				return {
					hooks: { webSearchPro: this.store },
					edit: (field, text) => {
						this.edit(field, text);
					},
					resetField: (field) => {
						this.resetField(field);
					},
					editCredential: (id, text) => {
						this.editCredential(id, text);
					},
					editRubric: (id, key, text) => {
						this.editRubric(id, key, text);
					},
					startRubric: (id) => {
						this.startRubric(id);
					},
					restoreRubric: (id) => {
						this.restoreRubric(id);
					},
					save: () => {
						this.save();
					},
					discard: () => {
						this.discard();
					},
					refreshCredentials: () => {
						this.refreshCredentials();
					},
					refreshStatus: () => {
						this.refreshStatus();
					},
					refreshOverlay: () => {
						this.refreshOverlay();
					},
					revokeOverlay: (keys) => {
						this.revokeOverlay(keys);
					},
					adoptOverlay: (key) => {
						this.adoptOverlay(key);
					},
					runTrial: (request) => {
						this.runTrial(request);
					},
					clearTrial: () => {
						this.clearTrial();
					}
				};
			}
			snapshot() {
				return this.store.getSnapshot();
			}
			edit(field, text) {
				this.staged.set(field, {
					text,
					clear: false
				});
				this.failed = false;
				this.publish();
			}
			resetField(field) {
				const spec = this.spec(field);
				this.staged.set(field, {
					text: spec.format(this.baseValue(field)),
					clear: true
				});
				this.failed = false;
				this.publish();
			}
			editCredential(id, text) {
				this.secretDrafts.set(id, text);
				this.failed = false;
				this.publish();
			}
			/** The entry the editor shows: the staged draft when there is one, else what is stored; undefined = no override. */
			rubricEntry(id) {
				const text = this.fieldState(rubricField(id)).text;
				if (text.trim() === "") return void 0;
				try {
					const value = JSON.parse(text);
					return isRecord$2(value) ? value : void 0;
				} catch {
					return;
				}
			}
			stageRubric(id, entry) {
				const field = rubricField(id);
				const spec = this.spec(field);
				this.staged.set(field, {
					text: entry && Object.keys(entry).length ? spec.format(entry) : "",
					clear: false
				});
				this.failed = false;
				this.publish();
			}
			editRubric(id, key, text) {
				const entry = structuredClone(this.rubricEntry(id) ?? {});
				if (key === "criteria") {
					this.criteriaRaw.set(id, text);
					const levels = text.split("\n").map((line) => line.trim()).filter(Boolean);
					if (levels.length) entry.criteria = levels;
					else delete entry.criteria;
				} else if (text.trim() === "") delete entry[key];
				else if (key === "maxStateChars" || key === "maxCandidateChars") entry[key] = Number.isFinite(Number(text)) ? Number(text) : text;
				else entry[key] = key === "version" ? text.trim() : text;
				this.stageRubric(id, entry);
			}
			/** Start an override from the built-in text under the next version label. */
			startRubric(id) {
				const base = builtinDef(id);
				if (!base) return;
				this.criteriaRaw.delete(id);
				this.stageRubric(id, {
					version: nextVersion(base.version),
					instructions: base.instructions,
					...base.criteria ? { criteria: [...base.criteria] } : {},
					maxStateChars: base.maxStateChars,
					maxCandidateChars: base.maxCandidateChars
				});
			}
			/** Restore default: the override entry is removed on save (the built-in applies again). */
			restoreRubric(id) {
				this.criteriaRaw.delete(id);
				this.resetField(rubricField(id));
			}
			discard() {
				this.staged.clear();
				this.secretDrafts.clear();
				this.criteriaRaw.clear();
				this.failed = false;
				this.publish();
			}
			async save() {
				const analysis = this.analyze();
				const plan = analysis.settings;
				const invalid = plan.some((item) => item.write === void 0) || analysis.blocked.size > 0;
				const credentials = this.credentialPlan();
				if (this.saving || invalid || plan.length === 0 && credentials.length === 0) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				let landed = true;
				try {
					if (analysis.ops.length > 0) landed = await this.scope.mutate(analysis.ops);
					if (landed) for (const id of credentials) {
						const value = this.secretDrafts.get(id)?.trim() ?? "";
						if (value === "") continue;
						landed = await this.writeCredential(id, value) && landed;
					}
				} catch {
					landed = false;
				}
				await this.refreshCredentials();
				if (landed) {
					this.staged.clear();
					this.secretDrafts.clear();
					this.criteriaRaw.clear();
				}
				this.saving = false;
				this.failed = !landed;
				this.publish();
				if (landed) this.refreshStatus();
			}
			async refreshCredentials() {
				const generation = ++this.credentialGeneration;
				const refs = this.credentialRefs();
				this.credentialRefSignature = stable(refs);
				for (const id of CREDENTIAL_IDS) this.credentialStates[id].loading = true;
				this.publish();
				const response = await this.ctx.remote.credentials.describe([...new Set(Object.values(refs))]);
				if (generation !== this.credentialGeneration) return;
				if (response.ok) for (const id of CREDENTIAL_IDS) {
					const view = response.value[refs[id]];
					this.credentialStates[id] = {
						configured: view?.configured ?? false,
						writable: view?.writable ?? true,
						loading: false
					};
				}
				else for (const id of CREDENTIAL_IDS) this.credentialStates[id].loading = false;
				if (generation === this.credentialGeneration) this.publish();
			}
			dispose() {
				this.unsubscribe();
				this.listeners.clear();
				this.credentialGeneration += 1;
			}
			project() {
				const analysis = this.analyze();
				const fields = {};
				for (const spec of SPECS) fields[spec.field] = this.decorate(spec.field, this.fieldState(spec.field), analysis);
				for (const field of this.dynamicFields()) fields[field] = this.decorate(field, this.fieldState(field), analysis);
				const credentialsDirty = this.credentialPlan().length > 0;
				return {
					available: this.scope.getSnapshot().status === "ready",
					writable: this.scope.getSnapshot().writable,
					dirty: analysis.settings.length > 0 || credentialsDirty,
					changes: this.changedFields() + this.credentialPlan().length,
					invalid: analysis.settings.some((item) => item.write === void 0) || analysis.blocked.size > 0,
					saving: this.saving,
					failed: this.failed,
					fields,
					credentials: Object.fromEntries(CREDENTIAL_IDS.map((id) => [id, {
						text: this.secretDrafts.get(id) ?? "",
						...this.credentialStates[id]
					}])),
					providerChoices: providerChoices(getAt(analysis.evidence, ["judge", "providers"])),
					rubrics: this.projectRubrics(fields, analysis),
					restartTouched: this.restartTouched(),
					unknownRubrics: unknownRubricIds(analysis.evidence.rubrics),
					server: this.server
				};
			}
			/** The start-up-only settings (restart.ts) whose staged edit differs from what is stored. */
			restartTouched() {
				const touched = [];
				for (const field of RESTART_FIELD_LIST) {
					if (field === "playwright.snapshotDir") {
						if (this.snapshotDirTouched()) touched.push(field);
						continue;
					}
					const draft = this.staged.get(field);
					if (!draft) continue;
					if (draft.clear ? this.stored(field) : draft.text !== this.spec(field).format(this.sectionValue(field))) touched.push(field);
				}
				return touched;
			}
			/** `playwright` is one JSON field; only its `snapshotDir` is a start-up setting (`enabled` is live). */
			snapshotDirTouched() {
				const draft = this.staged.get("playwright");
				if (!draft) return false;
				const stored = this.sectionValue("playwright");
				const before = isRecord$2(stored) ? stored.snapshotDir : void 0;
				if (draft.clear) return before !== void 0;
				try {
					const value = JSON.parse(draft.text);
					return (isRecord$2(value) ? value.snapshotDir : void 0) !== before;
				} catch {
					return false;
				}
			}
			/** Staged fields that differ from what is stored (a pending reset counts only when something is stored). */
			changedFields() {
				let count = 0;
				for (const [field, draft] of this.staged) {
					const spec = this.spec(field);
					if (draft.clear) {
						if (this.stored(field)) count++;
						continue;
					}
					if (draft.text !== spec.format(this.sectionValue(field))) count++;
				}
				return count;
			}
			decorate(field, state, analysis) {
				const own = analysis.issues.filter((issue) => issue.field === field);
				const errors = own.filter((issue) => issue.level === "error").map((issue) => issue.message);
				const warnings = own.filter((issue) => issue.level === "warning").map((issue) => issue.message);
				return {
					...state,
					invalid: state.invalid || analysis.blocked.has(field),
					...errors.length ? { message: errors.join("\n") } : {},
					...warnings.length ? { warning: warnings.join("\n") } : {}
				};
			}
			projectRubrics(fields, analysis) {
				return BUILTIN_RUBRIC_IDS.map((id) => {
					const base = builtinDef(id);
					const field = rubricField(id);
					const entry = this.rubricEntry(id);
					const state = fields[field];
					const text = (value) => typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
					const problems = analysis.issues.filter((issue) => issue.field === field).map((issue) => issue.message);
					return {
						id,
						kind: base.kind,
						description: base.description,
						builtin: {
							version: base.version,
							instructions: base.instructions,
							criteria: [...base.criteria ?? []],
							maxStateChars: base.maxStateChars,
							maxCandidateChars: base.maxCandidateChars
						},
						activeVersion: entry !== void 0 && problems.length === 0 && typeof entry.version === "string" ? entry.version : base.version,
						editing: entry !== void 0,
						entry: {
							version: text(entry?.version),
							instructions: text(entry?.instructions),
							criteria: this.criteriaRaw.get(id) ?? (Array.isArray(entry?.criteria) ? entry.criteria.map(text).join("\n") : ""),
							maxStateChars: text(entry?.maxStateChars),
							maxCandidateChars: text(entry?.maxCandidateChars)
						},
						overridden: state.overridden,
						invalid: state.invalid,
						problems: problems.flatMap((problem) => problem.split("\n"))
					};
				});
			}
			/** The state of one control from the staged draft, else from the Host section. */
			fieldState(field) {
				const spec = this.spec(field);
				const draft = this.staged.get(field);
				if (draft === void 0) return {
					text: spec.format(this.sectionValue(field)),
					overridden: this.stored(field),
					invalid: false
				};
				const write = draft.clear ? { kind: "clear" } : spec.parse(draft.text);
				return {
					text: draft.text,
					overridden: write?.kind === "set",
					invalid: write === void 0
				};
			}
			/**
			* What saving would do: the writes of the top-level fields, and for each root object (`evidence`, `provider`,
			* `keyedSources`) the one write that carries every staged field of it, built on the raw user layer. The effective
			* evidence settings the draft would produce are then checked with the server's own validators.
			*/
			analyze() {
				const settings = [];
				const sectionOps = [];
				const ops = /* @__PURE__ */ new Map();
				const staged = /* @__PURE__ */ new Set();
				for (const [field, draft] of this.staged) {
					const spec = this.spec(field);
					if (!isPathSpec(spec)) {
						if (draft.clear) {
							if (this.stored(field)) {
								settings.push({
									target: field,
									write: { kind: "clear" }
								});
								sectionOps.push(...this.topOps(field, { kind: "clear" }));
							}
							continue;
						}
						if (draft.text === spec.format(this.sectionValue(field))) continue;
						const write = spec.parse(draft.text);
						settings.push({
							target: field,
							write
						});
						if (write) sectionOps.push(...this.topOps(field, write));
						continue;
					}
					const entry = ops.get(spec.root) ?? {
						ops: [],
						invalid: false
					};
					const resolved = this.resolvedRoot(spec.root);
					if (draft.clear) {
						if (this.stored(field)) {
							entry.ops.push(...this.opsOf(spec, { kind: "clear" }, resolved));
							staged.add(field);
						}
					} else if (draft.text !== spec.format(this.sectionValue(field))) {
						const write = spec.parse(draft.text);
						staged.add(field);
						if (write === void 0) entry.invalid = true;
						else entry.ops.push(...this.opsOf(spec, write, resolved));
					}
					ops.set(spec.root, entry);
				}
				const user = this.userLayer() ?? {};
				const candidates = /* @__PURE__ */ new Map();
				for (const root of ROOTS) {
					const entry = ops.get(root);
					const stored = isRecord$2(user[root]) ? user[root] : void 0;
					const next = structuredClone(stored ?? {});
					if (entry) applyOps(next, entry.ops);
					candidates.set(root, next);
					if (entry === void 0 || !entry.invalid && same(next, stored ?? {})) continue;
					if (entry.invalid) settings.push({
						target: root,
						write: void 0
					});
					else {
						if (Object.keys(next).length > 0) settings.push({
							target: root,
							write: {
								kind: "set",
								value: next
							}
						});
						else if (this.storedTop(root)) settings.push({
							target: root,
							write: { kind: "clear" }
						});
						for (const op of entry.ops) if (op.op === "set" || hasAt(stored ?? {}, op.path)) sectionOps.push({
							...op,
							path: [root, ...op.path]
						});
					}
				}
				const base = this.scope.getSnapshot().base?.evidence;
				const merged = deepMerge(isRecord$2(base) ? base : {}, candidates.get("evidence"));
				const evidence = {
					...merged,
					...isRecord$2(merged.judge) ? { judge: normalizeJudge(merged.judge) } : {},
					...isRecord$2(merged.coverage) ? { coverage: normalizeCoverage(merged.coverage) } : {},
					...isRecord$2(merged.rubrics) ? { rubrics: normalizeRubrics(merged.rubrics) } : {}
				};
				const baseSources = this.scope.getSnapshot().base?.sources;
				const topValue = (field) => {
					const draft = this.staged.get(field);
					if (draft === void 0) return this.sectionValue(field);
					if (draft.clear) return void 0;
					const write = this.spec(field).parse(draft.text);
					return write?.kind === "set" ? write.value : void 0;
				};
				const issues = [
					...evidenceIssues(evidence),
					...sourcesIssues(deepMerge(isRecord$2(baseSources) ? baseSources : {}, candidates.get("sources"))),
					...cliIssues(topValue("platformBackends"), topValue("cliAdapters"))
				];
				const blocked = /* @__PURE__ */ new Set();
				const touched = (field) => staged.has(field) || this.staged.has(field);
				for (const issue of issues) if (issue.level === "error" && (touched(issue.field) || (issue.related ?? []).some((related) => touched(related)))) blocked.add(issue.field);
				return {
					settings,
					ops: sectionOps,
					issues,
					blocked,
					evidence
				};
			}
			/**
			* The Host ops of a top-level field. A container the schema does not declare volatile as a whole (`playwright`: its keys are)
			* is written key by key; every other field is one `set` or one `unset`.
			*/
			topOps(field, write) {
				if (!CONTAINER_FIELDS.includes(field)) return write.kind === "clear" ? [{
					op: "unset",
					path: [field]
				}] : [{
					op: "set",
					path: [field],
					value: write.value
				}];
				const stored = this.userLayer()?.[field];
				const keys = isRecord$2(stored) ? Object.keys(stored) : [];
				const value = write.kind === "set" && isRecord$2(write.value) ? write.value : {};
				return [...Object.entries(value).map(([key, entry]) => ({
					op: "set",
					path: [field, key],
					value: entry
				})), ...keys.filter((key) => !Object.hasOwn(value, key)).map((key) => ({
					op: "unset",
					path: [field, key]
				}))];
			}
			opsOf(spec, write, resolved) {
				if (spec.ops) return spec.ops(write, { resolved });
				return write.kind === "clear" ? [{
					op: "unset",
					path: [...spec.path]
				}] : [{
					op: "set",
					path: [...spec.path],
					value: write.value
				}];
			}
			credentialPlan() {
				return [...this.secretDrafts].filter(([, value]) => value.trim() !== "").map(([id]) => id);
			}
			async writeCredential(id, value) {
				const ref = this.credentialRefs()[id];
				if (!(await this.ctx.remote.credentials.set(ref, value)).ok) return false;
				const response = await this.ctx.remote.credentials.describe([ref]);
				return response.ok && (response.value[ref]?.configured ?? false);
			}
			/** The credentials ref / environment variable name each key is read from, from the saved settings (else the default). */
			credentialRefs() {
				return Object.fromEntries(CREDENTIAL_IDS.map((id) => {
					const { field, default: fallback } = credentialRef(id);
					const candidate = this.sectionValue(field);
					return [id, typeof candidate === "string" && candidate.trim() !== "" ? candidate : fallback];
				}));
			}
			/** The `sources.confidence.<id>` fields that hold a value now or in the draft: the card shows these ids with their values. */
			dynamicFields() {
				const stored = this.scope.getSnapshot().value?.sources;
				const ids = isRecord$2(stored) && isRecord$2(stored.confidence) ? Object.keys(stored.confidence) : [];
				return [.../* @__PURE__ */ new Set([...ids.map((id) => CONFIDENCE_PREFIX + id), ...[...this.staged.keys()].filter((field) => field.startsWith(CONFIDENCE_PREFIX))])];
			}
			spec(field) {
				const spec = SPEC_BY_FIELD.get(field) ?? dynamicSpec(field);
				if (!spec) throw new Error(`unknown web-search-pro settings field: ${field}`);
				return spec;
			}
			resolvedRoot(root) {
				const value = this.scope.getSnapshot().value?.[root];
				return isRecord$2(value) ? value : {};
			}
			sectionValue(field) {
				const spec = this.spec(field);
				if (!isPathSpec(spec)) return this.scope.getSnapshot().value?.[field];
				const resolved = this.resolvedRoot(spec.root);
				return spec.read ? spec.read(resolved) : getAt(resolved, spec.path);
			}
			baseValue(field) {
				const base = this.scope.getSnapshot().base;
				const spec = this.spec(field);
				if (!isPathSpec(spec)) return base?.[field];
				const root = isRecord$2(base?.[spec.root]) ? base[spec.root] : {};
				return spec.read ? spec.read(root) : getAt(root, spec.path);
			}
			userLayer() {
				return this.scope.getSnapshot().user;
			}
			storedTop(key) {
				const user = this.userLayer();
				return user !== void 0 && Object.hasOwn(user, key);
			}
			stored(field) {
				const spec = this.spec(field);
				if (!isPathSpec(spec)) return this.storedTop(field);
				const root = this.userLayer()?.[spec.root];
				if (!isRecord$2(root)) return false;
				return spec.stored ? spec.stored(root) : hasAt(root, spec.path);
			}
			publish() {
				this.store.set(this.project());
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/default-chain.ts
		/**
		* The default engine order of a plain search, as a pure function: the router uses it to decide the order, and the settings
		* card's status summary uses the same code to show the chain a search would try first, so the two cannot disagree.
		* No imports: the client bundle includes this file.
		* @module web-search-pro/default-chain
		*/
		/** The default `engines` list. A list equal to it is "not customised": the default rule for common ("常用") sources applies to it. */
		const DEFAULT_ENGINES = Object.freeze([
			"ddg",
			"bing",
			"exa",
			"seam",
			"jina"
		]);
		/**
		* Order of the configured chain: `sources.disabled` removed, `sources.priority` ids that are in the list first, then the common
		* sources whose key resolves (only while `engines` is the default list; a list the user wrote keeps its order and the position
		* it gave a common source), then the rest. Throws when everything is disabled.
		*/
		function effectiveChain(input) {
			const disabled = new Set(input.disabled ?? []);
			const kept = input.engines.filter((id) => !disabled.has(id));
			if (input.engines.length && !kept.length) throw new Error("every configured engine is disabled (sources.disabled): " + input.engines.join(", "));
			const first = (input.priority ?? []).filter((id) => kept.includes(id));
			const lead = input.engines.length !== DEFAULT_ENGINES.length || input.engines.some((id, i) => id !== DEFAULT_ENGINES[i]) || input.anonymousOnly ? [] : (input.commonReady ?? []).filter((id) => !disabled.has(id) && !kept.includes(id));
			return [.../* @__PURE__ */ new Set([
				...first,
				...lead,
				...kept.filter((id) => !first.includes(id))
			])];
		}
		/**
		* {@link effectiveChain} plus why it differs from the list: the preview of the settings card says it in one sentence per reason, so
		* a person who sees `deepseek` first in a list that does not begin with it knows which rule did that. Same inputs, same rule.
		*/
		function explainChain(input) {
			let chain;
			try {
				chain = effectiveChain(input);
			} catch {
				chain = void 0;
			}
			const reasons = [];
			const disabled = new Set(input.disabled ?? []);
			const removed = [...new Set(input.engines.filter((id) => disabled.has(id)))];
			if (removed.length) reasons.push({
				kind: "disabled",
				ids: removed
			});
			if (!chain) return {
				chain,
				reasons
			};
			const customised = input.engines.length !== DEFAULT_ENGINES.length || input.engines.some((id, i) => id !== DEFAULT_ENGINES[i]);
			const ready = (input.commonReady ?? []).filter((id) => !disabled.has(id));
			const led = chain.filter((id) => !input.engines.includes(id));
			if (led.length) reasons.push({
				kind: "common",
				ids: led
			});
			const kept = input.engines.filter((id) => !disabled.has(id));
			const moved = (input.priority ?? []).filter((id) => kept.includes(id)).filter((id, index) => kept.indexOf(id) !== index);
			if (moved.length) reasons.push({
				kind: "priority",
				ids: moved
			});
			if (input.anonymousOnly) {
				const skipped = ready.filter((id) => !input.engines.includes(id));
				if (skipped.length) reasons.push({
					kind: "anonymous-only",
					ids: skipped
				});
			} else if (customised) {
				const skipped = ready.filter((id) => !input.engines.includes(id));
				if (skipped.length) reasons.push({
					kind: "own-list",
					ids: skipped
				});
			}
			return {
				chain,
				reasons
			};
		}
		//#endregion
		//#region src/config-groups.ts
		/**
		* The groups the configuration is laid out in, and the order of its fields. One definition serves four readers: the order of
		* the keys of the `Config` schema (what the Host's generic configuration view and `--dump-config` print), the sections of the
		* settings card's text view, the group a field belongs to in the card's tests, and the docs. A test pins the schema to this
		* list, so a new field cannot be added without choosing its group.
		*
		* The groups follow the settings page, most used first: common, search order, sources and keys, custom CLI, reading and
		* evidence, platforms and runtime, advanced and diagnostics. Only top-level `Config` keys are listed; a key that is an object
		* (`sources`, `evidence`, `provider`, `keyedSources`, `playwright`) takes all of its nested options with it.
		*
		* Pure and free of imports: the client bundle includes this file.
		* @module web-search-pro/config-groups
		*/
		const CONFIG_GROUP_IDS = [
			"common",
			"order",
			"sources",
			"cli",
			"evidence",
			"runtime",
			"advanced"
		];
		/** Top-level `Config` keys by group, in display order. */
		const CONFIG_GROUPS = {
			common: [
				"searchMaxResults",
				"parallelEngines",
				"toolSurface",
				"allowProxyFakeIp",
				"deepseekFetch"
			],
			order: [
				"engines",
				"sources",
				"platformBackends"
			],
			sources: [
				"keyedSources",
				"exaApiKey",
				"exaApiKeyEnv",
				"jinaApiKey",
				"jinaApiKeyEnv",
				"bochaApiKey",
				"bochaApiKeyEnv",
				"bochaBaseUrl",
				"bochaSummary",
				"githubToken",
				"githubTokenEnv",
				"searxngUrl",
				"openalexMailto"
			],
			cli: ["cliAdapters"],
			evidence: [
				"evidence",
				"fetchDefaultChars",
				"exaContentsPerUrlChars",
				"exaContentsTotalChars"
			],
			runtime: [
				"enableCliBackends",
				"opencliEnabled",
				"agentReachEnabled",
				"twitterAuthToken",
				"twitterAuthTokenEnv",
				"twitterCt0",
				"twitterCt0Env",
				"playwright",
				"customPlatforms",
				"platformRules",
				"browserBindings",
				"providerId",
				"registerProvider",
				"provider",
				"timeoutMs"
			],
			advanced: [
				"ttlSeconds",
				"memoryCacheEntries",
				"rrfConstant",
				"freshnessBoost",
				"freshnessDays",
				"authorityBoost",
				"authorityDomains",
				"dbPath",
				"verbose"
			]
		};
		/** Titles of the groups, as the text view prints them (the card's own group titles live in its dictionary). */
		const CONFIG_GROUP_TITLES = {
			en: {
				common: "Common",
				order: "Search order",
				sources: "Sources and keys (API keys by reference name only)",
				cli: "Custom CLI",
				evidence: "Reading and evidence",
				runtime: "Platforms and runtime",
				advanced: "Advanced and diagnostics"
			},
			zh: {
				common: "常用",
				order: "搜索顺序",
				sources: "来源与密钥（API Key 只写引用名）",
				cli: "自定义 CLI",
				evidence: "读取与证据",
				runtime: "平台与运行时",
				advanced: "高级与诊断"
			}
		};
		CONFIG_GROUP_IDS.flatMap((id) => CONFIG_GROUPS[id]);
		new Map(CONFIG_GROUP_IDS.flatMap((id) => CONFIG_GROUPS[id].map((key) => [key, id])));
		//#endregion
		//#region src/client/field-keys.ts
		/** Dictionary key of the label of a field; the hint is `<key>Hint` and the `?` text `<key>Help`. */
		const EXPLICIT = {
			"evidence.autoProviders": "evAutoProviders",
			"evidence.sourcePolicy": "sourcePolicy",
			"evidence.maxRounds": "evMaxRounds",
			"evidence.maxQueries": "evMaxQueries",
			"evidence.judge.mode": "judgeMode",
			"evidence.hybridBorderline": "hybridBorderline",
			"evidence.judge.provider": "judgeProvider",
			"evidence.maxJevQuestions": "maxJevQuestions",
			"evidence.judge.allowLlm": "allowLlm",
			"evidence.judge.providers": "judgeProviders",
			"evidence.coverage.mode": "coverageMode",
			"evidence.coverage.provider": "coverageProvider",
			"evidence.coverage.thresholds.weak": "thresholdWeak",
			"evidence.coverage.thresholds.covered": "thresholdCovered",
			"evidence.budget.perSearchInputTokens": "budgetPerSearch",
			"evidence.budget.dailyInputTokens": "budgetDaily",
			"evidence.budget.timezone": "budgetTimezone",
			"evidence.budget.providers": "budgetProviders",
			"provider.evidence": "providerEvidence",
			"provider.deadlineMs": "providerDeadlineMs",
			"sources.priority": "srcPriority",
			"sources.disabled": "srcDisabled"
		};
		function labelKey(field) {
			const named = EXPLICIT[field];
			if (named) return named;
			if (/^keyedSources\..+\.apiKeyEnv$/.test(field)) return "keyedEnv";
			if (/^keyedSources\..+\.baseUrl$/.test(field)) return "keyedBaseUrl";
			if (/^sources\.budget\..+\.total$/.test(field)) return "reqTotal";
			if (/^sources\.budget\..+\.daily$/.test(field)) return "reqDaily";
			if (/^sources\.confidence\..+$/.test(field)) return "srcConfidence";
			return field;
		}
		/** The fields whose dictionary has a `<key>Help` text (a longer explanation behind the `?`). */
		const WITH_HELP = /* @__PURE__ */ new Set([
			"engines",
			"toolSurface",
			"allowProxyFakeIp",
			"deepseekFetch",
			"registerProvider",
			"evidence.sourcePolicy",
			"sources.priority",
			"sources.disabled",
			"evidence.judge.mode",
			"evidence.hybridBorderline",
			"evidence.judge.allowLlm",
			"evidence.coverage.mode",
			"evidence.coverage.thresholds.weak",
			"rrfConstant",
			"freshnessBoost",
			"authorityBoost",
			"enableCliBackends",
			"opencliEnabled",
			"agentReachEnabled",
			"evidence.autoProviders",
			"timeoutMs",
			"ttlSeconds",
			"sources.budget.total",
			"sources.budget.daily",
			"bochaSummary"
		]);
		/** `?` text applies to the generic budget keys too. */
		const hasHelp = (field) => WITH_HELP.has(field) || WITH_HELP.has(field.replace(/^sources\.budget\..+\.(total|daily)$/, "sources.budget.$1"));
		/** Dictionary key of the sentence saying why a start-up-only field needs a plugin restart (restart.ts lists the fields). */
		function restartWhyKey(field) {
			return {
				toolSurface: "restartWhyToolSurface",
				"playwright.snapshotDir": "restartWhyPlaywright",
				providerId: "restartWhyProviderId",
				registerProvider: "restartWhyRegisterProvider",
				timeoutMs: "restartWhyTimeoutMs",
				memoryCacheEntries: "restartWhyMemoryCacheEntries",
				dbPath: "restartWhyDbPath",
				verbose: "restartWhyVerbose"
			}[field] ?? "restartBadge";
		}
		const keyed = (id, name, tier, extra = {}) => ({
			id,
			name,
			tier,
			credential: `keyed:${id}`,
			envField: `keyedSources.${id}.apiKeyEnv`,
			defaultEnv: KEYED_SOURCE_ENVS[id][0],
			baseUrlField: `keyedSources.${id}.baseUrl`,
			budget: true,
			...extra
		});
		const SOURCE_DEFS = [
			keyed("deepseek", "DeepSeek Search / Fetch", "paid", { common: true }),
			{
				id: "bocha",
				name: "博查 Bocha",
				tier: "paid",
				credential: "bocha",
				envField: "bochaApiKeyEnv",
				defaultEnv: "BOCHA_SEARCH_API_KEY",
				baseUrlField: "bochaBaseUrl",
				extra: ["bochaSummary"],
				budget: true
			},
			keyed("tavily", "Tavily", "free-quota"),
			keyed("brave", "Brave Search", "free-quota"),
			keyed("linkup", "Linkup", "free-quota"),
			keyed("serper", "Serper (Google)", "free-quota"),
			keyed("metaso", "秘塔 Metaso", "paid"),
			keyed("zhipu", "智谱 Zhipu", "paid"),
			keyed("baidu-qianfan", "百度千帆 Baidu Qianfan", "free-quota"),
			{
				id: "exa",
				name: "Exa",
				tier: "free-quota",
				credential: "exa",
				envField: "exaApiKeyEnv",
				defaultEnv: "EXA_API_KEY"
			},
			{
				id: "jina",
				name: "Jina AI",
				tier: "free-quota",
				credential: "jina",
				envField: "jinaApiKeyEnv",
				defaultEnv: "JINA_API_KEY"
			},
			{
				id: "github",
				name: "GitHub",
				tier: "anonymous",
				credential: "github",
				envField: "githubTokenEnv",
				defaultEnv: "GITHUB_TOKEN"
			},
			{
				id: "searxng",
				name: "SearXNG",
				tier: "anonymous",
				extra: ["searxngUrl"]
			}
		];
		/** Fields of a source dialog in display order (the key itself is a credential, not a field). */
		function sourceFields(def) {
			return [
				...def.envField ? [def.envField] : [],
				...def.baseUrlField ? [def.baseUrlField] : [],
				...def.extra ?? [],
				...def.budget ? [`sources.budget.${def.id}.total`, `sources.budget.${def.id}.daily`] : []
			];
		}
		/** Fields shown as JSON objects, each in its own dialog: the field, the group it sits in. */
		const JSON_FIELDS = [
			{
				field: "evidence.judge.providers",
				group: "judge"
			},
			{
				field: "evidence.budget.providers",
				group: "judge"
			},
			{
				field: "playwright",
				group: "runtime"
			},
			{
				field: "platformBackends",
				group: "advanced"
			},
			{
				field: "cliAdapters",
				group: "advanced"
			},
			{
				field: "customPlatforms",
				group: "platform"
			},
			{
				field: "platformRules",
				group: "platform"
			},
			{
				field: "browserBindings",
				group: "platform"
			}
		];
		//#endregion
		//#region src/client/fill.ts
		/** Fill `{name}` placeholders of a dictionary entry. */
		const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ""));
		//#endregion
		//#region src/client/styles.ts
		const styles = {
			notice: "wsp-notice",
			field: "wsp-field",
			fieldHead: "wsp-field-head",
			label: "wsp-label",
			hint: "wsp-hint",
			input: "wsp-input",
			textarea: "wsp-textarea",
			code: "wsp-code",
			failed: "wsp-failed",
			actions: "wsp-actions",
			root: "wsp-root",
			summaryBar: "wsp-summary",
			chips: "wsp-chips",
			chip: "wsp-chip",
			chipRemove: "wsp-chip-remove",
			chipInput: "wsp-chip-input",
			group: "wsp-group",
			groupHead: "wsp-group-head",
			groupTitle: "wsp-group-title",
			groupSub: "wsp-group-sub",
			groupBadges: "wsp-group-badges",
			groupBody: "wsp-group-body",
			row: "wsp-row",
			rowText: "wsp-row-text",
			rowLabel: "wsp-row-label",
			rowControl: "wsp-row-control",
			rowHint: "wsp-row-hint",
			rowMeta: "wsp-row-meta",
			muted: "wsp-muted",
			select: "wsp-select",
			unitInput: "wsp-unit-input",
			unit: "wsp-unit",
			help: "wsp-help",
			link: "wsp-link",
			danger: "wsp-danger",
			list: "wsp-list",
			item: "wsp-item",
			itemMain: "wsp-item-main",
			itemTitle: "wsp-item-title",
			itemMeta: "wsp-item-meta",
			itemActions: "wsp-item-actions",
			empty: "wsp-empty",
			subHead: "wsp-sub-head",
			compare: "wsp-compare",
			compareCol: "wsp-compare-col",
			preview: "wsp-preview",
			savebar: "wsp-savebar",
			saveText: "wsp-save-text",
			dialogBody: "wsp-dialog-body",
			stack: "wsp-stack",
			fold: "wsp-fold",
			foldBody: "wsp-fold-body",
			foldHint: "wsp-fold-hint",
			invalidInput: "wsp-invalid-input",
			secretRow: "wsp-secret-row",
			codeBlock: "wsp-code-block",
			table: "wsp-table",
			chain: "wsp-chain",
			why: "wsp-why",
			orderBar: "wsp-order-bar",
			tokens: "wsp-tokens",
			tokenRow: "wsp-token-row",
			trialOut: "wsp-trial-out",
			trialBar: "wsp-trial-bar"
		};
		function ensureStyles() {
			if (document.getElementById("web-search-pro-settings-styles")) return;
			const style = document.createElement("style");
			style.id = "web-search-pro-settings-styles";
			style.textContent = `
.wsp-notice{margin:0;padding:9px 11px;border-radius:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-3)}.wsp-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);margin:0}
.wsp-field{display:flex;min-width:0;flex-direction:column;gap:6px}.wsp-field-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.wsp-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.wsp-input{box-sizing:border-box;width:100%;min-width:0;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;color:var(--dsw-alias-label-primary)}.wsp-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}.wsp-input:disabled{opacity:.55}.wsp-textarea{height:auto;padding:9px 10px;resize:vertical;line-height:1.45}.wsp-code{font-family:var(--ds-font-family-code);font-size:12px}
.wsp-failed{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary)}.wsp-actions{display:flex;flex-wrap:wrap;gap:8px}.wsp-invalid-input{border-color:var(--dsw-alias-state-error-primary)}
.wsp-root{container-type:inline-size;display:flex;flex-direction:column;gap:12px;min-width:0}
.wsp-summary{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3)}.wsp-summary>strong{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-right:2px}
.wsp-link{appearance:none;border:0;background:none;padding:0;margin:0;font:inherit;font-size:12px;color:var(--dsw-alias-state-business-primary);cursor:pointer;text-decoration:none}.wsp-link:hover{text-decoration:underline}.wsp-link:disabled{opacity:.4;cursor:default;text-decoration:none}.wsp-danger{color:var(--dsw-alias-state-error-primary)}
.wsp-group{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);min-width:0}.wsp-group[open]{background:var(--dsw-alias-bg-layer-2)}
.wsp-group-head{list-style:none;display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;border-radius:12px;min-width:0}.wsp-group-head::-webkit-details-marker{display:none}.wsp-group-head::marker{content:''}
.wsp-group-head::after{content:'';flex:none;width:7px;height:7px;margin:0 4px 2px 2px;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:rotate(45deg);transition:transform .16s}.wsp-group[open]>.wsp-group-head::after{transform:rotate(-135deg);margin-bottom:-2px}
.wsp-group-head:hover{background:var(--dsw-alias-interactive-bg-hover)}.wsp-group-head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.wsp-group-title{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}.wsp-group-title strong{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}.wsp-group-sub{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wsp-group-badges{display:flex;flex:none;align-items:center;gap:6px}.wsp-group-body{padding:2px 14px 14px;border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column}
.wsp-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,260px);gap:6px 16px;align-items:start;padding:12px 0}.wsp-row+.wsp-row,.wsp-row+.wsp-sub-head,.wsp-sub-head+.wsp-row{border-top:1px solid var(--dsw-alias-border-l1)}
.wsp-row-text{display:flex;flex-direction:column;gap:3px;min-width:0}.wsp-row-label{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.wsp-row-label label,.wsp-row-label>span:first-child{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.wsp-row-hint{margin:0;font-size:12px;line-height:1.45;color:var(--dsw-alias-label-tertiary)}.wsp-row-hint.wsp-bad,.wsp-bad{color:var(--dsw-alias-state-error-primary)}.wsp-row-control{display:flex;flex-direction:column;gap:6px;min-width:0}.wsp-row-control.wsp-inline{flex-direction:row;align-items:center;justify-content:flex-end}.wsp-row-wide{grid-template-columns:minmax(0,1fr)}
.wsp-row-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);opacity:.85}.wsp-muted{color:var(--dsw-alias-label-tertiary)}.wsp-sub-head{margin:14px 0 2px;padding-top:2px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}.wsp-sub-head:first-child{margin-top:8px}
.wsp-select{box-sizing:border-box;width:100%;min-width:0;height:34px;padding:0 28px 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background-color:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-tertiary) 50%),linear-gradient(135deg,var(--dsw-alias-label-tertiary) 50%,transparent 50%);background-position:calc(100% - 15px) 14px,calc(100% - 10px) 14px;background-size:5px 5px;background-repeat:no-repeat}
.wsp-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}.wsp-select:disabled{opacity:.55;cursor:default}.wsp-select.wsp-muted,.wsp-input.wsp-muted{color:var(--dsw-alias-label-tertiary)}.wsp-select option{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.wsp-input:focus-visible{border-color:var(--dsw-alias-state-business-primary)}.wsp-unit-input{display:flex;align-items:center;gap:6px;min-width:0}.wsp-unit-input .wsp-input{flex:none;width:120px}.wsp-input.wsp-num{max-width:160px}.wsp-unit-input .wsp-select{flex:none;width:auto;min-width:72px}.wsp-unit{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.wsp-help{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:1px solid var(--dsw-alias-border-l3);border-radius:50%;background:transparent;font:inherit;font-size:10px;line-height:1;color:var(--dsw-alias-label-tertiary);cursor:pointer}.wsp-help:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary)}.wsp-help:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.wsp-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);min-width:0}.wsp-chips:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.wsp-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 4px 2px 8px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);font-size:12px;color:var(--dsw-alias-label-primary)}.wsp-chip>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wsp-chip-remove{appearance:none;border:0;background:none;padding:0 4px;font:inherit;font-size:13px;line-height:1;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:50%}.wsp-chip-remove:hover{color:var(--dsw-alias-state-error-primary)}.wsp-chip-remove:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary)}
.wsp-chip-input{flex:1;min-width:120px;height:24px;border:0;background:transparent;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary)}.wsp-chip-input:focus{outline:none}
.wsp-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-3)}.wsp-item{display:flex;align-items:center;gap:10px;padding:9px 12px;min-width:0}.wsp-item+.wsp-item{border-top:1px solid var(--dsw-alias-border-l1)}
.wsp-item-main{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}.wsp-item-title{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:13px;color:var(--dsw-alias-label-primary)}.wsp-item-title code{font-family:var(--ds-font-family-code);font-size:12px}.wsp-item-meta{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wsp-item-actions{display:flex;flex:none;align-items:center;gap:6px}.wsp-empty{margin:0;padding:12px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.wsp-compare{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.wsp-compare-col{display:flex;flex-direction:column;gap:6px;min-width:0}.wsp-compare-col>label,.wsp-compare-col>strong{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.wsp-preview{margin:0;padding:9px 10px;max-height:280px;overflow:auto;border:1px dashed var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-family:var(--ds-font-family-code);font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}
.wsp-dialog-body{display:flex;flex-direction:column;gap:14px;min-width:0}.wsp-dialog-body .wsp-row{padding:8px 0}.wsp-stack{display:flex;flex-direction:column;gap:8px}
div.wsp-modal{width:min(560px,100%);max-height:100%}div.wsp-modal-wide{width:min(980px,100%)}.wsp-modal-content{min-height:0;overflow:auto}div.wsp-modal{gap:16px}
.wsp-savebar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:4px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.wsp-savebar[data-wsp-floating]{position:sticky;bottom:0;z-index:2;box-shadow:0 -6px 16px -8px rgba(0,0,0,.35)}.wsp-save-text{display:flex;flex-direction:column;gap:2px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary)}.wsp-save-text .wsp-bad{margin:0}
.wsp-fold{margin-top:6px;border-top:1px solid var(--dsw-alias-border-l1)}.wsp-fold>summary{list-style:none;display:flex;align-items:center;gap:6px;padding:10px 0;cursor:pointer;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}.wsp-fold>summary::-webkit-details-marker{display:none}.wsp-fold>summary::before{content:'';width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .16s}.wsp-fold[open]>summary::before{transform:rotate(45deg)}.wsp-fold>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.wsp-fold-body{display:flex;flex-direction:column}.wsp-fold-hint{font-weight:400;color:var(--dsw-alias-label-tertiary)}
.wsp-secret-row{display:flex;align-items:center;gap:8px;min-width:0}.wsp-secret-row .wsp-input{flex:1}.wsp-chain{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin:0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:12px;color:var(--dsw-alias-label-secondary)}.wsp-chain code{font-family:var(--ds-font-family-code);font-size:12px;color:var(--dsw-alias-label-primary)}
.wsp-code-block{margin:6px 0;padding:9px 11px;border-radius:8px;overflow:auto;font-family:var(--ds-font-family-code);font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);user-select:all}
.wsp-table{width:100%;border-collapse:collapse;font-size:12px;line-height:1.5}.wsp-table th,.wsp-table td{padding:5px 8px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary)}.wsp-table th{font-weight:500;color:var(--dsw-alias-label-primary)}.wsp-table td:first-child{color:var(--dsw-alias-label-primary);white-space:nowrap}
.wsp-order-no{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 4px;box-sizing:border-box;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary)}.wsp-order-default .wsp-order-no,.wsp-order-default .wsp-item-title strong{opacity:.6}
.wsp-input.wsp-sm{height:28px;width:68px;padding:0 8px;font-size:12px}.wsp-input.wsp-sm.wsp-num{max-width:68px}
.wsp-order-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px}.wsp-order-bar .wsp-select{width:auto;min-width:180px;max-width:100%}
.wsp-why{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.wsp-why strong{font-weight:500;color:var(--dsw-alias-label-secondary)}
.wsp-tokens{display:flex;flex-direction:column;gap:6px}.wsp-token-row{display:flex;align-items:center;gap:6px;min-width:0}.wsp-token-row .wsp-input{flex:1}.wsp-token-row .wsp-token-no{flex:none;width:16px;font-size:11px;text-align:right;color:var(--dsw-alias-label-tertiary)}
.wsp-trial-out{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);min-width:0}.wsp-trial-out strong{font-size:12px;font-weight:600}.wsp-trial-out pre{align-self:stretch;margin:0}.wsp-trial-out ul{margin:0;padding-left:18px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}.wsp-trial-out li{overflow-wrap:anywhere}
.wsp-allowed{font-size:12px}.wsp-trial-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.wsp-trial-bar .wsp-input{flex:1;min-width:160px}
.wsp-conf{display:inline-flex;align-items:center;gap:4px;flex:none;min-width:0}.wsp-conf-label{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}.wsp-conf-on .wsp-conf-label{color:var(--dsw-alias-label-secondary);font-weight:500}.wsp-conf .wsp-input.wsp-sm{width:56px}.wsp-conf-on .wsp-input.wsp-sm{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);font-weight:500}.wsp-conf .wsp-input.wsp-sm[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}
.wsp-conf-quiet{appearance:none;display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border:1px dashed var(--dsw-alias-border-l2);border-radius:999px;background:transparent;font:inherit;font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:pointer;white-space:nowrap}.wsp-conf-quiet span{opacity:.85}.wsp-conf-quiet:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-style:solid}.wsp-conf-quiet:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.wsp-conf-quiet:disabled{opacity:.55;cursor:default}
.wsp-agent{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 8px}.wsp-agent-tag{display:inline-flex;cursor:default}.wsp-agent-tag:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:6px}
.wsp-agent-row+.wsp-agent-row{border-top:1px solid var(--dsw-alias-border-l1)}.wsp-agent-row .wsp-item-meta{white-space:normal;overflow-wrap:anywhere}.wsp-agent-row .wsp-item-meta>div{margin-top:1px}
.wsp-restart{display:inline-flex;align-items:center;gap:4px}.wsp-bad-soft{font-size:12px;color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))}
.wsp-filter{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:4px 0 8px}.wsp-filter .wsp-input{flex:1;min-width:140px;max-width:280px;height:30px}.wsp-fold .wsp-list{margin-bottom:8px}
@container (max-width:560px){.wsp-order-row .wsp-item-main{flex:1 1 100%}.wsp-order-row .wsp-item-actions{margin-left:auto;flex-wrap:wrap;justify-content:flex-end;max-width:100%}.wsp-agent-row .wsp-item-main{flex:1 1 100%}.wsp-agent-row .wsp-item-actions{margin-left:0}.wsp-row{grid-template-columns:minmax(0,1fr)}.wsp-row-control.wsp-inline{justify-content:flex-start}.wsp-compare{grid-template-columns:minmax(0,1fr)}.wsp-group-sub{white-space:normal}.wsp-item{flex-wrap:wrap}.wsp-savebar{flex-wrap:wrap}.wsp-savebar .wsp-actions{margin-left:auto}}
@media(max-width:560px){.wsp-order-row .wsp-item-main{flex:1 1 100%}.wsp-order-row .wsp-item-actions{margin-left:auto;flex-wrap:wrap;justify-content:flex-end;max-width:100%}.wsp-agent-row .wsp-item-main{flex:1 1 100%}.wsp-agent-row .wsp-item-actions{margin-left:0}.wsp-order-bar .wsp-select{width:100%}.wsp-compare{grid-template-columns:minmax(0,1fr)}div.wsp-modal{width:100%}.wsp-row{grid-template-columns:minmax(0,1fr)}.wsp-row-control.wsp-inline{justify-content:flex-start}.wsp-secret-row{flex-wrap:wrap}.wsp-item{flex-wrap:wrap}}
`;
			document.head.append(style);
		}
		//#endregion
		//#region src/client/ui-kit.tsx
		/**
		* The small set of controls the settings card is made of.
		*
		* Switches, buttons, badges, dialogs and the click-to-read help bubble are the Host's own
		* (`@deepseek-ai/dsh-client-ui-primitives`). The Host ships no select, no chip input, no accordion and no
		* list-row, so those four are built here from native elements (`<select>`, `<details>`, `<input>`) and the
		* `--dsw-alias-*` tokens, which makes them follow the light and dark themes without a color of their own.
		* Nothing in this file knows about a configuration field: callers pass text and callbacks.
		* @module web-search-pro/client/ui-kit
		*/
		/** A read-only badge. */
		function Badge(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
				tone: props.tone ?? "neutral",
				children: props.children
			});
		}
		/** The mark of a setting an agent changed: a warning badge whose tooltip carries the value, the reason and the time. */
		function AgentTag(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: props.tip,
				portal: true,
				maxWidth: 360,
				side: "top",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "wsp-agent-tag",
					tabIndex: 0,
					"aria-label": props.tip,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: "warning",
						children: props.label
					})
				})
			});
		}
		/** The `?` button: its text opens on click, so a long explanation costs one glyph until someone asks. */
		function Help(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: props.text,
				openOnClick: true,
				portal: true,
				maxWidth: 360,
				side: "top",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: styles.help,
					"aria-label": props.label,
					"data-wsp-help": true,
					children: "?"
				})
			});
		}
		/** One setting: label, one-line hint, an optional `?`, the "overridden" badge with its reset, and the control. */
		function Row(props) {
			const { labels } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${styles.row} ${props.wide ? "wsp-row-wide" : ""}`,
				"data-wsp-field": props.field,
				"data-wsp-overridden": props.overridden ? "true" : void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.rowText,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.rowLabel,
							children: [
								props.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									htmlFor: props.id,
									children: props.label
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.label }),
								props.help ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Help, {
									label: labels.help,
									text: props.help
								}) : null,
								props.risk ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
									tone: "warning",
									children: props.risk
								}) : null,
								props.restart ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "wsp-restart",
									"data-wsp-restart": props.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
										tone: props.restart.touched ? "warning" : "outline",
										children: props.restart.badge
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Help, {
										label: labels.help,
										text: props.restart.why
									})]
								}) : null,
								props.mark,
								props.overridden ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
									tone: "info",
									children: labels.overridden
								}) : null,
								props.overridden && props.onReset ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: styles.link,
									disabled: props.disabled,
									onClick: props.onReset,
									"data-wsp-reset": props.field,
									children: labels.reset
								}) : null
							]
						}),
						props.invalid && props.problem ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: `${styles.rowHint} wsp-bad`,
							role: "alert",
							children: props.problem
						}) : props.hint || props.meta ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: styles.rowHint,
							children: [props.hint, props.meta ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: styles.rowMeta,
								children: [props.hint ? " · " : "", props.meta]
							}) : null]
						}) : null,
						props.warning ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: styles.rowHint,
							role: "note",
							"data-wsp-warning": true,
							children: ["! ", props.warning]
						}) : null
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: `${styles.rowControl} ${props.inline ? "wsp-inline" : ""}`,
					children: props.children
				})]
			});
		}
		/** A closed-by-default fold inside a group, for the items few people need. */
		function Fold(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: styles.fold,
				"data-wsp-fold": props.id,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [props.title, props.hint ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: styles.foldHint,
					children: [" · ", props.hint]
				}) : null] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: styles.foldBody,
					children: props.children
				})]
			});
		}
		/** A small heading inside a group, for sets of rows that belong together. */
		function SubHead(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: styles.subHead,
				role: "presentation",
				children: props.children
			});
		}
		/**
		* One group of the card, an accordion item. `<details>` keeps every control in the document while the group is
		* closed (so a server-rendered check still sees them) and gives keyboard and screen-reader behavior for free.
		*/
		function Group(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: styles.group,
				open: props.defaultOpen ? true : void 0,
				"data-wsp-group": props.id,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
					className: styles.groupHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: styles.groupTitle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: props.title }), props.summary ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: styles.groupSub,
							children: props.summary
						}) : null]
					}), props.badges ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: styles.groupBadges,
						children: props.badges
					}) : null]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: styles.groupBody,
					children: props.children
				})]
			});
		}
		/**
		* A native select. A stored value that is not among the options (a channel the list does not know, an older
		* enum value) is shown as its own entry instead of being silently replaced by the first option.
		*/
		function Select(props) {
			const options = props.options.some((option) => option.value === props.value) || props.value === "" ? props.options : [{
				value: props.value,
				label: props.value
			}, ...props.options];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
				id: props.id,
				className: `${styles.select} ${props.muted ? styles.muted : ""}`,
				value: props.value,
				disabled: props.disabled,
				"aria-label": props.ariaLabel,
				"aria-invalid": props.invalid || void 0,
				onChange: (event) => props.onChange(event.currentTarget.value),
				children: options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
					value: option.value,
					children: option.label
				}, option.value))
			});
		}
		/** A single-line text input; `muted` greys the value while it is only the inherited default. */
		function TextInput(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
				id: props.id,
				type: "text",
				className: `${styles.input} ${props.muted ? styles.muted : ""} ${props.invalid ? styles.invalidInput : ""} ${props.code ? styles.code : ""} ${props.numeric ? "wsp-num" : ""} ${props.small ? "wsp-sm" : ""}`,
				value: props.value,
				placeholder: props.placeholder,
				disabled: props.disabled,
				list: props.list,
				inputMode: props.numeric ? "numeric" : void 0,
				spellCheck: false,
				"aria-label": props.ariaLabel,
				"aria-invalid": props.invalid || void 0,
				autoFocus: props.autoFocus,
				onBlur: props.onBlur,
				onChange: (event) => props.onChange(event.currentTarget.value)
			});
		}
		/** A text input followed by a fixed unit. */
		function UnitInput(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: styles.unitInput,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
					id: props.id,
					value: props.value,
					onChange: props.onChange,
					placeholder: props.placeholder,
					disabled: props.disabled,
					muted: props.muted,
					invalid: props.invalid,
					numeric: true,
					ariaLabel: props.ariaLabel
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: styles.unit,
					children: props.unit
				})]
			});
		}
		/** The Host's switch, named by its row. */
		function Toggle(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				label: props.label,
				checked: props.checked,
				disabled: props.disabled,
				onChange: props.onChange
			});
		}
		/** A list of short strings as removable chips with an add box (Enter or comma adds; Backspace on an empty box removes the last). */
		function Chips(props) {
			const [draft, setDraft] = (0, react.useState)("");
			const [problem, setProblem] = (0, react.useState)();
			const commit = (raw) => {
				const value = raw.trim();
				if (value === "") {
					setDraft("");
					setProblem(void 0);
					return;
				}
				const refused = props.check?.(value, props.values);
				if (refused) {
					setProblem(refused);
					return;
				}
				if (!props.values.includes(value)) props.onChange([...props.values, value]);
				setDraft("");
				setProblem(void 0);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.stack,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.chips,
					"data-wsp-chips": true,
					children: [props.values.map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: styles.chip,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: value }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: styles.chipRemove,
							disabled: props.disabled,
							"aria-label": `${props.removeLabel}: ${value}`,
							onClick: () => props.onChange(props.values.filter((entry) => entry !== value)),
							children: "×"
						})]
					}, value)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: props.id,
						className: styles.chipInput,
						value: draft,
						placeholder: props.placeholder,
						disabled: props.disabled,
						"aria-label": props.addLabel,
						spellCheck: false,
						onChange: (event) => {
							const text = event.currentTarget.value;
							if (text.endsWith(",")) commit(text.slice(0, -1));
							else setDraft(text);
						},
						onBlur: () => {
							if (draft.trim() !== "") commit(draft);
						},
						onKeyDown: (event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								commit(draft);
							} else if (event.key === "Backspace" && draft === "" && props.values.length) props.onChange(props.values.slice(0, -1));
						}
					})]
				}), problem ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: `${styles.rowHint} wsp-bad`,
					role: "alert",
					children: problem
				}) : null]
			});
		}
		/** A dialog on the Host's modal: a title, a scrolling body, and a footer of actions. */
		function Dialog(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: props.open,
				onClose: props.onClose,
				title: props.title,
				closeLabel: props.closeLabel,
				description: props.description,
				footer: props.footer,
				className: `wsp-modal ${props.wide ? "wsp-modal-wide" : ""}`,
				contentClassName: "wsp-modal-content",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: styles.dialogBody,
					children: props.children
				})
			});
		}
		/** Primary and secondary buttons at the card's size. */
		function Btn(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: props.primary ? "primary" : "outline",
				size: "sm",
				disabled: props.disabled,
				title: props.title,
				"aria-label": props.ariaLabel,
				className: props.danger ? styles.danger : void 0,
				onClick: props.onClick,
				"data-wsp-action": props.data,
				children: props.children
			});
		}
		/** A list row: a title with badges, a meta line, and actions on the right. */
		function Item(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.item,
				"data-wsp-item": props.data,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.itemMain,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: styles.itemTitle,
						children: [props.title, props.badges]
					}), props.meta ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: styles.itemMeta,
						children: props.meta
					}) : null]
				}), props.actions ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: styles.itemActions,
					children: props.actions
				}) : null]
			});
		}
		/** A write-only secret input: it never shows a stored value, only whether one is configured. */
		function SecretInput(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: styles.secretRow,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					id: props.id,
					type: "password",
					className: styles.input,
					autoComplete: "new-password",
					value: props.value,
					placeholder: props.status,
					disabled: props.disabled,
					spellCheck: false,
					"aria-label": props.ariaLabel,
					onChange: (event) => props.onChange(event.currentTarget.value)
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
					tone: props.configured ? "success" : "neutral",
					children: props.status
				})]
			});
		}
		//#endregion
		//#region src/client/agent-mark.tsx
		/** The overlay item of a key in the card's state, or undefined. */
		function useOverlayItem(card, key) {
			return card.useWebSearchPro((snapshot) => snapshot.server.overlay.view?.items.find((item) => item.key === key));
		}
		/** One sentence for the tooltip: the value the agent set, the one in the configuration, the reason, who and when. */
		function agentTip(t, item) {
			const who = item.actor === "user" ? t("agentActorUser") : t("agentActorAgent");
			return fill(t("agentTip"), {
				value: item.summary,
				baseline: item.baseline,
				reason: item.reason ?? t("agentNoReason"),
				at: item.at ? formatTime(item.at) : "",
				who
			});
		}
		/**
		* `compact` shows the tag only (list rows have no room for buttons; the "Agent changes" group holds them); otherwise the tag is followed
		* by "Adopt into configuration" and "Revoke".
		*/
		function AgentMark({ card, itemKey, compact }) {
			const { t } = card;
			const item = useOverlayItem(card, itemKey);
			const busy = card.useWebSearchPro((snapshot) => !snapshot.writable || snapshot.saving || snapshot.server.overlay.busy);
			if (!item) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "wsp-agent",
				"data-wsp-agent": itemKey,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentTag, {
					label: t("agentBadge"),
					tip: agentTip(t, item)
				}), compact ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: styles.link,
					disabled: busy,
					onClick: () => card.adoptOverlay(itemKey),
					"data-wsp-agent-adopt": itemKey,
					children: t("agentAdopt")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: styles.link,
					disabled: busy,
					onClick: () => card.revokeOverlay([itemKey]),
					"data-wsp-agent-revoke": itemKey,
					children: t("agentRevoke")
				})] })]
			});
		}
		//#endregion
		//#region src/client/field-rows.tsx
		function rowLabels(t) {
			return {
				overridden: t("overridden"),
				reset: t("reset"),
				help: t("helpLabel"),
				invalid: t("invalid")
			};
		}
		/** The id of a field's control, tied to its label. */
		const controlId = (field) => `web-search-pro-${field}`;
		/** The units a number field is written with. */
		const UNIT_KEYS = {
			ms: "unitMs",
			sec: "unitSeconds",
			chars: "unitChars",
			count: "unitCount",
			tokens: "unitTokens",
			days: "unitDays",
			rounds: "unitCount"
		};
		/** How many of these fields carry an override: the number a group's badge shows. */
		function useOverriddenCount(card, fields) {
			return card.useWebSearchPro((snapshot) => fields.filter((field) => snapshot.fields[field]?.overridden).length);
		}
		/** The staged state of a field. */
		const stateOf = (snapshot, field) => snapshot.fields[field];
		function useField(card, field) {
			return {
				state: card.useWebSearchPro((snapshot) => stateOf(snapshot, field)),
				disabled: card.useWebSearchPro((snapshot) => !snapshot.writable || snapshot.saving),
				edit: (text) => card.edit(field, text),
				reset: () => card.resetField(field)
			};
		}
		function rowFor(props, field, children, extra = {}) {
			const { card } = props;
			const { t } = card;
			const touched = card.useWebSearchPro((snapshot) => snapshot.restartTouched.includes(props.field));
			const key = labelKey(props.field);
			const st = field.state;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
				field: props.field,
				id: extra.id,
				label: props.label ?? t(key),
				hint: props.hint ?? t(`${key}Hint`),
				help: hasHelp(props.field) ? t(`${key}Help`) : void 0,
				risk: props.risk,
				restart: isRestartField(props.field) ? {
					badge: t("restartBadge"),
					why: t(restartWhyKey(props.field)),
					touched
				} : void 0,
				mark: overlayKeyOfField(props.field) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentMark, {
					card,
					itemKey: overlayKeyOfField(props.field)
				}) : void 0,
				overridden: st.overridden,
				invalid: st.invalid || !!st.message,
				problem: st.message ?? t("invalid"),
				warning: st.warning,
				disabled: field.disabled,
				labels: rowLabels(t),
				onReset: field.reset,
				inline: extra.inline,
				wide: extra.wide,
				children
			});
		}
		/** A boolean field as a switch. */
		function SwitchRow(props) {
			const field = useField(props.card, props.field);
			const label = props.label ?? props.card.t(labelKey(props.field));
			return rowFor(props, field, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Toggle, {
				label,
				checked: field.state.text === "true",
				disabled: field.disabled,
				onChange: (next) => field.edit(String(next))
			}), { inline: true });
		}
		/** An enumerated field as a drop-down. */
		function SelectRow(props) {
			const field = useField(props.card, props.field);
			const id = controlId(props.field);
			return rowFor(props, field, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Select, {
				id,
				value: field.state.text,
				options: props.options,
				disabled: field.disabled,
				muted: !field.state.overridden,
				invalid: field.state.invalid,
				onChange: field.edit
			}), { id });
		}
		/** A free-text field. */
		function TextRow(props) {
			const field = useField(props.card, props.field);
			const id = controlId(props.field);
			return rowFor(props, field, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
				id,
				value: field.state.text,
				placeholder: props.placeholder,
				code: props.code,
				disabled: field.disabled,
				muted: !field.state.overridden,
				invalid: field.state.invalid,
				onChange: field.edit
			}), { id });
		}
		/** A number field with its unit written after the input. */
		function NumberRow(props) {
			const field = useField(props.card, props.field);
			const id = controlId(props.field);
			return rowFor(props, field, props.unit ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnitInput, {
				id,
				value: field.state.text,
				unit: props.card.t(UNIT_KEYS[props.unit]),
				placeholder: props.placeholder,
				disabled: field.disabled,
				muted: !field.state.overridden,
				invalid: field.state.invalid,
				onChange: field.edit
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
				id,
				value: field.state.text,
				placeholder: props.placeholder,
				numeric: true,
				disabled: field.disabled,
				muted: !field.state.overridden,
				invalid: field.state.invalid,
				onChange: field.edit
			}), { id });
		}
		const parseList = (text) => [...new Set(text.split(",").map((item) => item.trim()).filter(Boolean))];
		/** A comma-separated list (engine ids, domains) as removable chips with an add box. */
		function ListRow(props) {
			const field = useField(props.card, props.field);
			const id = controlId(props.field);
			const { t } = props.card;
			return rowFor(props, field, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chips, {
				id,
				values: parseList(field.state.text),
				placeholder: props.placeholder,
				disabled: field.disabled,
				removeLabel: t("chipRemove"),
				addLabel: t(labelKey(props.field)),
				onChange: (values) => field.edit(values.join(", "))
			}), {
				id,
				wide: true
			});
		}
		//#endregion
		//#region src/client/card-frame.tsx
		/**
		* The frame around the groups: the status summary on top (with the warnings dialog) and the save bar at the bottom.
		*
		* The Host's `SettingsForm` offers one save button below the controls. This card needs the bar to stay in view while a long
		* page scrolls, to say how many edits are waiting, and to offer "Discard", so the frame is built here; the behaviors a
		* settings form has are kept: it says so when the settings are not served or read-only, and it drops the staged edits when
		* the page is left.
		* @module web-search-pro/client/card-frame
		*/
		/** Sources whose key is a credential the card can see (searxng and the like have none). */
		const KEYED_DEFS = SOURCE_DEFS.filter((def) => def.credential);
		/** What the default chain rule reads from the staged settings: the list, the preferences, the ready common sources, the policy. */
		function chainInputOf(snapshot) {
			const text = (field) => snapshot.fields[field]?.text ?? "";
			const commonReady = SOURCE_DEFS.filter((def) => def.common && def.credential && COMMON_SOURCE_IDS.includes(def.id) && snapshot.credentials[def.credential]?.configured).map((def) => def.id);
			return {
				engines: parseList(text("engines")),
				priority: parseList(text("sources.priority")),
				disabled: parseList(text("sources.disabled")),
				commonReady,
				anonymousOnly: text("evidence.sourcePolicy") === "anonymous-only"
			};
		}
		/** The chain a plain search would try, from the staged settings; undefined when the draft leaves nothing to try. */
		function chainOf(snapshot) {
			try {
				return effectiveChain(chainInputOf(snapshot));
			} catch {
				return;
			}
		}
		/**
		* The chain a plain search tries once the agent's changes (engines, priority, disabled of the overlay) are on top of the staged settings,
		* by the same rule; undefined while the agent changed none of the three, an empty list when it would leave nothing to try.
		*/
		function agentChainOf(snapshot) {
			const items = snapshot.server.overlay.view?.items ?? [];
			const listOf = (key) => {
				const value = items.find((item) => item.key === key)?.value;
				return Array.isArray(value) ? value.filter((id) => typeof id === "string") : void 0;
			};
			const engines = listOf("engines");
			const priority = listOf("sources.priority");
			const disabled = listOf("sources.disabled");
			if (!engines && !priority && !disabled) return void 0;
			const base = chainInputOf(snapshot);
			try {
				return effectiveChain({
					...base,
					engines: engines ?? base.engines,
					priority: priority ?? base.priority,
					disabled: disabled ?? base.disabled
				});
			} catch {
				return [];
			}
		}
		/** Everything the warnings badge counts: what the validation says about a field, and the rubric problems. */
		function warningsOf(snapshot, t) {
			const out = [];
			for (const [field, state] of Object.entries(snapshot.fields)) {
				if (field.startsWith("evidence.rubrics.")) continue;
				const name = field.startsWith("keyedSources.") || field.startsWith("sources.budget.") ? field : t(labelKey(field));
				if (state.message) out.push(name + ": " + state.message);
				if (state.warning) out.push(name + ": " + state.warning);
			}
			for (const rubric of snapshot.rubrics) for (const problem of rubric.problems) out.push(rubric.id + ": " + problem);
			for (const entry of snapshot.server.status?.pendingRestart ?? []) out.push(entry.field + ": " + fill(t("pendingRestartLine"), {
				running: entry.running || t("pendingEmpty"),
				configured: entry.configured || t("pendingEmpty")
			}));
			if (snapshot.unknownRubrics.length) out.push(t("rubricUnknown") + " " + snapshot.unknownRubrics.join(", "));
			return out;
		}
		const JUDGE_TONE = {
			off: "neutral",
			shadow: "info",
			control: "warning",
			hybrid: "warning"
		};
		function SummaryBar({ card }) {
			const { t } = card;
			const [open, setOpen] = (0, react.useState)(false);
			const view = card.useWebSearchPro((snapshot) => ({
				chain: chainOf(snapshot)?.join(" › ") ?? "",
				keyed: KEYED_DEFS.filter((def) => snapshot.credentials[def.credential]?.configured).length,
				common: SOURCE_DEFS.filter((def) => def.common).map((def) => ({
					id: def.id,
					name: def.name,
					ready: !!snapshot.credentials[def.credential]?.configured
				})),
				route: snapshot.fields.registerProvider.text === "true",
				surface: snapshot.fields.toolSurface.text || "indexed",
				judge: snapshot.fields["evidence.judge.mode"].text || "off",
				pending: snapshot.server.status?.pendingRestart ?? [],
				agent: snapshot.server.overlay.view?.items.length ?? 0,
				warnings: warningsOf(snapshot, t)
			}));
			const chain = view.chain.split(" › ");
			const shown = chain.length > 5 ? [...chain.slice(0, 5), "…"] : chain;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.summaryBar,
				role: "group",
				"aria-label": t("summaryTitle"),
				"data-wsp-summary": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("summaryTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Badge, {
						tone: "neutral",
						children: [
							t("summaryChain"),
							" ",
							view.chain ? shown.join(" › ") : t("summaryChainEmpty")
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: view.keyed ? "success" : "neutral",
						children: fill(t("summaryKeys"), {
							n: view.keyed,
							m: KEYED_DEFS.length
						})
					}),
					view.common.map((source) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Badge, {
						tone: source.ready ? "success" : "warning",
						children: [
							source.name,
							" · ",
							t("commonBadge"),
							" · ",
							source.ready ? t("summaryReady") : t("summaryNoKey")
						]
					}, source.id)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: view.route ? "info" : "neutral",
						children: view.route ? t("summaryRouteOn") : t("summaryRouteOff")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Badge, {
						tone: JUDGE_TONE[view.judge] ?? "neutral",
						children: [
							t("summaryJudge"),
							" ",
							view.judge
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Badge, {
						tone: "neutral",
						children: [
							t("summarySurface"),
							" ",
							view.surface
						]
					}),
					view.agent ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: styles.link,
						onClick: () => {
							const node = document.querySelector("[data-wsp-group=\"agent\"]");
							if (node) {
								node.open = true;
								node.scrollIntoView?.({
									block: "start",
									behavior: "smooth"
								});
							}
						},
						"data-wsp-agent-summary": view.agent,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
								tone: "warning",
								children: fill(t("summaryAgent"), { n: view.agent })
							}),
							" · ",
							t("summaryAgentOpen")
						]
					}) : null,
					view.pending.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"data-wsp-pending-restart": view.pending.map((entry) => entry.field).join(","),
						title: view.pending.map((entry) => entry.field + ": " + fill(t("pendingRestartLine"), {
							running: entry.running || t("pendingEmpty"),
							configured: entry.configured || t("pendingEmpty")
						})).join("\n"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Badge, {
							tone: "warning",
							children: [
								fill(t("summaryPendingRestart"), { n: view.pending.length }),
								": ",
								view.pending.map((entry) => entry.field).join(", ")
							]
						})
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: styles.link,
						onClick: () => setOpen(true),
						"data-wsp-warnings-count": view.warnings.length,
						children: [
							view.warnings.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
								tone: "warning",
								children: fill(t("summaryWarnings"), { n: view.warnings.length })
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.muted,
								children: t("summaryNoWarnings")
							}),
							" · ",
							t("summaryDetails")
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dialog, {
						open,
						title: t("warningsTitle"),
						closeLabel: t("close"),
						onClose: () => setOpen(false),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							onClick: () => setOpen(false),
							primary: true,
							children: t("close")
						}),
						children: view.warnings.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: styles.rowHint,
							children: t("warningsNone")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							"data-wsp-warning-list": true,
							children: view.warnings.map((warning, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: warning }, index))
						})
					})
				]
			});
		}
		function SaveBar({ card }) {
			const { t } = card;
			const state = card.useWebSearchPro((snapshot) => snapshot);
			const count = state.changes;
			const blocked = !state.dirty || state.invalid || state.saving || !state.writable;
			const floating = state.dirty || state.saving || state.failed;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.savebar,
				role: "region",
				"aria-label": t("save"),
				"data-wsp-savebar": true,
				"data-wsp-floating": floating ? "" : void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.saveText,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"data-wsp-unsaved": count,
							children: state.invalid ? t("savebarInvalid") : count ? fill(t("savebarDirty"), { n: count }) : t("savebarClean")
						}),
						state.restartTouched.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wsp-bad-soft",
							role: "note",
							"data-wsp-restart-note": state.restartTouched.join(","),
							children: fill(t("savebarRestart"), { fields: state.restartTouched.join(", ") })
						}) : null,
						state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wsp-bad",
							role: "status",
							children: t("saveFailed")
						}) : null
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.actions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
						onClick: card.discard,
						disabled: !state.dirty || state.saving,
						data: "discard",
						children: t("discardChanges")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
						primary: true,
						onClick: card.save,
						disabled: blocked,
						data: "save",
						children: state.saving ? t("saving") : t("save")
					})]
				})]
			});
		}
		/** The page frame: nothing but a notice while the settings are not served; the staged edits are dropped when the page is left. */
		function Frame({ card, children }) {
			const { t } = card;
			const state = card.useWebSearchPro((snapshot) => ({
				available: snapshot.available,
				writable: snapshot.writable
			}));
			const discard = (0, react.useRef)(card.discard);
			discard.current = card.discard;
			(0, react.useEffect)(() => () => {
				discard.current();
			}, []);
			if (!state.available) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: styles.notice,
				role: "status",
				children: t("unavailable")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.root,
				"data-wsp-root": true,
				"data-web-search-pro-settings": true,
				children: [!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: styles.notice,
					role: "status",
					children: t("readOnly")
				}) : null, children]
			});
		}
		//#endregion
		//#region src/client/json-list.tsx
		/**
		* The settings that are whole JSON objects (custom providers, platform backend chains, CLI adapters, custom platforms, ...) as a
		* list: a row each (name, how many entries it holds, "default" while it is empty) and one dialog with a code box and the
		* server's own validation message. Nothing here is a second place the data lives: the box edits the same staged field.
		* @module web-search-pro/client/json-list
		*/
		/** How many entries a JSON object text holds; undefined when it is not an object. */
		function entryCount(text) {
			if (text.trim() === "") return 0;
			try {
				const value = JSON.parse(text);
				return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : void 0;
			} catch {
				return;
			}
		}
		/** The code box of one JSON field. */
		function JsonForm({ card, field }) {
			const { t } = card;
			const f = useField(card, field);
			const key = labelKey(field);
			const id = `web-search-pro-${field}`;
			const st = f.state;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
				field,
				id,
				label: t(key),
				hint: t(`${key}Hint`),
				help: hasHelp(field) ? t(`${key}Help`) : void 0,
				overridden: st.overridden,
				invalid: st.invalid || !!st.message,
				problem: st.message ?? t("invalidJson"),
				warning: st.warning,
				disabled: f.disabled,
				labels: rowLabels(t),
				onReset: f.reset,
				wide: true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
					id,
					className: `${styles.input} ${styles.textarea} ${styles.code} ${st.invalid ? styles.invalidInput : ""}`,
					rows: 12,
					spellCheck: false,
					value: st.text,
					disabled: f.disabled,
					"aria-invalid": st.invalid || void 0,
					onChange: (event) => f.edit(event.currentTarget.value)
				})
			});
		}
		function JsonItem({ card, field, onEdit }) {
			const { t } = card;
			const st = card.useWebSearchPro((snapshot) => stateOf(snapshot, field));
			const disabled = card.useWebSearchPro((snapshot) => !snapshot.writable);
			const n = entryCount(st.text);
			const key = labelKey(field);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Item, {
				data: field,
				title: t(key),
				badges: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: st.invalid ? "danger" : st.overridden ? "info" : "outline",
						children: st.invalid ? t("invalid") : st.overridden ? t("overridden") : t("promptStateDefault")
					}),
					n ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: "neutral",
						children: fill(t("jsonEntries"), { n })
					}) : null,
					field === "playwright" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "wsp-restart",
						"data-wsp-restart": "playwright.snapshotDir",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
							tone: "outline",
							children: t("restartBadgeSnapshot")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Help, {
							label: t("helpLabel"),
							text: t("restartWhyPlaywright")
						})]
					}) : null
				] }),
				meta: t(`${key}Hint`),
				actions: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
					disabled,
					onClick: onEdit,
					data: "json-edit",
					children: t("edit")
				})
			});
		}
		/** A list of JSON-object settings with its dialog. `fields` names which ones (see JSON_FIELDS). */
		function JsonList({ card, fields }) {
			const { t } = card;
			const [editing, setEditing] = (0, react.useState)();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: styles.list,
				"data-wsp-json-list": true,
				children: fields.map((field) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JsonItem, {
					card,
					field,
					onEdit: () => setEditing(field)
				}, field))
			}), editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dialog, {
				open: true,
				wide: true,
				title: fill(t("jsonDialogTitle"), { name: t(labelKey(editing)) }),
				closeLabel: t("close"),
				description: t("jsonDialogHint"),
				onClose: () => setEditing(void 0),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
					primary: true,
					onClick: () => setEditing(void 0),
					data: "json-done",
					children: t("done")
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JsonForm, {
					card,
					field: editing
				})
			}) : null] });
		}
		/** The fields of one group of JSON settings. */
		const jsonFieldsOf = (group) => JSON_FIELDS.filter((entry) => entry.group === group).map((entry) => entry.field);
		//#endregion
		//#region src/client/field-docs.ts
		/**
		* The comment printed in front of every key of the text view ("Advanced: text mode"), in the language of the card: what the
		* setting is for, its allowed values or range, its default, and the risk when there is one. Comment lines start with `#`, so
		* the text stays valid YAML and a round trip never reads a comment as data. Pure (it imports only config-groups.ts): the text view and the
		* tests read it, and the client bundle includes it. Nothing here names a secret value: keys are only ever referenced by name.
		* @module web-search-pro/client/field-docs
		*/
		/** Display name of a source in the docs (proper names, the same in both languages). */
		const SOURCE_NAME = {
			deepseek: "DeepSeek Search / Fetch",
			bocha: "Bocha",
			tavily: "Tavily",
			brave: "Brave Search",
			linkup: "Linkup",
			serper: "Serper",
			metaso: "Metaso",
			zhipu: "Zhipu",
			"baidu-qianfan": "Baidu Qianfan"
		};
		const DOCS = {
			engines: {
				en: "Default engine chain of a plain search, tried in order: ids such as ddg, bing, exa, seam, jina. At least one. Default: ddg, bing, exa, seam, jina. While this is the default list a ready DeepSeek key puts deepseek first; a list you write is used as written.",
				zh: "普通搜索的默认引擎链，按顺序尝试：id 如 ddg、bing、exa、seam、jina，至少一个。默认 ddg, bing, exa, seam, jina。保持默认列表时，DeepSeek Key 就绪会把 deepseek 排最前；你自己写的列表按所写顺序。"
			},
			parallelEngines: {
				en: "true = query every default engine at once and merge by rank fusion | false = try them one after another. Default: false",
				zh: "true = 同时查询全部默认引擎并按排名融合 | false = 依次回退。默认 false"
			},
			searchMaxResults: {
				en: "Results per search when the call gives no count, 1-20. Default: 8",
				zh: "调用未指定 count 时的结果数，1–20。默认 8"
			},
			timeoutMs: {
				en: "Time budget of one enhanced search in milliseconds, at least 1000. Default: 30000",
				zh: "单次增强搜索的时间预算（毫秒），至少 1000。默认 30000"
			},
			fetchDefaultChars: {
				en: "Characters one read.fetch returns, 1000-500000; longer pages continue with offset. Default: 20000",
				zh: "read.fetch 单次返回的字数，1000–500000；更长的页面用 offset 续读。默认 20000"
			},
			exaContentsPerUrlChars: {
				en: "read.contents output per URL in characters, at least 500. Default: 8000",
				zh: "read.contents 每个 URL 的输出字数，至少 500。默认 8000"
			},
			exaContentsTotalChars: {
				en: "read.contents output of one call over all URLs, at least 1000. Default: 30000",
				zh: "read.contents 一次调用所有 URL 的输出字数总上限，至少 1000。默认 30000"
			},
			exaApiKeyEnv: {
				en: "Name of the DSH credential or environment variable holding the Exa key (the key itself is never stored here). Default: EXA_API_KEY",
				zh: "保存 Exa Key 的 DSH 凭据或环境变量名（Key 本身从不写在这里）。默认 EXA_API_KEY"
			},
			jinaApiKeyEnv: {
				en: "Name of the credential / environment variable holding the Jina key. Default: JINA_API_KEY",
				zh: "保存 Jina Key 的凭据 / 环境变量名。默认 JINA_API_KEY"
			},
			githubTokenEnv: {
				en: "Name of the credential / environment variable holding the GitHub token (raises the rate limit). Default: GITHUB_TOKEN",
				zh: "保存 GitHub Token 的凭据 / 环境变量名（只用来提高限额）。默认 GITHUB_TOKEN"
			},
			twitterAuthTokenEnv: {
				en: "Name of the credential / environment variable holding the twitter-cli auth_token cookie. Handed to the command only through its environment. Default: TWITTER_AUTH_TOKEN",
				zh: "保存 twitter-cli 的 auth_token 的凭据 / 环境变量名；只通过子进程环境变量交给命令。默认 TWITTER_AUTH_TOKEN"
			},
			twitterCt0Env: {
				en: "Name of the credential / environment variable holding the twitter-cli ct0 cookie. Default: TWITTER_CT0",
				zh: "保存 twitter-cli 的 ct0 的凭据 / 环境变量名。默认 TWITTER_CT0"
			},
			bochaApiKeyEnv: {
				en: "Name of the credential / environment variable holding the Bocha key; BOCHA_JEV_API_KEY is the fallback. Default: BOCHA_SEARCH_API_KEY",
				zh: "保存博查 Key 的凭据 / 环境变量名，找不到时回退 BOCHA_JEV_API_KEY。默认 BOCHA_SEARCH_API_KEY"
			},
			bochaBaseUrl: {
				en: "Bocha endpoint base (an http(s) URL; /v1/web-search is appended). Default: https://api.bocha.cn",
				zh: "博查接口地址（http(s) URL，/v1/web-search 会自动追加）。默认 https://api.bocha.cn"
			},
			bochaSummary: {
				en: "true = ask Bocha for its longer page summary (better for evidence scoring) | false. Default: true",
				zh: "true = 请求博查较长的页面摘要（更利于证据评分）| false。默认 true"
			},
			deepseekFetch: {
				en: "true = read.fetch may use the DeepSeek Fetch API (billed: $0.75 per 1,000 successful requests) after Jina and a direct request found no content, and mode=deepseek works | false. Risk: spends money. Default: false",
				zh: "true = read.fetch 在 Jina 与直连都没拿到正文时可用 DeepSeek Fetch API（按请求计费：每 1000 次成功请求 $0.75），mode=deepseek 可用 | false。风险：会花钱。默认 false"
			},
			searxngUrl: {
				en: "Your own SearXNG instance (JSON format enabled), http(s) URL; the searxng source exists only when this is set. Default: empty",
				zh: "你自己的 SearXNG 实例（需开启 JSON 格式），http(s) URL；设置后才有 searxng 来源。默认 空"
			},
			openalexMailto: {
				en: "Contact e-mail put in the User-Agent of OpenAlex requests (etiquette, optional). Default: empty",
				zh: "写进 OpenAlex 请求 User-Agent 的联系邮箱（礼貌性，可留空）。默认 空"
			},
			enableCliBackends: {
				en: "true = allow local CLI backends (bili, yt-dlp, OpenCLI, Agent Reach, ...) | false. Default: true",
				zh: "true = 允许本机 CLI 后端（bili、yt-dlp、OpenCLI、Agent Reach 等）| false。默认 true"
			},
			opencliEnabled: {
				en: "true = allow site adapters through the connected Chrome Browser Bridge | false. Default: true",
				zh: "true = 允许经 Chrome Browser Bridge 使用站点适配器 | false。默认 true"
			},
			agentReachEnabled: {
				en: "true = allow Agent Reach compatible backends | false. Default: true",
				zh: "true = 允许兼容 Agent Reach 的后端 | false。默认 true"
			},
			providerId: {
				en: "Id the plugin registers as the ctx.web provider; referenced by searchProvider / fetchProvider or DSH_WEB_SEARCH_PROVIDER. Default: web-search-pro",
				zh: "本插件注册为 ctx.web provider 的 id；被 searchProvider / fetchProvider 或 DSH_WEB_SEARCH_PROVIDER 引用。默认 web-search-pro"
			},
			registerProvider: {
				en: "true = register as the ctx.web provider so the built-in web_search / web_fetch can route through this plugin (takes effect at start-up; the host also needs the profile patch shown in the card) | false. Default: false",
				zh: "true = 注册为 ctx.web provider，让内置 web_search / web_fetch 可经本插件（启动时生效；宿主还需要卡片里给出的 profile patch）| false。默认 false"
			},
			toolSurface: {
				en: "Tools the model sees: indexed = web_index + web_call only (default, least resident text) | flat = one tool per action, for comparison and debugging. Read at start-up. Default: indexed",
				zh: "模型看到的工具形态：indexed = 只有 web_index + web_call（默认，常驻文本最少）| flat = 每个动作一个工具，仅用于对比与调试。启动时读取。默认 indexed"
			},
			playwright: {
				en: "JSON object {\"enabled\": true|false, \"snapshotDir\": \"<absolute path>\"}: the browser-render fallback of read.fetch and the screenshot directory. Default: {\"enabled\": true}",
				zh: "JSON 对象 {\"enabled\": true|false, \"snapshotDir\": \"<绝对路径>\"}：read.fetch 的浏览器渲染回退与截图目录。默认 {\"enabled\": true}"
			},
			ttlSeconds: {
				en: "Seconds a cached search or page stays fresh; 0 = always stale. Default: 3600",
				zh: "缓存的搜索与页面保持新鲜的秒数；0 = 总是过期。默认 3600"
			},
			memoryCacheEntries: {
				en: "Capacity of the in-process LRU cache, at least 1. Default: 128",
				zh: "进程内 LRU 缓存容量，至少 1。默认 128"
			},
			rrfConstant: {
				en: "Smoothing constant k of the rank fusion 1/(k + rank), at least 1. Default: 60",
				zh: "排名融合 1/(k + 名次) 的平滑常数 k，至少 1。默认 60"
			},
			freshnessBoost: {
				en: "Bonus for recent results as a fraction of one rank step, 0-1; each URL gets it once. Default: 0.2",
				zh: "近期结果的加分，占一个排名名次的比例，0–1；每个 URL 只加一次。默认 0.2"
			},
			freshnessDays: {
				en: "Days over which the freshness bonus decays to zero, at least 1. Default: 30",
				zh: "新鲜度加分衰减到 0 的天数，至少 1。默认 30"
			},
			authorityBoost: {
				en: "Bonus for authority hosts as a fraction of one rank step, 0-1. Default: 0.25",
				zh: "权威域名的加分，占一个排名名次的比例，0–1。默认 0.25"
			},
			authorityDomains: {
				en: "Extra authority domains, comma separated, no scheme or path (github.com, wikipedia.org, .edu, .gov, .org already count). Default: empty",
				zh: "额外的权威域名，逗号分隔，不带协议和路径（github.com、wikipedia.org、.edu、.gov、.org 已内置）。默认 空"
			},
			dbPath: {
				en: "SQLite file of the cache and history; empty = the plugin default path. Default: empty",
				zh: "缓存与历史的 SQLite 文件；留空 = 插件默认路径。默认 空"
			},
			allowProxyFakeIp: {
				en: "true = trust DNS answers in the proxy fake-IP ranges (198.18.0.0/15, fdfe:dcba:9876::/64, 2001:2::/48) | false. Turn it on only when Clash/TUN makes searches fail with \"resolved to proxy fake-IP\". Literal fake-IP URLs, localhost and other private addresses stay blocked. Default: false",
				zh: "true = 信任代理 fake-IP 网段（198.18.0.0/15、fdfe:dcba:9876::/64、2001:2::/48）里的 DNS 结果 | false。仅在 Clash/TUN 让搜索报 “resolved to proxy fake-IP” 时打开。字面 fake-IP URL、localhost 与其他私网地址仍被拒绝。默认 false"
			},
			platformRules: {
				en: "JSON object: per platform the selectors {item, title, link, text?} used by the browser search page. Default: empty",
				zh: "JSON 对象：按平台给出浏览器搜索页用的选择器 {item, title, link, text?}。默认 空"
			},
			customPlatforms: {
				en: "JSON object: your own platforms, each {name, url template, item, title, link, text?}; a key may not reuse a built-in source id. Logins go through browserBindings, not here. Default: empty",
				zh: "JSON 对象：你自己的平台，每个 {name, url 模板, item, title, link, text?}；键不能和内置来源重名。登录态通过 browserBindings 引用，不写在这里。默认 空"
			},
			browserBindings: {
				en: "JSON object: bind a platform to a dsh-browser login profile and rule pack. Default: empty",
				zh: "JSON 对象：把平台绑定到 dsh-browser 的登录 profile 与规则包。默认 空"
			},
			platformBackends: {
				en: "JSON object: per platform the ordered backends to try, e.g. {\"xiaohongshu\": [\"xhs\", \"opencli\", \"browser-opencli\"]}. A backend that is missing or not logged in is skipped with its reason. Default: empty (built-in chains)",
				zh: "JSON 对象：按平台给出依次尝试的后端，如 {\"xiaohongshu\": [\"xhs\", \"opencli\", \"browser-opencli\"]}。缺失或未登录的后端会被跳过并说明原因。默认 空（用内置链）"
			},
			cliAdapters: {
				en: "JSON object: your own read-only CLI adapter specs by id (argv array, output fields, probe contract, allowedSubcommands). Write actions and cookie-reading flags are refused. Default: empty",
				zh: "JSON 对象：按 id 定义你自己的只读 CLI 适配规格（argv 数组、输出字段、探测契约、allowedSubcommands）。写操作与读取 Cookie 的参数会被拒绝。默认 空"
			},
			verbose: {
				en: "true = write a load marker and more run diagnostics | false. Default: false",
				zh: "true = 写入加载标记并输出更多运行诊断 | false。默认 false"
			},
			"evidence.autoProviders": {
				en: "true = ready sources strong in the task language (Bocha, Exa, DeepSeek, ...) go ahead of the profile table | false = the table and engines as they are. Default: true",
				zh: "true = 就绪且擅长任务语言的来源（博查、Exa、DeepSeek 等）排到 profile 表之前 | false = 完全按表与 engines。默认 true"
			},
			"evidence.sourcePolicy": {
				en: "default = the usual order | anonymous-only = automatic planning never uses a source that needs a key, account or login, even a configured one (a source named in the call still runs). Default: default",
				zh: "default = 通常顺序 | anonymous-only = 自动规划绝不使用需要 Key、账号或登录的来源（即使已配置；调用里明确指定的仍可用）。默认 default"
			},
			"evidence.maxRounds": {
				en: "Search rounds per task, at least 1; 1 = no follow-up search. Default: 2",
				zh: "每个任务的检索轮数，至少 1；1 = 不补搜。默认 2"
			},
			"evidence.maxQueries": {
				en: "Search requests per task over all rounds, at least 1. Default: 4",
				zh: "每个任务所有轮次的搜索请求数上限，至少 1。默认 4"
			},
			"evidence.judge.mode": {
				en: "Model scoring: off | shadow (record only) | control (the model decides) | hybrid (rules first, the model re-scores cross-language pairs). Writes the legacy keys jevMode / scorer too. Calls a paid model: check the key and the usage caps first. Default: off",
				zh: "模型评分：off | shadow（只记录对照）| control（由模型决定）| hybrid（规则为主，模型复评跨语言对）。同时写旧键 jevMode / scorer。会调用付费模型：开启前先确认 Key 与用量上限。默认 off"
			},
			"evidence.hybridBorderline": {
				en: "true = hybrid also hands rule-borderline pairs (grade 1) to the model; roughly doubles the cost | false. Default: false",
				zh: "true = hybrid 也把规则评分为 1 的边界对交给模型；成本约翻倍 | false。默认 false"
			},
			"evidence.judge.provider": {
				en: "Scoring provider id: a preset (bocha-jev, typesafe-jev, laya-local, jina-rerank, cohere-rerank) or one you define; empty = bocha-jev. Default: empty",
				zh: "评分 provider 的 id：内置预设（bocha-jev、typesafe-jev、laya-local、jina-rerank、cohere-rerank）或你定义的；留空 = bocha-jev。默认 空"
			},
			"evidence.maxJevQuestions": {
				en: "Most (need, block) pairs asked of the model per search, at least 1. Default: 64",
				zh: "每次搜索向模型提的（需求, 文本块）对的上限，至少 1。默认 64"
			},
			"evidence.judge.allowLlm": {
				en: "true = providers that speak the llm protocol may be used | false. Risk: general LLM calls cost tokens. Default: false",
				zh: "true = 允许使用 llm 协议的 provider | false。风险：通用 LLM 调用消耗 token。默认 false"
			},
			"evidence.judge.providers": {
				en: "JSON object: scoring providers by id {protocol, baseUrl, model, keyRef, ...}; a preset id overrides its fields. keyRef is only the NAME of the key: never put a key value here. Default: empty",
				zh: "JSON 对象：按 id 定义评分 provider {protocol, baseUrl, model, keyRef, …}；与预设同名则覆盖字段。keyRef 只是 Key 的名字：切勿在这里写 Key 的值。默认 空"
			},
			"evidence.coverage.mode": {
				en: "Coverage judge: off | shadow (record the probability) | control (weak support becomes a gap). Not switched on by the scoring mode. Default: off",
				zh: "覆盖判定：off | shadow（记录概率）| control（弱支持降级为缺口）。不随评分模式自动开启。默认 off"
			},
			"evidence.coverage.provider": {
				en: "Coverage provider id; must speak the systemone protocol; empty = the scoring provider. Default: empty",
				zh: "覆盖判定的 provider id；必须是 systemone 协议；留空 = 同评分 provider。默认 空"
			},
			"evidence.coverage.thresholds.weak": {
				en: "Probability below which a need counts as weak, 0-1; set together with the covered threshold (weak <= covered). Empty = the calibrated value shipped for bocha-jev + cover.sufficient v1",
				zh: "概率低于它判为弱，0–1；与覆盖阈值同时填写（弱 ≤ 覆盖）。留空 = 随插件发布的、仅对 bocha-jev + cover.sufficient v1 校准过的值"
			},
			"evidence.coverage.thresholds.covered": {
				en: "Probability from which a need counts as covered, 0-1. Empty = the calibrated value",
				zh: "概率不低于它判为覆盖，0–1。留空 = 校准值"
			},
			"evidence.budget.perSearchInputTokens": {
				en: "Most model input tokens one search may use; beyond it the search falls back to rule scoring; 0 = no model call. Default: 60000",
				zh: "一次搜索最多使用的模型输入 token；超限则回退规则评分；0 = 不调用模型。默认 60000"
			},
			"evidence.budget.dailyInputTokens": {
				en: "Most model input tokens per day, counted by the time zone below. Default: 1000000",
				zh: "每日最多使用的模型输入 token，按下面的时区按日统计。默认 1000000"
			},
			"evidence.budget.timezone": {
				en: "IANA time zone of the day boundary (Asia/Shanghai); empty = the system time zone. Default: empty",
				zh: "日界线所用的 IANA 时区（如 Asia/Shanghai）；留空 = 系统时区。默认 空"
			},
			"evidence.budget.providers": {
				en: "JSON object: caps per provider, e.g. {\"bocha-jev\": {\"dailyInputTokens\": 200000}}; the stricter of this and the global cap applies. Default: empty",
				zh: "JSON 对象：按 provider 的上限，如 {\"bocha-jev\": {\"dailyInputTokens\": 200000}}；与全局上限取更严者。默认 空"
			},
			"provider.evidence": {
				en: "What the built-in web_search returns once routed through this plugin: auto = an evidence pack (a plain list on failure or timeout) | off = the source list only. Default: auto",
				zh: "内置 web_search 经本插件后返回什么：auto = 证据包（失败或超时退回普通列表）| off = 只返回来源列表。默认 auto"
			},
			"provider.deadlineMs": {
				en: "Deadline of the evidence run inside one built-in web_search in milliseconds, at least 100; at the deadline the partial result returns. Default: 25000",
				zh: "一次内置 web_search 内证据管线的期限（毫秒），至少 100；到点返回已有结果。默认 25000"
			},
			"sources.priority": {
				en: "Source ids ranked first in this order (only ready sources that fit the task language and profile); an engines list in the call still wins. Default: empty",
				zh: "按此顺序排最前的来源 id（仅限就绪且适合任务语言与 profile 的来源）；调用里的 engines 仍然最优先。默认 空"
			},
			"sources.disabled": {
				en: "Source ids never used by automatic planning or the engines list (a source named in the call still runs). Put deepseek here to opt out of the billed DeepSeek default. Default: empty",
				zh: "自动规划与 engines 列表都不再使用的来源 id（调用里明确指定的仍可用）。想关掉按量计费的 DeepSeek 默认就把 deepseek 写在这里。默认 空"
			}
		};
		/** Doc of one `keyedSources.<id>.<key>` / `sources.budget.<id>.<axis>` / `evidence.rubrics.<id>` field. */
		function family(field) {
			let m = /^keyedSources\.(.+)\.apiKeyEnv$/.exec(field);
			if (m) {
				const name = SOURCE_NAME[m[1]] ?? m[1];
				return {
					en: `Name of the credential / environment variable holding the ${name} key (the key itself is never stored here); empty = the default name.`,
					zh: `保存 ${name} Key 的凭据 / 环境变量名（Key 本身从不写在这里）；留空 = 默认名。`
				};
			}
			m = /^keyedSources\.(.+)\.baseUrl$/.exec(field);
			if (m) {
				const name = SOURCE_NAME[m[1]] ?? m[1];
				return {
					en: `Endpoint base of ${name} (an http(s) URL); override only for a proxy or private gateway. Empty = the built-in endpoint.`,
					zh: `${name} 的接口地址（http(s) URL）；仅在使用代理或私有网关时覆盖。留空 = 内置地址。`
				};
			}
			m = /^sources\.budget\.(.+)\.(total|daily)$/.exec(field);
			if (m) {
				const name = SOURCE_NAME[m[1]] ?? m[1];
				return m[2] === "total" ? {
					en: `Most requests ever sent to ${name} (counted in the usage ledger, kept across restarts); a used-up source is skipped and the plan falls back, never an error. Empty = no cap.`,
					zh: `${name} 累计最多请求次数（计入用量账本，重启后仍有效）；用完被跳过并回退到其他来源，不是错误。留空 = 不限。`
				} : {
					en: `Most requests per calendar day to ${name} (the day boundary follows the budget time zone). Empty = no cap.`,
					zh: `${name} 每个自然日最多请求次数（日界线取评分用量上限里的时区）。留空 = 不限。`
				};
			}
			m = /^sources\.confidence\.(.+)$/.exec(field);
			if (m) return {
				en: `Confidence of ${m[1]} (a source or a platform backend), 0-1: it weighs a little less in the rank fusion of several sources and is printed with its results; 1 changes nothing. Empty = 1 for a built-in source, the \`confidence\` of its spec (default 0.5) for a custom CLI.`,
				zh: `${m[1]}（来源或平台后端）的置信度，0–1：多个来源融合排名时权重略低，并随结果显示；1 不改变任何东西。留空 = 内置来源为 1，自定义 CLI 取其规格里的 \`confidence\`（默认 0.5）。`
			};
			m = /^evidence\.rubrics\.(.+)$/.exec(field);
			if (m) return {
				en: `JSON object overriding the built-in judge rubric ${m[1]} {version, instructions, criteria?, maxStateChars, maxCandidateChars}; the version must differ from the built-in one, an invalid override is ignored. Default: empty (the built-in rubric)`,
				zh: `JSON 对象，覆盖内置评分 rubric ${m[1]}：{version, instructions, criteria?, maxStateChars, maxCandidateChars}；版本号必须不同于内置，无效的覆盖会被忽略。默认 空（用内置）`
			};
		}
		/** The doc of a config field in a language; undefined only for a field the card does not know. */
		function fieldDoc(field, lang = "en") {
			const doc = DOCS[field] ?? family(field);
			return doc ? lang === "zh" ? doc.zh : doc.en : void 0;
		}
		/** The docs of the groups of keys and the header of the text view. */
		function textViewDocs(lang = "en") {
			return lang === "zh" ? {
				header: [
					"Web Search Pro 的设置，写在 settings.yaml 的 web-search-pro: 段（也是 profile 的 cordis.patch.yml 里 web-search-pro 条目的 config）。",
					"`键: 值` 表示覆盖默认值；以 # 开头的行是注释，被读取时忽略；每个键上面的注释说明用途、取值、默认值与风险。",
					"被注释的 `# 键: 值` 行是未覆盖的键（显示当前生效的值）；密钥从不出现在这里，只有保存密钥的凭据引用名。这份文本是面板里控件的只读视图：修改请用控件。"
				],
				group: CONFIG_GROUP_TITLES.zh
			} : {
				header: [
					"Web Search Pro settings, as written in the web-search-pro: section of settings.yaml (the config of the web-search-pro entry in a profile's cordis.patch.yml).",
					"`key: value` overrides the default. A line starting with # is a comment and is ignored when read; the comment above each key says what it is for, the allowed values, the default and any risk.",
					"A commented `# key: value` line is a key you have not overridden (it shows the value in force). Secrets never appear here, only the names of the credentials that hold them. This text is a read-only view of the controls in the panel: edit the controls."
				],
				group: CONFIG_GROUP_TITLES.en
			};
		}
		//#endregion
		//#region src/client/text-view.ts
		/**
		* The "Advanced: text mode" view: the plugin's settings as one commented YAML text. It is a read-only print of the controls'
		* staged state, not a second place the settings live. Every key has a comment in front of it (see field-docs.ts); keys you have
		* overridden are plain lines, the others are commented `# key: value` lines showing the value in force; secrets never appear
		* (only the names of the credentials that hold them). Comment lines start with `#`, so stripping them leaves exactly the
		* overrides as valid YAML.
		* @module web-search-pro/client/text-view
		*/
		const newNode = () => ({ children: /* @__PURE__ */ new Map() });
		const hasActive = (node) => (node.leaf?.overridden ?? false) || [...node.children.values()].some(hasActive);
		const scalar = (value) => JSON.stringify(value);
		const quoteKey = (key) => /^[A-Za-z0-9_.-]+$/.test(key) ? key : JSON.stringify(key);
		/** The tail of a comment for a setting the plugin reads only when it starts (`playwright` holds one such option: snapshotDir). */
		function restartNote(field, lang) {
			if (field === "playwright") return lang === "zh" ? " 【snapshotDir 重启插件后生效】" : " [snapshotDir applies after a plugin restart]";
			return isRestartField(field) ? lang === "zh" ? " 【重启插件后生效】" : " [applies after a plugin restart]" : "";
		}
		function valueOf(spec, view) {
			const write = spec.parse(view.text);
			if (write?.kind === "set") return {
				value: write.value,
				set: true
			};
			return {
				value: void 0,
				set: false
			};
		}
		/** Print one node and what is below it; a node with nothing overridden below it is printed commented out. */
		function print(node, key, depth, lang, out) {
			const pad = "  ".repeat(depth);
			if (node.leaf) {
				const { spec, value, set, overridden } = node.leaf;
				const doc = fieldDoc(spec.field, lang);
				if (doc) out.push(pad + "# " + doc + restartNote(spec.field, lang));
				const line = quoteKey(key) + ":" + (set ? " " + scalar(value) : "");
				out.push(overridden ? pad + line : pad + "# " + line);
				return;
			}
			const active = hasActive(node);
			out.push(pad + (active ? "" : "# ") + quoteKey(key) + ":");
			for (const [childKey, child] of node.children) print(child, childKey, depth + 1, lang, out);
		}
		/**
		* The text of the card's current (staged) settings in `lang`. `views` is the staged text and override flag of every field, as the
		* card state carries them; `specs` are the field specs of the form model.
		*/
		function renderTextView(views, specs, lang = "en") {
			const docs = textViewDocs(lang);
			const lines = docs.header.map((line) => "# " + line);
			const leaves = /* @__PURE__ */ new Map();
			const roots = /* @__PURE__ */ new Map();
			for (const spec of specs) {
				const view = views[spec.field];
				if (!view) continue;
				const { value, set } = valueOf(spec, view);
				const leaf = {
					spec,
					value,
					set,
					overridden: view.overridden && set
				};
				if (isPathSpec(spec)) {
					const root = roots.get(spec.root) ?? newNode();
					roots.set(spec.root, root);
					let node = root;
					for (const key of spec.path) {
						const next = node.children.get(key) ?? newNode();
						node.children.set(key, next);
						node = next;
					}
					node.leaf = leaf;
				} else leaves.set(spec.field, leaf);
			}
			for (const group of CONFIG_GROUP_IDS) {
				const body = [];
				for (const key of CONFIG_GROUPS[group]) {
					const leaf = leaves.get(key);
					if (leaf) print({
						children: /* @__PURE__ */ new Map(),
						leaf
					}, key, 0, lang, body);
					const root = roots.get(key);
					if (root) print(root, key, 0, lang, body);
				}
				if (body.length) lines.push("", "# ── " + docs.group[group] + " ──", ...body);
			}
			return lines.join("\n") + "\n";
		}
		//#endregion
		//#region src/client/group-advanced.tsx
		/**
		* "Advanced: text mode": the settings as one commented YAML text, to read or copy. It is a view of the controls (it prints
		* the staged state, secrets excluded), not a second place the settings live. Every key has a comment in front of it.
		* @module web-search-pro/client/group-advanced
		*/
		function AdvancedGroup({ card }) {
			const { t } = card;
			const fields = card.useWebSearchPro((snapshot) => snapshot.fields);
			const [copied, setCopied] = (0, react.useState)(false);
			const text = renderTextView(fields, [...ALL_SPECS, ...dynamicSpecsOf(fields)], t("lang"));
			const id = "web-search-pro-text-view";
			const n = useOverriddenCount(card, jsonFieldsOf("advanced"));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Group, {
				id: "advanced",
				title: t("groupAdvanced"),
				summary: t("groupAdvancedSub"),
				badges: n ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
					tone: "info",
					children: fill(t("overriddenCount"), { n })
				}) : null,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.stack,
					"data-wsp-text-view": true,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: styles.rowHint,
							children: t("textViewHint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							id,
							className: `${styles.input} ${styles.textarea} ${styles.code}`,
							rows: 26,
							readOnly: true,
							spellCheck: false,
							"aria-label": t("textViewTitle"),
							value: text,
							onFocus: (event) => event.currentTarget.select()
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							onClick: () => {
								navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => void 0);
							},
							data: "text-copy",
							children: copied ? t("textViewCopied") : t("textViewCopy")
						}) }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: styles.notice,
							role: "note",
							children: t("textViewNote")
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Fold, {
					id: "raw-json",
					title: t("advancedRawTitle"),
					hint: t("advancedRawHint"),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JsonList, {
						card,
						fields: jsonFieldsOf("advanced")
					})
				})]
			});
		}
		//#endregion
		//#region src/client/group-agent.tsx
		const KIND_LABEL = {
			engines: "agentKindEngines",
			priority: "agentKindPriority",
			disabled: "agentKindDisabled",
			confidence: "agentKindConfidence",
			platform: "agentKindPlatform",
			cli: "agentKindCli"
		};
		/** One overlay entry: what it is, the value the agent set against the one in the configuration, why and when, and the two buttons. */
		function AgentItem({ card, item, busy, items }) {
			const { t } = card;
			const needs = overlayCliDependencies(item, items);
			const who = item.actor === "user" ? t("agentActorUser") : t("agentActorAgent");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "wsp-agent-row",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Item, {
					data: item.key,
					title: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t(KIND_LABEL[item.kind]) }), item.target ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: item.target }) : null] }),
					badges: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentTag, {
						label: t("agentBadge"),
						tip: agentTip(t, item)
					}),
					meta: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.muted,
								children: t("agentNow")
							}),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: item.summary })
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.muted,
								children: t("agentConfigHolds")
							}),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: item.baseline })
						] }),
						needs.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wsp-bad-soft",
							"data-wsp-agent-needs": needs.join(","),
							children: fill(t("agentNeedsCli"), { ids: needs.join(", ") })
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.muted,
							children: [
								item.reason ? "“" + item.reason + "”" : t("agentNoReason"),
								item.at ? " · " + formatTime(item.at) : "",
								" · ",
								who,
								item.sessionId ? " · " + item.sessionId : ""
							]
						})
					] }),
					actions: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
						disabled: busy,
						onClick: () => card.adoptOverlay(item.key),
						data: "agent-adopt",
						children: t("agentAdopt")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
						danger: true,
						disabled: busy,
						onClick: () => card.revokeOverlay([item.key]),
						data: "agent-revoke",
						children: t("agentRevoke")
					})] })
				})
			});
		}
		function AgentGroup({ card }) {
			const { t } = card;
			const state = card.useWebSearchPro((snapshot) => ({
				overlay: snapshot.server.overlay,
				busy: !snapshot.writable || snapshot.saving || snapshot.server.overlay.busy,
				writable: snapshot.writable
			}));
			const { overlay } = state;
			const view = overlay.view;
			const items = view?.items ?? [];
			const audit = view?.audit ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Group, {
				id: "agent",
				title: t("groupAgent"),
				summary: t("groupAgentSub"),
				badges: items.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
					tone: "warning",
					children: fill(t("agentCount"), { n: items.length })
				}) : null,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						children: t("agentNote")
					}),
					overlay.failed && !view ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.notice,
						role: "status",
						"data-wsp-agent-unavailable": true,
						children: t("agentUnavailable")
					}) : null,
					view && !view.valid ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: `${styles.rowHint} wsp-bad`,
						role: "alert",
						"data-wsp-agent-invalid": true,
						children: fill(t("agentInvalid"), { problem: view.problem ?? "" })
					}) : null,
					overlay.error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: `${styles.rowHint} wsp-bad`,
						role: "alert",
						"data-wsp-agent-error": overlay.error.key,
						children: fill(t(overlay.error.key), { why: overlay.error.why ?? "" })
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: styles.list,
						"data-wsp-agent-list": true,
						children: view === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: styles.empty,
							children: overlay.loading ? t("agentLoading") : t("agentNotLoaded")
						}) : items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: styles.empty,
							children: t("agentEmpty")
						}) : items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentItem, {
							card,
							item,
							items,
							busy: state.busy
						}, item.key))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: styles.actions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							disabled: overlay.loading,
							onClick: card.refreshOverlay,
							data: "agent-refresh",
							children: overlay.loading ? t("agentRefreshing") : t("agentRefresh")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							danger: true,
							disabled: state.busy || !view || items.length === 0 && view.valid,
							onClick: () => card.revokeOverlay("all"),
							data: "agent-revoke-all",
							children: t("agentRevokeAll")
						})]
					}),
					view ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						"data-wsp-agent-file": true,
						children: fill(t("agentFile"), {
							file: view.file,
							revision: view.revision
						})
					}) : null,
					view ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Fold, {
						id: "agent-audit",
						title: fill(t("agentAuditTitle"), { n: audit.length }),
						hint: t("agentAuditHint"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: styles.list,
							"data-wsp-agent-audit": true,
							children: audit.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: styles.empty,
								children: t("agentAuditEmpty")
							}) : audit.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Item, {
								data: "#" + entry.revision,
								title: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "wsp-order-no",
									children: entry.revision
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: entry.action })] }),
								badges: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
									tone: "outline",
									children: entry.actor === "user" ? t("agentActorUser") : t("agentActorAgent")
								}),
								meta: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: styles.muted,
									children: [
										formatTime(entry.at),
										entry.sessionId ? " · " + entry.sessionId : "",
										" · “",
										entry.reason,
										"”"
									]
								}), entry.changes.map((change, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: change.key }),
									" ",
									change.before,
									" → ",
									change.after
								] }, index))] })
							}, entry.revision))
						})
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/cli-form.ts
		/**
		* The form side of the custom CLI editor: a `cliAdapters` entry (the JSON spec) as the fields of the edit dialog and back. Two
		* views of one object: the form writes the keys it has controls for onto a copy of the spec and leaves every other key as it
		* was (searches, read, env, login, errorCodes, a field mapping that is not a plain path), and the JSON box edits the whole spec.
		* Validation is `validateCliAdapterSpec`, the function the server registers specs with; its messages are sorted to the field they
		* are about. `allowedSubcommands` is derived from the command words of the argv templates, never typed.
		* Pure: no Host, no DOM.
		* @module web-search-pro/client/cli-form
		*/
		const isRecord$1 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
		const strings = (value) => Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
		/** The result fields the form maps, in display order; each takes a dotted path into one item of the tool's output. */
		const FIELD_KEYS = [
			"url",
			"title",
			"snippet",
			"publishedAt"
		];
		/** How a plain text tool's lines become items (`whole` is a switch of its own). */
		const LINE_MODES = ["url-lines", "tsv"];
		/** The spec a new entry starts from: a JSON-printing tool mapped url / title / snippet. The form fills the command in. */
		function newSpec() {
			return {
				bins: [""],
				packageNote: "",
				platforms: [],
				engine: true,
				probe: {
					versionArgs: ["--version"],
					helpArgs: ["--help"],
					mustContain: []
				},
				allowedSubcommands: [],
				search: {
					argv: ["{query}"],
					output: {
						format: "json",
						fields: {
							url: "url",
							title: "title",
							snippet: "snippet"
						}
					}
				},
				env: {},
				needsLogin: false,
				timeoutMs: 15e3,
				maxOutputBytes: 1048576
			};
		}
		/** The example of the dialog: `echo`, whose whole output is the result (no field mapping), a way to see the pieces work without a real tool. */
		function echoSpec() {
			return {
				bins: ["echo"],
				packageNote: "echo (part of the system)",
				platforms: [],
				engine: true,
				confidence: .5,
				probe: {
					versionArgs: ["--version"],
					helpArgs: ["--help"],
					mustContain: []
				},
				allowedSubcommands: [],
				search: {
					argv: ["{query}"],
					output: {
						format: "text",
						lines: { mode: "whole" }
					}
				},
				env: {},
				needsLogin: false,
				timeoutMs: 5e3,
				maxOutputBytes: 65536
			};
		}
		const pathText = (value) => typeof value === "string" ? value : "";
		/** The form fields of a spec (plain or not): everything the dialog shows, as text. */
		function specToForm(id, raw) {
			const spec = isRecord$1(raw) ? raw : {};
			const search = isRecord$1(spec.search) ? spec.search : {};
			const output = isRecord$1(search.output) ? search.output : {};
			const lines = isRecord$1(output.lines) ? output.lines : void 0;
			const fields = isRecord$1(output.fields) ? output.fields : {};
			const probe = isRecord$1(spec.probe) ? spec.probe : {};
			const complex = FIELD_KEYS.filter((key) => fields[key] !== void 0 && typeof fields[key] !== "string");
			const numberText = (value) => typeof value === "number" || typeof value === "string" ? String(value) : "";
			return {
				id,
				bin: strings(spec.bins)[0] ?? "",
				argv: strings(search.argv),
				format: OUTPUT_FORMATS.includes(output.format) ? output.format : "json",
				whole: lines?.mode === "whole",
				wholeMax: lines?.mode === "whole" && lines.maxChars !== void 0 ? numberText(lines.maxChars) : "",
				itemsPath: pathText(output.itemsPath),
				linesMode: lines?.mode === "tsv" ? "tsv" : "url-lines",
				columns: lines?.mode === "tsv" ? strings(lines.columns).join(", ") : "",
				fields: Object.fromEntries(FIELD_KEYS.map((key) => [key, pathText(fields[key])])),
				complex,
				timeoutMs: numberText(spec.timeoutMs),
				maxOutputBytes: numberText(spec.maxOutputBytes),
				engine: spec.engine === true,
				platforms: strings(spec.platforms),
				confidence: spec.confidence === void 0 ? "" : numberText(spec.confidence),
				packageNote: typeof spec.packageNote === "string" ? spec.packageNote : "",
				helpArgs: strings(probe.helpArgs).join(" "),
				mustContain: strings(probe.mustContain)
			};
		}
		/** A number typed in a box: the number when it is one, else the text itself, so the validation says what is wrong with it. */
		const numberOrText = (text) => {
			const trimmed = text.trim();
			return trimmed !== "" && Number.isFinite(Number(trimmed)) ? Number(trimmed) : trimmed;
		};
		/** The command words the argv templates of a spec use, in order, without repeats: what `allowedSubcommands` must list. */
		function derivedSubcommands(spec) {
			const argvs = [];
			const probe = isRecord$1(spec.probe) ? spec.probe : {};
			argvs.push(strings(probe.versionArgs), strings(probe.helpArgs));
			const searchArgv = (value) => {
				if (isRecord$1(value)) argvs.push(strings(value.argv));
			};
			searchArgv(spec.search);
			searchArgv(spec.read);
			if (isRecord$1(spec.searches)) for (const entry of Object.values(spec.searches)) searchArgv(entry);
			return [...new Set(argvs.flatMap((argv) => commandWords(argv)))];
		}
		/**
		* The spec the form describes, built on `base` (the entry as it was: every key the form has no control for is kept). Nothing is
		* validated here; a value that is not what its box wants is written as typed so `validateCliAdapterSpec` names it.
		*/
		function formToSpec(form, base = {}) {
			const spec = structuredClone(base);
			delete spec.id;
			const bins = strings(spec.bins);
			spec.bins = [form.bin.trim(), ...bins.slice(1)];
			spec.packageNote = form.packageNote.trim() || (form.bin.trim() ? form.bin.trim() + " (installed by you)" : "");
			spec.platforms = [...form.platforms];
			if (form.engine) spec.engine = true;
			else delete spec.engine;
			if (form.confidence.trim() === "") delete spec.confidence;
			else spec.confidence = numberOrText(form.confidence);
			spec.needsLogin = typeof spec.needsLogin === "boolean" ? spec.needsLogin : false;
			if (!isRecord$1(spec.env)) spec.env = {};
			if (form.timeoutMs.trim() === "") delete spec.timeoutMs;
			else spec.timeoutMs = numberOrText(form.timeoutMs);
			if (form.maxOutputBytes.trim() === "") delete spec.maxOutputBytes;
			else spec.maxOutputBytes = numberOrText(form.maxOutputBytes);
			const probe = isRecord$1(spec.probe) ? { ...spec.probe } : {};
			probe.versionArgs = Array.isArray(probe.versionArgs) ? probe.versionArgs : ["--version"];
			probe.helpArgs = form.helpArgs.trim() === "" ? ["--help"] : form.helpArgs.trim().split(/\s+/);
			probe.mustContain = [...form.mustContain];
			spec.probe = probe;
			const search = isRecord$1(spec.search) ? { ...spec.search } : {};
			search.argv = [...form.argv];
			const previous = isRecord$1(search.output) ? search.output : {};
			const output = {
				...previous,
				format: form.format
			};
			delete output.lines;
			const fields = isRecord$1(previous.fields) ? { ...previous.fields } : {};
			if (form.format === "text") {
				if (form.whole) output.lines = form.wholeMax.trim() === "" ? { mode: "whole" } : {
					mode: "whole",
					maxChars: numberOrText(form.wholeMax)
				};
				else output.lines = form.linesMode === "tsv" ? {
					mode: "tsv",
					columns: form.columns.split(",").map((column) => column.trim()).filter(Boolean)
				} : { mode: "url-lines" };
			}
			if (form.format === "json" || form.format === "yaml") {
				if (form.itemsPath.trim() !== "") output.itemsPath = form.itemsPath.trim();
				else delete output.itemsPath;
			} else delete output.itemsPath;
			if (form.format === "text" && form.whole) delete output.fields;
			else {
				for (const key of FIELD_KEYS) {
					if (form.complex.includes(key)) continue;
					const text = form.fields[key].trim();
					if (text === "") delete fields[key];
					else fields[key] = text;
				}
				output.fields = fields;
			}
			search.output = output;
			spec.search = search;
			spec.allowedSubcommands = derivedSubcommands(spec);
			return spec;
		}
		/** Sort the validator's messages (`cliAdapters.<id>.<path>: ...`) to the dialog field they are about. */
		function errorsByField(id, errors) {
			const out = {};
			const add = (field, message) => {
				(out[field] ??= []).push(message);
			};
			const prefix = "cliAdapters." + id;
			for (const error of errors) {
				const message = error.startsWith(prefix) ? error.slice(prefix.length).replace(/^[.:]\s*/, "") : error;
				const hit = [
					[/^id\b/, "id"],
					[/^bins\b/, "bin"],
					[/^packageNote\b/, "packageNote"],
					[/^platforms\b/, "platforms"],
					[/^engine\b/, "engine"],
					[/^confidence\b/, "confidence"],
					[/^timeoutMs\b/, "timeoutMs"],
					[/^maxOutputBytes\b/, "maxOutputBytes"],
					[/^probe\b/, "probe"],
					[/^search\.argv\b/, "argv"],
					[/^search\.output\.format\b/, "format"],
					[/^search\.output\.itemsPath\b/, "itemsPath"],
					[/^search\.output\.lines\b/, "lines"],
					[/^search\.output\.fields\.url\b/, "url"],
					[/^search\.output\.fields\.title\b/, "title"],
					[/^search\.output\.fields\.snippet\b/, "snippet"],
					[/^search\.output\.fields\.publishedAt\b/, "publishedAt"],
					[/^search\.output\.fields\b/, "fields"]
				].find(([pattern]) => pattern.test(message));
				add(hit ? hit[1] : "general", message);
			}
			return out;
		}
		/** Validate a spec (the JSON view): the server's function, plus the one rule only the editor has (an id is not used twice). */
		function checkSpec(id, spec, taken = []) {
			const errors = [...validateCliAdapterSpec({
				...spec,
				id
			}, "user").errors];
			if (taken.includes(id)) errors.push("cliAdapters." + id + ".id: \"" + id + "\" is already used by another entry");
			return {
				spec,
				errors,
				byField: errorsByField(id, errors),
				ok: errors.length === 0
			};
		}
		/** The JSON text of a spec as the dialog's raw box prints it. */
		const specText = (spec) => JSON.stringify(spec, null, 2);
		/** The spec a raw JSON text holds, or the reason it is not one. */
		function parseSpecText(text) {
			try {
				const value = JSON.parse(text);
				return isRecord$1(value) ? { spec: value } : { error: "the spec must be a JSON object" };
			} catch (error) {
				return { error: error instanceof Error ? error.message : String(error) };
			}
		}
		/** The `cliAdapters` object of the staged text (empty text = no entries); undefined when it is not an object. */
		function adaptersOf(text) {
			if (text.trim() === "") return {};
			try {
				const value = JSON.parse(text);
				return isRecord$1(value) ? value : void 0;
			} catch {
				return;
			}
		}
		/**
		* The `cliAdapters` text with entry `id` set to `spec` (a new key goes last), or removed when `spec` is undefined. The other
		* entries are kept as they were. The object with no entries comes back as the empty text, which the form model stores as "not set".
		* Undefined when the current text is not an object (the raw JSON box has to be fixed first).
		*/
		function withAdapter(text, id, spec) {
			const all = adaptersOf(text);
			if (!all) return void 0;
			const next = { ...all };
			if (spec === void 0) delete next[id];
			else next[id] = spec;
			return Object.keys(next).length === 0 ? "" : JSON.stringify(next, null, 2);
		}
		/** A free id for a copy or a new entry: `base`, `base-2`, `base-3`, ... */
		function freeId(base, taken) {
			const stem = base.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "").slice(0, 36) || "mycli";
			if (!taken.includes(stem)) return stem;
			for (let n = 2;; n++) if (!taken.includes(stem + "-" + n)) return stem + "-" + n;
		}
		//#endregion
		//#region src/client/sources-table.ts
		const ANONYMOUS_SOURCES = [
			{
				id: "ddg",
				name: "DuckDuckGo",
				use: "srcUseDdg"
			},
			{
				id: "bing",
				name: "Bing",
				use: "srcUseBing"
			},
			{
				id: "wikipedia",
				name: "Wikipedia",
				use: "srcUseWikipedia"
			},
			{
				id: "hackernews",
				name: "Hacker News",
				use: "srcUseHackernews"
			},
			{
				id: "stackexchange",
				name: "Stack Exchange",
				use: "srcUseStackexchange"
			},
			{
				id: "openalex",
				name: "OpenAlex",
				use: "srcUseOpenalex"
			},
			{
				id: "semanticscholar",
				name: "Semantic Scholar",
				use: "srcUseSemanticscholar"
			},
			{
				id: "anysearch",
				name: "AnySearch",
				use: "srcUseAnysearch"
			},
			{
				id: "arxiv",
				name: "arXiv",
				use: "srcUseArxiv"
			},
			{
				id: "pubmed",
				name: "PubMed",
				use: "srcUsePubmed"
			},
			{
				id: "v2ex",
				name: "V2EX",
				use: "srcUseV2ex"
			}
		];
		//#endregion
		//#region src/client/order.ts
		/**
		* The pure side of the "Search order" group: the lists it edits (engines, the backend chain of a platform), the sources one can
		* add to them, what a source is called and whether the card can tell it is ready, and the edits as text patches. No Host, no DOM:
		* the editors call these and stage the resulting text into the form model, the tests call the same functions.
		* @module web-search-pro/client/order
		*/
		/** The ctx.web engine of the Host: the default `engines` list names it (`seam`). */
		const SEAM_SOURCE = {
			id: "seam",
			name: "ctx.web (seam)"
		};
		/** The route ids a general engine list may name: every keyed and anonymous source of the card, plus the ctx.web engine. */
		const BUILTIN_ENGINE_IDS = [
			...SOURCE_DEFS.map((def) => def.id),
			...ANONYMOUS_SOURCES.map((source) => source.id).filter((id) => !SOURCE_DEFS.some((def) => def.id === id)),
			SEAM_SOURCE.id
		];
		/** Id of a custom CLI as `engines` and `platformBackends` write it. */
		const customId = (id) => "custom-cli:" + id;
		const isCustomId = (id) => id.startsWith("custom-cli:");
		const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
		/** The custom CLI entries of the (staged) `cliAdapters` value, by id, in the order they were written. */
		function customEntries(cliAdapters) {
			return isRecord(cliAdapters) ? Object.entries(cliAdapters).filter((entry) => isRecord(entry[1])) : [];
		}
		/** What the list needs to know of a source id: its name and what kind it is. `cliAdapters` is the staged value (custom ids are looked up in it). */
		function sourceInfo(id, cliAdapters) {
			const def = SOURCE_DEFS.find((entry) => entry.id === id);
			if (def) return {
				id,
				name: def.name,
				kind: "keyed",
				def
			};
			const anonymous = ANONYMOUS_SOURCES.find((source) => source.id === id);
			if (anonymous) return {
				id,
				name: anonymous.name,
				kind: "anonymous"
			};
			if (id === SEAM_SOURCE.id) return {
				id,
				name: SEAM_SOURCE.name,
				kind: "seam"
			};
			if (isCustomId(id)) return {
				id,
				name: id.slice(11),
				kind: customEntries(cliAdapters).some(([key]) => key === id.slice(11)) ? "custom" : "unknown"
			};
			return {
				id,
				name: id,
				kind: "unknown"
			};
		}
		/** The ids of a list value written as comma-separated text (`engines`), de-duplicated, in order. */
		const idsOf = (text) => [...new Set(text.split(",").map((item) => item.trim()).filter(Boolean))];
		/** The text form of a list of ids. */
		const textOf = (ids) => ids.join(", ");
		function addId(ids, id) {
			return ids.includes(id) ? [...ids] : [...ids, id];
		}
		function removeId(ids, id) {
			return ids.filter((entry) => entry !== id);
		}
		/** Move `id` one place towards the front (`-1`) or the back (`1`); at an end, or when absent, the list comes back unchanged. */
		function moveId(ids, id, delta) {
			const index = ids.indexOf(id);
			const target = index + delta;
			if (index < 0 || target < 0 || target >= ids.length) return [...ids];
			const out = [...ids];
			out.splice(index, 1);
			out.splice(target, 0, id);
			return out;
		}
		/**
		* The sources that can be added to the general engine list: the built-in ones and the custom CLIs marked `engine`, those already in
		* the list left out. A custom CLI whose spec is invalid is not offered (the server would not register it).
		*/
		function engineChoices(current, cliAdapters) {
			const custom = customEntries(cliAdapters).filter(([key, raw]) => raw.engine === true && validateCliAdapterSpec({
				...raw,
				id: key
			}, "user").ok).map(([key]) => customId(key));
			return [...BUILTIN_ENGINE_IDS, ...custom].filter((id) => !current.includes(id));
		}
		/** Display names of the platforms that have a backend chain (proper names; the ids are what `platformBackends` is keyed by). */
		const PLATFORM_NAMES = {
			xiaohongshu: "小红书",
			reddit: "Reddit",
			twitter: "Twitter / X",
			zhihu: "知乎",
			bilibili: "Bilibili",
			youtube: "YouTube",
			github: "GitHub",
			"github-issues": "GitHub Issues",
			"github-code": "GitHub Code",
			wechat: "微信公众号",
			omnireach: "OmniReach",
			tanso: "Tanso",
			instagram: "Instagram",
			facebook: "Facebook",
			weibo: "微博",
			douban: "豆瓣",
			tieba: "百度贴吧",
			douyin: "抖音",
			kuaishou: "快手"
		};
		/** Display names of the fixed (non-CLI) backends. */
		const BACKEND_NAMES = {
			opencli: "OpenCLI",
			"browser-opencli": "dsh-browser OpenCLI",
			"browser-search": "dsh-browser search page",
			rest: "REST API"
		};
		/** The platforms the card lists: every one with a backend chain. */
		const ORDER_PLATFORMS = CHAIN_PLATFORMS;
		/** The built-in default chain of a platform. */
		const defaultChainOf = (platform) => DEFAULT_CHAINS[platform] ?? [];
		/**
		* The backends that can sit in the chain of `platform`: the built-in ones that serve it (CLI specs and the fixed backends) and the
		* custom CLIs whose spec declares the platform; those already in `current` are left out.
		*/
		function backendChoices(platform, current, cliAdapters) {
			const { platforms } = specPlatformsOf(cliAdapters);
			return [
				...BUILTIN_CLI_SPECS.map((spec) => spec.id),
				...FIXED_BACKENDS,
				...[...platforms.keys()].filter(isCustomId)
			].filter((id) => !current.includes(id) && backendServes(id, platform, platforms).ok);
		}
		/** The name a backend row shows: the fixed backends and custom CLIs by name, a CLI spec by its command. */
		function backendName(id) {
			if (BACKEND_NAMES[id]) return BACKEND_NAMES[id];
			if (isCustomId(id)) return id.slice(11);
			return BUILTIN_CLI_SPECS.find((spec) => spec.id === id)?.bins[0] ?? id;
		}
		/** The `platformBackends` value of the staged text as an object (undefined when it is empty or not an object). */
		function chainsOf(text) {
			if (text.trim() === "") return {};
			try {
				const value = JSON.parse(text);
				if (!isRecord(value)) return void 0;
				return Object.fromEntries(Object.entries(value).filter((entry) => Array.isArray(entry[1])));
			} catch {
				return;
			}
		}
		/**
		* `platformBackends` text with the chain of `platform` set to `ids`, or the platform's key removed (`ids` undefined: back to the
		* default chain). Other platforms, and keys this card does not know, are kept as they were. The empty object comes back as
		* the empty text, which the form model stores as "not set".
		*/
		function withChain(text, platform, ids) {
			let value;
			if (text.trim() === "") value = {};
			else try {
				const parsed = JSON.parse(text);
				if (!isRecord(parsed)) return void 0;
				value = { ...parsed };
			} catch {
				return;
			}
			if (ids === void 0) delete value[platform];
			else value[platform] = [...ids];
			return Object.keys(value).length === 0 ? "" : JSON.stringify(value, null, 2);
		}
		/** One row per custom CLI of the staged `cliAdapters` value: what the list shows, with the server's own validation. */
		function customRows(cliAdapters) {
			return customEntries(cliAdapters).map(([id, raw]) => {
				const checked = validateCliAdapterSpec({
					...raw,
					id
				}, "user");
				return {
					id,
					bin: (Array.isArray(raw.bins) ? raw.bins.filter((bin) => typeof bin === "string") : [])[0] ?? "",
					engine: raw.engine === true,
					platforms: Array.isArray(raw.platforms) ? raw.platforms.filter((p) => typeof p === "string") : [],
					confidence: typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : DEFAULT_CUSTOM_CONFIDENCE,
					problems: checked.errors
				};
			});
		}
		/** The platforms people reach for most: listed even when nothing was changed for them. */
		const COMMON_PLATFORMS = [
			"xiaohongshu",
			"zhihu",
			"reddit",
			"twitter",
			"bilibili",
			"youtube",
			"github",
			"wechat"
		];
		/**
		* Which platforms the list shows up front, and which fold into "show the rest": a platform is shown when its chain was changed
		* (`platformBackends` has its key), when a valid custom CLI declares it, or when it is one of the common ones. Both halves keep the
		* order of `platforms`. `platformBackends` is the staged text; when it is not valid JSON nothing counts as changed.
		*/
		function splitPlatforms(platforms, platformBackends, cliAdapters) {
			const changed = new Set(Object.keys(chainsOf(platformBackends) ?? {}));
			const declared = new Set(customRows(cliAdapters).filter((row) => row.problems.length === 0).flatMap((row) => row.platforms));
			const shown = [];
			const rest = [];
			for (const platform of platforms) (changed.has(platform) || declared.has(platform) || COMMON_PLATFORMS.includes(platform) ? shown : rest).push(platform);
			return {
				shown,
				rest
			};
		}
		/** The platforms whose display name or id contains `query` (case-insensitive, surrounding spaces ignored); an empty query keeps all. */
		function filterPlatforms(platforms, query) {
			const needle = query.trim().toLowerCase();
			if (needle === "") return [...platforms];
			return platforms.filter((platform) => platform.toLowerCase().includes(needle) || (PLATFORM_NAMES[platform] ?? "").toLowerCase().includes(needle));
		}
		/** What the confidence box of a row shows, from the staged text of `sources.confidence.<id>` and the default of the source. */
		function confidenceView(text, defaultValue) {
			const trimmed = text.trim();
			const typed = trimmed !== "";
			const number = typed ? Number(trimmed) : NaN;
			const invalid = typed && !(Number.isFinite(number) && number >= 0 && number <= 1);
			const effective = typed && !invalid ? number : defaultValue;
			return {
				effective,
				invalid,
				typed,
				quiet: !invalid && effective === 1
			};
		}
		//#endregion
		//#region src/client/group-cli.tsx
		/**
		* "Custom CLI": the command-line tools the user adds, as a list (id, command, purpose, confidence, whether the spec is valid) and one
		* edit dialog per tool. The dialog is a form over the same spec the JSON box holds ("View JSON" at the bottom): editing either side
		* rewrites the other, every problem is the server's own message shown by the control it is about, "Done" puts the spec into the
		* draft (only when it is valid), and "Try it" runs the draft once through the plugin. The entries live inside `cliAdapters`.
		* @module web-search-pro/client/group-cli
		*/
		function draftOf(mode, id, spec) {
			return {
				mode,
				id,
				spec,
				form: specToForm(id, spec),
				jsonText: specText(spec),
				query: ""
			};
		}
		/** The draft after a form edit: the spec is rebuilt from the fields on top of the spec as it was, the JSON text follows. */
		function editForm(draft, patch) {
			const form = {
				...draft.form,
				...patch
			};
			const spec = formToSpec(form, draft.spec);
			return {
				...draft,
				form,
				spec,
				jsonText: specText(spec),
				jsonError: void 0
			};
		}
		/** A new entry's id; an existing one cannot be renamed (copy it instead). */
		function editId(draft, id) {
			return draft.mode === "new" ? {
				...draft,
				id,
				form: {
					...draft.form,
					id
				}
			} : draft;
		}
		/** The draft after the JSON box changed: a text that parses becomes the spec and the form is read from it; one that does not leaves both alone. */
		function editJson(draft, text) {
			const parsed = parseSpecText(text);
			if ("error" in parsed) return {
				...draft,
				jsonText: text,
				jsonError: parsed.error
			};
			const spec = parsed.spec;
			return {
				...draft,
				spec,
				form: specToForm(draft.id, spec),
				jsonText: text
			};
		}
		const FIELD_LABELS = {
			url: {
				label: "cliFieldUrl",
				hint: "cliFieldUrlHint"
			},
			title: {
				label: "cliFieldTitle",
				hint: "cliFieldTitleHint"
			},
			snippet: {
				label: "cliFieldSnippet",
				hint: "cliFieldSnippetHint"
			},
			publishedAt: {
				label: "cliFieldPublishedAt",
				hint: "cliFieldPublishedAtHint"
			}
		};
		/** One setting of the dialog: the card's own row with the control, and the server's messages for it in place of the hint. */
		function FormRow(props) {
			const { card } = props;
			const bad = (props.errors?.length ?? 0) > 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
				field: props.field,
				id: props.id,
				label: props.label,
				hint: props.hint,
				invalid: bad,
				problem: props.errors?.join("\n"),
				labels: rowLabels(card.t),
				wide: props.wide,
				inline: props.inline,
				children: props.children
			});
		}
		/** The argument template: one box per token, buttons to add one, to add a placeholder, and to drop one. */
		function Tokens({ card, tokens, onChange, disabled, invalid }) {
			const { t } = card;
			const edit = (index, value) => onChange(tokens.map((token, i) => i === index ? value : token));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.tokens,
				"data-wsp-tokens": true,
				children: [tokens.map((token, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.tokenRow,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wsp-token-no",
							children: index + 1
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
							code: true,
							value: token,
							invalid: invalid && token === "",
							disabled,
							ariaLabel: fill(t("cliArgvToken"), { n: index + 1 }),
							onChange: (value) => edit(index, value)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							ariaLabel: t("cliArgvRemove"),
							title: t("cliArgvRemove"),
							danger: true,
							disabled,
							onClick: () => onChange(tokens.filter((_, i) => i !== index)),
							data: "token-remove",
							children: "×"
						})
					]
				}, index)), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.actions,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Btn, {
							disabled,
							onClick: () => onChange([...tokens, ""]),
							data: "token-add",
							children: ["＋ ", t("cliArgvAdd")]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							disabled: disabled || tokens.includes("{query}"),
							onClick: () => onChange([...tokens, "{query}"]),
							data: "token-query",
							children: "{query}"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							disabled,
							onClick: () => onChange([...tokens, "{count}"]),
							data: "token-count",
							children: "{count}"
						})
					]
				})]
			});
		}
		/** What the form of one custom CLI shows and edits; presentational (the dialog and the render test both mount it). */
		function CliBody({ card, draft, check, disabled, onForm, onId, onJson, onQuery, onTrial }) {
			const { t } = card;
			const { form } = draft;
			const errors = (field) => check.byField[field] ?? [];
			const allowed = derivedSubcommands(draft.spec);
			const server = card.useWebSearchPro((snapshot) => snapshot.server);
			const trial = server.trial.id === draft.id ? server.trial : { state: "idle" };
			const format = form.format;
			const pathFormat = format === "json" || format === "yaml";
			const platformCheck = (value) => ORDER_PLATFORMS.includes(value) ? void 0 : t("cliPlatformUnknown") + ": " + ORDER_PLATFORMS.join(", ");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.stack,
				"data-wsp-cli-form": draft.id,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						children: t("cliDialogNote")
					}),
					errors("general").length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: `${styles.rowHint} wsp-bad`,
						role: "alert",
						children: errors("general").join("\n")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						id: "web-search-pro-cli-id",
						label: t("cliId"),
						hint: t("cliIdHint"),
						errors: errors("id"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
							id: "web-search-pro-cli-id",
							code: true,
							value: draft.id,
							disabled: disabled || draft.mode === "edit",
							invalid: errors("id").length > 0,
							onChange: onId
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						id: "web-search-pro-cli-bin",
						label: t("cliBin"),
						hint: t("cliBinHint"),
						errors: errors("bin"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
							id: "web-search-pro-cli-bin",
							code: true,
							value: form.bin,
							disabled,
							placeholder: "mytool",
							invalid: errors("bin").length > 0,
							onChange: (bin) => onForm({ bin })
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(FormRow, {
						card,
						label: t("cliArgv"),
						hint: t("cliArgvHint"),
						errors: errors("argv"),
						wide: true,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tokens, {
							card,
							tokens: form.argv,
							disabled,
							invalid: errors("argv").length > 0,
							onChange: (argv) => onForm({ argv })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: styles.rowHint,
							children: t("cliArgvNote")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						label: t("cliAllowed"),
						hint: t("cliAllowedHint"),
						errors: errors("probe"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wsp-allowed",
							"data-wsp-allowed": true,
							children: allowed.length ? allowed.map((word) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", { children: [word, " "] }, word)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.muted,
								children: t("cliAllowedNone")
							})
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("cliOutput") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						id: "web-search-pro-cli-format",
						label: t("cliFormat"),
						hint: t("cliFormatHint"),
						errors: errors("format"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Select, {
							id: "web-search-pro-cli-format",
							value: format,
							disabled,
							options: OUTPUT_FORMATS.map((value) => ({
								value,
								label: value
							})),
							onChange: (value) => onForm({ format: value })
						})
					}),
					format === "text" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						label: t("cliWhole"),
						hint: t("cliWholeHint"),
						inline: true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Toggle, {
							label: t("cliWhole"),
							checked: form.whole,
							disabled,
							onChange: (whole) => onForm({ whole })
						})
					}) : null,
					format === "text" && form.whole ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						id: "web-search-pro-cli-whole-max",
						label: t("cliWholeMax"),
						hint: t("cliWholeMaxHint"),
						errors: errors("lines"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnitInput, {
							id: "web-search-pro-cli-whole-max",
							value: form.wholeMax,
							unit: t("unitChars"),
							placeholder: String(WHOLE_OUTPUT_DEFAULT_CHARS),
							disabled,
							invalid: errors("lines").length > 0,
							onChange: (wholeMax) => onForm({ wholeMax })
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						"data-wsp-whole-note": true,
						children: t("cliWholeNote")
					})] }) : null,
					format === "text" && !form.whole ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						id: "web-search-pro-cli-lines",
						label: t("cliLinesMode"),
						hint: t("cliLinesModeHint"),
						errors: form.linesMode === "tsv" ? [] : errors("lines"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Select, {
							id: "web-search-pro-cli-lines",
							value: form.linesMode,
							disabled,
							options: LINE_MODES.map((value) => ({
								value,
								label: value === "tsv" ? t("cliOptTsv") : t("cliOptUrlLines")
							})),
							onChange: (value) => onForm({ linesMode: value })
						})
					}), form.linesMode === "tsv" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						id: "web-search-pro-cli-columns",
						label: t("cliColumns"),
						hint: t("cliColumnsHint"),
						errors: errors("lines"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
							id: "web-search-pro-cli-columns",
							code: true,
							value: form.columns,
							disabled,
							placeholder: "id, title, link",
							invalid: errors("lines").length > 0,
							onChange: (columns) => onForm({ columns })
						})
					}) : null] }) : null,
					pathFormat ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						id: "web-search-pro-cli-items",
						label: t("cliItemsPath"),
						hint: t("cliItemsPathHint"),
						errors: errors("itemsPath"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
							id: "web-search-pro-cli-items",
							code: true,
							value: form.itemsPath,
							disabled,
							placeholder: "data.items",
							invalid: errors("itemsPath").length > 0,
							onChange: (itemsPath) => onForm({ itemsPath })
						})
					}) : null,
					!(format === "text" && form.whole) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: styles.rowHint,
							children: t("cliFieldsNote")
						}),
						errors("fields").length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: `${styles.rowHint} wsp-bad`,
							role: "alert",
							children: errors("fields").join("\n")
						}) : null,
						FIELD_KEYS.map((key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
							card,
							id: `web-search-pro-cli-field-${key}`,
							label: t(FIELD_LABELS[key].label),
							hint: form.complex.includes(key) ? t("cliFieldComplex") : t(FIELD_LABELS[key].hint),
							errors: errors(key),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
								id: `web-search-pro-cli-field-${key}`,
								code: true,
								value: form.fields[key],
								disabled: disabled || form.complex.includes(key),
								placeholder: form.complex.includes(key) ? "{…}" : key === "url" ? "link" : key === "title" ? "title" : key === "snippet" ? "summary" : "published_at",
								invalid: errors(key).length > 0,
								onChange: (value) => onForm({ fields: {
									...form.fields,
									[key]: value
								} })
							})
						}, key))
					] }) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						id: "web-search-pro-cli-timeout",
						label: t("cliTimeout"),
						hint: t("cliTimeoutHint"),
						errors: errors("timeoutMs"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnitInput, {
							id: "web-search-pro-cli-timeout",
							value: form.timeoutMs,
							unit: t("unitMs"),
							disabled,
							invalid: errors("timeoutMs").length > 0,
							onChange: (timeoutMs) => onForm({ timeoutMs })
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("cliPurpose") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						label: t("cliEngine"),
						hint: t("cliEngineHint"),
						errors: errors("engine"),
						inline: true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Toggle, {
							label: t("cliEngine"),
							checked: form.engine,
							disabled,
							onChange: (engine) => onForm({ engine })
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						id: "web-search-pro-cli-platforms",
						label: t("cliPlatforms"),
						hint: t("cliPlatformsHint"),
						errors: errors("platforms"),
						wide: true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chips, {
							id: "web-search-pro-cli-platforms",
							values: form.platforms,
							disabled,
							placeholder: t("cliPlatformsAdd"),
							removeLabel: t("chipRemove"),
							addLabel: t("cliPlatforms"),
							check: platformCheck,
							onChange: (platforms) => onForm({ platforms })
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
						card,
						id: "web-search-pro-cli-confidence",
						label: t("cliConfidenceLabel"),
						hint: t("cliConfidenceHint"),
						errors: errors("confidence"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
							id: "web-search-pro-cli-confidence",
							numeric: true,
							value: form.confidence,
							disabled,
							placeholder: String(DEFAULT_CUSTOM_CONFIDENCE),
							invalid: errors("confidence").length > 0,
							onChange: (confidence) => onForm({ confidence })
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						children: t("cliConfidenceNote")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Fold, {
						id: "cli-advanced",
						title: t("cliAdvanced"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
								card,
								id: "web-search-pro-cli-package",
								label: t("cliPackageNote"),
								hint: t("cliPackageNoteHint"),
								errors: errors("packageNote"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
									id: "web-search-pro-cli-package",
									value: form.packageNote,
									disabled,
									placeholder: form.bin ? form.bin + " (installed by you)" : "",
									invalid: errors("packageNote").length > 0,
									onChange: (packageNote) => onForm({ packageNote })
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
								card,
								id: "web-search-pro-cli-help",
								label: t("cliHelpArgs"),
								hint: t("cliHelpArgsHint"),
								errors: errors("probe"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
									id: "web-search-pro-cli-help",
									code: true,
									value: form.helpArgs,
									disabled,
									placeholder: "--help",
									onChange: (helpArgs) => onForm({ helpArgs })
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
								card,
								id: "web-search-pro-cli-must",
								label: t("cliMustContain"),
								hint: t("cliMustContainHint"),
								wide: true,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chips, {
									id: "web-search-pro-cli-must",
									values: form.mustContain,
									disabled,
									removeLabel: t("chipRemove"),
									addLabel: t("cliMustContain"),
									onChange: (mustContain) => onForm({ mustContain })
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FormRow, {
								card,
								id: "web-search-pro-cli-max",
								label: t("cliMaxOutput"),
								hint: t("cliMaxOutputHint"),
								errors: errors("maxOutputBytes"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnitInput, {
									id: "web-search-pro-cli-max",
									value: form.maxOutputBytes,
									unit: t("unitBytes"),
									disabled,
									invalid: errors("maxOutputBytes").length > 0,
									onChange: (maxOutputBytes) => onForm({ maxOutputBytes })
								})
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Fold, {
						id: "cli-trial",
						title: t("cliTrial"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.stack,
							"data-wsp-trial": true,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: styles.rowHint,
								children: t("cliTrialNote")
							}), server.available ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: styles.trialBar,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
										value: draft.query,
										placeholder: t("cliTrialQueryDefault"),
										ariaLabel: t("cliTrialQuery"),
										disabled,
										onChange: onQuery
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
										disabled: disabled || !check.ok || trial.state === "running",
										onClick: onTrial,
										data: "trial-run",
										children: trial.state === "running" ? t("cliTrialRunning") : t("cliTrialRun")
									})]
								}),
								!check.ok ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: styles.rowHint,
									children: t("cliTrialInvalid")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TrialOutput, {
									card,
									trial
								})
							] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: styles.notice,
								role: "note",
								"data-wsp-trial-unavailable": true,
								children: t("cliTrialUnavailable")
							})]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Fold, {
						id: "cli-json",
						title: t("cliJson"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.stack,
							"data-wsp-json-view": true,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: styles.rowHint,
									children: t("cliJsonNote")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									className: `${styles.input} ${styles.textarea} ${styles.code} ${draft.jsonError ? styles.invalidInput : ""}`,
									rows: 14,
									spellCheck: false,
									value: draft.jsonText,
									disabled,
									"aria-label": t("cliJson"),
									"aria-invalid": draft.jsonError ? true : void 0,
									onChange: (event) => onJson(event.currentTarget.value)
								}),
								draft.jsonError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: `${styles.rowHint} wsp-bad`,
									role: "alert",
									children: fill(t("cliJsonBad"), { why: draft.jsonError })
								}) : null
							]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: check.ok ? styles.rowHint : `${styles.rowHint} wsp-bad`,
						role: check.ok ? "status" : "alert",
						"data-wsp-cli-check": check.ok ? "ok" : "bad",
						children: check.ok ? t("cliValid") : t("cliProblems") + ": " + check.errors.length
					})
				]
			});
		}
		/** What a trial run found: the first results and the tool's own words, or where it stopped and why. */
		function TrialOutput({ card, trial }) {
			const { t } = card;
			if (trial.state === "failed") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: `${styles.rowHint} wsp-bad`,
				role: "alert",
				children: fill(t("cliTrialRpcFailed"), { why: trial.error ?? "" })
			});
			const result = trial.result;
			if (trial.state !== "done" || !result) return null;
			const stages = {
				disabled: t("cliTrialStageDisabled"),
				validate: t("cliTrialStageValidate"),
				probe: t("cliTrialStageProbe"),
				search: t("cliTrialStageSearch")
			};
			if (!result.ok) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.trialOut,
				"data-wsp-trial-result": "failed",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
						className: "wsp-bad",
						children: fill(t("cliTrialFailed"), { stage: stages[result.stage] })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: result.message }),
					result.errors?.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: result.errors.map((error, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: error }, index)) }) : null,
					result.hint ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: styles.rowHint,
						children: fill(t("cliTrialHint"), { hint: result.hint })
					}) : null,
					result.raw ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("cliTrialRaw") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: styles.codeBlock,
						children: result.raw
					})] }) : null
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.trialOut,
				"data-wsp-trial-result": "ok",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: fill(t("cliTrialOk"), {
						n: result.total,
						m: result.sources.length,
						ms: result.elapsedMs
					}) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: "outline",
						children: t("cliTrialLabel")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: styles.rowHint,
						children: t("cliTrialResults")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: result.sources.map((source, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: source.title ?? source.url }),
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: source.url }),
						source.snippet ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" — ", source.snippet] }) : null,
						source.publishedAt ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							" (",
							source.publishedAt,
							")"
						] }) : null
					] }, index)) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("cliTrialRaw") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: styles.codeBlock,
						children: result.raw
					})
				]
			});
		}
		function CliDialog({ card, initial, taken, onClose }) {
			const { t } = card;
			const [draft, setDraft] = (0, react.useState)(initial);
			const text = card.useWebSearchPro((snapshot) => snapshot.fields.cliAdapters.text);
			const disabled = card.useWebSearchPro((snapshot) => !snapshot.writable || snapshot.saving);
			const check = checkSpec(draft.id, draft.spec, draft.mode === "new" ? taken : []);
			const apply = () => {
				const next = withAdapter(text, draft.id, draft.spec);
				if (next === void 0) return;
				card.edit("cliAdapters", next);
				card.clearTrial();
				onClose();
			};
			const close = () => {
				card.clearTrial();
				onClose();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dialog, {
				open: true,
				wide: true,
				title: draft.mode === "new" ? t("cliDialogNew") : fill(t("cliDialogEdit"), { id: draft.id }),
				closeLabel: t("close"),
				onClose: close,
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
					onClick: close,
					data: "cli-cancel",
					children: t("cliCancel")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
					primary: true,
					disabled: disabled || !check.ok || adaptersOf(text) === void 0,
					title: check.ok ? void 0 : t("cliApplyBlocked"),
					onClick: apply,
					data: "cli-apply",
					children: t("cliApply")
				})] }),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CliBody, {
					card,
					draft,
					check,
					disabled,
					onForm: (patch) => setDraft((current) => editForm(current, patch)),
					onId: (id) => setDraft((current) => editId(current, id)),
					onJson: (value) => setDraft((current) => editJson(current, value)),
					onQuery: (query) => setDraft((current) => ({
						...current,
						query
					})),
					onTrial: () => card.runTrial({
						id: draft.id,
						spec: draft.spec,
						query: draft.query.trim() || t("cliTrialQueryDefault")
					})
				})
			});
		}
		function CliList({ card }) {
			const { t } = card;
			const text = card.useWebSearchPro((snapshot) => snapshot.fields.cliAdapters.text);
			const disabled = card.useWebSearchPro((snapshot) => !snapshot.writable);
			const [editing, setEditing] = (0, react.useState)();
			const adapters = adaptersOf(text);
			const rows = customRows(adapters);
			const taken = rows.map((row) => row.id);
			const open = (mode, id, spec) => setEditing(draftOf(mode, id, spec));
			const entry = (id) => customEntries(adapters).find(([key]) => key === id)?.[1] ?? {};
			const remove = (id) => {
				const next = withAdapter(text, id, void 0);
				if (next !== void 0) card.edit("cliAdapters", next);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				adapters === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: `${styles.rowHint} wsp-bad`,
					role: "alert",
					children: t("platformChainBad").replace("platformBackends", "cliAdapters")
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: styles.list,
					"data-wsp-cli-list": true,
					children: rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.empty,
						children: t("cliEmpty")
					}) : rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Item, {
						data: row.id,
						title: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: row.id }),
						badges: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							row.engine ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
								tone: "info",
								children: t("cliPurposeEngine")
							}) : null,
							row.platforms.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
								tone: "neutral",
								children: fill(t("cliPurposePlatforms"), { list: row.platforms.join(", ") })
							}) : null,
							!row.engine && !row.platforms.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
								tone: "warning",
								children: t("cliPurposeNone")
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
								tone: "neutral",
								children: fill(t("orderConfidenceBadge"), { c: row.confidence })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
								tone: row.problems.length ? "danger" : "success",
								children: row.problems.length ? t("stateSpecBad") + " · " + row.problems.length : t("stateSpecOk")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentMark, {
								card,
								itemKey: "cliAdapters." + row.id,
								compact: true
							})
						] }),
						meta: row.problems.length ? row.problems[0] : row.bin + " " + argvPreview(entry(row.id)),
						actions: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								disabled,
								onClick: () => open("edit", row.id, entry(row.id)),
								data: "cli-edit",
								children: t("edit")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								disabled,
								onClick: () => open("new", freeId(row.id + "-copy", taken), structuredClone(entry(row.id))),
								data: "cli-copy",
								children: t("cliCopy")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								danger: true,
								disabled,
								title: t("cliDeleteNote"),
								onClick: () => remove(row.id),
								data: "cli-delete",
								children: t("cliDelete")
							})
						] })
					}, row.id))
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.actions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Btn, {
						disabled: disabled || adapters === void 0,
						onClick: () => open("new", freeId("mycli", taken), newSpec()),
						data: "cli-add",
						children: ["＋ ", t("cliAdd")]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
						disabled: disabled || adapters === void 0,
						onClick: () => open("new", freeId("echo", taken), echoSpec()),
						data: "cli-add-example",
						children: t("cliAddExample")
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentClis, {
					card,
					baseline: taken
				}),
				editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CliDialog, {
					card,
					initial: editing,
					taken,
					onClose: () => setEditing(void 0)
				}, editing.mode + editing.id) : null
			] });
		}
		/**
		* The custom CLIs an agent added with `config.upsert_cli` that the configuration does not hold: they live only in the overlay, so the list
		* above (which is the configuration) cannot show them. Each carries the same two buttons as in "Agent changes".
		*/
		function AgentClis({ card, baseline }) {
			const { t } = card;
			const items = card.useWebSearchPro((snapshot) => (snapshot.server.overlay.view?.items ?? []).filter((item) => item.kind === "cli" && item.target !== void 0 && !baseline.includes(item.target)));
			if (items.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-wsp-agent-clis": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("agentCliTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						children: t("agentCliNote")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: styles.list,
						children: items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wsp-agent-row",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Item, {
								data: item.target,
								title: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: item.target }),
								badges: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentMark, {
									card,
									itemKey: item.key,
									compact: true
								}),
								meta: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: item.summary }) }), item.reason ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: styles.muted,
									children: [
										"“",
										item.reason,
										"”"
									]
								}) : null] }),
								actions: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									onClick: () => card.adoptOverlay(item.key),
									data: "agent-adopt",
									children: t("agentAdopt")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									danger: true,
									onClick: () => card.revokeOverlay([item.key]),
									data: "agent-revoke",
									children: t("agentRevoke")
								})] })
							})
						}, item.key))
					})
				]
			});
		}
		/** The argument template as one line, for the list's meta text. */
		function argvPreview(spec) {
			const search = spec.search;
			return Array.isArray(search?.argv) ? search.argv.filter((token) => typeof token === "string").join(" ") : "";
		}
		function CliGroup({ card }) {
			const { t } = card;
			const n = useOverriddenCount(card, ["cliAdapters"]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Group, {
				id: "cli",
				title: t("groupCli"),
				summary: t("groupCliSub"),
				badges: n ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
					tone: "info",
					children: fill(t("overriddenCount"), { n })
				}) : null,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: styles.rowHint,
					children: t("cliIntroNote")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CliList, { card })]
			});
		}
		//#endregion
		//#region src/client/group-sources.tsx
		/**
		* "Sources": how sources are ranked (policy, priority, disabled) and a list of the sources that need a key or an address: a
		* row per source (name, tier, whether its key is set, and the "常用" mark), and one edit dialog per source holding its key
		* reference, write-only key, endpoint and request budget. The anonymous sources are a folded reference table. Edits stage into
		* the same draft the sticky save bar writes; a dialog has no save button of its own.
		* @module web-search-pro/client/group-sources
		*/
		/** The write-only key of a source. It shows whether a key is stored, never the key. */
		function SecretRow({ card, id, label }) {
			const { t } = card;
			const cred = card.useWebSearchPro((snapshot) => snapshot.credentials[id]);
			const disabled = card.useWebSearchPro((snapshot) => !snapshot.writable || snapshot.saving);
			const status = cred.loading ? t("credentialChecking") : cred.configured ? t("credentialSet") : t("credentialUnset");
			const inputId = `web-search-pro-credential-${id}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-wsp-credential": id,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
					id: inputId,
					label,
					hint: cred.writable ? t("credentialWriteOnlyHint") : t("credentialReadOnlyHint"),
					labels: rowLabels(t),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretInput, {
						id: inputId,
						value: cred.text,
						onChange: (text) => card.editCredential(id, text),
						status,
						configured: cred.configured,
						disabled: disabled || !cred.writable,
						ariaLabel: label
					})
				})
			});
		}
		/** Whether a source is usable as far as the card can tell: its key is stored, or (SearXNG) its address is set. */
		function useSourceReady(card, def) {
			return card.useWebSearchPro((snapshot) => {
				if (def.credential) {
					const cred = snapshot.credentials[def.credential];
					return {
						ready: cred.configured,
						loading: cred.loading
					};
				}
				return {
					ready: (snapshot.fields.searxngUrl?.text ?? "") !== "",
					loading: false
				};
			});
		}
		const NOTE_KEYS = {
			deepseek: "sourceNoteDeepseek",
			bocha: "sourceNoteBocha",
			exa: "sourceNoteExa",
			jina: "sourceNoteJina",
			github: "sourceNoteGithub",
			searxng: "sourceNoteSearxng"
		};
		/** The controls of one source: reference name, write-only key, endpoint, extras and request budget. */
		function SourceForm({ card, def }) {
			const { t } = card;
			const keyedFields = def.id === "bocha" || def.id === "exa" || def.id === "jina" || def.id === "github";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				def.envField ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextRow, {
					card,
					field: def.envField,
					placeholder: def.defaultEnv,
					code: true,
					hint: `${t("keyedEnvHint")} ${def.defaultEnv}`,
					label: keyedFields ? t(def.envField) : t("keyedEnv")
				}) : null,
				def.credential ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretRow, {
					card,
					id: def.credential,
					label: t("keyedApiKey")
				}) : null,
				def.baseUrlField ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextRow, {
					card,
					field: def.baseUrlField,
					code: true,
					placeholder: def.id === "bocha" ? "https://api.bocha.cn" : def.id === "deepseek" ? "https://api.deepseek.com/v1/tools" : "",
					label: t(def.baseUrlField === "bochaBaseUrl" ? "bochaBaseUrl" : "keyedBaseUrl"),
					hint: def.baseUrlField === "bochaBaseUrl" ? t("bochaBaseUrlHint") : t("keyedBaseUrlHint")
				}) : null,
				def.extra?.map((field) => field === "bochaSummary" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
					card,
					field
				}, field) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextRow, {
					card,
					field,
					code: true,
					placeholder: "http://127.0.0.1:8080"
				}, field)),
				def.budget ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("reqBudgetGroup") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						children: t("reqBudgetNote")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: `sources.budget.${def.id}.total`,
						unit: "count"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: `sources.budget.${def.id}.daily`,
						unit: "count"
					})
				] }) : null
			] });
		}
		/** One source's edit dialog. */
		function SourceDialog({ card, def, onClose }) {
			const { t } = card;
			const fields = sourceFields(def);
			const overridden = card.useWebSearchPro((snapshot) => fields.filter((field) => snapshot.fields[field]?.overridden));
			const disabled = card.useWebSearchPro((snapshot) => !snapshot.writable || snapshot.saving);
			const note = NOTE_KEYS[def.id];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Dialog, {
				open: true,
				wide: false,
				title: fill(t("sourceDialogTitle"), { name: def.name }),
				closeLabel: t("close"),
				description: t(note ?? "sourceNoteKeyed"),
				onClose,
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
					disabled: disabled || overridden.length === 0,
					onClick: () => {
						for (const field of overridden) card.resetField(field);
					},
					data: "source-reset",
					children: t("sourceResetAll")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
					primary: true,
					onClick: onClose,
					data: "source-done",
					children: t("done")
				})] }),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: styles.rowHint,
					children: t("dialogStagesNote")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceForm, {
					card,
					def
				})]
			});
		}
		const TIER_KEYS = {
			paid: "tierPaid",
			"free-quota": "tierFree",
			anonymous: "tierAnonymous"
		};
		/** One row of the sources list. */
		function SourceItem({ card, def, onEdit }) {
			const { t } = card;
			const { ready, loading } = useSourceReady(card, def);
			const disabled = card.useWebSearchPro((snapshot) => !snapshot.writable);
			const view = card.useWebSearchPro((snapshot) => ({
				ref: def.envField ? snapshot.fields[def.envField]?.text || def.defaultEnv || "" : "",
				url: def.id === "searxng" ? snapshot.fields.searxngUrl.text : "",
				capped: def.budget ? ["total", "daily"].some((axis) => snapshot.fields[`sources.budget.${def.id}.${axis}`]?.text) : false
			}));
			const meta = def.id === "searxng" ? view.url || t("sourceMetaNoUrl") : [view.ref ? fill(t("sourceMetaRef"), { ref: view.ref }) : "", view.capped ? t("sourceMetaCapped") : ""].filter(Boolean).join(" · ");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Item, {
				data: def.id,
				title: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: def.name }),
				badges: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					def.common ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: "info",
						children: t("commonBadge")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: def.tier === "paid" ? "warning" : "outline",
						children: t(TIER_KEYS[def.tier])
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: ready ? "success" : "neutral",
						children: loading ? t("credentialChecking") : ready ? def.credential ? t("credentialSet") : t("sourceConfigured") : def.credential ? t("credentialUnset") : t("sourceNotConfigured")
					})
				] }),
				meta,
				actions: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
					disabled,
					onClick: onEdit,
					data: "source-edit",
					children: t("edit")
				})
			});
		}
		/** Open dialog state shared by the Common and Sources groups: one source at a time. */
		function SourceList({ card, only }) {
			const [editing, setEditing] = (0, react.useState)();
			const defs = SOURCE_DEFS.filter((def) => !only || only.includes(def.id));
			const def = SOURCE_DEFS.find((entry) => entry.id === editing);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: styles.list,
				"data-wsp-source-list": true,
				children: defs.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceItem, {
					card,
					def: entry,
					onEdit: () => setEditing(entry.id)
				}, entry.id))
			}), def ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceDialog, {
				card,
				def,
				onClose: () => setEditing(void 0)
			}, def.id) : null] });
		}
		const FIELD_NAMES = [
			"evidence.sourcePolicy",
			"sources.priority",
			"sources.disabled",
			"openalexMailto"
		];
		function SourcesGroup({ card }) {
			const { t } = card;
			const count = useOverriddenCount(card, [...FIELD_NAMES, ...SOURCE_DEFS.flatMap(sourceFields)]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Group, {
				id: "sources",
				title: t("groupSources"),
				summary: t("groupSourcesSub"),
				badges: count ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
					tone: "info",
					children: fill(t("overriddenCount"), { n: count })
				}) : null,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("strategyGroup") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						"data-wsp-strategy": true,
						children: t("strategyNote")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectRow, {
						card,
						field: "evidence.sourcePolicy",
						options: [{
							value: "default",
							label: t("optPolicyDefault")
						}, {
							value: "anonymous-only",
							label: t("optPolicyAnonymousOnly")
						}]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListRow, {
						card,
						field: "sources.priority",
						placeholder: "deepseek, exa"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListRow, {
						card,
						field: "sources.disabled",
						placeholder: "bing"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("sourcesListTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						children: t("sourcesListHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceList, { card }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Fold, {
						id: "anonymous",
						title: t("anonymousTitle"),
						hint: t("anonymousHint"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: styles.table,
								"data-wsp-anonymous": true,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										scope: "col",
										children: t("anonymousName")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										scope: "col",
										children: "id"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										scope: "col",
										children: t("anonymousUse")
									})
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: ANONYMOUS_SOURCES.map((source) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: source.name }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: source.id }) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: t(source.use) })
								] }, source.id)) })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextRow, {
								card,
								field: "openalexMailto"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: styles.rowHint,
								"data-wsp-status-line": true,
								children: t("sourcesStatusLine")
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/group-common.tsx
		/**
		* "Common": what nearly everyone touches, open by default (every other group starts closed): the default engine chain with the
		* order a search would really try, the result count, parallel fusion, the tool surface, the proxy fake-IP switch, and the
		* DeepSeek Search source (常用) with its page-reading switch.
		* @module web-search-pro/client/group-common
		*/
		/** The names of the common group's fields, in order. */
		const COMMON_FIELDS = [
			"searchMaxResults",
			"parallelEngines",
			"toolSurface",
			"allowProxyFakeIp",
			"deepseekFetch"
		];
		/** The chain a plain search would try, computed from the staged settings by the router's own function. */
		function ChainLine({ card }) {
			const { t } = card;
			const chain = card.useWebSearchPro((snapshot) => chainOf(snapshot)?.join(" › ") ?? "");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
				className: styles.chain,
				role: "status",
				"data-wsp-chain": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("chainNow") }),
					chain ? chain.split(" › ").map((id, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [index ? "› " : "", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: id })] }, id + index)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("chainEmpty") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: styles.link,
						onClick: () => {
							const node = document.querySelector("[data-wsp-group=\"order\"]");
							if (node) {
								node.open = true;
								node.scrollIntoView?.({
									block: "start",
									behavior: "smooth"
								});
							}
						},
						"data-wsp-open-order": true,
						children: t("chainEdit")
					})
				]
			});
		}
		function CommonGroup({ card }) {
			const { t } = card;
			const count = useOverriddenCount(card, COMMON_FIELDS);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Group, {
				id: "common",
				title: t("groupCommon"),
				summary: t("groupCommonSub"),
				defaultOpen: true,
				badges: count ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
					tone: "info",
					children: fill(t("overriddenCount"), { n: count })
				}) : null,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChainLine, { card }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "searchMaxResults",
						unit: "count"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
						card,
						field: "parallelEngines"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectRow, {
						card,
						field: "toolSurface",
						options: [{
							value: "indexed",
							label: t("optIndexed")
						}, {
							value: "flat",
							label: t("optFlat")
						}]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
						card,
						field: "allowProxyFakeIp",
						risk: t("riskNetwork")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("commonDeepseekTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceList, {
						card,
						only: ["deepseek"]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
						card,
						field: "deepseekFetch",
						risk: t("riskBilled")
					})
				]
			});
		}
		//#endregion
		//#region src/client/group-judge.tsx
		/**
		* "Scoring model": the optional model judge (mode, provider, coverage judge, usage caps), its custom providers as a JSON list,
		* and the judge prompts (rubrics) as a list: a row each (name, active version, default or overridden) and an edit dialog that
		* puts the built-in text beside your override. The dialog edits the same staged entry the rest of the card writes on save.
		* @module web-search-pro/client/group-judge
		*/
		const MODE_FIELDS = [
			"evidence.judge.mode",
			"evidence.judge.provider",
			"evidence.hybridBorderline",
			"evidence.maxJevQuestions",
			"evidence.judge.allowLlm",
			"evidence.coverage.mode",
			"evidence.coverage.provider",
			"evidence.coverage.thresholds.weak",
			"evidence.coverage.thresholds.covered",
			"evidence.budget.perSearchInputTokens",
			"evidence.budget.dailyInputTokens",
			"evidence.budget.timezone",
			"evidence.judge.providers",
			"evidence.budget.providers"
		];
		const CONTROLS = [
			{
				key: "version",
				label: "rubricVersion",
				hint: "rubricVersionHint",
				kind: "line"
			},
			{
				key: "instructions",
				label: "rubricInstructions",
				hint: "rubricInstructionsHint",
				kind: "area"
			},
			{
				key: "criteria",
				label: "rubricCriteria",
				hint: "rubricCriteriaHint",
				kind: "area"
			},
			{
				key: "maxStateChars",
				label: "rubricMaxState",
				hint: "rubricMaxStateHint",
				kind: "number"
			},
			{
				key: "maxCandidateChars",
				label: "rubricMaxCandidate",
				hint: "rubricMaxCandidateHint",
				kind: "number"
			}
		];
		/** The built-in value of a control. */
		function builtinText(rubric, key) {
			switch (key) {
				case "version": return rubric.builtin.version;
				case "instructions": return rubric.builtin.instructions;
				case "criteria": return rubric.builtin.criteria.join("\n");
				case "maxStateChars": return String(rubric.builtin.maxStateChars);
				case "maxCandidateChars": return String(rubric.builtin.maxCandidateChars);
			}
		}
		/** The controls of one rubric override: each is a view of the one staged entry; the built-in text sits beside it. */
		function RubricForm({ card, id }) {
			const { t } = card;
			const rubric = card.useWebSearchPro((snapshot) => snapshot.rubrics.find((entry) => entry.id === id));
			const disabled = card.useWebSearchPro((snapshot) => !snapshot.writable || snapshot.saving);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.stack,
				"data-wsp-field": `evidence.rubrics.${id}`,
				"data-wsp-rubric": id,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						children: rubric.description
					}),
					!rubric.editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: styles.compareCol,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("promptDefaultCol") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							className: styles.preview,
							children: rubric.builtin.instructions
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
						disabled,
						onClick: () => card.startRubric(id),
						data: "rubric-start",
						children: t("rubricCreate")
					}) })] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [CONTROLS.filter((control) => control.key !== "criteria" || rubric.kind === "score").map((control) => {
						const inputId = `web-search-pro-rubric-${id}-${control.key}`;
						const value = rubric.entry[control.key];
						const invalid = rubric.invalid;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.compare,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.compareCol,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
									t(control.label),
									" · ",
									t("promptDefaultCol")
								] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
									className: styles.preview,
									children: builtinText(rubric, control.key)
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.compareCol,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										htmlFor: inputId,
										children: [
											t(control.label),
											" · ",
											t("promptMineCol")
										]
									}),
									control.kind === "area" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										id: inputId,
										className: `${styles.input} ${styles.textarea} ${styles.code} ${invalid ? styles.invalidInput : ""}`,
										rows: control.key === "criteria" ? 5 : 10,
										spellCheck: false,
										value,
										disabled,
										placeholder: t("promptEmptyIsDefault"),
										"aria-invalid": invalid || void 0,
										onChange: (event) => card.editRubric(id, control.key, event.currentTarget.value)
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
										id: inputId,
										value,
										code: true,
										disabled,
										invalid,
										numeric: control.kind === "number",
										placeholder: t("promptEmptyIsDefault"),
										onChange: (text) => card.editRubric(id, control.key, text)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: styles.rowHint,
										children: t(control.hint)
									})
								]
							})]
						}, control.key);
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: styles.link,
						disabled,
						onClick: () => card.restoreRubric(id),
						"data-wsp-reset": `evidence.rubrics.${id}`,
						children: t("rubricRestore")
					}) })] }),
					rubric.problems.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: rubric.invalid ? "wsp-bad" : styles.rowHint,
						role: "alert",
						"data-wsp-rubric-problems": true,
						children: rubric.problems.map((problem, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: problem }, index))
					}) : null
				]
			});
		}
		function RubricList({ card }) {
			const { t } = card;
			const rubrics = card.useWebSearchPro((snapshot) => snapshot.rubrics);
			const unknown = card.useWebSearchPro((snapshot) => snapshot.unknownRubrics);
			const disabled = card.useWebSearchPro((snapshot) => !snapshot.writable || snapshot.saving);
			const [editing, setEditing] = (0, react.useState)();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("rubricsTitle") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: styles.rowHint,
					children: t("rubricNotes")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: styles.list,
					"data-wsp-rubrics": true,
					children: rubrics.map((rubric) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Item, {
						data: rubric.id,
						title: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: rubric.id }),
						badges: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Badge, {
							tone: "neutral",
							children: [
								t("rubricActive"),
								" ",
								rubric.activeVersion
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
							tone: rubric.invalid ? "danger" : rubric.editing ? "info" : "outline",
							children: rubric.invalid ? t("invalid") : rubric.editing ? t("rubricOverrideOn") : t("promptStateDefault")
						})] }),
						meta: rubric.description,
						actions: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [rubric.editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: styles.link,
							disabled,
							onClick: () => card.restoreRubric(rubric.id),
							children: t("rubricRestore")
						}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							disabled,
							onClick: () => setEditing(rubric.id),
							data: "rubric-edit",
							children: t("edit")
						})] })
					}, rubric.id))
				}),
				unknown.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: styles.rowHint,
					role: "note",
					children: [
						t("rubricUnknown"),
						" ",
						unknown.join(", ")
					]
				}) : null,
				editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dialog, {
					open: true,
					wide: true,
					title: fill(t("rubricDialogTitle"), { name: editing }),
					closeLabel: t("close"),
					description: t("dialogStagesNote"),
					onClose: () => setEditing(void 0),
					footer: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
						primary: true,
						onClick: () => setEditing(void 0),
						data: "rubric-done",
						children: t("done")
					}),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RubricForm, {
						card,
						id: editing
					})
				}) : null
			] });
		}
		function JudgeGroup({ card }) {
			const { t } = card;
			const count = useOverriddenCount(card, [...MODE_FIELDS, ...BUILTIN_RUBRIC_IDS.map((id) => `evidence.rubrics.${id}`)]);
			const providers = card.useWebSearchPro((snapshot) => snapshot.providerChoices);
			const options = [{
				value: "",
				label: t("emptyDefault")
			}, ...providers.map((id) => ({
				value: id,
				label: id
			}))];
			const off = {
				value: "off",
				label: t("optionOff")
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Group, {
				id: "judge",
				title: t("groupJudge"),
				summary: t("groupJudgeSub"),
				badges: count ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
					tone: "info",
					children: fill(t("overriddenCount"), { n: count })
				}) : null,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectRow, {
						card,
						field: "evidence.judge.mode",
						risk: t("riskModel"),
						options: [
							off,
							{
								value: "shadow",
								label: t("optShadow")
							},
							{
								value: "control",
								label: t("optControl")
							},
							{
								value: "hybrid",
								label: t("optHybrid")
							}
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectRow, {
						card,
						field: "evidence.judge.provider",
						options
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
						card,
						field: "evidence.hybridBorderline"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "evidence.maxJevQuestions",
						unit: "count"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
						card,
						field: "evidence.judge.allowLlm",
						risk: t("riskModel")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Fold, {
						id: "judge-coverage",
						title: t("judgeGroupCoverage"),
						hint: t("judgeGroupCoverageHint"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectRow, {
								card,
								field: "evidence.coverage.mode",
								options: [
									off,
									{
										value: "shadow",
										label: t("optShadow")
									},
									{
										value: "control",
										label: t("optControl")
									}
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectRow, {
								card,
								field: "evidence.coverage.provider",
								options
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
								card,
								field: "evidence.coverage.thresholds.weak"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
								card,
								field: "evidence.coverage.thresholds.covered"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Fold, {
						id: "judge-budget",
						title: t("judgeGroupBudget"),
						hint: t("judgeGroupBudgetHint"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
								card,
								field: "evidence.budget.perSearchInputTokens",
								unit: "tokens"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
								card,
								field: "evidence.budget.dailyInputTokens",
								unit: "tokens"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextRow, {
								card,
								field: "evidence.budget.timezone",
								placeholder: "Asia/Shanghai"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("judgeGroupProviders") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(JsonList, {
						card,
						fields: jsonFieldsOf("judge")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RubricList, { card })
				]
			});
		}
		//#endregion
		//#region src/client/group-order.tsx
		/**
		* "Search order": the order a plain search tries its engines, and the order each platform tries its backends, as lists one
		* moves, adds to and removes from (not as a comma text). Below the engine list sits the order a search would really use, with a
		* sentence on why it differs from the list; the platforms are rows with a dialog. Everything stages into the same draft the sticky
		* save bar writes: `engines` and `platformBackends` as they are, `sources.confidence.<id>` for the confidence box of a row.
		* @module web-search-pro/client/group-order
		*/
		/** The fields of this group, for its "N overridden" badge (the confidence entries are counted by their prefix). */
		const ORDER_FIELDS = ["engines", "platformBackends"];
		/** Whether the card can tell a source runs: its key, its address, its spec, or (when the plugin answers) the plugin's own probe. */
		function sourceState(snapshot, info, t) {
			const live = snapshot.server.status?.sources[info.id];
			if (info.kind === "keyed" && info.def) {
				const def = info.def;
				if (def.credential) {
					const cred = snapshot.credentials[def.credential];
					return cred.loading ? {
						tone: "neutral",
						label: t("credentialChecking")
					} : cred.configured ? {
						tone: "success",
						label: t("stateReady")
					} : {
						tone: "warning",
						label: t("stateNoKey")
					};
				}
				return (snapshot.fields.searxngUrl?.text ?? "") !== "" ? {
					tone: "success",
					label: t("stateReady")
				} : {
					tone: "warning",
					label: t("stateNoUrl")
				};
			}
			if (info.kind === "custom") {
				const problems = customRows(adaptersOf(snapshot.fields.cliAdapters.text)).find((row) => row.id === info.id.slice(11))?.problems ?? [];
				if (problems.length) return {
					tone: "danger",
					label: t("stateSpecBad"),
					reason: problems[0]
				};
				if (live) return live.available ? {
					tone: "success",
					label: t("stateReady")
				} : {
					tone: "warning",
					label: t("stateNotReady"),
					...live.reason ? { reason: live.reason } : {}
				};
				return {
					tone: "neutral",
					label: t("stateSpecOk")
				};
			}
			if (info.kind === "unknown") return info.id.startsWith("custom-cli:") ? {
				tone: "danger",
				label: t("stateNoSpec")
			} : {
				tone: "warning",
				label: t("stateUnknown")
			};
			if (live && !live.available) return {
				tone: "warning",
				label: t("stateNotReady"),
				...live.reason ? { reason: live.reason } : {}
			};
			return {
				tone: "success",
				label: t("stateReady")
			};
		}
		/** Confidence a source has when nothing is set for it. */
		const defaultConfidence = (info, adapters) => {
			if (info.kind !== "custom") return 1;
			const raw = customEntries(adapters).find(([key]) => key === info.id.slice(11))?.[1];
			return typeof raw?.confidence === "number" ? raw.confidence : DEFAULT_CUSTOM_CONFIDENCE;
		};
		/**
		* The confidence of a source, as a labelled box. While it is 1 (the built-in default, which changes nothing) it is only a quiet
		* "Confidence · default 1" that opens into the box on a click; any other value, or a wrong one, keeps the box open and picked out.
		*/
		function ConfidenceBox({ card, info, adapters, fallback }) {
			const { t } = card;
			const [open, setOpen] = (0, react.useState)(false);
			const field = confidenceField(info.id);
			const text = card.useWebSearchPro((snapshot) => snapshot.fields[field]?.text ?? "");
			const invalid = card.useWebSearchPro((snapshot) => snapshot.fields[field]?.invalid ?? false);
			const disabled = card.useWebSearchPro((snapshot) => !snapshot.writable || snapshot.saving);
			const dflt = fallback ?? defaultConfidence(info, adapters);
			const view = confidenceView(text, dflt);
			const name = fill(t("orderConfidenceOf"), { name: info.name });
			const help = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Help, {
				label: t("helpLabel"),
				text: t("orderConfidenceHelp")
			});
			if (view.quiet && !open && !invalid) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "wsp-conf",
				"data-wsp-confidence": "quiet",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "wsp-conf-quiet",
						disabled,
						"aria-label": name,
						title: t("orderConfidenceEdit"),
						onClick: () => setOpen(true),
						children: [
							t("orderConfidenceLabel"),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: view.typed ? view.effective : fill(t("orderConfidenceDefault"), { c: view.effective }) })
						]
					}),
					help,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentMark, {
						card,
						itemKey: "sources.confidence." + info.id,
						compact: true
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: view.quiet && !invalid ? "wsp-conf" : "wsp-conf wsp-conf-on",
				"data-wsp-confidence": "set",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						className: "wsp-conf-label",
						htmlFor: "wsp-conf-" + info.id,
						children: t("orderConfidenceLabel")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
						id: "wsp-conf-" + info.id,
						small: true,
						numeric: true,
						value: text,
						placeholder: String(dflt),
						invalid: invalid || view.invalid,
						disabled,
						ariaLabel: name,
						autoFocus: open,
						onBlur: () => setOpen(false),
						onChange: (value) => card.edit(field, value)
					}),
					help,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentMark, {
						card,
						itemKey: "sources.confidence." + info.id,
						compact: true
					})
				]
			});
		}
		/** One row of an ordered list: its place, name, readiness and confidence, and the buttons that move it. */
		function OrderItem(props) {
			const { card, info, index, count, state } = props;
			const { t } = card;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: props.muted ? "wsp-order-row wsp-order-default" : "wsp-order-row",
				"data-wsp-order-item": info.id,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Item, {
					data: info.id,
					title: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wsp-order-no",
							children: index + 1
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: info.name }),
						info.name !== info.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: info.id }) : null
					] }),
					badges: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [info.kind === "custom" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: "outline",
						children: t("kindCustom")
					}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: state.tone,
						children: state.label
					})] }),
					meta: state.reason,
					actions: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfidenceBox, {
							card,
							info,
							adapters: props.adapters,
							fallback: props.fallback
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							ariaLabel: t("orderUp"),
							title: t("orderUp"),
							disabled: props.disabled || index === 0,
							onClick: () => props.onMove(-1),
							data: "order-up",
							children: "↑"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							ariaLabel: t("orderDown"),
							title: t("orderDown"),
							disabled: props.disabled || index === count - 1,
							onClick: () => props.onMove(1),
							data: "order-down",
							children: "↓"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							ariaLabel: t("orderRemove"),
							title: t("orderRemove"),
							danger: true,
							disabled: props.disabled,
							onClick: props.onRemove,
							data: "order-remove",
							children: "×"
						})
					] })
				})
			});
		}
		/** A closed drop-down that adds the source picked (it snaps back to its title). */
		function AddSelect({ label, title, choices, onAdd, disabled, name }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				"data-wsp-add": name,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Select, {
					ariaLabel: label,
					value: "",
					options: [{
						value: "",
						label: title
					}, ...choices],
					disabled: disabled || choices.length === 0,
					onChange: (value) => {
						if (value) onAdd(value);
					}
				})
			});
		}
		function whyText(t, reasons) {
			if (!reasons.length) return t("orderWhySame");
			const text = (reason) => {
				const ids = reason.ids.join(", ");
				switch (reason.kind) {
					case "common": return fill(t("orderWhyCommon"), { ids });
					case "disabled": return fill(t("orderWhyDisabled"), { ids });
					case "priority": return fill(t("orderWhyPriority"), { ids });
					case "anonymous-only": return fill(t("orderWhyAnonymous"), { ids });
					case "own-list": return fill(t("orderWhyOwn"), { ids });
				}
			};
			return reasons.map(text).join(" ");
		}
		/** The chain a plain search would try, from the draft, and one sentence on why it is not the list as written. */
		function EffectiveChain({ card }) {
			const { t } = card;
			const view = card.useWebSearchPro((snapshot) => explainChain(chainInputOf(snapshot)));
			const agent = card.useWebSearchPro((snapshot) => agentChainOf(snapshot));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-wsp-effective": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: styles.chain,
						role: "status",
						"data-wsp-chain": true,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("chainNow") }), view.chain?.length ? view.chain.map((id, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [index ? "› " : "", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: id })] }, id + index)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("chainEmpty") })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: styles.why,
						"data-wsp-why": true,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("orderWhy") }),
							" ",
							view.chain ? whyText(t, view.reasons) : t("orderWhyNone")
						]
					}),
					agent ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: styles.why,
						"data-wsp-effective-agent": true,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("orderAgentChain") }),
							" ",
							agent.length ? agent.map((id, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								index ? "› " : "",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: id }),
								" "
							] }, id + index)) : t("orderAgentChainNone")
						]
					}) : null
				]
			});
		}
		function EngineOrder({ card }) {
			const { t } = card;
			const field = useField(card, "engines");
			const adaptersValue = adaptersOf(card.useWebSearchPro((snapshot) => snapshot.fields.cliAdapters.text));
			const ids = idsOf(field.state.text);
			const st = field.state;
			const set = (next) => field.edit(textOf(next));
			const choices = engineChoices(ids, adaptersValue).map((id) => ({
				value: id,
				label: sourceInfo(id, adaptersValue).name + (sourceInfo(id, adaptersValue).name !== id ? " (" + id + ")" : "")
			}));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
				field: "engines",
				label: t("engines"),
				hint: t("enginesHint"),
				help: hasHelp("engines") ? t(`${labelKey("engines")}Help`) : void 0,
				overridden: st.overridden,
				invalid: st.invalid || !!st.message,
				problem: st.message ?? t("invalid"),
				warning: st.warning,
				disabled: field.disabled,
				labels: rowLabels(t),
				wide: true,
				mark: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentMark, {
					card,
					itemKey: "engines"
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.stack,
					"data-wsp-order": "engines",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: styles.list,
							role: "list",
							"aria-label": t("orderListLabel"),
							children: ids.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: styles.empty,
								children: t("orderEmpty")
							}) : ids.map((id, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EngineRow, {
								card,
								id,
								index,
								ids,
								adapters: adaptersValue,
								disabled: field.disabled,
								onChange: set
							}, id))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.orderBar,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddSelect, {
								name: "engine",
								label: t("orderAddLabel"),
								title: t("orderAdd"),
								choices,
								disabled: field.disabled,
								onAdd: (id) => set(addId(ids, id))
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								disabled: field.disabled || !st.overridden,
								onClick: field.reset,
								data: "order-restore",
								children: t("orderRestore")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EffectiveChain, { card })
					]
				})
			});
		}
		function EngineRow({ card, id, index, ids, adapters, disabled, onChange }) {
			const { t } = card;
			const info = sourceInfo(id, adapters);
			const state = card.useWebSearchPro((snapshot) => sourceState(snapshot, info, t));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OrderItem, {
				card,
				info,
				index,
				count: ids.length,
				adapters,
				state,
				disabled,
				onMove: (delta) => onChange(moveId(ids, id, delta)),
				onRemove: () => onChange(removeId(ids, id))
			});
		}
		/** The chain a platform uses now: the override when there is one, else the built-in default. */
		function chainFor(text, platform) {
			const chains = chainsOf(text);
			if (!chains) return {
				ids: [...defaultChainOf(platform)],
				overridden: false,
				valid: false
			};
			const own = chains[platform];
			return own ? {
				ids: own,
				overridden: true,
				valid: true
			} : {
				ids: [...defaultChainOf(platform)],
				overridden: false,
				valid: true
			};
		}
		function PlatformItem({ card, platform, onEdit }) {
			const { t } = card;
			const text = card.useWebSearchPro((snapshot) => snapshot.fields.platformBackends.text);
			const disabled = card.useWebSearchPro((snapshot) => !snapshot.writable);
			const chain = chainFor(text, platform);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Item, {
				data: platform,
				title: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: PLATFORM_NAMES[platform] ?? platform }),
				badges: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					platform in PLATFORM_NAMES && PLATFORM_NAMES[platform] !== platform ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: platform }) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: chain.overridden ? "info" : "outline",
						children: chain.overridden ? t("overridden") : t("orderDefaultBadge")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentMark, {
						card,
						itemKey: "platformBackends." + platform,
						compact: true
					})
				] }),
				meta: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: chain.overridden ? void 0 : styles.muted,
					children: chain.ids.map(backendName).join(" › ") || t("platformEmpty")
				}),
				actions: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
					disabled,
					onClick: onEdit,
					data: "platform-edit",
					children: t("edit")
				})
			});
		}
		/** The body of the platform dialog: the chain as a list with its buttons, the backends that can still be added, and "Restore default". */
		function PlatformForm({ card, platform }) {
			const { t } = card;
			const field = useField(card, "platformBackends");
			const adaptersValue = adaptersOf(card.useWebSearchPro((snapshot) => snapshot.fields.cliAdapters.text));
			const chain = chainFor(field.state.text, platform);
			const write = (ids) => {
				const next = withChain(field.state.text, platform, ids);
				if (next !== void 0) field.edit(next);
			};
			if (!chain.valid) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: `${styles.rowHint} wsp-bad`,
				role: "alert",
				children: t("platformChainBad")
			});
			const choices = backendChoices(platform, chain.ids, adaptersValue).map((id) => ({
				value: id,
				label: backendName(id) + (backendName(id) !== id ? " (" + id + ")" : "")
			}));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.stack,
				"data-wsp-order": "platform:" + platform,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: styles.list,
					role: "list",
					"aria-label": t("orderListLabel"),
					children: chain.ids.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.empty,
						children: t("platformEmpty")
					}) : chain.ids.map((id, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BackendRow, {
						card,
						platform,
						id,
						index,
						ids: chain.ids,
						muted: !chain.overridden,
						adapters: adaptersValue,
						disabled: field.disabled,
						onChange: write
					}, id))
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.orderBar,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddSelect, {
							name: "backend",
							label: t("orderAddLabel"),
							title: choices.length ? t("orderAdd") : t("platformAddNone"),
							choices,
							disabled: field.disabled,
							onAdd: (id) => write(addId(chain.ids, id))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							disabled: field.disabled || !chain.overridden,
							onClick: () => write(void 0),
							data: "platform-restore",
							children: t("orderRestore")
						}),
						!chain.overridden ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
							tone: "outline",
							children: t("orderDefaultBadge")
						}) : null
					]
				})]
			});
		}
		function BackendRow({ card, platform, id, index, ids, muted, adapters, disabled, onChange }) {
			const { t } = card;
			const custom = isCustomId(id);
			const base = custom ? sourceInfo(id, adapters) : {
				id,
				name: backendName(id),
				kind: "unknown"
			};
			const info = custom ? base : {
				...base,
				kind: "anonymous"
			};
			const leg = card.useWebSearchPro((snapshot) => snapshot.server.status?.legs[platform + "/" + id]);
			const state = card.useWebSearchPro((snapshot) => {
				if (custom) return sourceState(snapshot, info, t);
				return leg ? leg.ready ? {
					tone: "success",
					label: t("stateReady")
				} : {
					tone: "warning",
					label: t("stateNotReady"),
					...leg.reason ? { reason: leg.reason } : {}
				} : {
					tone: "neutral",
					label: t("backendUnknown")
				};
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OrderItem, {
				card,
				info,
				index,
				count: ids.length,
				adapters,
				state,
				fallback: leg?.confidence,
				muted,
				disabled,
				onMove: (delta) => onChange(moveId(ids, id, delta)),
				onRemove: () => onChange(removeId(ids, id))
			});
		}
		function PlatformList({ card }) {
			const { t } = card;
			const [editing, setEditing] = (0, react.useState)();
			const [query, setQuery] = (0, react.useState)("");
			const split = card.useWebSearchPro((snapshot) => splitPlatforms(ORDER_PLATFORMS, snapshot.fields.platformBackends.text, adaptersOf(snapshot.fields.cliAdapters.text)));
			const row = (platform) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlatformItem, {
				card,
				platform,
				onEdit: () => setEditing(platform)
			}, platform);
			const filtering = query.trim() !== "";
			const found = filterPlatforms(ORDER_PLATFORMS, query);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wsp-filter",
					"data-wsp-platform-filter": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextInput, {
						value: query,
						onChange: setQuery,
						placeholder: t("orderPlatformFilter"),
						ariaLabel: t("orderPlatformFilterLabel")
					}), filtering ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: styles.rowHint,
						children: fill(t("orderPlatformFound"), {
							n: found.length,
							total: ORDER_PLATFORMS.length
						})
					}) : null]
				}),
				filtering ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: styles.list,
					"data-wsp-platform-list": true,
					children: found.length ? found.map(row) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.empty,
						children: t("orderPlatformNone")
					})
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: styles.list,
					"data-wsp-platform-list": true,
					children: split.shown.map(row)
				}), split.rest.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Fold, {
					id: "platforms-more",
					title: fill(t("orderPlatformsMore"), { n: split.rest.length }),
					hint: t("orderPlatformsMoreHint"),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: styles.list,
						"data-wsp-platform-rest": true,
						children: split.rest.map(row)
					})
				}) : null] }),
				editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Dialog, {
					open: true,
					title: fill(t("platformDialogTitle"), { name: PLATFORM_NAMES[editing] ?? editing }),
					closeLabel: t("close"),
					description: t("platformDialogNote"),
					onClose: () => setEditing(void 0),
					footer: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
						primary: true,
						onClick: () => setEditing(void 0),
						data: "platform-done",
						children: t("done")
					}),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						children: t("dialogStagesNote")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlatformForm, {
						card,
						platform: editing
					})]
				}) : null
			] });
		}
		/** Open another group of the card (the "Sources" group holds `sources.priority` / `sources.disabled`) and scroll to it. */
		function openGroup(id) {
			const node = document.querySelector(`[data-wsp-group="${id}"]`);
			if (!node) return;
			node.open = true;
			node.scrollIntoView?.({
				block: "start",
				behavior: "smooth"
			});
		}
		function OrderGroup({ card }) {
			const { t } = card;
			const count = useOverriddenCount(card, ORDER_FIELDS) + card.useWebSearchPro((snapshot) => Object.keys(snapshot.fields).filter((field) => field.startsWith("sources.confidence.") && snapshot.fields[field]?.overridden).length);
			const rules = card.useWebSearchPro((snapshot) => ({
				priority: (snapshot.fields["sources.priority"]?.text ?? "").trim(),
				disabled: (snapshot.fields["sources.disabled"]?.text ?? "").trim()
			}));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Group, {
				id: "order",
				title: t("groupOrder"),
				summary: t("groupOrderSub"),
				badges: count ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
					tone: "info",
					children: fill(t("overriddenCount"), { n: count })
				}) : null,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("orderEnginesTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EngineOrder, { card }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: styles.rowHint,
						"data-wsp-order-rules": true,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [t("orderRulesTitle"), "."] }),
							" ",
							t("orderRulesNote"),
							" ",
							fill(t("orderPriorityNow"), { ids: rules.priority || t("orderNone") }),
							" · ",
							fill(t("orderDisabledNow"), { ids: rules.disabled || t("orderNone") }),
							" · ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: styles.link,
								onClick: () => openGroup("sources"),
								"data-wsp-open-sources": true,
								children: t("orderRulesLink")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("orderPlatformsTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						children: t("orderPlatformsNote")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlatformList, { card })
				]
			});
		}
		//#endregion
		//#region src/client/group-runtime.tsx
		/**
		* "Runtime and backends": the CLI / OpenCLI / Agent Reach switches, the Twitter / X login values (a dialog), the JSON objects
		* that shape backends (Playwright, platform backend chains, CLI adapters) and the platform settings (custom platforms,
		* selectors, browser bindings), each as a list with its own dialog. The backend order of the platforms and the custom CLIs have their own
		* groups ("Search order", "Custom CLI"); their raw JSON is under "Advanced".
		* @module web-search-pro/client/group-runtime
		*/
		const RUNTIME = [
			"enableCliBackends",
			"opencliEnabled",
			"agentReachEnabled",
			"twitterAuthTokenEnv",
			"twitterCt0Env",
			"playwright",
			"customPlatforms",
			"platformRules",
			"browserBindings"
		];
		/** The two values twitter-cli needs: the controls of the dialog. */
		function TwitterForm({ card }) {
			const { t } = card;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextRow, {
					card,
					field: "twitterAuthTokenEnv",
					code: true,
					placeholder: "TWITTER_AUTH_TOKEN"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretRow, {
					card,
					id: "twitter-auth-token",
					label: t("twitterAuthToken")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextRow, {
					card,
					field: "twitterCt0Env",
					code: true,
					placeholder: "TWITTER_CT0"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretRow, {
					card,
					id: "twitter-ct0",
					label: t("twitterCt0")
				})
			] });
		}
		function TwitterItem({ card }) {
			const { t } = card;
			const [open, setOpen] = (0, react.useState)(false);
			const view = card.useWebSearchPro((snapshot) => ({
				a: snapshot.credentials["twitter-auth-token"],
				b: snapshot.credentials["twitter-ct0"],
				writable: snapshot.writable
			}));
			const both = view.a.configured && view.b.configured;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: styles.list,
				"data-wsp-twitter": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Item, {
					data: "twitter",
					title: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("twitterGroup") }),
					badges: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						tone: both ? "success" : view.a.configured || view.b.configured ? "warning" : "neutral",
						children: both ? t("credentialSet") : view.a.configured || view.b.configured ? t("twitterPartial") : t("credentialUnset")
					}),
					meta: t("twitterGroupHint"),
					actions: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
						disabled: !view.writable,
						onClick: () => setOpen(true),
						data: "twitter-edit",
						children: t("edit")
					})
				})
			}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Dialog, {
				open: true,
				title: t("twitterGroup"),
				closeLabel: t("close"),
				description: t("twitterGroupHint"),
				onClose: () => setOpen(false),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
					primary: true,
					onClick: () => setOpen(false),
					children: t("done")
				}),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: styles.rowHint,
					children: t("dialogStagesNote")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TwitterForm, { card })]
			}) : null] });
		}
		function RuntimeGroup({ card }) {
			const { t } = card;
			const n = useOverriddenCount(card, RUNTIME);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Group, {
				id: "runtime",
				title: t("groupRuntime"),
				summary: t("groupRuntimeSub"),
				badges: n ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
					tone: "info",
					children: fill(t("overriddenCount"), { n })
				}) : null,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
						card,
						field: "enableCliBackends"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
						card,
						field: "opencliEnabled"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
						card,
						field: "agentReachEnabled"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("runtimeLoginTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TwitterItem, { card }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("runtimeBackendsTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(JsonList, {
						card,
						fields: jsonFieldsOf("runtime")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubHead, { children: t("runtimePlatformsTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(JsonList, {
						card,
						fields: jsonFieldsOf("platform")
					})
				]
			});
		}
		//#endregion
		//#region src/client/groups-basic.tsx
		/**
		* The small groups: "Reading and evidence", "Network and cache", "Ranking weights" (advanced) and the built-in web tool
		* "Route". Each is a handful of rows built from the same controls; the long explanations sit behind the `?`.
		* @module web-search-pro/client/groups-basic
		*/
		const count = (card, fields, t) => {
			const n = useOverriddenCount(card, fields);
			return n ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
				tone: "info",
				children: fill(t("overriddenCount"), { n })
			}) : null;
		};
		const READING = [
			"fetchDefaultChars",
			"exaContentsPerUrlChars",
			"exaContentsTotalChars",
			"evidence.autoProviders",
			"evidence.maxRounds",
			"evidence.maxQueries"
		];
		function ReadingGroup({ card }) {
			const { t } = card;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Group, {
				id: "reading",
				title: t("groupReading"),
				summary: t("groupReadingSub"),
				badges: count(card, READING, t),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "fetchDefaultChars",
						unit: "chars"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "exaContentsPerUrlChars",
						unit: "chars"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "exaContentsTotalChars",
						unit: "chars"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
						card,
						field: "evidence.autoProviders"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "evidence.maxRounds",
						unit: "rounds"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "evidence.maxQueries",
						unit: "count"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.notice,
						role: "note",
						children: t("evidenceNote")
					})
				]
			});
		}
		const NETWORK = [
			"timeoutMs",
			"ttlSeconds",
			"memoryCacheEntries",
			"dbPath",
			"verbose"
		];
		function NetworkGroup({ card }) {
			const { t } = card;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Group, {
				id: "network",
				title: t("groupNetwork"),
				summary: t("groupNetworkSub"),
				badges: count(card, NETWORK, t),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "timeoutMs",
						unit: "ms"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "ttlSeconds",
						unit: "sec"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "memoryCacheEntries",
						unit: "count"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextRow, {
						card,
						field: "dbPath",
						code: true
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
						card,
						field: "verbose"
					})
				]
			});
		}
		const RANKING = [
			"rrfConstant",
			"freshnessBoost",
			"freshnessDays",
			"authorityBoost",
			"authorityDomains"
		];
		function RankingGroup({ card }) {
			const { t } = card;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Group, {
				id: "ranking",
				title: t("groupRanking"),
				summary: t("groupRankingSub"),
				badges: count(card, RANKING, t),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "rrfConstant"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "freshnessBoost"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "freshnessDays",
						unit: "days"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
						card,
						field: "authorityBoost"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListRow, {
						card,
						field: "authorityDomains",
						placeholder: "docs.example.com"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.notice,
						role: "note",
						children: t("rankingNote")
					})
				]
			});
		}
		const ROUTE = [
			"registerProvider",
			"providerId",
			"provider.evidence",
			"provider.deadlineMs"
		];
		function RouteGroup({ card }) {
			const { t } = card;
			const on = card.useWebSearchPro((snapshot) => snapshot.fields.registerProvider.text === "true");
			const routeId = card.useWebSearchPro((snapshot) => snapshot.fields.providerId.text.trim() || "web-search-pro");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Group, {
				id: "route",
				title: t("groupRoute"),
				summary: t("groupRouteSub"),
				badges: count(card, ROUTE, t),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
						card,
						field: "registerProvider"
					}),
					on ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextRow, {
							card,
							field: "providerId",
							code: true
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectRow, {
							card,
							field: "provider.evidence",
							options: [{
								value: "auto",
								label: t("optAuto")
							}, {
								value: "off",
								label: t("optOff")
							}]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberRow, {
							card,
							field: "provider.deadlineMs",
							unit: "ms"
						})
					] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.rowHint,
						children: t("routeOffNote")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Fold, {
						id: "route-patch",
						title: t("routeHelpTitle"),
						hint: t("routeHelpFoldHint"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							"data-wsp-route-help": true,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: styles.rowHint,
									children: t("routeHelpIntro")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
									className: styles.codeBlock,
									children: `- id: web\n  name: '@deepseek-ai/dsh-web'\n  config:\n    searchProvider: ${routeId}\n    fetchProvider: ${routeId}`
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: styles.rowHint,
									children: t("routeHelpAfter")
								})
							]
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/SettingsCard.tsx
		function SettingsCard(props) {
			if (props.view === "summary") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: props.t("description") });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Frame, {
				card: props,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SummaryBar, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CommonGroup, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(OrderGroup, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourcesGroup, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CliGroup, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReadingGroup, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(JudgeGroup, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RouteGroup, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RuntimeGroup, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NetworkGroup, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RankingGroup, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentGroup, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdvancedGroup, { card: props }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SaveBar, { card: props })
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* The two dictionaries of the settings card. Each field has a label, a one-line hint (`<key>Hint`) and, where the explanation
		* is longer, a `?` text (`<key>Help`); the keys are named in field-keys.ts. A test pins both dictionaries to the same keys and
		* to every key the card asks for.
		* @module web-search-pro/client/locales
		*/
		const zh = {
			tab: "Web Search Pro",
			title: "Web Search Pro",
			description: "搜索引擎、来源与 Key、评分模型、读取与缓存、平台规则",
			lang: "zh",
			readOnly: "当前设置文档为只读，无法保存修改。",
			unavailable: "设置暂时不可用：宿主没有提供这个插件的配置表单。",
			reset: "恢复默认",
			overridden: "已覆盖",
			overriddenCount: "{n} 项已覆盖",
			invalid: "输入值无效，请检查范围或格式。",
			invalidJson: "JSON 无效；必须是一个对象。",
			helpLabel: "更多说明",
			edit: "编辑",
			close: "关闭",
			done: "完成",
			emptyDefault: "（默认）",
			optionOff: "off",
			chipRemove: "移除",
			save: "保存",
			saving: "保存中…",
			discardChanges: "放弃修改",
			saveFailed: "Host 未接受全部修改；草稿已保留，请检查冲突或日志。",
			savebarClean: "没有未保存的修改",
			savebarDirty: "{n} 项未保存的修改",
			savebarInvalid: "有无效的输入，修正后才能保存",
			dialogStagesNote: "这里的修改先留在草稿里，点页面底部的“保存”才写入。",
			summaryTitle: "当前状态",
			summaryChain: "默认引擎链",
			summaryChainEmpty: "（空）",
			summaryKeys: "已配置 Key 的来源 {n}/{m}",
			summaryReady: "已就绪",
			summaryNoKey: "未配置 Key",
			summaryRouteOn: "内置 web 工具：经本插件",
			summaryRouteOff: "内置 web 工具：未接入",
			summaryJudge: "评分模型",
			summarySurface: "工具面",
			summaryWarnings: "{n} 条提示",
			summaryNoWarnings: "无提示",
			summaryDetails: "查看详情",
			warningsTitle: "需要注意的设置",
			warningsNone: "当前草稿没有校验提示。",
			unitMs: "毫秒",
			unitSeconds: "秒",
			unitChars: "字符",
			unitCount: "",
			unitTokens: "token",
			unitDays: "天",
			riskNetwork: "网络",
			riskBilled: "计费",
			riskModel: "调用模型",
			groupCommon: "常用",
			groupCommonSub: "默认引擎链、结果数、工具面、代理 fake-IP、DeepSeek 搜索",
			groupSources: "来源",
			groupSourcesSub: "排序策略与每个来源的 Key、地址、请求额度",
			groupReading: "读取与证据",
			groupReadingSub: "读页字数、补搜轮数、按语言自动选来源",
			groupJudge: "评分模型",
			groupJudgeSub: "可选的付费 / 本地模型与提示词（默认关闭）",
			groupRoute: "内置 web 工具路由",
			groupRouteSub: "让宿主内置 web_search / web_fetch 经过本插件",
			groupRuntime: "运行时与后端",
			groupRuntimeSub: "CLI / OpenCLI、Twitter 登录值、后端链、平台与浏览器绑定",
			groupNetwork: "网络与缓存",
			groupNetworkSub: "超时、缓存有效期、数据库路径、诊断日志",
			groupRanking: "排序加权",
			groupRankingSub: "多来源融合的排名常数与时效 / 权威加分（高级）",
			groupAdvanced: "高级：文本模式",
			groupAdvancedSub: "带注释的 YAML 视图，可复制",
			chainNow: "实际尝试顺序：",
			chainEmpty: "没有可用的引擎",
			commonDeepseekTitle: "DeepSeek 搜索 / 抓取（常用）",
			commonBadge: "常用",
			engines: "默认引擎链",
			enginesHint: "从上到下依次尝试；用箭头调整顺序。",
			enginesHelp: "例如 ddg、bing、exa、seam、jina。保持默认列表时，DeepSeek Key 就绪会把 deepseek 排最前；你自己写的列表按所写顺序，调用里的 engines 永远最优先。",
			searchMaxResults: "默认结果数",
			searchMaxResultsHint: "1–20；调用没写 count 时用。",
			parallelEngines: "并行融合多个引擎",
			parallelEnginesHint: "同时查全部默认引擎并融合，而非依次回退。",
			toolSurface: "工具面",
			toolSurfaceHint: "模型看到的工具形态；启动时读取。",
			toolSurfaceHelp: "indexed：只暴露 web_index / web_call，常驻文本最少（默认）。flat：每个动作一个工具，仅用于对比和调试。改完需重启。",
			optIndexed: "indexed · 两个入口（默认）",
			optFlat: "flat · 每动作一个工具（调试）",
			allowProxyFakeIp: "允许代理 fake-IP DNS",
			allowProxyFakeIpHint: "Clash / TUN 下搜索报“fake-IP”时打开。",
			allowProxyFakeIpHelp: "开着 Clash / TUN 等代理时，若搜索报“地址被拦截 / 私网地址”，且域名被解析成 198.18.x.x，就打开它：只信任 fake-IP 段（198.18/15、fdfe:dcba:9876::/64、2001:2::/48），字面 IP、localhost 与其他私网仍被拒绝。",
			deepseekFetch: "用 DeepSeek Fetch 读取网页",
			deepseekFetchHint: "默认关闭；按请求计费。",
			deepseekFetchHelp: "开启后 read.fetch 在 Jina、直连都没拿到正文时，改用 DeepSeek Fetch API（每 1000 次成功请求 $0.75，空结果与失败不计费），之后才轮到浏览器渲染；也可显式用 mode=deepseek。与 DeepSeek 搜索共用同一个 Key。",
			strategyGroup: "来源策略",
			strategyNote: "顺序：调用里的 engines / platform 最优先 → 下面的“优先来源” → 你配置了 Key 的来源（“常用”的 DeepSeek 排最前）→ 匿名 / 免费默认。付费来源只在配置了 Key 才会用到。",
			sourcePolicy: "来源策略",
			sourcePolicyHint: "是否允许自动规划用需要 Key 的来源。",
			sourcePolicyHelp: "default：按上述顺序。anonymous-only：即使配置了 Key，自动规划也绝不使用需要 Key、账号或登录的来源（调用里明确指定的仍可用）。",
			optPolicyDefault: "default · 按顺序（默认）",
			optPolicyAnonymousOnly: "anonymous-only · 只用匿名来源",
			srcPriority: "优先来源",
			srcPriorityHint: "按顺序排最前的来源 id。",
			srcPriorityHelp: "仅限就绪且适合任务语言与 profile 的来源；例：deepseek, exa。留空 = 不指定。调用里的 engines 仍最优先。",
			srcDisabled: "停用来源",
			srcDisabledHint: "自动规划与默认引擎链都不再用它们。",
			srcDisabledHelp: "调用里明确指定的来源仍可用。想关掉按量计费的 DeepSeek 默认，就在这里写 deepseek。",
			sourcesListTitle: "需要 Key 或地址的来源",
			sourcesListHint: "点“编辑”设置 Key 引用名、Key、地址与请求额度；Key 写入 DSH Credentials，页面从不显示明文。",
			tierPaid: "付费",
			tierFree: "有免费额度",
			tierAnonymous: "免 Key",
			sourceConfigured: "已设置",
			sourceNotConfigured: "未设置",
			sourceMetaRef: "Key 引用名 {ref}",
			sourceMetaCapped: "已设请求上限",
			sourceMetaNoUrl: "未设置地址",
			sourceDialogTitle: "{name}",
			sourceResetAll: "恢复本项默认",
			sourceNoteDeepseek: "DeepSeek 搜索 / 抓取，“常用”来源：有 Key 时中英文都排第一。按请求计费：每 1000 次成功请求 $0.75，空结果与失败不计费；插件直接调用按会计费处理。与 DeepSeek 模型用同一个 DEEPSEEK_API_KEY。页面读取开关在“常用”组。",
			sourceNoteBocha: "博查：中文搜索，付费。账号没有搜索余额时返回 403。",
			sourceNoteExa: "Exa：有 Key 走原生 API；没有 Key 时可经 mcporter 的 MCP 回退。",
			sourceNoteJina: "Jina：搜索与页面读取；每个新 Key 有一次性免费额度。",
			sourceNoteGithub: "GitHub Token 可选，只用来提高 API 限额。",
			sourceNoteSearxng: "自建 SearXNG 实例（需开启 JSON 格式）；设置地址后才有 searxng 来源，无内置公共实例。",
			sourceNoteKeyed: "填入 Key 引用名即可启用；没有 Key 前该来源不可用。地址只在使用代理或私有网关时覆盖。",
			keyedEnv: "Key 引用名",
			keyedEnvHint: "凭据 / 环境变量名；留空用默认：",
			keyedBaseUrl: "接口地址",
			keyedBaseUrlHint: "留空用内置地址；须为 http(s) URL。",
			keyedApiKey: "API Key",
			credentialWriteOnlyHint: "只写输入；留空不会覆盖已保存的密钥。",
			credentialReadOnlyHint: "当前凭据服务只读，无法在这里写入。",
			credentialChecking: "检查中…",
			credentialSet: "已配置",
			credentialUnset: "未配置",
			bochaApiKeyEnv: "博查 Key 引用名",
			bochaApiKeyEnvHint: "凭据 / 环境变量名；留空用默认：BOCHA_SEARCH_API_KEY。",
			bochaBaseUrl: "博查接口地址",
			bochaBaseUrlHint: "默认 https://api.bocha.cn；须为 http(s) URL。",
			bochaSummary: "请求博查长摘要",
			bochaSummaryHint: "默认开启。",
			bochaSummaryHelp: "长摘要更利于证据评分；关闭可减少返回体。",
			exaApiKeyEnv: "Exa Key 引用名",
			exaApiKeyEnvHint: "凭据 / 环境变量名；留空用默认：EXA_API_KEY。",
			jinaApiKeyEnv: "Jina Key 引用名",
			jinaApiKeyEnvHint: "凭据 / 环境变量名；留空用默认：JINA_API_KEY。",
			githubTokenEnv: "GitHub Token 引用名",
			githubTokenEnvHint: "凭据 / 环境变量名；留空用默认：GITHUB_TOKEN。",
			searxngUrl: "SearXNG 地址",
			searxngUrlHint: "自建实例的 http(s) 地址。",
			openalexMailto: "OpenAlex 联系邮箱",
			openalexMailtoHint: "写进请求的 User-Agent，礼貌性，可留空。",
			reqBudgetGroup: "请求额度（可选）",
			reqBudgetNote: "为这个来源设请求上限，计入用量账本（重启后仍有效）；用完后它被跳过并回退到其他来源，不是错误。默认没有上限。",
			reqTotal: "总量上限",
			reqTotalHint: "累计最多请求次数；留空 = 不限。",
			reqTotalHelp: "例：博查账号有 1000 次，可设总量 1000、每日 50。已用 / 剩余见 web_call sources.status。",
			reqDaily: "每日上限",
			reqDailyHint: "每个自然日最多次数；留空 = 不限。",
			reqDailyHelp: "日界线取评分用量上限里的时区。已用 / 剩余见 web_call sources.status。",
			anonymousTitle: "匿名来源（无需 Key）",
			anonymousHint: "参考表，不代表此刻可用",
			anonymousName: "来源",
			anonymousUse: "用途",
			sourcesStatusLine: "各来源的实时就绪状态（安装、Key、最近一次成功）由 web_call sources.status 显示。",
			srcUseDdg: "通用网页，默认首选",
			srcUseBing: "通用网页，与 DuckDuckGo 互补",
			srcUseWikipedia: "百科事实，中英文",
			srcUseHackernews: "英文技术讨论与经验",
			srcUseStackexchange: "编程问答（Stack Overflow）",
			srcUseOpenalex: "学术论文索引",
			srcUseSemanticscholar: "学术论文；匿名额度常被占满",
			srcUseAnysearch: "匿名通用搜索，额度有限",
			srcUseArxiv: "预印本论文",
			srcUsePubmed: "生物医学文献",
			srcUseV2ex: "中文社区讨论",
			fetchDefaultChars: "页面读取默认字数",
			fetchDefaultCharsHint: "read.fetch 单次上限，1000–500000。",
			exaContentsPerUrlChars: "Exa 正文单 URL 上限",
			exaContentsPerUrlCharsHint: "read.contents 每个 URL，至少 500。",
			exaContentsTotalChars: "Exa 正文总上限",
			exaContentsTotalCharsHint: "read.contents 一次调用总计，至少 1000。",
			evAutoProviders: "按语言自动选来源",
			evAutoProvidersHint: "擅长任务语言的就绪来源排到前面。",
			evAutoProvidersHelp: "就绪且擅长任务语言的来源（DeepSeek、博查、Exa 等）排到 profile 表前；关闭则完全按表与 engines。",
			evMaxRounds: "最多检索轮数",
			evMaxRoundsHint: "1 = 不补搜；默认 2。",
			evMaxQueries: "每任务最多搜索请求",
			evMaxQueriesHint: "含全部轮次；默认 4。",
			evidenceNote: "保底保留条数（minKeep，3）与证据包字符预算是插件内置默认或每次调用的参数（search.run 的 budget），没有配置项。",
			judgeMode: "评分模式",
			judgeModeHint: "默认 off：不调用任何模型。",
			judgeModeHelp: "off 不调用；shadow 只记录对照；control 由模型决定；hybrid 规则为主、模型复评跨语言（及边界）对。同时写入旧键 jevMode / scorer。开启前请确认 Key 与用量上限。",
			optShadow: "shadow · 只观察",
			optControl: "control · 模型决定",
			optHybrid: "hybrid · 混合",
			judgeProvider: "评分 provider",
			judgeProviderHint: "默认 bocha-jev；预设与自定义 id 可选。",
			hybridBorderline: "hybrid：边界对也复评",
			hybridBorderlineHint: "成本约翻倍。",
			hybridBorderlineHelp: "规则评分为 1 的对也交给模型。",
			maxJevQuestions: "每次搜索最多提问数",
			maxJevQuestionsHint: "（需求, 文本块）对上限，默认 64。",
			allowLlm: "允许 llm 协议",
			allowLlmHint: "默认关闭；llm 协议的 provider 要先开它。",
			allowLlmHelp: "通用 LLM 调用会消耗 token；只在确实要用 llm 协议的 provider 时打开。",
			judgeGroupCoverage: "覆盖判定",
			judgeGroupCoverageHint: "模型判断摘录是否够答",
			judgeGroupBudget: "用量上限",
			judgeGroupBudgetHint: "单次与每日 token",
			judgeGroupProviders: "自定义评分 provider",
			coverageMode: "覆盖判定模式",
			coverageModeHint: "默认 off；不随评分模式开启。",
			coverageModeHelp: "off（默认）；shadow 记录概率；control 把弱支持降级为缺口。",
			coverageProvider: "覆盖判定 provider",
			coverageProviderHint: "默认同评分 provider。",
			thresholdWeak: "弱阈值",
			thresholdWeakHint: "概率低于它判为弱；留空用校准值。",
			thresholdWeakHelp: "留空时用随插件发布的、仅对 bocha-jev + cover.sufficient v1 校准过的值。两个阈值要同时填写，弱 ≤ 覆盖。",
			thresholdCovered: "覆盖阈值",
			thresholdCoveredHint: "概率不低于它判为覆盖。",
			budgetPerSearch: "单次搜索输入上限",
			budgetPerSearchHint: "默认 60000；0 = 不调用。",
			budgetDaily: "每日输入上限",
			budgetDailyHint: "默认 1000000。",
			budgetTimezone: "日界时区",
			budgetTimezoneHint: "IANA 名称；留空用系统时区。",
			budgetProviders: "按 provider 的上限",
			budgetProvidersHint: "JSON；与全局上限取更严者。",
			judgeProviders: "自定义 provider",
			judgeProvidersHint: "JSON；按 id 定义协议、地址、模型、keyRef。",
			rubricsTitle: "提示词（rubric）",
			rubricNotes: "评分与覆盖判定向模型提的问题文本。覆盖必须换新版本号；改动会改变问题哈希，旧缓存不再复用；无效的覆盖会被忽略。",
			rubricActive: "生效版本",
			rubricOverrideOn: "已覆盖",
			rubricCreate: "从默认文本开始覆盖",
			rubricRestore: "恢复默认",
			rubricDialogTitle: "编辑提示词：{name}",
			rubricVersion: "版本号",
			rubricVersionHint: "字母数字与 . _ -，至多 32 字符，须不同于内置。",
			rubricInstructions: "提示词模板",
			rubricInstructionsHint: "只能用该 rubric 允许的变量，且含必需变量。",
			rubricCriteria: "评分等级",
			rubricCriteriaHint: "每行一级，由低到高；仅评分类，2–10 级。",
			rubricMaxState: "任务描述字符上限",
			rubricMaxStateHint: "20–2000。",
			rubricMaxCandidate: "候选文本字符上限",
			rubricMaxCandidateHint: "100–8000。",
			rubricUnknown: "设置里有不对应任何内置 rubric 的覆盖，会被忽略：",
			promptDefaultCol: "默认",
			promptMineCol: "我的覆盖",
			promptEmptyIsDefault: "留空 = 用默认",
			promptStateDefault: "默认",
			jsonEntries: "{n} 项",
			jsonDialogTitle: "编辑：{name}",
			jsonDialogHint: "这是一个 JSON 对象；校验与服务端用同一套规则。",
			registerProvider: "注册为 ctx.web provider",
			registerProviderHint: "让内置 web_search / web_fetch 可经本插件。",
			registerProviderHelp: "启动时生效。注册只是“可选”：宿主只在 web 条目写明 id 或它是唯一可用 provider 时才用它，还需要下面的 profile patch。",
			providerId: "Provider ID",
			providerIdHint: "被 web 条目或环境变量引用的稳定 id。",
			providerEvidence: "内置 web_search 返回",
			providerEvidenceHint: "auto：证据包；off：只返回来源列表。",
			optAuto: "auto · 证据包（默认）",
			optOff: "off · 来源列表",
			providerDeadlineMs: "证据运行期限",
			providerDeadlineMsHint: "到点返回已有结果，至少 100。",
			routeOffNote: "未注册：内置 web_search / web_fetch 不经过本插件。",
			routeHelpTitle: "选中本插件还需要 profile patch",
			routeHelpFoldHint: "写进 cordis.patch.yml",
			routeHelpIntro: "在 $DSH_HOME/profiles/<profile>/cordis.patch.yml 中写：",
			routeHelpAfter: "也可只设环境变量 DSH_WEB_SEARCH_PROVIDER / DSH_WEB_FETCH_PROVIDER。不要只注册而不写 fetchProvider（宿主自带的 http 与本插件同时可用时 web_fetch 会报 AMBIGUOUS）。重启后用 web_call sources.status 查看 “ctx.web route” 一行。",
			enableCliBackends: "启用 CLI 后端",
			enableCliBackendsHint: "bili、yt-dlp、OpenCLI、Agent Reach 等。",
			enableCliBackendsHelp: "允许本机 CLI 后端；关闭后这些平台后端都不会被运行。",
			opencliEnabled: "启用 OpenCLI",
			opencliEnabledHint: "经 Chrome Browser Bridge 用站点适配器。",
			opencliEnabledHelp: "允许通过已连接的 Chrome Browser Bridge 使用站点适配器。",
			agentReachEnabled: "启用 Agent Reach",
			agentReachEnabledHint: "兼容 Agent Reach 的外部后端。",
			agentReachEnabledHelp: "允许兼容 Agent Reach 的外部搜索后端。",
			runtimeLoginTitle: "登录值",
			runtimeBackendsTitle: "后端（JSON）",
			runtimePlatformsTitle: "平台与浏览器（JSON）",
			twitterGroup: "Twitter / X（twitter-cli）",
			twitterGroupHint: "twitter-cli 需要 auth_token 与 ct0；只通过子进程环境变量传给命令。",
			twitterPartial: "只配了一个",
			twitterAuthTokenEnv: "auth_token 引用名",
			twitterAuthTokenEnvHint: "凭据 / 环境变量名；默认 TWITTER_AUTH_TOKEN。",
			twitterCt0Env: "ct0 引用名",
			twitterCt0EnvHint: "凭据 / 环境变量名；默认 TWITTER_CT0。",
			twitterAuthToken: "Twitter auth_token",
			twitterCt0: "Twitter ct0",
			playwright: "Playwright 设置",
			playwrightHint: "JSON；浏览器渲染回退与截图目录。",
			platformBackends: "平台后端顺序",
			platformBackendsHint: "JSON；每个平台依次尝试的后端。",
			cliAdapters: "自定义 CLI 适配",
			cliAdaptersHint: "JSON；按 id 定义只读 CLI 适配规格。",
			customPlatforms: "自定义平台",
			customPlatformsHint: "JSON；搜索 URL 与选择器，登录态走浏览器绑定。",
			platformRules: "平台选择器覆盖",
			platformRulesHint: "JSON；按平台设 item / title / link 选择器。",
			browserBindings: "浏览器绑定",
			browserBindingsHint: "JSON；平台绑定到 dsh-browser 登录 profile 与规则包。",
			timeoutMs: "超时预算",
			timeoutMsHint: "单次增强搜索，至少 1000。",
			timeoutMsHelp: "单次增强搜索的协作超时；证据运行另有自己的期限。",
			ttlSeconds: "缓存有效期",
			ttlSecondsHint: "0 = 每次都视为过期。",
			ttlSecondsHelp: "缓存的搜索与页面保持新鲜多久；改动立即对新请求生效。",
			memoryCacheEntries: "内存缓存条目",
			memoryCacheEntriesHint: "进程内 LRU 容量，至少 1。",
			dbPath: "SQLite 路径",
			dbPathHint: "留空 = 插件默认路径。",
			verbose: "详细诊断日志",
			verboseHint: "写入加载标记并输出更多诊断。",
			rrfConstant: "RRF 常数",
			rrfConstantHint: "多来源融合的排名平滑常数 k。",
			rrfConstantHelp: "融合分 = Σ 1/(k + 名次)；k 越大，名次差距的影响越小。默认 60。",
			freshnessBoost: "时效加权",
			freshnessBoostHint: "0–1，占一个名次的比例。",
			freshnessBoostHelp: "近期结果的加分，占同一来源相邻两名分差的比例；每个 URL 只加一次。加分合计不会让第 10 名超过第 1 名。",
			freshnessDays: "时效衰减天数",
			freshnessDaysHint: "多少天内衰减到 0。",
			authorityBoost: "权威域名加权",
			authorityBoostHint: "0–1，占一个名次的比例。",
			authorityBoostHelp: "权威域名（github.com、wikipedia.org、.edu / .gov / .org 与下面的额外域名）的加分。",
			authorityDomains: "额外权威域名",
			authorityDomainsHint: "不带协议和路径。",
			rankingNote: "来源自带的 rerank_score / authority（DeepSeek）另有一项很小的加分（0.3 个名次），不在这里配置。",
			textViewTitle: "设置文本",
			textViewHint: "当前草稿的设置（不含密钥），每个键前有注释：用途、取值、默认值、风险。",
			textViewCopy: "复制",
			textViewCopied: "已复制",
			textViewNote: "这是控件的只读视图：想改设置请用上面的控件；注释行以 # 开头，被读取时忽略。",
			groupOrder: "搜索顺序",
			groupOrderSub: "通用搜索与每个平台的后端尝试顺序",
			groupCli: "自定义 CLI",
			groupCliSub: "加入你自己的只读命令行工具",
			orderEnginesTitle: "通用搜索顺序",
			orderListLabel: "引擎顺序",
			orderAdd: "添加来源…",
			orderAddLabel: "添加来源",
			orderRestore: "恢复默认顺序",
			orderEmpty: "列表是空的：至少要留一个来源。",
			orderUp: "上移",
			orderDown: "下移",
			orderRemove: "移除",
			orderConfidenceOf: "{name} 的置信度",
			orderConfidenceBadge: "置信度 {c}",
			orderConfidenceDefault: "默认 {c}",
			orderConfidenceLabel: "置信度",
			orderConfidenceEdit: "点一下修改置信度",
			orderConfidenceHelp: "只在多个来源融合排名时略微降低它的权重；1 = 不调整。",
			orderPlatformFilter: "按平台名或 id 过滤…",
			orderPlatformFilterLabel: "过滤平台",
			orderPlatformFound: "匹配 {n} / {total} 个平台",
			orderPlatformNone: "没有匹配的平台。",
			orderPlatformsMore: "显示其余 {n} 个平台",
			orderPlatformsMoreHint: "先列改过的、有自定义 CLI 的和常用的",
			stateReady: "就绪",
			stateNoKey: "缺 Key",
			stateNoUrl: "未设地址",
			stateNotReady: "未就绪",
			stateUnknown: "未知来源",
			stateSpecOk: "规格合法",
			stateSpecBad: "规格有问题",
			stateNoSpec: "没有这个自定义 CLI",
			kindCustom: "自定义",
			kindSeam: "宿主内置",
			orderWhy: "为什么和列表不同：",
			orderWhySame: "与上面的列表一致。",
			orderWhyCommon: "{ids} 配置了 Key，默认规则把它放在列表前面。",
			orderWhyDisabled: "sources.disabled 排除了 {ids}。",
			orderWhyPriority: "sources.priority 把 {ids} 提到了前面。",
			orderWhyAnonymous: "只用免费来源（anonymous-only），{ids} 不会自动加入。",
			orderWhyOwn: "这是你自己写的顺序，{ids} 不会自动加入。",
			orderWhyNone: "所有引擎都被停用，没有可尝试的来源。",
			orderRulesTitle: "三者的关系",
			orderRulesNote: "调用里显式给的 engines 最优先；其次是上面这份列表；“来源”里的 sources.priority / sources.disabled 再对它调整（停用的去掉，优先的提前）；最后才是默认规则（DeepSeek 有 Key 时排最前）。",
			orderRulesLink: "去“来源”里设置",
			orderPriorityNow: "优先：{ids}",
			orderDisabledNow: "停用：{ids}",
			orderNone: "无",
			orderPlatformsTitle: "平台后端顺序",
			orderPlatformsNote: "每个平台按顺序尝试这些后端，前一个不可用或失败就落到下一个。没改过的显示内置默认链。",
			orderDefaultBadge: "默认",
			platformDialogTitle: "{name} 的后端顺序",
			platformDialogNote: "改动写入 platformBackends 里这个平台的一项；“恢复默认”删掉这一项，回到内置链。",
			platformChainBad: "platformBackends 的 JSON 当前无效：先在“高级”里改好，再用这里编辑。",
			platformEmpty: "这条链是空的，平台没有后端可用。",
			platformAddNone: "没有可再加入的后端",
			backendUnknown: "未知后端",
			cliIntroNote: "只读保证和内置适配一样：参数模板逐个 token，不经 shell；写入 / 登录类命令、读 Cookie 的参数会被拒绝；输出和超时有上限。结果带“用户自定义，未经插件验证”的标签和置信度。",
			cliAdd: "新增自定义 CLI",
			cliAddExample: "用 echo 做示例",
			cliEmpty: "还没有自定义 CLI。",
			cliCopy: "复制",
			cliDelete: "删除",
			cliPurposeEngine: "通用引擎",
			cliPurposePlatforms: "平台 {list}",
			cliPurposeNone: "未设用途",
			cliDeleteNote: "删除会在保存后生效；引用它的引擎列表或平台链需要一并改掉。",
			cliDialogNew: "新增自定义 CLI",
			cliDialogEdit: "编辑 {id}",
			cliDialogNote: "表单和下面的 JSON 是同一份规格的两种视图，校验用的是服务端的函数。点“完成”把它放进草稿，保存后才生效。",
			cliCancel: "取消",
			cliApply: "完成",
			cliId: "ID",
			cliIdHint: "小写字母、数字、. _ -；保存后不能改。",
			cliBin: "命令",
			cliBinHint: "PATH 上的命令名，不能是路径。",
			cliArgv: "参数模板",
			cliArgvHint: "每个参数一格；不经 shell。",
			cliArgvNote: "占位符：{query} 查询，{count} 结果数，{terms} 把查询按词拆成多个参数。至少要有 {query}（或 {terms}）。以 - 开头的写法按参数处理，子命令写在前面。",
			cliArgvAdd: "添加参数",
			cliArgvRemove: "删除参数",
			cliArgvToken: "参数 {n}",
			cliAllowed: "允许的子命令",
			cliAllowedHint: "自动从参数模板推出。",
			cliAllowedNone: "（没有子命令）",
			cliFormat: "输出格式",
			cliFormatHint: "工具打印的结果是什么格式。",
			cliWhole: "整段输出",
			cliWholeHint: "不写字段映射：把 stdout 整体当一条结果。",
			cliWholeNote: "标题是“适配名: 查询”，链接是占位的 cli://<id>?q=…，文本超出上限会截断并写明。这条结果出现在普通搜索里，但不是网页：证据模式不会抓取它，只把它列为来源。",
			cliWholeMax: "最多字符数",
			cliWholeMaxHint: "200–8000；留空 2000。",
			cliItemsPath: "结果数组路径",
			cliItemsPathHint: "例：data.items；留空 = 根数组。",
			cliLinesMode: "文本行方式",
			cliLinesModeHint: "一行一个结果的两种写法。",
			cliOptUrlLines: "url-lines · 含链接的行",
			cliOptTsv: "tsv · 制表符分隔的列",
			cliColumns: "列名",
			cliColumnsHint: "逗号分隔，例：id, title, link。",
			cliFields: "字段映射",
			cliFieldsNote: "每个结果字段填一个点路径，指向工具输出里的一条结果。URL 必填，必须是 http(s) 链接。",
			cliFieldUrl: "URL",
			cliFieldTitle: "标题",
			cliFieldSnippet: "摘要",
			cliFieldPublishedAt: "时间",
			cliFieldUrlHint: "例：link 或 data.url",
			cliFieldTitleHint: "例：title",
			cliFieldSnippetHint: "例：summary",
			cliFieldPublishedAtHint: "例：published_at",
			cliFieldComplex: "较复杂的映射，在 JSON 视图里改",
			cliTimeout: "超时",
			cliTimeoutHint: "1000–180000 毫秒。",
			cliPurpose: "用途",
			cliEngine: "作为通用搜索引擎",
			cliEngineHint: "可加入“通用搜索顺序”，参与融合与去重。",
			cliPlatforms: "服务的平台",
			cliPlatformsHint: "可加入这些平台的后端顺序。",
			cliPlatformUnknown: "没有这个平台的后端链",
			cliPlatformsAdd: "平台 id，回车添加",
			cliConfidenceLabel: "置信度",
			cliConfidenceHint: "0–1；留空 0.5。",
			cliConfidenceNote: "置信度只在多个来源融合排名时让它的权重略低，并随结果显示；1 不改变任何东西。也可以在“搜索顺序”的列表里按来源覆盖。",
			cliAdvanced: "高级",
			cliPackageNote: "安装说明",
			cliPackageNoteHint: "缺这个命令时给用户看。",
			cliHelpArgs: "帮助命令",
			cliHelpArgsHint: "空格分隔，例：search --help",
			cliMustContain: "帮助里必须出现",
			cliMustContainHint: "用来确认命令是对的程序。",
			cliMaxOutput: "输出上限",
			cliMaxOutputHint: "1024–16777216 字节。",
			unitBytes: "字节",
			cliJson: "查看 JSON",
			cliJsonNote: "直接改整份规格；合法的修改会同步回上面的表单。",
			cliJsonBad: "JSON 无法解析：{why}",
			cliProblems: "这份规格有问题",
			cliValid: "规格合法。",
			cliApplyBlocked: "规格有问题时不能放进草稿。",
			cliTrial: "试运行",
			cliTrialNote: "真的运行一次：先探测命令（版本和帮助），再用示例查询搜索一次；只读，不登录，不保存任何东西。",
			cliTrialQuery: "示例查询",
			cliTrialQueryDefault: "hello",
			cliTrialRun: "运行一次",
			cliTrialRunning: "运行中…",
			cliTrialUnavailable: "当前宿主没有给插件开通道，这里无法试运行。保存后用 web_call 的 sources.status 看是否就绪，用 search.run 搜一次。",
			cliTrialInvalid: "规格有问题，先修正再试运行。",
			cliTrialOk: "运行成功：解析出 {n} 条，显示前 {m} 条，用时 {ms} ms。",
			cliTrialFailed: "没有成功（停在“{stage}”）：",
			cliTrialStageDisabled: "被设置关闭",
			cliTrialStageValidate: "校验",
			cliTrialStageProbe: "探测命令",
			cliTrialStageSearch: "搜索",
			cliTrialRaw: "工具原话",
			cliTrialResults: "解析出的结果",
			cliTrialHint: "建议：{hint}",
			cliTrialLabel: "用户自定义，未经插件验证",
			cliTrialRpcFailed: "试运行没有完成：{why}",
			chainEdit: "编辑顺序 →",
			advancedRawTitle: "原始 JSON",
			advancedRawHint: "平台后端顺序和自定义 CLI 的整段 JSON",
			cliOutput: "输出",
			restartBadge: "重启插件后生效",
			restartBadgeSnapshot: "快照目录：重启插件后生效",
			restartWhyToolSurface: "工具（web_index + web_call，或每个动作一个工具）在插件启动时注册，改了要重启插件才会换。",
			restartWhyPlaywright: "快照目录在插件启动时确定；playwright.enabled 则即时生效。",
			restartWhyProviderId: "注册到宿主时就给定了 provider id，改了要重启插件。",
			restartWhyRegisterProvider: "是否注册 ctx.web provider 在插件启动时决定，改了要重启插件。",
			restartWhyTimeoutMs: "每个动作的截止时间和宿主工具上限在启动时定下，改了要重启插件（搜索内部的协作超时预算则即时生效）。",
			restartWhyMemoryCacheEntries: "进程内缓存在启动时按这个容量创建，改了要重启插件。",
			restartWhyDbPath: "数据库（和 agent 修改文件）在启动时打开，改路径要重启插件；旧路径里的数据不会自动搬过去。",
			restartWhyVerbose: "加载标记在启动时写入，改了要重启插件。",
			savebarRestart: "其中 {fields} 要重启插件后才生效。",
			summaryPendingRestart: "待重启 {n} 项",
			pendingRestartLine: "待重启：当前生效 {running}，配置为 {configured}",
			pendingEmpty: "（空）",
			groupAgent: "agent 修改",
			groupAgentSub: "agent 经 config.* 做的修改：实时生效，不改你的配置",
			agentBadge: "agent 修改",
			agentTip: "agent 设为 {value}（你的配置里是 {baseline}）· {reason} · {at} · {who}",
			agentNoReason: "（没有记录原因）",
			agentActorAgent: "agent",
			agentActorUser: "你（面板）",
			agentAdopt: "采纳到配置",
			agentRevoke: "撤销",
			agentRevokeAll: "全部撤销",
			agentRefresh: "刷新",
			agentRefreshing: "读取中…",
			agentNow: "生效：",
			agentConfigHolds: "你的配置：",
			agentCount: "{n} 项",
			agentNote: "agent 用 config.* 动作改的搜索顺序、来源规则、置信度、平台后端和自定义 CLI 放在一个单独的覆盖文件里，立刻生效，不会改动你的配置。“采纳到配置”把值写进你的配置（和下面的保存一样是一次原子写入）再撤销这条覆盖；“撤销”直接丢弃它。每次修改都记了原因，并留有审计记录。",
			agentEmpty: "agent 没有做过修改。",
			agentLoading: "正在读取…",
			agentNotLoaded: "还没有读取。点“刷新”。",
			agentUnavailable: "读不到 agent 修改：宿主没有提供这个插件的私有通道，或插件版本较旧。agent 仍可用 config.inspect 查看。",
			agentInvalid: "覆盖文件被整体忽略（插件按你的配置运行）：{problem}　点“全部撤销”可把坏文件挪开并重新开始。",
			agentAdoptFailed: "没能写入配置（宿主没有接受），覆盖保持不变。",
			agentAdoptHalf: "值已写进配置，但撤销覆盖没成功：{why}　刷新后可手动撤销。",
			agentRevokeFailed: "撤销失败：{why}",
			agentFile: "覆盖文件 {file} · 版本 {revision}",
			agentAuditTitle: "最近的审计记录（{n}）",
			agentAuditHint: "每次修改的原因、时间和前后值",
			agentAuditEmpty: "还没有记录。",
			agentKindEngines: "引擎顺序",
			agentKindPriority: "优先来源 sources.priority",
			agentKindDisabled: "停用来源 sources.disabled",
			agentKindConfidence: "置信度",
			agentKindPlatform: "平台后端顺序",
			agentKindCli: "自定义 CLI",
			summaryAgent: "agent 修改 {n} 项",
			summaryAgentOpen: "查看",
			agentCliTitle: "agent 添加的 CLI",
			agentCliNote: "这些 CLI 只在覆盖文件里，不在上面的列表里。",
			orderAgentChain: "加上 agent 的修改后实际尝试顺序：",
			orderAgentChainNone: "加上 agent 的修改后没有可用的引擎（全部被停用）。",
			agentNeedsCli: "用到了只存在于覆盖层的自定义 CLI：{ids}。采纳时请连这个 CLI 一起采纳，否则你的配置会引用一个它没有定义的 CLI。"
		};
		const en = {
			tab: "Web Search Pro",
			title: "Web Search Pro",
			description: "Search engines, sources and keys, scoring model, reading and cache, platform rules",
			lang: "en",
			readOnly: "The settings document is read-only, so changes cannot be saved.",
			unavailable: "Settings are unavailable: the host serves no configuration form for this plugin.",
			reset: "Restore default",
			overridden: "Overridden",
			overriddenCount: "{n} overridden",
			invalid: "Invalid value: check the range or format.",
			invalidJson: "Invalid JSON: it must be an object.",
			helpLabel: "More about this setting",
			edit: "Edit",
			close: "Close",
			done: "Done",
			emptyDefault: "(default)",
			optionOff: "off",
			chipRemove: "Remove",
			save: "Save",
			saving: "Saving…",
			discardChanges: "Discard",
			saveFailed: "The host did not accept every change; the draft is kept, check for conflicts or the log.",
			savebarClean: "No unsaved changes",
			savebarDirty: "{n} unsaved change(s)",
			savebarInvalid: "Some input is invalid; fix it to save",
			dialogStagesNote: "Changes here stay in the draft; press Save at the bottom of the page to write them.",
			summaryTitle: "Status",
			summaryChain: "Default chain",
			summaryChainEmpty: "(empty)",
			summaryKeys: "Sources with a key {n}/{m}",
			summaryReady: "ready",
			summaryNoKey: "no key",
			summaryRouteOn: "Built-in web tools: routed here",
			summaryRouteOff: "Built-in web tools: not routed",
			summaryJudge: "Scoring model",
			summarySurface: "Tool surface",
			summaryWarnings: "{n} notice(s)",
			summaryNoWarnings: "No notices",
			summaryDetails: "details",
			warningsTitle: "Settings that need attention",
			warningsNone: "The current draft has no validation notices.",
			unitMs: "ms",
			unitSeconds: "s",
			unitChars: "chars",
			unitCount: "",
			unitTokens: "tokens",
			unitDays: "days",
			riskNetwork: "network",
			riskBilled: "billed",
			riskModel: "calls a model",
			groupCommon: "Common",
			groupCommonSub: "Default engine chain, result count, tool surface, proxy fake-IP, DeepSeek Search",
			groupSources: "Sources",
			groupSourcesSub: "Ranking policy and each source's key, endpoint and request budget",
			groupReading: "Reading and evidence",
			groupReadingSub: "Page length, follow-up rounds, language-aware source choice",
			groupJudge: "Scoring model",
			groupJudgeSub: "Optional paid / local model and its prompts (off by default)",
			groupRoute: "Built-in web tool route",
			groupRouteSub: "Route the host's web_search / web_fetch through this plugin",
			groupRuntime: "Runtime and backends",
			groupRuntimeSub: "CLI / OpenCLI, Twitter login values, backend chains, platforms and browser bindings",
			groupNetwork: "Network and cache",
			groupNetworkSub: "Timeout, cache lifetime, database path, diagnostics",
			groupRanking: "Ranking weights",
			groupRankingSub: "Rank constant and freshness / authority bonuses for multi-source fusion (advanced)",
			groupAdvanced: "Advanced: text mode",
			groupAdvancedSub: "The settings as commented YAML, to copy",
			chainNow: "Order a search tries:",
			chainEmpty: "no usable engine",
			commonDeepseekTitle: "DeepSeek Search / Fetch (common)",
			commonBadge: "Common",
			engines: "Default engine chain",
			enginesHint: "Tried top to bottom; use the arrows to reorder.",
			enginesHelp: "For example ddg, bing, exa, seam, jina. While this is the default list a ready DeepSeek key puts deepseek first; a list you wrote is used as written, and engines in a call always wins.",
			searchMaxResults: "Default result count",
			searchMaxResultsHint: "1-20; used when a call gives no count.",
			parallelEngines: "Fuse several engines in parallel",
			parallelEnginesHint: "Query every default engine at once and fuse, instead of falling back.",
			toolSurface: "Tool surface",
			toolSurfaceHint: "The tools the model sees; read at start-up.",
			toolSurfaceHelp: "indexed exposes only web_index / web_call, the least resident text (default). flat is one tool per action, for comparison and debugging. Restart after changing it.",
			optIndexed: "indexed · two entry points (default)",
			optFlat: "flat · one tool per action (debug)",
			allowProxyFakeIp: "Allow proxy fake-IP DNS",
			allowProxyFakeIpHint: "Turn on when searches fail with \"fake-IP\" under Clash / TUN.",
			allowProxyFakeIpHelp: "With a proxy such as Clash / TUN, if a search fails with \"blocked / private address\" and the host resolves to 198.18.x.x, turn this on. Only the fake-IP ranges (198.18/15, fdfe:dcba:9876::/64, 2001:2::/48) are trusted; literal IPs, localhost and other private addresses stay blocked.",
			deepseekFetch: "Read pages with DeepSeek Fetch",
			deepseekFetchHint: "Off by default; billed per request.",
			deepseekFetchHelp: "When on, read.fetch falls back to the DeepSeek Fetch API (billed $0.75 per 1,000 successful requests; empty results and failures are free) when Jina and a direct request found no content, before browser rendering; mode=deepseek asks for it explicitly. It uses the same key as DeepSeek Search.",
			strategyGroup: "Ranking policy",
			strategyNote: "Order: engines / platform in the call, then \"Priority sources\" below, then sources you configured a key for (DeepSeek, the common one, first), then the anonymous / free defaults. A paid source is used only once its key is configured.",
			sourcePolicy: "Source policy",
			sourcePolicyHint: "Whether automatic planning may use keyed sources.",
			sourcePolicyHelp: "default follows the order above. anonymous-only: automatic planning never uses a source that needs a key, account or login, even a configured one (a source named in the call still runs).",
			optPolicyDefault: "default · in order (default)",
			optPolicyAnonymousOnly: "anonymous-only · anonymous sources only",
			srcPriority: "Priority sources",
			srcPriorityHint: "Source ids ranked first, in this order.",
			srcPriorityHelp: "Only ready sources that fit the task language and profile; for example deepseek, exa. Empty = none. engines in the call still wins.",
			srcDisabled: "Disabled sources",
			srcDisabledHint: "Never used by planning or the default chain.",
			srcDisabledHelp: "A source named in the call still runs. To opt out of the billed DeepSeek default, put deepseek here.",
			sourcesListTitle: "Sources that need a key or an address",
			sourcesListHint: "Edit sets the key reference, the key, the endpoint and the request budget; keys go to DSH Credentials and are never shown.",
			tierPaid: "Paid",
			tierFree: "Free allowance",
			tierAnonymous: "No key",
			sourceConfigured: "Set",
			sourceNotConfigured: "Not set",
			sourceMetaRef: "key reference {ref}",
			sourceMetaCapped: "request cap set",
			sourceMetaNoUrl: "no address set",
			sourceDialogTitle: "{name}",
			sourceResetAll: "Restore this source's defaults",
			sourceNoteDeepseek: "DeepSeek Search / Fetch, the common source: with a key it leads in Chinese and English. Billed per request: $0.75 per 1,000 successful requests; empty results and failures are free; direct plugin calls are treated as billed. Same DEEPSEEK_API_KEY as the DeepSeek models. The page-reading switch is in the Common group.",
			sourceNoteBocha: "Bocha: Chinese search, paid. An account without search balance gets HTTP 403.",
			sourceNoteExa: "Exa: with a key it uses the native API; without one it can fall back to the MCP route through mcporter.",
			sourceNoteJina: "Jina: search and page reading; every new key comes with a one-time free allowance.",
			sourceNoteGithub: "A GitHub token is optional and only raises the API rate limit.",
			sourceNoteSearxng: "Your own SearXNG instance (JSON format enabled); the searxng source exists only once an address is set. No public instance is built in.",
			sourceNoteKeyed: "Naming the key reference enables this source; it is unusable until a key is set. Override the endpoint only for a proxy or private gateway.",
			keyedEnv: "Key reference",
			keyedEnvHint: "Credential / environment variable name; blank uses the default:",
			keyedBaseUrl: "Endpoint",
			keyedBaseUrlHint: "Blank uses the built-in endpoint; an http(s) URL.",
			keyedApiKey: "API Key",
			credentialWriteOnlyHint: "Write-only; blank leaves the stored secret unchanged.",
			credentialReadOnlyHint: "The credential service is read-only, so nothing can be written here.",
			credentialChecking: "Checking…",
			credentialSet: "Configured",
			credentialUnset: "Not configured",
			bochaApiKeyEnv: "Bocha key reference",
			bochaApiKeyEnvHint: "Credential / environment variable; blank: BOCHA_SEARCH_API_KEY.",
			bochaBaseUrl: "Bocha endpoint",
			bochaBaseUrlHint: "Default https://api.bocha.cn; an http(s) URL.",
			bochaSummary: "Ask Bocha for the long summary",
			bochaSummaryHint: "On by default.",
			bochaSummaryHelp: "The long summary helps evidence scoring; turn it off for smaller responses.",
			exaApiKeyEnv: "Exa key reference",
			exaApiKeyEnvHint: "Credential / environment variable; blank: EXA_API_KEY.",
			jinaApiKeyEnv: "Jina key reference",
			jinaApiKeyEnvHint: "Credential / environment variable; blank: JINA_API_KEY.",
			githubTokenEnv: "GitHub token reference",
			githubTokenEnvHint: "Credential / environment variable; blank: GITHUB_TOKEN.",
			searxngUrl: "SearXNG address",
			searxngUrlHint: "The http(s) address of your own instance.",
			openalexMailto: "OpenAlex contact e-mail",
			openalexMailtoHint: "Put in the request User-Agent; polite, optional.",
			reqBudgetGroup: "Request budget (optional)",
			reqBudgetNote: "Cap this source's requests, counted in the usage ledger (it survives restarts). A used-up source is skipped and the plan falls back to others; it is never an error. No cap by default.",
			reqTotal: "Total cap",
			reqTotalHint: "Most requests ever; blank = no cap.",
			reqTotalHelp: "Example: a Bocha account with 1000 requests can use total 1000, daily 50. Used / remaining is in web_call sources.status.",
			reqDaily: "Daily cap",
			reqDailyHint: "Most requests per day; blank = no cap.",
			reqDailyHelp: "The day boundary follows the scoring budget time zone. Used / remaining is in web_call sources.status.",
			anonymousTitle: "Anonymous sources (no key)",
			anonymousHint: "reference only, not live state",
			anonymousName: "Source",
			anonymousUse: "Use",
			sourcesStatusLine: "Live readiness of each source (installation, key, last success) is shown by web_call sources.status.",
			srcUseDdg: "General web, the default first choice",
			srcUseBing: "General web, complements DuckDuckGo",
			srcUseWikipedia: "Encyclopedic facts, zh / en",
			srcUseHackernews: "English tech discussion and experience",
			srcUseStackexchange: "Programming Q&A (Stack Overflow)",
			srcUseOpenalex: "Scholarly paper index",
			srcUseSemanticscholar: "Papers; the anonymous pool is often full",
			srcUseAnysearch: "Anonymous general search, limited allowance",
			srcUseArxiv: "Preprints",
			srcUsePubmed: "Biomedical literature",
			srcUseV2ex: "Chinese community discussion",
			fetchDefaultChars: "Page read length",
			fetchDefaultCharsHint: "read.fetch per call, 1000-500000.",
			exaContentsPerUrlChars: "Exa contents per URL",
			exaContentsPerUrlCharsHint: "read.contents per URL, at least 500.",
			exaContentsTotalChars: "Exa contents total",
			exaContentsTotalCharsHint: "read.contents per call, at least 1000.",
			evAutoProviders: "Pick sources by language",
			evAutoProvidersHint: "Ready sources strong in the task language go first.",
			evAutoProvidersHelp: "Ready sources strong in the task language (DeepSeek, Bocha, Exa, ...) go ahead of the profile table; off keeps the table and engines as they are.",
			evMaxRounds: "Search rounds",
			evMaxRoundsHint: "1 = no follow-up; default 2.",
			evMaxQueries: "Search requests per task",
			evMaxQueriesHint: "Over all rounds; default 4.",
			evidenceNote: "The keep floor (minKeep, 3) and the evidence pack character budget are built-in defaults or the per-call budget of search.run: they have no setting.",
			judgeMode: "Scoring mode",
			judgeModeHint: "Default off: no model is called.",
			judgeModeHelp: "off calls nothing; shadow only records a comparison; control lets the model decide; hybrid keeps the rules and re-scores cross-language (and borderline) pairs with the model. Also writes the legacy keys jevMode / scorer. Check the key and the usage caps first.",
			optShadow: "shadow · observe only",
			optControl: "control · the model decides",
			optHybrid: "hybrid · mixed",
			judgeProvider: "Scoring provider",
			judgeProviderHint: "Default bocha-jev; presets and your ids.",
			hybridBorderline: "hybrid: re-score borderline pairs",
			hybridBorderlineHint: "Roughly doubles the cost.",
			hybridBorderlineHelp: "Pairs the rules grade 1 go to the model as well.",
			maxJevQuestions: "Questions per search",
			maxJevQuestionsHint: "(need, block) pairs, default 64.",
			allowLlm: "Allow the llm protocol",
			allowLlmHint: "Off by default; llm providers need it.",
			allowLlmHelp: "General LLM calls cost tokens; turn it on only for a provider that really speaks the llm protocol.",
			judgeGroupCoverage: "Coverage judge",
			judgeGroupCoverageHint: "the model checks whether excerpts suffice",
			judgeGroupBudget: "Usage caps",
			judgeGroupBudgetHint: "per search and per day tokens",
			judgeGroupProviders: "Custom scoring providers",
			coverageMode: "Coverage mode",
			coverageModeHint: "Default off; not tied to the scoring mode.",
			coverageModeHelp: "off (default); shadow records the probability; control turns weak support into a gap.",
			coverageProvider: "Coverage provider",
			coverageProviderHint: "Default: the scoring provider.",
			thresholdWeak: "Weak threshold",
			thresholdWeakHint: "Below it is weak; blank = calibrated value.",
			thresholdWeakHelp: "Blank uses the value shipped with the plugin, calibrated only for bocha-jev + cover.sufficient v1. Set both thresholds together, weak <= covered.",
			thresholdCovered: "Covered threshold",
			thresholdCoveredHint: "At or above it counts as covered.",
			budgetPerSearch: "Input cap per search",
			budgetPerSearchHint: "Default 60000; 0 = no calls.",
			budgetDaily: "Input cap per day",
			budgetDailyHint: "Default 1000000.",
			budgetTimezone: "Day boundary time zone",
			budgetTimezoneHint: "IANA name; blank = system.",
			budgetProviders: "Caps per provider",
			budgetProvidersHint: "JSON; the stricter cap applies.",
			judgeProviders: "Custom providers",
			judgeProvidersHint: "JSON; define protocol, baseUrl, model, keyRef by id.",
			rubricsTitle: "Prompts (rubrics)",
			rubricNotes: "The question texts scoring and the coverage judge put to the model. An override needs a new version label; editing changes the question hash, so old cache is not reused; an invalid override is ignored.",
			rubricActive: "Active",
			rubricOverrideOn: "Overridden",
			rubricCreate: "Start an override from the default text",
			rubricRestore: "Restore default",
			rubricDialogTitle: "Edit prompt: {name}",
			rubricVersion: "Version",
			rubricVersionHint: "Letters, digits and . _ -, at most 32; differs from the built-in.",
			rubricInstructions: "Prompt template",
			rubricInstructionsHint: "Only the variables this rubric allows, with the required ones.",
			rubricCriteria: "Grade levels",
			rubricCriteriaHint: "One per line, low to high; scoring rubrics only, 2-10.",
			rubricMaxState: "Task characters",
			rubricMaxStateHint: "20-2000.",
			rubricMaxCandidate: "Candidate characters",
			rubricMaxCandidateHint: "100-8000.",
			rubricUnknown: "Overrides in settings that name no built-in rubric are ignored:",
			promptDefaultCol: "Default",
			promptMineCol: "My override",
			promptEmptyIsDefault: "Blank = the default",
			promptStateDefault: "Default",
			jsonEntries: "{n} entries",
			jsonDialogTitle: "Edit: {name}",
			jsonDialogHint: "A JSON object; validated with the server's own rules.",
			registerProvider: "Register as the ctx.web provider",
			registerProviderHint: "Lets built-in web_search / web_fetch route here.",
			registerProviderHelp: "Takes effect at start-up. Registering only makes it selectable: the host uses a provider only when the web entry names its id or it is the only usable one, which needs the profile patch below.",
			providerId: "Provider id",
			providerIdHint: "The stable id the web entry or environment names.",
			providerEvidence: "Built-in web_search returns",
			providerEvidenceHint: "auto: an evidence pack; off: the source list.",
			optAuto: "auto · evidence pack (default)",
			optOff: "off · source list",
			providerDeadlineMs: "Evidence deadline",
			providerDeadlineMsHint: "Partial result at the deadline, at least 100.",
			routeOffNote: "Not registered: built-in web_search / web_fetch do not go through this plugin.",
			routeHelpTitle: "Selecting this plugin also needs a profile patch",
			routeHelpFoldHint: "goes into cordis.patch.yml",
			routeHelpIntro: "Write this in $DSH_HOME/profiles/<profile>/cordis.patch.yml:",
			routeHelpAfter: "Or set only the environment variables DSH_WEB_SEARCH_PROVIDER / DSH_WEB_FETCH_PROVIDER. Do not register without naming fetchProvider (with the host's own http provider also usable, web_fetch fails with AMBIGUOUS). After a restart check the \"ctx.web route\" line of web_call sources.status.",
			enableCliBackends: "Enable CLI backends",
			enableCliBackendsHint: "bili, yt-dlp, OpenCLI, Agent Reach, ...",
			enableCliBackendsHelp: "Allows the local CLI backends; when off none of those platform backends runs.",
			opencliEnabled: "Enable OpenCLI",
			opencliEnabledHint: "Site adapters through the Chrome Browser Bridge.",
			opencliEnabledHelp: "Allows site adapters through the connected Chrome Browser Bridge.",
			agentReachEnabled: "Enable Agent Reach",
			agentReachEnabledHint: "Agent Reach compatible backends.",
			agentReachEnabledHelp: "Allows external search backends compatible with Agent Reach.",
			runtimeLoginTitle: "Login values",
			runtimeBackendsTitle: "Backends (JSON)",
			runtimePlatformsTitle: "Platforms and browser (JSON)",
			twitterGroup: "Twitter / X (twitter-cli)",
			twitterGroupHint: "twitter-cli needs auth_token and ct0; handed to the command only through its environment.",
			twitterPartial: "only one is set",
			twitterAuthTokenEnv: "auth_token reference",
			twitterAuthTokenEnvHint: "Credential / environment variable; default TWITTER_AUTH_TOKEN.",
			twitterCt0Env: "ct0 reference",
			twitterCt0EnvHint: "Credential / environment variable; default TWITTER_CT0.",
			twitterAuthToken: "Twitter auth_token",
			twitterCt0: "Twitter ct0",
			playwright: "Playwright settings",
			playwrightHint: "JSON; browser-render fallback and snapshot directory.",
			platformBackends: "Platform backend order",
			platformBackendsHint: "JSON; backends tried per platform, in order.",
			cliAdapters: "Custom CLI adapters",
			cliAdaptersHint: "JSON; read-only CLI adapter specs by id.",
			customPlatforms: "Custom platforms",
			customPlatformsHint: "JSON; search URL and selectors; logins go through browser bindings.",
			platformRules: "Platform selector overrides",
			platformRulesHint: "JSON; item / title / link selectors per platform.",
			browserBindings: "Browser bindings",
			browserBindingsHint: "JSON; bind a platform to a dsh-browser login profile and rule pack.",
			timeoutMs: "Timeout budget",
			timeoutMsHint: "One enhanced search, at least 1000.",
			timeoutMsHelp: "The cooperative timeout of one enhanced search; the evidence run has its own deadline.",
			ttlSeconds: "Cache lifetime",
			ttlSecondsHint: "0 = always stale.",
			ttlSecondsHelp: "How long a cached search or page stays fresh; a change applies to new requests at once.",
			memoryCacheEntries: "Memory cache entries",
			memoryCacheEntriesHint: "In-process LRU capacity, at least 1.",
			dbPath: "SQLite path",
			dbPathHint: "Blank = the plugin default path.",
			verbose: "Verbose diagnostics",
			verboseHint: "Write a load marker and more diagnostics.",
			rrfConstant: "RRF constant",
			rrfConstantHint: "Rank smoothing constant k of the fusion.",
			rrfConstantHelp: "Fusion score = sum of 1/(k + rank); a larger k flattens the difference between ranks. Default 60.",
			freshnessBoost: "Freshness bonus",
			freshnessBoostHint: "0-1, a fraction of one rank step.",
			freshnessBoostHelp: "Bonus for recent results as a fraction of the score gap between adjacent ranks of one provider; each URL gets it once. The bonuses together never lift rank 10 over rank 1.",
			freshnessDays: "Freshness decay",
			freshnessDaysHint: "Days until the bonus is zero.",
			authorityBoost: "Authority bonus",
			authorityBoostHint: "0-1, a fraction of one rank step.",
			authorityBoostHelp: "Bonus for authority hosts (github.com, wikipedia.org, .edu / .gov / .org and the extra domains below).",
			authorityDomains: "Extra authority domains",
			authorityDomainsHint: "No scheme or path.",
			rankingNote: "A source's own rerank_score / authority (DeepSeek) adds one more small bonus (0.3 of a rank step); it is not configured here.",
			textViewTitle: "Settings text",
			textViewHint: "The current draft (secrets excluded), every key preceded by a comment: use, values, default, risk.",
			textViewCopy: "Copy",
			textViewCopied: "Copied",
			textViewNote: "A read-only view of the controls: edit the controls above. Comment lines start with # and are ignored when read.",
			groupOrder: "Search order",
			groupOrderSub: "The order of the general search and of each platform's backends",
			groupCli: "Custom CLI",
			groupCliSub: "Add your own read-only command-line tools",
			orderEnginesTitle: "General search order",
			orderListLabel: "Engine order",
			orderAdd: "Add a source…",
			orderAddLabel: "Add a source",
			orderRestore: "Restore default order",
			orderEmpty: "The list is empty: keep at least one source.",
			orderUp: "Move up",
			orderDown: "Move down",
			orderRemove: "Remove",
			orderConfidenceOf: "Confidence of {name}",
			orderConfidenceBadge: "confidence {c}",
			orderConfidenceDefault: "default {c}",
			orderConfidenceLabel: "Confidence",
			orderConfidenceEdit: "Click to change the confidence",
			orderConfidenceHelp: "Only slightly lowers this source's weight when several sources are fused into one ranking; 1 = no adjustment.",
			orderPlatformFilter: "Filter by platform name or id…",
			orderPlatformFilterLabel: "Filter platforms",
			orderPlatformFound: "{n} of {total} platforms match",
			orderPlatformNone: "No platform matches.",
			orderPlatformsMore: "Show the other {n} platforms",
			orderPlatformsMoreHint: "changed, custom-CLI and common ones are listed first",
			stateReady: "Ready",
			stateNoKey: "No key",
			stateNoUrl: "No address",
			stateNotReady: "Not ready",
			stateUnknown: "Unknown source",
			stateSpecOk: "Spec valid",
			stateSpecBad: "Spec has problems",
			stateNoSpec: "No such custom CLI",
			kindCustom: "Custom",
			kindSeam: "Host",
			orderWhy: "Why it differs from the list:",
			orderWhySame: "Same as the list above.",
			orderWhyCommon: "{ids}: a key is set, so the default rule puts it in front of the list.",
			orderWhyDisabled: "sources.disabled leaves out {ids}.",
			orderWhyPriority: "sources.priority moves {ids} to the front.",
			orderWhyAnonymous: "Free sources only (anonymous-only): {ids} is not added.",
			orderWhyOwn: "This is your own order, so {ids} is not added.",
			orderWhyNone: "Every engine is disabled: there is nothing to try.",
			orderRulesTitle: "How the three relate",
			orderRulesNote: "An explicit engines in the call wins; then the list above; then sources.priority / sources.disabled from \"Sources\" adjust it (disabled ones leave, priority ones move up); the default rule (DeepSeek first once its key is set) comes last.",
			orderRulesLink: "Set them in \"Sources\"",
			orderPriorityNow: "Priority: {ids}",
			orderDisabledNow: "Disabled: {ids}",
			orderNone: "none",
			orderPlatformsTitle: "Platform backend order",
			orderPlatformsNote: "Each platform tries its backends in order and falls through to the next when one is unavailable or fails. A platform you did not change shows the built-in default chain.",
			orderDefaultBadge: "Default",
			platformDialogTitle: "Backend order of {name}",
			platformDialogNote: "Edits write this platform's entry of platformBackends; \"Restore default\" removes it and the built-in chain applies again.",
			platformChainBad: "platformBackends is not valid JSON right now: fix it under \"Advanced\" first.",
			platformEmpty: "This chain is empty: the platform has no backend.",
			platformAddNone: "No other backend can serve it",
			backendUnknown: "Unknown backend",
			cliIntroNote: "The read-only guarantee is the one of the built-in adapters: the argument template is a list of tokens, never a shell string; write / login commands and cookie-reading flags are refused; output and time are capped. Results carry the label \"user-defined, not verified by the plugin\" and a confidence.",
			cliAdd: "Add a custom CLI",
			cliAddExample: "Add an echo example",
			cliEmpty: "No custom CLI yet.",
			cliCopy: "Copy",
			cliDelete: "Delete",
			cliPurposeEngine: "General engine",
			cliPurposePlatforms: "platforms {list}",
			cliPurposeNone: "no purpose set",
			cliDeleteNote: "Deleting takes effect on save; lists and chains that name it have to change too.",
			cliDialogNew: "New custom CLI",
			cliDialogEdit: "Edit {id}",
			cliDialogNote: "The form and the JSON below are two views of one spec, validated with the server's own functions. \"Done\" puts it into the draft; it takes effect on save.",
			cliCancel: "Cancel",
			cliApply: "Done",
			cliId: "ID",
			cliIdHint: "Lower case, digits and . _ -; fixed once saved.",
			cliBin: "Command",
			cliBinHint: "A command name on PATH, never a path.",
			cliArgv: "Argument template",
			cliArgvHint: "One argument per box; no shell.",
			cliArgvNote: "Placeholders: {query} the query, {count} the result count, {terms} the query split into one argument per word. {query} (or {terms}) is required. A leading - is a flag; subcommands go first.",
			cliArgvAdd: "Add argument",
			cliArgvRemove: "Remove argument",
			cliArgvToken: "Argument {n}",
			cliAllowed: "Allowed subcommands",
			cliAllowedHint: "Derived from the template.",
			cliAllowedNone: "(no subcommands)",
			cliFormat: "Output format",
			cliFormatHint: "What the tool prints.",
			cliWhole: "Whole output",
			cliWholeHint: "No field mapping: stdout is one result.",
			cliWholeNote: "The title is \"<id>: <query>\", the link a stand-in cli://<id>?q=…; text past the limit is cut and says so. It shows up in plain searches, but it is not a web page: evidence mode never fetches it, it only lists it as a source.",
			cliWholeMax: "Most characters",
			cliWholeMaxHint: "200-8000; empty = 2000.",
			cliItemsPath: "Result array path",
			cliItemsPathHint: "e.g. data.items; empty = the root array.",
			cliLinesMode: "Text line mode",
			cliLinesModeHint: "Two ways a line becomes a result.",
			cliOptUrlLines: "url-lines · lines holding a URL",
			cliOptTsv: "tsv · tab separated columns",
			cliColumns: "Columns",
			cliColumnsHint: "Comma separated, e.g. id, title, link.",
			cliFields: "Field mapping",
			cliFieldsNote: "A dotted path per result field, into one item of the tool's output. The URL is required and must be an http(s) link.",
			cliFieldUrl: "URL",
			cliFieldTitle: "Title",
			cliFieldSnippet: "Snippet",
			cliFieldPublishedAt: "Time",
			cliFieldUrlHint: "e.g. link or data.url",
			cliFieldTitleHint: "e.g. title",
			cliFieldSnippetHint: "e.g. summary",
			cliFieldPublishedAtHint: "e.g. published_at",
			cliFieldComplex: "A more complex mapping: edit it in the JSON view",
			cliTimeout: "Timeout",
			cliTimeoutHint: "1000-180000 ms.",
			cliPurpose: "Purpose",
			cliEngine: "As a general search engine",
			cliEngineHint: "Can join the general search order, fused and de-duplicated.",
			cliPlatforms: "Platforms it serves",
			cliPlatformsHint: "Can join the backend order of these platforms.",
			cliPlatformUnknown: "No backend chain for this platform",
			cliPlatformsAdd: "Platform id, Enter adds",
			cliConfidenceLabel: "Confidence",
			cliConfidenceHint: "0-1; empty = 0.5.",
			cliConfidenceNote: "Confidence makes this source weigh a little less when several sources are fused, and is printed with its results; 1 changes nothing. The \"Search order\" list can override it per source.",
			cliAdvanced: "Advanced",
			cliPackageNote: "Install note",
			cliPackageNoteHint: "Shown when the command is missing.",
			cliHelpArgs: "Help command",
			cliHelpArgsHint: "Space separated, e.g. search --help",
			cliMustContain: "Help must contain",
			cliMustContainHint: "Proves it is the right program.",
			cliMaxOutput: "Output cap",
			cliMaxOutputHint: "1024-16777216 bytes.",
			unitBytes: "bytes",
			cliJson: "View JSON",
			cliJsonNote: "Edit the whole spec; valid edits sync back into the form above.",
			cliJsonBad: "The JSON cannot be parsed: {why}",
			cliProblems: "This spec has problems",
			cliValid: "The spec is valid.",
			cliApplyBlocked: "A spec with problems cannot go into the draft.",
			cliTrial: "Try it",
			cliTrialNote: "A real run: the command is probed (version and help), then one search runs with the sample query. Read-only, no login, nothing is stored.",
			cliTrialQuery: "Sample query",
			cliTrialQueryDefault: "hello",
			cliTrialRun: "Run once",
			cliTrialRunning: "Running…",
			cliTrialUnavailable: "This host gives the plugin no channel, so Try it is unavailable here. After saving, check readiness with web_call sources.status and search once with search.run.",
			cliTrialInvalid: "The spec has problems: fix them before trying it.",
			cliTrialOk: "It ran: {n} result(s) parsed, the first {m} shown, {ms} ms.",
			cliTrialFailed: "It did not succeed (stopped at \"{stage}\"):",
			cliTrialStageDisabled: "disabled by settings",
			cliTrialStageValidate: "validation",
			cliTrialStageProbe: "probing the command",
			cliTrialStageSearch: "search",
			cliTrialRaw: "What the tool said",
			cliTrialResults: "Parsed results",
			cliTrialHint: "Suggestion: {hint}",
			cliTrialLabel: "User-defined, not verified by the plugin",
			cliTrialRpcFailed: "The trial did not finish: {why}",
			chainEdit: "Edit the order →",
			advancedRawTitle: "Raw JSON",
			advancedRawHint: "the whole JSON of the platform backend order and the custom CLIs",
			cliOutput: "Output",
			restartBadge: "Applies after a plugin restart",
			restartBadgeSnapshot: "Snapshot folder: after a plugin restart",
			restartWhyToolSurface: "The tools (web_index + web_call, or one per action) are registered when the plugin starts, so a change needs a plugin restart.",
			restartWhyPlaywright: "The snapshot folder is fixed when the plugin starts; playwright.enabled takes effect at once.",
			restartWhyProviderId: "The provider id is given to the host at registration, so a change needs a plugin restart.",
			restartWhyRegisterProvider: "Whether the ctx.web provider is registered is decided when the plugin starts, so a change needs a plugin restart.",
			restartWhyTimeoutMs: "Each action's deadline and the host tool ceiling are fixed at start (the time budget inside a search follows the setting at once), so a change needs a plugin restart.",
			restartWhyMemoryCacheEntries: "The in-process cache is created with this size at start, so a change needs a plugin restart.",
			restartWhyDbPath: "The database (and the agent overlay file) is opened at start, so a new path needs a plugin restart; data at the old path is not moved.",
			restartWhyVerbose: "The load marker is written at start, so a change needs a plugin restart.",
			savebarRestart: "{fields}: takes effect only after the plugin restarts.",
			summaryPendingRestart: "{n} setting(s) wait for a restart",
			pendingRestartLine: "Waiting for a restart: running {running}, configured {configured}",
			pendingEmpty: "(empty)",
			groupAgent: "Agent changes",
			groupAgentSub: "What an agent changed with config.*: live, and your configuration is untouched",
			agentBadge: "Changed by agent",
			agentTip: "Set to {value} (your configuration holds {baseline}) · {reason} · {at} · {who}",
			agentNoReason: "(no reason recorded)",
			agentActorAgent: "agent",
			agentActorUser: "you (panel)",
			agentAdopt: "Adopt into configuration",
			agentRevoke: "Revoke",
			agentRevokeAll: "Revoke all",
			agentRefresh: "Refresh",
			agentRefreshing: "Reading…",
			agentNow: "In force:",
			agentConfigHolds: "Your configuration:",
			agentCount: "{n} change(s)",
			agentNote: "The search order, source rules, confidence, platform backends and custom CLIs an agent changed with the config.* actions sit in a separate overlay file. They apply at once and never edit your configuration. \"Adopt into configuration\" writes the value into your configuration (one atomic write, like Save) and then drops the overlay entry; \"Revoke\" just drops it. Every change carries a reason and is kept in an audit trail.",
			agentEmpty: "The agent has changed nothing.",
			agentLoading: "Reading…",
			agentNotLoaded: "Not read yet. Press Refresh.",
			agentUnavailable: "The agent changes cannot be read: the host offers no private channel for this plugin, or the plugin is older. An agent can still call config.inspect.",
			agentInvalid: "The overlay file is ignored as a whole (the plugin runs on your configuration): {problem} \"Revoke all\" moves the bad file aside and starts fresh.",
			agentAdoptFailed: "The configuration was not written (the host refused), so the overlay is unchanged.",
			agentAdoptHalf: "The value is in your configuration, but the overlay entry could not be dropped: {why} Refresh and revoke it by hand.",
			agentRevokeFailed: "Revoke failed: {why}",
			agentFile: "Overlay file {file} · revision {revision}",
			agentAuditTitle: "Recent audit records ({n})",
			agentAuditHint: "the reason, time and before / after of every change",
			agentAuditEmpty: "No records yet.",
			agentKindEngines: "Engine order",
			agentKindPriority: "Priority sources",
			agentKindDisabled: "Disabled sources",
			agentKindConfidence: "Confidence",
			agentKindPlatform: "Platform backend order",
			agentKindCli: "Custom CLI",
			summaryAgent: "{n} agent change(s)",
			summaryAgentOpen: "view",
			agentCliTitle: "CLIs added by an agent",
			agentCliNote: "These CLIs live only in the overlay file, so they are not in the list above.",
			orderAgentChain: "With the agent's changes a search tries:",
			orderAgentChainNone: "With the agent's changes no engine is left (all are disabled).",
			agentNeedsCli: "Uses a custom CLI that only the overlay holds: {ids}. Adopt that CLI too, or your configuration will name a CLI it does not define."
		};
		//#endregion
		//#region src/client/index.ts
		const name = "web-search-pro-client";
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.credentials",
			"configForms"
		];
		const NS = "web-search-pro.card";
		function apply(ctx) {
			ensureStyles();
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "web-search-pro: settings dictionaries");
			const controller = new WebSearchSettingsController(ctx.configForms.get("web-search-pro"), ctx);
			ctx.effect(() => () => {
				controller.dispose();
			}, "web-search-pro: settings controller");
			ctx.effect(() => ctx.configForms.whileServed(["web-search-pro"], () => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
				name: "plugins.bundle.config",
				key: "dsh-web-search-pro",
				locale: NS,
				inject: () => controller.inject()
			}, SettingsCard))), "web-search-pro: bundle configuration");
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map