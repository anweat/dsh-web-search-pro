window.__ModuleLoader__.load({
	id: "dsh-web-search-pro",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
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
			tavily: ["TAVILY_API_KEY"],
			brave: ["BRAVE_API_KEY"],
			linkup: ["LINKUP_API_KEY"],
			serper: ["SERPER_API_KEY"],
			metaso: ["METASO_API_KEY"],
			zhipu: ["ZHIPU_API_KEY"],
			"baidu-qianfan": ["QIANFAN_API_KEY", "BAIDU_API_KEY"]
		});
		const KEYED_SOURCE_IDS = Object.freeze(Object.keys(KEYED_SOURCE_ENVS));
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
		const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
		function getAt(root, path) {
			let node = root;
			for (const key of path) {
				if (!isRecord(node)) return void 0;
				node = node[key];
			}
			return node;
		}
		function hasAt(root, path) {
			let node = root;
			for (const key of path) {
				if (!isRecord(node) || !Object.hasOwn(node, key)) return false;
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
						node = isRecord(next) ? next : node[key] = {};
					}
					node[op.path[op.path.length - 1]] = structuredClone(op.value);
					continue;
				}
				const trail = [root];
				let node = root;
				for (const key of op.path.slice(0, -1)) {
					node = isRecord(node) ? node[key] : void 0;
					if (!isRecord(node)) break;
					trail.push(node);
				}
				if (trail.length !== op.path.length) continue;
				delete trail[trail.length - 1][op.path[op.path.length - 1]];
				for (let depth = trail.length - 1; depth > 0; depth--) if (Object.keys(trail[depth]).length === 0) delete trail[depth - 1][op.path[depth - 1]];
			}
		}
		/** Recursive merge, `over` winning; arrays and scalars are replaced (how a user layer sits on its base). */
		function deepMerge(base, over) {
			if (!isRecord(base) || !isRecord(over)) return over === void 0 ? base : over;
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
			format: (value) => isRecord(value) ? JSON.stringify(value, null, 2) : "",
			parse(text) {
				if (text.trim() === "") return required ? void 0 : { kind: "clear" };
				try {
					const value = JSON.parse(text);
					return isRecord(value) ? {
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
			bochaBaseUrl: "https://api.bocha.cn",
			bochaSummary: true
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
			textField("bochaApiKeyEnv", { pattern: KEY_REF_PATTERN }),
			textField("bochaBaseUrl", { url: true }),
			booleanField("bochaSummary", true),
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
		/** The keyed sources the card has controls for: route id and the environment variable its key is read from by default. */
		const KEYED_SOURCES = KEYED_SOURCE_IDS.map((id) => ({
			id,
			defaultEnv: KEYED_SOURCE_ENVS[id][0]
		}));
		const KEYED_SPECS = KEYED_SOURCES.flatMap(({ id }) => [path(textField(`keyedSources.${id}.apiKeyEnv`, { pattern: KEY_REF_PATTERN }), "keyedSources", [id, "apiKeyEnv"]), path(textField(`keyedSources.${id}.baseUrl`, { url: true }), "keyedSources", [id, "baseUrl"])]);
		const BUDGET_SPECS = ["bocha", ...KEYED_SOURCE_IDS].flatMap((id) => ["total", "daily"].map((axis) => path(numberField(`sources.budget.${id}.${axis}`, {
			min: 0,
			integer: true
		}), "sources", [
			"budget",
			id,
			axis
		])));
		/** The spec of a rubric override entry: the whole object as one JSON draft, which the rubric editor builds field by field. */
		const rubricSpec = (id) => path(jsonField(`evidence.rubrics.${id}`), E, ["rubrics", id]);
		const rubricField = (id) => `evidence.rubrics.${id}`;
		/** Fields that a Host write can never take as text (credentials go through the credentials remote). */
		const CREDENTIAL_IDS = [
			"exa",
			"jina",
			"github",
			"bocha",
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
		function resolveSources(input, known) {
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
			return {
				priority,
				disabled,
				budget,
				diagnostics
			};
		}
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
		const PATH_RE = /^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/;
		const VERSION_RE = /^\d+(\.\d+){0,3}$/;
		const PLACEHOLDERS = /* @__PURE__ */ new Set([
			"query",
			"count",
			"url"
		]);
		const MAX_TIMEOUT_MS = 18e4;
		const MAX_OUTPUT_BYTES = 16777216;
		const SPEC_KEYS = /* @__PURE__ */ new Set([
			"id",
			"bins",
			"packageNote",
			"platforms",
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
			"mustContain"
		]);
		const SEARCH_KEYS = /* @__PURE__ */ new Set([
			"argv",
			"maxCount",
			"output",
			"emptyWhen",
			"notLoggedInPatterns"
		]);
		const OUTPUT_KEYS = /* @__PURE__ */ new Set([
			"format",
			"itemsPath",
			"expect",
			"errorPaths",
			"lines",
			"fields",
			"stripTags",
			"emptyValues",
			"snippetMax",
			"titleMax",
			"requireTitle"
		]);
		const FIELD_KEYS = /* @__PURE__ */ new Set([
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
				errors.push(where + " must be a path, a list, { template }, { join }, { epoch } or { date }");
				return;
			}
			const keys = Object.keys(value);
			if (keys.length === 1 && (keys[0] === "epoch" || keys[0] === "date")) {
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
				} else if (isObject(part) && typeof part.path === "string" && PATH_RE.test(part.path) && Object.keys(part).every((k) => [
					"path",
					"prefix",
					"suffix"
				].includes(k))) {
					for (const k of ["prefix", "suffix"]) if (part[k] !== void 0 && !(typeof part[k] === "string" && part[k].length <= 40)) errors.push(where + ".join." + k + " must be a short string");
				} else errors.push(where + ".join: each part is a path or { path, prefix?, suffix? }");
				if (value.sep !== void 0 && !(typeof value.sep === "string" && value.sep.length <= 16)) errors.push(where + ".sep must be a short string");
				return;
			}
			errors.push(where + " must be a path, a list, { template }, { join }, { epoch } or { date }");
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
			if (value.lines !== void 0) {
				const l = value.lines;
				if (isObject(l) && l.mode === "url-lines" && Object.keys(l).length === 1) {} else if (isObject(l) && l.mode === "tsv" && strList(l.columns, 24, 40) && l.columns.length >= 2 && l.columns.every((c) => /^[A-Za-z0-9_]+$/.test(c)) && Object.keys(l).every((k) => k === "mode" || k === "columns")) {} else errors.push(where + ".lines must be { mode: \"url-lines\" } or { mode: \"tsv\", columns: [...] }");
			}
			if (value.format === "text" && value.lines === void 0) errors.push(where + ".lines is required for format text");
			if (value.format !== "text" && value.lines !== void 0) errors.push(where + ".lines is only for format text");
			if (!isObject(value.fields)) errors.push(where + ".fields must be an object");
			else {
				closed(value.fields, FIELD_KEYS, where + ".fields", errors);
				if (value.fields.url === void 0) errors.push(where + ".fields.url is required");
				for (const key of Object.keys(value.fields)) if (FIELD_KEYS.has(key)) checkFieldSource(value.fields[key], where + ".fields." + key, errors);
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
				if (!argv.some((t) => /\{(query|url)\}/.test(t))) errors.push(where + ".argv must carry a {query} (or {url}) placeholder");
				errors.push(...argvProblems(argv, allowed, where + ".argv"));
			}
			if (value.maxCount !== void 0 && !(Number.isInteger(value.maxCount) && value.maxCount >= 1 && value.maxCount <= 100)) errors.push(where + ".maxCount must be an integer 1..100");
			checkOutput(value.output, where + ".output", errors);
			for (const key of ["emptyWhen", "notLoggedInPatterns"]) if (value[key] !== void 0 && !strList(value[key], 12, 120)) errors.push(where + "." + key + " must be a list of short strings");
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
			if (!strList(raw.platforms, 8, 40) || !raw.platforms.length) errors.push(at + ".platforms must list 1..8 platform ids");
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
					if (!isStr(l.command, 120)) errors.push(at + ".login.command must be a short string (what the user runs themselves)");
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
		/**
		* The built-in CLI adapter specs (dev-plan M12). Every argv, flag and output field was derived from the tool's own
		* `--help` (and, where the help does not show the output shape, from the installed package source or the upstream
		* README), and `verification` records how far each was checked:
		*  - `live`: a real read-only search was run and its output parsed (bili, gh, omnireach/wechat);
		*  - `contract-only`: help and version probed on a real install, output shape taken from the tool's own source,
		*    README or documented output option, because a search needs the user's login or reads browser cookies, or was outside
		*    the checks allowed (xhs, zhihu, rdt, twitter, opencli sites, yt-dlp, wx-search-cli);
		*  - `docs-only`: not installed here; derived from the upstream README (tanso).
		* Fixtures for the contract-only and docs-only parsers are marked "constructed from help/docs" in test/fixtures/cli.
		* @module web-search-pro/cli/builtin-specs
		*/
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
				output: {
					format: "json",
					itemsPath: "data",
					expect: ENVELOPE,
					errorPaths: ["message", "error"],
					stripTags: true,
					snippetMax: 300,
					fields: {
						url: { template: "https://www.bilibili.com/video/{bvid}" },
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
				date: SPEC_CHECK_DATE,
				note: "`bili search DeepSeek --type video --max 2 --json` parsed (fixture bili-search.json)"
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
					"%(id)s	%(title)s	%(channel)s	%(view_count)s	%(duration_string)s"
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
					emptyValues: ["None"],
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
				status: "contract-only",
				version: "2026.08.19",
				date: SPEC_CHECK_DATE,
				note: "help and version probed; flags from `yt-dlp --help`; the print template is the one the plugin has used since 0.1; no search was run"
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
				mustContain: ["search"]
			},
			allowedSubcommands: ["search"],
			search: {
				argv: [
					"search",
					"{query}",
					"-n",
					"{count}"
				],
				maxCount: 10,
				output: {
					format: "text",
					lines: { mode: "url-lines" },
					titleMax: 200,
					requireTitle: true,
					fields: {
						url: "url",
						title: "title"
					}
				},
				notLoggedInPatterns: [
					"not authenticated",
					"unauthorized",
					"no twitter cookies",
					"auth_token",
					"ct0"
				]
			},
			env: { required: ["TWITTER_AUTH_TOKEN", "TWITTER_CT0"] },
			needsLogin: true,
			timeoutMs: 45e3,
			maxOutputBytes: 4 * MB,
			verification: {
				status: "contract-only",
				version: "0.8.5",
				date: SPEC_CHECK_DATE,
				note: "help probed; the plain-text output (`search QUERY -n N`) is the one the plugin has used since 0.1; the tool also offers --json, not used here; no search was run (needs your tokens)"
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
					fields: {
						url: { template: "https://www.xiaohongshu.com/explore/{id}?xsec_token={xsec_token}&xsec_source=pc_search" },
						title: ["note_card.display_title", "note_card.title"],
						snippet: { join: [{
							path: "note_card.user.nickname",
							prefix: "作者: "
						}, {
							path: "note_card.interact_info.liked_count",
							prefix: "赞: "
						}] }
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
				status: "contract-only",
				version: "0.6.4",
				date: SPEC_CHECK_DATE,
				note: "help probed; output shape from the installed package source (client response + its own normalizer); no search was run: it needs your login and, without a saved one, reads browser cookies"
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
					date: SPEC_CHECK_DATE,
					note: "`omnireach search 大模型 备案 --on wechat --limit 2 --json` parsed (fixture omnireach-wechat.json); the multi-source command was not run"
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
						"{query}"
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
							"{query}"
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
							"{query}"
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
					date: SPEC_CHECK_DATE,
					note: "`gh search repos --json … --sort stars -- \"dsh web search\"` parsed (fixture gh-repos.json); issues and code searches follow the documented JSON fields of their help pages and were not run"
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
					status: "contract-only",
					version: "0.1.0",
					date: SPEC_CHECK_DATE,
					note: "help and version probed on a real install; output shape (JSON array of { title, link, real_url, publish_time, page }) from the upstream README and src/index.ts read with gh api; no search was run"
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
		/** Platforms whose provider is a chain (everything in the default table). */
		const CHAIN_PLATFORMS = Object.keys({
			xiaohongshu: [
				"opencli",
				"xhs",
				"browser-opencli"
			],
			reddit: [
				"rdt",
				"opencli",
				"browser-opencli"
			],
			twitter: [
				"twitter",
				"opencli",
				"browser-opencli"
			],
			zhihu: ["zhihu", "browser-search"],
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
		});
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
			if (!id.startsWith("custom-cli:") && !platforms.includes(platform)) return {
				ok: false,
				why: "does not serve platform " + platform + " (it serves " + platforms.join(", ") + ")"
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
			if (!isRecord(value)) return;
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
			if (!isRecord(providers)) return {
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
			if (base && isRecord(entry) && entry.version === base.version && !problems.some((p) => p.startsWith("changed content"))) problems.push("version must differ from the built-in \"" + base.version + "\"");
			return problems;
		}
		/** The rubric entries of an evidence object that carry any problem, by rubric id. */
		function rubricIssues(rubrics) {
			const out = {};
			if (!isRecord(rubrics)) return out;
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
			const judge = isRecord(ev.judge) ? ev.judge : {};
			const custom = customProviders(judge.providers);
			if (custom.problems.length) add("evidence.judge.providers", custom.problems.join("\n"));
			const settings = {
				...typeof judge.provider === "string" ? { provider: judge.provider } : {},
				allowLlm: judge.allowLlm === true,
				...isRecord(judge.providers) ? { providers: judge.providers } : {}
			};
			const catalog = resolveProviders(settings).providers;
			const selected = typeof judge.provider === "string" && judge.provider ? judge.provider : DEFAULT_PROVIDER_ID;
			const mode = typeof getAt(ev, ["judge", "mode"]) === "string" ? getAt(ev, ["judge", "mode"]) : ev.jevMode;
			if (typeof judge.provider === "string" && judge.provider && !catalog.has(judge.provider)) add("evidence.judge.provider", "provider \"" + judge.provider + "\" is not defined (known: " + [...catalog.keys()].join(", ") + ")", "error", ["evidence.judge.providers"]);
			else if (mode !== void 0 && mode !== "off") {
				const why = unusableReason(catalog.get(selected), settings);
				if (why) add("evidence.judge.provider", why, "warning");
			}
			const coverage = isRecord(ev.coverage) ? ev.coverage : {};
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
					const rubric = isRecord(ev.rubrics) && isRecord(ev.rubrics["cover.sufficient"]) && rubricEntryProblems("cover.sufficient", ev.rubrics["cover.sufficient"]).length === 0 ? String(ev.rubrics["cover.sufficient"].version) : builtinDef("cover.sufficient").version;
					const key = thresholdKey(providerId, {
						id: "cover.sufficient",
						version: rubric
					});
					if (!CALIBRATED_THRESHOLDS[key]) add("evidence.coverage.thresholds.weak", "no calibrated thresholds for " + key + ": set both thresholds (fitted on your own labels) or the judge stays off", "warning");
				}
			}
			if (ev.budget !== void 0) {
				const diagnostics = resolveBudget(isRecord(ev.budget) ? ev.budget : {}).diagnostics;
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
			return isRecord(rubrics) ? Object.keys(rubrics).filter((id) => !BUILTIN_RUBRIC_IDS.includes(id)) : [];
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
		const SPEC_BY_FIELD = new Map(SPECS.map((spec) => [spec.field, spec]));
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
			constructor(scope, ctx) {
				this.scope = scope;
				this.ctx = ctx;
				this.store = createLocalStore(this.project());
				this.unsubscribe = scope.subscribe(() => {
					this.publish();
					if (stable(this.credentialRefs()) !== this.credentialRefSignature) this.refreshCredentials();
				});
				this.refreshCredentials();
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
					return isRecord(value) ? value : void 0;
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
					for (const item of plan) {
						if (item.write === void 0) {
							landed = false;
							break;
						}
						if (item.write.kind === "clear") {
							await this.scope.unset(item.target);
							landed = !this.storedTop(item.target) && landed;
						} else {
							await this.scope.set(item.target, item.write.value);
							landed = same(this.userLayer()?.[item.target], item.write.value) && landed;
						}
					}
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
				const credentialsDirty = this.credentialPlan().length > 0;
				return {
					available: this.scope.getSnapshot().status === "ready",
					writable: this.scope.getSnapshot().writable,
					dirty: analysis.settings.length > 0 || credentialsDirty,
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
					unknownRubrics: unknownRubricIds(analysis.evidence.rubrics)
				};
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
				const ops = /* @__PURE__ */ new Map();
				const staged = /* @__PURE__ */ new Set();
				for (const [field, draft] of this.staged) {
					const spec = this.spec(field);
					if (!isPathSpec(spec)) {
						if (draft.clear) {
							if (this.stored(field)) settings.push({
								target: field,
								write: { kind: "clear" }
							});
							continue;
						}
						if (draft.text === spec.format(this.sectionValue(field))) continue;
						settings.push({
							target: field,
							write: spec.parse(draft.text)
						});
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
					const stored = isRecord(user[root]) ? user[root] : void 0;
					const next = structuredClone(stored ?? {});
					if (entry) applyOps(next, entry.ops);
					candidates.set(root, next);
					if (entry === void 0 || !entry.invalid && same(next, stored ?? {})) continue;
					if (entry.invalid) settings.push({
						target: root,
						write: void 0
					});
					else if (Object.keys(next).length > 0) settings.push({
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
				}
				const base = this.scope.getSnapshot().base?.evidence;
				const evidence = deepMerge(isRecord(base) ? base : {}, candidates.get("evidence"));
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
					...sourcesIssues(deepMerge(isRecord(baseSources) ? baseSources : {}, candidates.get("sources"))),
					...cliIssues(topValue("platformBackends"), topValue("cliAdapters"))
				];
				const blocked = /* @__PURE__ */ new Set();
				const touched = (field) => staged.has(field) || this.staged.has(field);
				for (const issue of issues) if (issue.level === "error" && (touched(issue.field) || (issue.related ?? []).some((related) => touched(related)))) blocked.add(issue.field);
				return {
					settings,
					issues,
					blocked,
					evidence
				};
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
			spec(field) {
				const spec = SPEC_BY_FIELD.get(field);
				if (!spec) throw new Error(`unknown web-search-pro settings field: ${field}`);
				return spec;
			}
			resolvedRoot(root) {
				const value = this.scope.getSnapshot().value?.[root];
				return isRecord(value) ? value : {};
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
				const root = isRecord(base?.[spec.root]) ? base[spec.root] : {};
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
				if (!isRecord(root)) return false;
				return spec.stored ? spec.stored(root) : hasAt(root, spec.path);
			}
			publish() {
				this.store.set(this.project());
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/client/styles.ts
		const styles = {
			card: "wsp-card",
			cardOpen: "wsp-card-open",
			header: "wsp-header",
			headText: "wsp-head-text",
			titleRow: "wsp-title-row",
			name: "wsp-name",
			description: "wsp-description",
			dirtyBadge: "wsp-dirty-badge",
			chevron: "wsp-chevron",
			chevronOpen: "wsp-chevron-open",
			body: "wsp-body",
			notice: "wsp-notice",
			section: "wsp-section",
			sectionHeading: "wsp-section-heading",
			grid: "wsp-grid",
			field: "wsp-field",
			fieldInvalid: "wsp-field-invalid",
			fieldHeading: "wsp-field-heading",
			label: "wsp-label",
			hint: "wsp-hint",
			input: "wsp-input",
			textarea: "wsp-textarea",
			code: "wsp-code",
			reset: "wsp-reset",
			toggleField: "wsp-toggle-field",
			toggleLabel: "wsp-toggle-label",
			toggleCopy: "wsp-toggle-copy",
			checkbox: "wsp-checkbox",
			secretRow: "wsp-secret-row",
			credentialStatus: "wsp-credential-status",
			advanced: "wsp-advanced",
			advancedHint: "wsp-advanced-hint",
			footer: "wsp-footer",
			status: "wsp-status",
			failed: "wsp-failed",
			actions: "wsp-actions",
			secondaryButton: "wsp-secondary-button",
			primaryButton: "wsp-primary-button",
			select: "wsp-select",
			problem: "wsp-problem",
			warning: "wsp-warning",
			sectionSummary: "wsp-section-summary",
			sectionBody: "wsp-section-body",
			subheading: "wsp-subheading",
			codeBlock: "wsp-code-block",
			note: "wsp-note",
			table: "wsp-table",
			rubric: "wsp-rubric",
			rubricHead: "wsp-rubric-head",
			badge: "wsp-badge",
			fullRow: "wsp-full-row",
			keyedSource: "wsp-keyed-source",
			linkButton: "wsp-link-button"
		};
		const STYLE_ID = "web-search-pro-settings-styles";
		function ensureStyles() {
			if (document.getElementById(STYLE_ID)) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = `
.wsp-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}
.wsp-card:hover{border-color:var(--dsw-alias-label-dimmed)}.wsp-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.wsp-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.wsp-header:focus-visible,.wsp-reset:focus-visible,.wsp-primary-button:focus-visible,.wsp-secondary-button:focus-visible,.wsp-input:focus-visible,.wsp-checkbox:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.wsp-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}.wsp-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.wsp-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.wsp-description{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.wsp-dirty-badge{font-size:11px;line-height:18px;padding:0 7px;border-radius:9px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.wsp-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}.wsp-chevron-open{transform:rotate(180deg)}.wsp-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:4px 0 8px}
.wsp-notice{margin:12px 0 0;padding:9px 11px;border-radius:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-3)}
.wsp-section{padding:18px 0}.wsp-section+.wsp-section{border-top:1px solid var(--dsw-alias-border-l2)}.wsp-section-heading{margin-bottom:14px}.wsp-section-heading h3{margin:0;font-size:14px;line-height:1.5;color:var(--dsw-alias-label-primary)}.wsp-section-heading p,.wsp-advanced-hint{margin:3px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.wsp-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:16px;row-gap:14px}.wsp-field{display:flex;min-width:0;flex-direction:column;gap:6px}.wsp-field-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.wsp-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}.wsp-hint{margin:0;font-size:12px;line-height:1.45;color:var(--dsw-alias-label-tertiary)}
.wsp-input{box-sizing:border-box;width:100%;min-width:0;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;color:var(--dsw-alias-label-primary)}.wsp-input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}.wsp-input:disabled{opacity:.55;cursor:default}.wsp-field-invalid .wsp-input{border-color:var(--dsw-alias-label-error)}
.wsp-textarea{height:auto;padding:9px 10px;resize:vertical;line-height:1.45}.wsp-code{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:12px}.wsp-reset{appearance:none;border:0;background:none;padding:0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:11px;cursor:pointer}.wsp-reset:disabled{opacity:.45;cursor:default}
.wsp-toggle-field{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;min-width:0;padding-top:2px}.wsp-toggle-label{display:flex;align-items:flex-start;gap:9px;min-width:0;cursor:pointer}.wsp-toggle-copy{display:flex;min-width:0;flex-direction:column;gap:3px}.wsp-checkbox{width:16px;height:16px;flex:none;margin:2px 0 0;accent-color:var(--dsw-alias-brand-primary)}
.wsp-secret-row{display:flex;align-items:center;gap:8px}.wsp-secret-row .wsp-input{flex:1}.wsp-credential-status{flex:none;font-size:11px;line-height:20px;padding:0 7px;border-radius:10px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-3)}.wsp-credential-status[data-configured=true]{color:var(--dsw-alias-brand-primary)}
.wsp-advanced{padding:16px 0;border-top:1px solid var(--dsw-alias-border-l2)}.wsp-advanced>summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}.wsp-advanced-hint{margin-bottom:14px}.wsp-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}
.wsp-status,.wsp-failed{margin:0;font-size:12px;line-height:1.5}.wsp-status{color:var(--dsw-alias-label-tertiary)}.wsp-failed{color:var(--dsw-alias-label-error)}.wsp-actions{display:flex;gap:8px}.wsp-primary-button,.wsp-secondary-button{appearance:none;border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;line-height:1.4;cursor:pointer}.wsp-primary-button{border:1px solid transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.wsp-secondary-button{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}.wsp-primary-button:disabled,.wsp-secondary-button:disabled{opacity:.4;cursor:default}
.wsp-section>.wsp-section-summary{display:block;cursor:pointer;list-style:none;padding:0}.wsp-section>.wsp-section-summary::-webkit-details-marker{display:none}.wsp-section>.wsp-section-summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:4px;border-radius:6px}
.wsp-section-summary .wsp-section-heading{margin:0;padding-right:22px;position:relative}.wsp-section-summary .wsp-section-heading::after{content:"";position:absolute;right:2px;top:7px;width:7px;height:7px;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:rotate(45deg);transition:transform .16s}.wsp-section[open]>.wsp-section-summary .wsp-section-heading::after{transform:rotate(225deg);top:10px}
.wsp-section-body{padding-top:14px}.wsp-subheading{margin:18px 0 10px;font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary)}.wsp-subheading:first-child{margin-top:0}
.wsp-select{appearance:auto;padding-right:6px}.wsp-problem,.wsp-warning{margin:0;font-size:12px;line-height:1.45;white-space:pre-line}.wsp-problem{color:var(--dsw-alias-label-error)}.wsp-warning{color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-tertiary))}.wsp-warning::before{content:"! "}.wsp-toggle-copy .wsp-problem,.wsp-toggle-copy .wsp-warning{display:block}
.wsp-note{margin:12px 0 0;padding:9px 11px;border-radius:8px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-3)}.wsp-note p{margin:0}.wsp-note p+p,.wsp-note pre+p{margin-top:6px}
.wsp-code-block{margin:8px 0;padding:9px 11px;border-radius:8px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);user-select:all}
.wsp-table{width:100%;border-collapse:collapse;font-size:12px;line-height:1.5}.wsp-table th,.wsp-table td{padding:5px 8px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}.wsp-table th{font-weight:500;color:var(--dsw-alias-label-primary)}.wsp-table td:first-child{color:var(--dsw-alias-label-primary);white-space:nowrap}.wsp-table code{font-size:11px}
.wsp-rubric{padding:12px;margin:10px 0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}.wsp-rubric-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px}.wsp-rubric-head strong{font-size:13px;color:var(--dsw-alias-label-primary)}.wsp-badge{display:inline-block;font-size:11px;line-height:18px;padding:0 7px;margin-left:6px;border-radius:9px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-3)}.wsp-badge[data-on=true]{color:var(--dsw-alias-brand-primary)}
.wsp-full-row{grid-column:1/-1}.wsp-keyed-source{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;margin-top:10px}.wsp-keyed-source>summary{cursor:pointer;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}.wsp-keyed-source .wsp-grid{margin-top:12px}.wsp-link-button{appearance:none;border:0;background:none;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-brand-primary);cursor:pointer}
@media(max-width:720px){.wsp-grid{grid-template-columns:minmax(0,1fr)}.wsp-footer{align-items:stretch;flex-direction:column}.wsp-actions{justify-content:flex-end}}
@media(max-width:420px){.wsp-body{margin:0 12px}.wsp-secret-row{align-items:stretch;flex-direction:column}.wsp-credential-status{align-self:flex-start}.wsp-actions{display:grid;grid-template-columns:1fr 1fr}.wsp-primary-button,.wsp-secondary-button{width:100%}}
`;
			document.head.append(style);
		}
		//#endregion
		//#region src/client/fields.tsx
		function FieldShell(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${styles.field} ${props.state?.invalid ? styles.fieldInvalid : ""}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: styles.fieldHeading,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: styles.label,
							htmlFor: props.id,
							children: props.label
						}), props.field && props.state?.overridden ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: styles.reset,
							disabled: props.disabled,
							onClick: () => {
								props.onReset?.(props.field);
							},
							children: props.resetLabel
						}) : null]
					}),
					props.children,
					props.state?.message ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.problem,
						role: "alert",
						"data-web-search-pro-problem": true,
						children: props.state.message
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.hint,
						children: props.state?.invalid && !props.state.message ? props.invalidLabel : props.hint
					}),
					props.state?.warning ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.warning,
						role: "note",
						"data-web-search-pro-warning": true,
						children: props.state.warning
					}) : null
				]
			});
		}
		function TextField(props) {
			const id = `web-search-pro-${props.field}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldShell, {
				id,
				label: props.label,
				hint: props.hint,
				field: props.field,
				state: props.state,
				disabled: props.disabled,
				resetLabel: props.t("reset"),
				invalidLabel: props.t("invalid"),
				onReset: props.reset,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					id,
					className: styles.input,
					type: props.type ?? "text",
					inputMode: props.type === "number" ? "decimal" : void 0,
					value: props.state.text,
					placeholder: props.placeholder,
					disabled: props.disabled,
					"aria-invalid": props.state.invalid || void 0,
					onChange: (event) => {
						props.edit(props.field, event.currentTarget.value);
					}
				})
			});
		}
		function JsonField(props) {
			const id = `web-search-pro-${props.field}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldShell, {
				id,
				label: props.label,
				hint: props.hint,
				field: props.field,
				state: props.state,
				disabled: props.disabled,
				resetLabel: props.t("reset"),
				invalidLabel: props.t("invalidJson"),
				onReset: props.reset,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
					id,
					className: `${styles.input} ${styles.textarea} ${styles.code}`,
					rows: props.rows ?? 5,
					value: props.state.text,
					disabled: props.disabled,
					spellCheck: false,
					"aria-invalid": props.state.invalid || void 0,
					onChange: (event) => {
						props.edit(props.field, event.currentTarget.value);
					}
				})
			});
		}
		function SelectField(props) {
			const id = `web-search-pro-${props.field}`;
			const known = props.options.some((option) => option.value === props.state.text);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldShell, {
				id,
				label: props.label,
				hint: props.hint,
				field: props.field,
				state: props.state,
				disabled: props.disabled,
				resetLabel: props.t("reset"),
				invalidLabel: props.t("invalid"),
				onReset: props.reset,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
					id,
					className: `${styles.input} ${styles.select}`,
					value: props.state.text,
					disabled: props.disabled,
					"aria-invalid": props.state.invalid || void 0,
					onChange: (event) => {
						props.edit(props.field, event.currentTarget.value);
					},
					children: [
						props.emptyLabel !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "",
							children: props.emptyLabel
						}) : null,
						!known && props.state.text !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: props.state.text,
							children: props.state.text
						}) : null,
						props.options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: option.value,
							children: option.label
						}, option.value))
					]
				})
			});
		}
		function ToggleField(props) {
			const checked = props.state.text === "true";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.toggleField,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: styles.toggleLabel,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: `web-search-pro-${props.field}`,
						className: styles.checkbox,
						type: "checkbox",
						checked,
						disabled: props.disabled,
						onChange: (event) => {
							props.edit(props.field, String(event.currentTarget.checked));
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: styles.toggleCopy,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.label,
								children: props.label
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.hint,
								children: props.hint
							}),
							props.state.message ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.problem,
								role: "alert",
								children: props.state.message
							}) : null,
							props.state.warning ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.warning,
								role: "note",
								children: props.state.warning
							}) : null
						]
					})]
				}), props.state.overridden ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: styles.reset,
					disabled: props.disabled,
					onClick: () => {
						props.reset(props.field);
					},
					children: props.t("reset")
				}) : null]
			});
		}
		function CredentialField(props) {
			const inputId = `web-search-pro-credential-${props.id}`;
			const status = props.state.loading ? props.t("credentialChecking") : props.state.configured ? props.t("credentialSet") : props.t("credentialUnset");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldShell, {
				id: inputId,
				label: props.label,
				hint: props.hint,
				disabled: props.disabled || !props.state.writable,
				resetLabel: props.t("reset"),
				invalidLabel: props.t("invalid"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.secretRow,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: inputId,
						className: styles.input,
						type: "password",
						autoComplete: "new-password",
						value: props.state.text,
						placeholder: status,
						disabled: props.disabled || !props.state.writable,
						onChange: (event) => {
							props.edit(props.id, event.currentTarget.value);
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: styles.credentialStatus,
						"data-configured": props.state.configured ? "true" : void 0,
						children: status
					})]
				})
			});
		}
		//#endregion
		//#region src/client/RubricEditor.tsx
		/** Label and hint keys of each rubric text control. */
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
		/** The built-in value of a control, shown as the placeholder while the entry leaves it blank. */
		function builtinText(rubric, key) {
			switch (key) {
				case "version": return rubric.builtin.version;
				case "instructions": return rubric.builtin.instructions;
				case "criteria": return rubric.builtin.criteria.join("\n");
				case "maxStateChars": return String(rubric.builtin.maxStateChars);
				case "maxCandidateChars": return String(rubric.builtin.maxCandidateChars);
			}
		}
		/**
		* One built-in rubric: its active version, and an override editor whose controls are views of one staged entry
		* (version, instructions, levels, limits). The problems shown are the ones the server would act on: it ignores an
		* invalid override and uses the built-in, so the card refuses to save one.
		*/
		function Rubric(props) {
			const { t, rubric, disabled } = props;
			const idBase = `web-search-pro-rubric-${rubric.id}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.rubric,
				"data-web-search-pro-rubric": rubric.id,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: styles.rubricHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: rubric.id }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: styles.badge,
								children: [
									t("rubricActive"),
									": ",
									rubric.activeVersion
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.badge,
								"data-on": rubric.editing || void 0,
								children: rubric.editing ? t("rubricOverrideOn") : `${t("rubricBuiltin")} ${rubric.builtin.version}`
							})
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: rubric.editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: styles.linkButton,
							disabled,
							onClick: () => {
								props.restoreRubric(rubric.id);
							},
							children: t("rubricRestore")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: styles.linkButton,
							disabled,
							onClick: () => {
								props.startRubric(rubric.id);
							},
							children: t("rubricCreate")
						}) })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.hint,
						children: rubric.description
					}),
					rubric.editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: styles.grid,
						children: CONTROLS.filter((control) => control.key !== "criteria" || rubric.kind === "score").map((control) => {
							const id = `${idBase}-${control.key}`;
							const common = {
								id,
								value: rubric.entry[control.key],
								disabled,
								placeholder: builtinText(rubric, control.key),
								spellCheck: false,
								"aria-invalid": rubric.invalid || void 0
							};
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: `${styles.field} ${control.kind === "area" ? styles.fullRow : ""}`,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: styles.label,
										htmlFor: id,
										children: t(control.label)
									}),
									control.kind === "area" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										...common,
										className: `${styles.input} ${styles.textarea} ${styles.code}`,
										rows: control.key === "criteria" ? 5 : 6,
										onChange: (event) => {
											props.editRubric(rubric.id, control.key, event.currentTarget.value);
										}
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										...common,
										className: styles.input,
										type: "text",
										inputMode: control.kind === "number" ? "numeric" : void 0,
										onChange: (event) => {
											props.editRubric(rubric.id, control.key, event.currentTarget.value);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: styles.hint,
										children: t(control.hint)
									})
								]
							}, control.key);
						})
					}) : null,
					rubric.problems.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: rubric.invalid ? styles.problem : styles.warning,
						role: "alert",
						"data-web-search-pro-rubric-problems": true,
						children: rubric.problems.map((problem, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: problem }, index))
					}) : null
				]
			});
		}
		function RubricEditor(props) {
			const { t, state } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-web-search-pro-rubrics": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.hint,
						children: t("rubricNotes")
					}),
					state.rubrics.map((rubric) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Rubric, {
						t,
						rubric,
						disabled: props.disabled,
						editRubric: props.editRubric,
						startRubric: props.startRubric,
						restoreRubric: props.restoreRubric
					}, rubric.id)),
					state.unknownRubrics.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: styles.warning,
						role: "note",
						children: [
							t("rubricUnknown"),
							" ",
							state.unknownRubrics.join(", ")
						]
					}) : null
				]
			});
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
		/** Display names of the keyed sources by route id (proper names, shown the same in every language). */
		const KEYED_NAMES = {
			tavily: "Tavily",
			brave: "Brave Search",
			linkup: "Linkup",
			serper: "Serper (Google)",
			metaso: "秘塔 Metaso",
			zhipu: "智谱 Zhipu",
			"baidu-qianfan": "百度千帆 Baidu Qianfan"
		};
		//#endregion
		//#region src/client/SettingsCard.tsx
		/** A collapsible group of settings; `defaultOpen` only decides how it starts. */
		function Section(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: styles.section,
				open: props.defaultOpen || void 0,
				"data-web-search-pro-section": props.id,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
					className: styles.sectionSummary,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: styles.sectionHeading,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: props.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.hint })]
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: styles.sectionBody,
					children: props.children
				})]
			});
		}
		function SettingsCard(props) {
			const { t } = props;
			const state = props.useWebSearchPro((snapshot) => snapshot);
			const [open, setOpen] = (0, react.useState)(true);
			if (props.view === "summary") return t("description");
			if (!state.available) return null;
			const disabled = !state.writable || state.saving;
			const text = (field, label, hint, type, placeholder) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
				field,
				state: state.fields[field],
				label: t(label),
				hint: t(hint),
				disabled,
				t,
				edit: props.edit,
				reset: props.resetField,
				type,
				placeholder
			});
			const toggle = (field, label, hint) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleField, {
				field,
				state: state.fields[field],
				label: t(label),
				hint: t(hint),
				disabled,
				t,
				edit: props.edit,
				reset: props.resetField
			});
			const json = (field, label, hint, rows) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JsonField, {
				field,
				state: state.fields[field],
				label: t(label),
				hint: t(hint),
				disabled,
				t,
				edit: props.edit,
				reset: props.resetField,
				rows
			});
			const select = (field, label, hint, options, emptyLabel) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectField, {
				field,
				state: state.fields[field],
				label: t(label),
				hint: t(hint),
				disabled,
				options,
				emptyLabel,
				t,
				edit: props.edit,
				reset: props.resetField
			});
			const providers = state.providerChoices.map((id) => ({
				value: id,
				label: id
			}));
			const off = {
				value: "off",
				label: t("optionOff")
			};
			const routeId = state.fields.providerId.text.trim() || "web-search-pro";
			const credential = (id, label, hint = "credentialWriteOnlyHint") => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CredentialField, {
				id,
				label: t(label),
				hint: t(hint),
				state: state.credentials[id],
				disabled,
				t,
				edit: props.editCredential
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${styles.card} ${open ? styles.cardOpen : ""}`,
				"data-web-search-pro-settings": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: styles.header,
					"aria-expanded": open,
					"aria-label": `${t(open ? "collapse" : "expand")}: ${t("title")}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: styles.headText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: styles.titleRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.name,
								children: t("title")
							}), state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.dirtyBadge,
								children: t("unsaved")
							}) : null]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: styles.description,
							children: t("description")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						className: `${styles.chevron} ${open ? styles.chevronOpen : ""}`,
						viewBox: "0 0 14 14",
						width: "14",
						height: "14",
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: "M3.5 5.5 7 9l3.5-3.5",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "1.5",
							strokeLinecap: "round",
							strokeLinejoin: "round"
						})
					})]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.body,
					children: [
						!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: styles.notice,
							role: "status",
							children: t("readOnly")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Section, {
							id: "search",
							title: t("searchSection"),
							hint: t("searchSectionHint"),
							defaultOpen: true,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.grid,
								children: [
									text("engines", "engines", "enginesHint"),
									text("searchMaxResults", "searchMaxResults", "searchMaxResultsHint", "number"),
									toggle("parallelEngines", "parallelEngines", "parallelEnginesHint")
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Section, {
							id: "network",
							title: t("networkSection"),
							hint: t("networkSectionHint"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.grid,
								children: [toggle("allowProxyFakeIp", "allowProxyFakeIp", "allowProxyFakeIpHint"), text("timeoutMs", "timeoutMs", "timeoutMsHint", "number")]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Section, {
							id: "tool-surface",
							title: t("toolSurfaceSection"),
							hint: t("toolSurfaceSectionHint"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: styles.grid,
								children: select("toolSurface", "toolSurface", "toolSurfaceHint", [{
									value: "indexed",
									label: t("optIndexed")
								}, {
									value: "flat",
									label: t("optFlat")
								}])
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Section, {
							id: "route",
							title: t("routeSection"),
							hint: t("routeSectionHint"),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.grid,
								children: [
									toggle("registerProvider", "registerProvider", "registerProviderHint"),
									text("providerId", "providerId", "providerIdHint"),
									select("provider.evidence", "providerEvidence", "providerEvidenceHint", [{
										value: "auto",
										label: t("optAuto")
									}, {
										value: "off",
										label: t("optOff")
									}]),
									text("provider.deadlineMs", "providerDeadlineMs", "providerDeadlineMsHint", "number")
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.note,
								"data-web-search-pro-route-help": true,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("routeHelpTitle") }) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("routeHelpIntro") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
										className: styles.codeBlock,
										children: `- id: web\n  name: '@deepseek-ai/dsh-web'\n  config:\n    searchProvider: ${routeId}\n    fetchProvider: ${routeId}`
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("routeHelpAfter") })
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Section, {
							id: "evidence",
							title: t("evidenceSection"),
							hint: t("evidenceSectionHint"),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.grid,
								children: [
									toggle("evidence.autoProviders", "evAutoProviders", "evAutoProvidersHint"),
									text("evidence.maxRounds", "evMaxRounds", "evMaxRoundsHint", "number"),
									text("evidence.maxQueries", "evMaxQueries", "evMaxQueriesHint", "number"),
									text("fetchDefaultChars", "fetchDefaultChars", "fetchDefaultCharsHint", "number"),
									text("exaContentsPerUrlChars", "exaContentsPerUrlChars", "exaContentsPerUrlCharsHint", "number"),
									text("exaContentsTotalChars", "exaContentsTotalChars", "exaContentsTotalCharsHint", "number")
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: styles.note,
								children: t("evidenceNote")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Section, {
							id: "judge",
							title: t("judgeSection"),
							hint: t("judgeSectionHint"),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: styles.subheading,
									children: t("judgeGroupModel")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: styles.grid,
									children: [
										select("evidence.judge.mode", "judgeMode", "judgeModeHint", [
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
										]),
										select("evidence.judge.provider", "judgeProvider", "judgeProviderHint", providers, t("emptyDefault")),
										toggle("evidence.hybridBorderline", "hybridBorderline", "hybridBorderlineHint"),
										text("evidence.maxJevQuestions", "maxJevQuestions", "maxJevQuestionsHint", "number"),
										toggle("evidence.judge.allowLlm", "allowLlm", "allowLlmHint")
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: styles.subheading,
									children: t("judgeGroupCoverage")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: styles.grid,
									children: [
										select("evidence.coverage.mode", "coverageMode", "coverageModeHint", [
											off,
											{
												value: "shadow",
												label: t("optShadow")
											},
											{
												value: "control",
												label: t("optControl")
											}
										]),
										select("evidence.coverage.provider", "coverageProvider", "coverageProviderHint", providers, t("emptyDefault")),
										text("evidence.coverage.thresholds.weak", "thresholdWeak", "thresholdWeakHint", "number"),
										text("evidence.coverage.thresholds.covered", "thresholdCovered", "thresholdCoveredHint", "number")
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: styles.subheading,
									children: t("judgeGroupBudget")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: styles.grid,
									children: [
										text("evidence.budget.perSearchInputTokens", "budgetPerSearch", "budgetPerSearchHint", "number"),
										text("evidence.budget.dailyInputTokens", "budgetDaily", "budgetDailyHint", "number"),
										text("evidence.budget.timezone", "budgetTimezone", "budgetTimezoneHint"),
										json("evidence.budget.providers", "budgetProviders", "budgetProvidersHint", 4)
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: styles.subheading,
									children: t("judgeGroupProviders")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: styles.grid,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: styles.fullRow,
										children: json("evidence.judge.providers", "judgeProviders", "judgeProvidersHint", 9)
									})
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Section, {
							id: "prompts",
							title: t("promptsSection"),
							hint: t("promptsSectionHint"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RubricEditor, {
								t,
								state,
								disabled,
								editRubric: props.editRubric,
								startRubric: props.startRubric,
								restoreRubric: props.restoreRubric
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Section, {
							id: "sources",
							title: t("sourcesSection"),
							hint: t("sourcesSectionHint"),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: styles.subheading,
									children: t("strategyGroup")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: styles.hint,
									"data-web-search-pro-strategy": true,
									children: t("strategyNote")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: styles.grid,
									children: [
										select("evidence.sourcePolicy", "sourcePolicy", "sourcePolicyHint", [{
											value: "default",
											label: t("optPolicyDefault")
										}, {
											value: "anonymous-only",
											label: t("optPolicyAnonymousOnly")
										}]),
										text("sources.priority", "srcPriority", "srcPriorityHint", "text", "bocha, exa"),
										text("sources.disabled", "srcDisabled", "srcDisabledHint")
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: styles.subheading,
									children: t("bochaGroup")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: styles.grid,
									children: [
										text("bochaApiKeyEnv", "bochaApiKeyEnv", "bochaApiKeyEnvHint", "text", "BOCHA_SEARCH_API_KEY"),
										credential("bocha", "bochaApiKey"),
										text("bochaBaseUrl", "bochaBaseUrl", "bochaBaseUrlHint", "text", "https://api.bocha.cn"),
										toggle("bochaSummary", "bochaSummary", "bochaSummaryHint"),
										text("sources.budget.bocha.total", "reqTotal", "reqTotalHint", "number"),
										text("sources.budget.bocha.daily", "reqDaily", "reqDailyHint", "number")
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: styles.note,
									"data-web-search-pro-req-budget": true,
									children: [
										t("reqBudgetGroup"),
										": ",
										t("reqBudgetNote")
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: styles.subheading,
									children: t("keyedGroup")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: styles.hint,
									children: t("keyedGroupHint")
								}),
								KEYED_SOURCES.map(({ id, defaultEnv }) => {
									const envField = `keyedSources.${id}.apiKeyEnv`;
									const urlField = `keyedSources.${id}.baseUrl`;
									const status = state.credentials[`keyed:${id}`];
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
										className: styles.keyedSource,
										open: state.fields[envField].overridden || state.fields[urlField].overridden || state.fields[`sources.budget.${id}.total`].overridden || state.fields[`sources.budget.${id}.daily`].overridden || status.configured || void 0,
										"data-web-search-pro-keyed": id,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [KEYED_NAMES[id] ?? id, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: styles.badge,
											"data-on": status.configured || void 0,
											children: status.loading ? t("credentialChecking") : status.configured ? t("credentialSet") : t("credentialUnset")
										})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: styles.grid,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
													field: envField,
													state: state.fields[envField],
													label: t("keyedEnv"),
													hint: `${t("keyedEnvHint")}${defaultEnv}`,
													disabled,
													t,
													edit: props.edit,
													reset: props.resetField,
													placeholder: defaultEnv
												}),
												credential(`keyed:${id}`, "keyedApiKey"),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
													field: urlField,
													state: state.fields[urlField],
													label: t("keyedBaseUrl"),
													hint: t("keyedBaseUrlHint"),
													disabled,
													t,
													edit: props.edit,
													reset: props.resetField
												}),
												text(`sources.budget.${id}.total`, "reqTotal", "reqTotalHint", "number"),
												text(`sources.budget.${id}.daily`, "reqDaily", "reqDailyHint", "number")
											]
										})]
									}, id);
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: styles.subheading,
									children: "SearXNG · OpenAlex"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: styles.grid,
									children: [text("searxngUrl", "searxngUrl", "searxngUrlHint", "text", "http://127.0.0.1:8080"), text("openalexMailto", "openalexMailto", "openalexMailtoHint")]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: styles.subheading,
									children: t("anonymousTitle")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: styles.hint,
									children: t("anonymousHint")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
									className: styles.table,
									"data-web-search-pro-anonymous": true,
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
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: styles.note,
									"data-web-search-pro-status-line": true,
									children: t("sourcesStatusLine")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Section, {
							id: "credentials",
							title: t("credentialsSection"),
							hint: t("credentialsSectionHint"),
							defaultOpen: true,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.grid,
								children: [
									text("exaApiKeyEnv", "exaApiKeyEnv", "credentialRefHint"),
									credential("exa", "exaApiKey"),
									text("jinaApiKeyEnv", "jinaApiKeyEnv", "credentialRefHint"),
									credential("jina", "jinaApiKey"),
									text("githubTokenEnv", "githubTokenEnv", "credentialRefHint"),
									credential("github", "githubToken")
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Section, {
							id: "runtime",
							title: t("runtimeSection"),
							hint: t("runtimeSectionHint"),
							defaultOpen: true,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.grid,
								children: [
									toggle("enableCliBackends", "enableCliBackends", "enableCliBackendsHint"),
									toggle("opencliEnabled", "opencliEnabled", "opencliEnabledHint"),
									toggle("agentReachEnabled", "agentReachEnabled", "agentReachEnabledHint"),
									json("playwright", "playwright", "playwrightHint", 4),
									json("platformBackends", "platformBackends", "platformBackendsHint", 7),
									json("cliAdapters", "cliAdapters", "cliAdaptersHint", 12)
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							className: styles.advanced,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("advancedSection") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: styles.advancedHint,
									children: t("advancedSectionHint")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: styles.grid,
									children: [
										text("ttlSeconds", "ttlSeconds", "ttlSecondsHint", "number"),
										text("memoryCacheEntries", "memoryCacheEntries", "memoryCacheEntriesHint", "number"),
										text("rrfConstant", "rrfConstant", "rrfConstantHint", "number"),
										text("freshnessBoost", "freshnessBoost", "boostHint", "number"),
										text("freshnessDays", "freshnessDays", "freshnessDaysHint", "number"),
										text("authorityBoost", "authorityBoost", "boostHint", "number"),
										text("authorityDomains", "authorityDomains", "authorityDomainsHint"),
										text("dbPath", "dbPath", "dbPathHint"),
										json("platformRules", "platformRules", "platformRulesHint"),
										json("customPlatforms", "customPlatforms", "customPlatformsHint", 7),
										json("browserBindings", "browserBindings", "browserBindingsHint", 7),
										toggle("verbose", "verbose", "verboseHint")
									]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.footer,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: state.failed ? styles.failed : styles.status,
								role: "status",
								"aria-live": "polite",
								children: state.failed ? t("saveFailed") : state.invalid ? t("invalidSave") : state.dirty ? t("pendingSave") : t("saved")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.actions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: styles.secondaryButton,
									disabled: !state.dirty || state.saving,
									onClick: props.discard,
									children: t("discard")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: styles.primaryButton,
									disabled: !state.dirty || state.invalid || state.saving || !state.writable,
									onClick: props.save,
									children: t(state.saving ? "saving" : "save")
								})]
							})]
						})
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const zh = {
			tab: "Web Search Pro",
			title: "Web Search Pro",
			description: "搜索引擎、凭据、OpenCLI、Playwright、缓存与平台规则",
			expand: "展开",
			collapse: "收起",
			unsaved: "未保存",
			readOnly: "当前设置文档为只读，无法保存修改。",
			searchSection: "搜索策略",
			searchSectionHint: "控制默认引擎、并行方式和单次搜索预算。",
			engines: "默认引擎顺序",
			enginesHint: "逗号分隔；按顺序尝试，例如 seam, exa, ddg, bing, jina。",
			searchMaxResults: "默认结果数",
			searchMaxResultsHint: "1–20。工具调用未指定 count 时使用。",
			timeoutMs: "超时预算（毫秒）",
			timeoutMsHint: "单次增强搜索的协作超时，至少 1000 毫秒。",
			fetchDefaultChars: "页面读取默认字数",
			fetchDefaultCharsHint: "read.fetch 单次输出上限（1000–500000）；更长的页面用 offset 续读。",
			exaContentsPerUrlChars: "Exa 正文单 URL 上限",
			exaContentsPerUrlCharsHint: "read.contents 每个 URL 的输出字数上限，至少 500。",
			exaContentsTotalChars: "Exa 正文总上限",
			exaContentsTotalCharsHint: "read.contents 一次调用所有 URL 的输出字数总上限，至少 1000。",
			parallelEngines: "并行融合多个引擎",
			parallelEnginesHint: "同时查询全部默认引擎并用 RRF 合并，而非顺序回退。",
			credentialsSection: "服务凭据",
			credentialsSectionHint: "密钥写入 DSH Credentials；浏览器只显示是否已配置，不读取明文。",
			exaApiKeyEnv: "Exa 凭据引用",
			jinaApiKeyEnv: "Jina 凭据引用",
			githubTokenEnv: "GitHub 凭据引用",
			credentialRefHint: "DSH Credentials / 环境变量引用名。修改引用和密钥可在一次保存中完成。",
			exaApiKey: "Exa API Key",
			jinaApiKey: "Jina API Key",
			githubToken: "GitHub Token",
			credentialWriteOnlyHint: "只写输入；留空不会覆盖已保存密钥。",
			credentialChecking: "正在检查…",
			credentialSet: "已配置",
			credentialUnset: "未配置",
			runtimeSection: "运行时与后端",
			runtimeSectionHint: "控制 CLI、OpenCLI、Agent Reach、ctx.web Provider 与浏览器回退。",
			enableCliBackends: "启用 CLI 后端",
			enableCliBackendsHint: "允许 bili、yt-dlp、OpenCLI 和 Agent Reach 等本机后端。",
			opencliEnabled: "启用 OpenCLI",
			opencliEnabledHint: "允许通过已连接的 Chrome Browser Bridge 使用站点适配器。",
			agentReachEnabled: "启用 Agent Reach",
			agentReachEnabledHint: "允许兼容 Agent Reach 的外部搜索后端。",
			registerProvider: "注册为 ctx.web Provider",
			registerProviderHint: "让内置 web_search / web_fetch 可路由到 Web Search Pro。",
			providerId: "Provider ID",
			providerIdHint: "供 DSH_WEB_SEARCH_PROVIDER 或 Web 设置引用的稳定标识。",
			playwright: "Playwright 设置（JSON）",
			playwrightHint: "例如 {\"enabled\":true,\"snapshotDir\":\"D:/...\"}；目录留空时继承默认值。",
			advancedSection: "高级：排序、缓存与平台规则",
			advancedSectionHint: "适合调试、私有平台和精细排序；JSON 必须是对象。",
			ttlSeconds: "缓存有效期（秒）",
			ttlSecondsHint: "0 表示每次都视为过期。",
			memoryCacheEntries: "内存缓存条目",
			memoryCacheEntriesHint: "进程内 LRU 容量，至少 1。",
			rrfConstant: "RRF 常量",
			rrfConstantHint: "多引擎融合的排名平滑常量。",
			freshnessBoost: "时效加权",
			authorityBoost: "权威域名加权",
			boostHint: "0–1：占一个排名名次的比例，每个 URL 只加一次。",
			freshnessDays: "时效衰减天数",
			freshnessDaysHint: "新鲜度加权在多少天内衰减到 0。",
			authorityDomains: "额外权威域名",
			authorityDomainsHint: "逗号分隔，不需要协议或路径。",
			dbPath: "SQLite 路径",
			dbPathHint: "留空恢复插件默认路径。",
			allowProxyFakeIp: "允许代理 fake-IP DNS",
			allowProxyFakeIpHint: "开着 Clash / TUN 等代理时，若搜索报“地址被拦截 / 私网地址”，且域名被解析成 198.18.x.x，就打开它：仅信任 fake-IP 段（198.18/15、fdfe:dcba:9876::/64、2001:2::/48），其他私网与字面 IP 仍拒绝。",
			platformRules: "平台选择器覆盖（JSON）",
			platformRulesHint: "按平台设置 item/title/link/text 选择器。",
			customPlatforms: "自定义平台（JSON）",
			customPlatformsHint: "按平台定义搜索 URL 与选择器；登录态请通过浏览器绑定引用 AuthProfile。",
			platformBackends: "平台后端顺序（JSON）",
			platformBackendsHint: "每个平台依次尝试的后端，如 {\"xiaohongshu\": [\"xhs\", \"opencli\", \"browser-opencli\"]}。id：各 CLI（xhs、rdt、zhihu、twitter、bili、yt-dlp、omnireach、wx-search-cli、gh、tanso）、opencli、browser-opencli、browser-search、rest、custom-cli:<id>。缺失或未登录的后端会被跳过并说明原因。",
			cliAdapters: "自定义 CLI 适配（JSON）",
			cliAdaptersHint: "按 id 定义只读 CLI 适配规格（argv 数组、输出字段、探测契约、allowedSubcommands）。写操作和读取浏览器 Cookie 的参数会被拒绝；无效条目被忽略并在 sources.status 说明。登录始终由你自己运行 CLI。",
			browserBindings: "浏览器绑定（JSON）",
			browserBindingsHint: "把平台绑定到 dsh-browser AuthProfile 与 RulePack。",
			verbose: "详细诊断日志",
			verboseHint: "写入加载标记并输出更多运行诊断。",
			networkSection: "网络",
			networkSectionHint: "代理环境与单次搜索的超时。",
			toolSurfaceSection: "工具面",
			toolSurfaceSectionHint: "模型看到的工具形态；启动时读取，改完需重启。",
			toolSurface: "工具面形态",
			toolSurfaceHint: "indexed：只暴露 web_index / web_call，常驻文本最少（默认）。flat：每个动作一个工具，仅用于对比和调试。",
			optIndexed: "indexed（默认）",
			optFlat: "flat（调试）",
			routeSection: "内置 web 工具路由",
			routeSectionHint: "让宿主内置的 web_search / web_fetch 经过本插件的证据管线。",
			providerEvidence: "内置 web_search 返回",
			providerEvidenceHint: "auto：返回证据包（失败或超时退回普通来源）。off：只返回来源列表，与旧行为一致。",
			optAuto: "auto（证据包）",
			optOff: "off（来源列表）",
			providerDeadlineMs: "证据运行期限（毫秒）",
			providerDeadlineMsHint: "一次内置 web_search 内证据管线的期限，到点返回已有结果；至少 100。",
			routeHelpTitle: "选中本插件还需要 profile patch",
			routeHelpIntro: "注册只是“可选”。宿主只在 web 条目写明 id 或它是唯一可用 provider 时才用它；在 $DSH_HOME/profiles/<profile>/cordis.patch.yml 中写：",
			routeHelpAfter: "也可只设环境变量 DSH_WEB_SEARCH_PROVIDER / DSH_WEB_FETCH_PROVIDER。不要只注册而不写 fetchProvider（宿主自带的 http 与本插件同时可用时 web_fetch 会报 AMBIGUOUS）。重启后用 web_call sources.status 查看 “ctx.web route” 一行。",
			evidenceSection: "证据管线",
			evidenceSectionHint: "来源选择、补搜轮数，以及读页与正文的输出上限。",
			evAutoProviders: "按语言自动选来源",
			evAutoProvidersHint: "就绪且擅长任务语言的来源（博查、Exa 等）排到 profile 表前；关闭则完全按表与 engines。",
			evMaxRounds: "最多检索轮数",
			evMaxRoundsHint: "1 = 不补搜；默认 2（关键需求缺口时补搜一轮）。",
			evMaxQueries: "每任务最多搜索请求",
			evMaxQueriesHint: "含全部轮次；用完则不再补搜，默认 4。",
			evidenceNote: "保底保留条数（minKeep，3）与证据包字符预算是插件内置默认或每次调用的参数（search.run 的 budget），没有配置项。",
			judgeSection: "评分模型",
			judgeSectionHint: "可选的付费 / 本地模型：参与 S6 评分与 S8 覆盖判定。默认关闭；开启前请确认 Key 与用量上限。",
			judgeGroupModel: "评分",
			judgeGroupCoverage: "覆盖判定",
			judgeGroupBudget: "用量上限",
			judgeGroupProviders: "自定义 provider",
			judgeMode: "评分模式",
			judgeModeHint: "off 不调用；shadow 只记录对照；control 由模型决定；hybrid 规则为主、模型复评跨语言（及边界）对。同时写入旧键 jevMode / scorer，保持一致。",
			optShadow: "shadow（只观察）",
			optControl: "control（模型决定）",
			optHybrid: "hybrid（混合）",
			hybridBorderline: "hybrid：边界对也复评",
			hybridBorderlineHint: "规则评分为 1 的对也交给模型；成本约翻倍。",
			judgeProvider: "评分 provider",
			judgeProviderHint: "默认 bocha-jev。内置预设与下面自定义的 id 可选；占位、未校准的 rerank 会给出警告。",
			maxJevQuestions: "每次搜索最多提问数",
			maxJevQuestionsHint: "向模型提的（需求, 文本块）对上限，默认 64。",
			allowLlm: "允许 llm 协议",
			allowLlmHint: "默认关闭；llm 协议的 provider 需要先打开它。",
			judgeProviders: "自定义 provider（JSON）",
			judgeProvidersHint: "按 id 定义 {protocol, baseUrl, model, keyRef, …}；与预设同名则覆盖字段。keyRef 只是 Key 的引用名，这里不放、也不显示 Key 值。",
			coverageMode: "覆盖判定模式",
			coverageModeHint: "off（默认）；shadow 记录概率；control 把弱支持降级为缺口。不随评分模式自动开启。",
			coverageProvider: "覆盖判定 provider",
			coverageProviderHint: "默认同评分 provider；必须是 systemone 协议。",
			thresholdWeak: "弱阈值",
			thresholdWeakHint: "概率低于它判为弱。留空时用随插件发布的、仅对 bocha-jev + cover.sufficient v1 校准过的值。",
			thresholdCovered: "覆盖阈值",
			thresholdCoveredHint: "概率不低于它判为覆盖；两个阈值要同时填写，弱 ≤ 覆盖。",
			budgetPerSearch: "单次搜索输入 token 上限",
			budgetPerSearchHint: "默认 60000；超限则该搜索回退规则评分。0 = 不允许调用。",
			budgetDaily: "每日输入 token 上限",
			budgetDailyHint: "默认 1000000；按下面的时区按日统计。",
			budgetTimezone: "日界时区",
			budgetTimezoneHint: "IANA 名称，如 Asia/Shanghai；留空用系统时区。",
			budgetProviders: "按 provider 的上限（JSON）",
			budgetProvidersHint: "例如 {\"bocha-jev\":{\"dailyInputTokens\":200000}}；与全局上限取更严者。",
			promptsSection: "提示词（rubric）",
			promptsSectionHint: "评分与覆盖判定向模型提的问题文本。内置版本可被覆盖；覆盖必须换一个新版本号，错误的覆盖会被忽略。",
			rubricActive: "生效版本",
			rubricBuiltin: "内置",
			rubricOverrideOn: "已覆盖",
			rubricCreate: "从内置文本开始覆盖",
			rubricRestore: "恢复默认",
			rubricVersion: "版本号",
			rubricVersionHint: "字母数字与 . _ -，至多 32 字符，且不同于内置版本。",
			rubricInstructions: "提示词模板",
			rubricInstructionsHint: "只能用 {task} {need} {constraint} {candidate} 中该 rubric 允许的变量，且必须含必需变量。",
			rubricCriteria: "评分等级（每行一级，由低到高）",
			rubricCriteriaHint: "仅评分类 rubric，2–10 级。",
			rubricMaxState: "任务描述字符上限",
			rubricMaxStateHint: "20–2000。",
			rubricMaxCandidate: "候选文本字符上限",
			rubricMaxCandidateHint: "100–8000。",
			rubricUnknown: "设置里有不对应任何内置 rubric 的覆盖，会被忽略：",
			rubricNotes: "内置值显示为占位；留空表示沿用内置。改动会改变问题的哈希，旧缓存不会被复用。",
			sourcesSection: "来源",
			sourcesSectionHint: "博查、需 Key 的来源、自建 SearXNG 与礼貌邮箱；匿名来源见下表。",
			bochaGroup: "博查（Bocha）",
			bochaApiKey: "博查 API Key",
			bochaApiKeyEnv: "博查 Key 引用名",
			bochaApiKeyEnvHint: "凭据 / 环境变量名，默认 BOCHA_SEARCH_API_KEY；缺省时回退 BOCHA_JEV_API_KEY。",
			bochaBaseUrl: "博查接口地址",
			bochaBaseUrlHint: "默认 https://api.bocha.cn（官方参考实现的地址，已实测；https://api.bochaai.com 同一个 Key 也可用）；/v1/web-search 会自动追加。",
			bochaSummary: "请求博查长摘要",
			bochaSummaryHint: "默认开启；关闭可减少返回体。",
			keyedGroup: "需 Key 的来源",
			keyedGroupHint: "填入 Key 引用名即启用（未设 Key 前不可用）；Key 写入 DSH Credentials，不在此显示。地址仅在使用代理或私有网关时覆盖。均未经真实服务验证。",
			keyedEnv: "Key 引用名",
			keyedEnvHint: "凭据 / 环境变量名，留空用默认值：",
			keyedBaseUrl: "接口地址",
			keyedBaseUrlHint: "留空用内置地址；须为 http(s) URL。",
			keyedApiKey: "API Key",
			searxngUrl: "SearXNG 地址",
			searxngUrlHint: "自建实例（需开启 JSON 格式）；设置后才有 searxng 来源，无内置公共实例。",
			openalexMailto: "OpenAlex 联系邮箱",
			openalexMailtoHint: "写入 OpenAlex 请求的 User-Agent，礼貌性、可留空。",
			reqBudgetGroup: "请求额度（可选）",
			reqBudgetNote: "为某个来源设置请求上限，计入用量账本（重启后仍有效）；用完后该来源被跳过并回退到其他来源，不会报错。默认没有任何上限。例：博查账号有 1000 次，可设总量 1000、每日 50。已用 / 剩余见 web_call sources.status。",
			reqTotal: "总量上限（次）",
			reqTotalHint: "该来源累计最多请求次数；留空 = 不限。",
			reqDaily: "每日上限（次）",
			reqDailyHint: "每个自然日最多请求次数（时区取评分用量上限里的 timezone）；留空 = 不限。",
			strategyGroup: "来源策略",
			strategyNote: "顺序：调用里明确写的 engines / platform 最优先；其次是下面的“优先来源”；其次是你配置了 Key 的来源（按语言与 profile 自动提前）；什么都没配置时，用匿名 / 免费来源（英文先 Exa 的无 Key 路线，再 DuckDuckGo / Bing）。付费来源只在你配置了 Key 才会被用到。",
			sourcePolicy: "来源策略",
			sourcePolicyHint: "default：按上述顺序。anonymous-only：即使配置了 Key，自动规划也绝不使用需要 Key、账号或登录的来源（调用里明确指定的仍可用）。",
			optPolicyDefault: "default（默认）",
			optPolicyAnonymousOnly: "anonymous-only（只用匿名来源）",
			srcPriority: "优先来源",
			srcPriorityHint: "来源 id，逗号分隔，按顺序排最前（仅限就绪且适合任务语言与 profile 的来源），例：bocha, exa。留空 = 不指定。",
			srcDisabled: "停用来源",
			srcDisabledHint: "来源 id，逗号分隔：自动规划与 engines 列表都不再使用它们（调用里明确指定仍可用）。",
			anonymousTitle: "匿名来源（无需 Key）",
			anonymousHint: "下表只是参考，不代表此刻可用；实时就绪情况见 web_call sources.status。",
			anonymousName: "来源",
			anonymousUse: "用途",
			sourcesStatusLine: "各来源的实时就绪状态（安装、Key、最近一次成功）由 web_call sources.status 显示。",
			emptyDefault: "（默认）",
			optionOff: "off",
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
			reset: "恢复部署值",
			invalid: "输入值无效，请检查范围或格式。",
			invalidJson: "JSON 无效；必须是一个对象。",
			save: "保存",
			saving: "保存中…",
			discard: "放弃修改",
			saved: "配置已与 Host 同步。",
			pendingSave: "修改只在点击保存后写入 settings.yaml。",
			invalidSave: "存在无效字段，修正后才能保存。",
			saveFailed: "Host 未接受全部修改；草稿已保留，请检查冲突或日志。"
		};
		const en = {
			tab: "Web Search Pro",
			title: "Web Search Pro",
			description: "Search engines, credentials, OpenCLI, Playwright, cache, and platform rules",
			expand: "Expand",
			collapse: "Collapse",
			unsaved: "Unsaved",
			readOnly: "The settings document is read-only.",
			searchSection: "Search strategy",
			searchSectionHint: "Control default engines, fusion, and per-call budgets.",
			engines: "Default engine order",
			enginesHint: "Comma-separated, for example seam, exa, ddg, bing, jina.",
			searchMaxResults: "Default result count",
			searchMaxResultsHint: "1–20; used when a tool call omits count.",
			timeoutMs: "Timeout budget (ms)",
			timeoutMsHint: "Cooperative timeout for one enhanced search; minimum 1000 ms.",
			fetchDefaultChars: "Default page characters",
			fetchDefaultCharsHint: "Output cap of one read.fetch call (1000–500000); longer pages continue with offset.",
			exaContentsPerUrlChars: "Exa contents per-URL cap",
			exaContentsPerUrlCharsHint: "Characters returned per URL by read.contents; minimum 500.",
			exaContentsTotalChars: "Exa contents total cap",
			exaContentsTotalCharsHint: "Characters returned over all URLs of one read.contents call; minimum 1000.",
			parallelEngines: "Fuse engines in parallel",
			parallelEnginesHint: "Query every default engine and merge with RRF instead of sequential fallback.",
			credentialsSection: "Service credentials",
			credentialsSectionHint: "Secrets write through DSH Credentials; the browser receives status only.",
			exaApiKeyEnv: "Exa credential reference",
			jinaApiKeyEnv: "Jina credential reference",
			githubTokenEnv: "GitHub credential reference",
			credentialRefHint: "DSH Credentials or environment-variable reference. A reference and key can be saved together.",
			exaApiKey: "Exa API Key",
			jinaApiKey: "Jina API Key",
			githubToken: "GitHub Token",
			credentialWriteOnlyHint: "Write-only; blank leaves the stored secret unchanged.",
			credentialChecking: "Checking…",
			credentialSet: "Configured",
			credentialUnset: "Not configured",
			runtimeSection: "Runtime and backends",
			runtimeSectionHint: "Control CLI, OpenCLI, Agent Reach, ctx.web provider, and browser fallback.",
			enableCliBackends: "Enable CLI backends",
			enableCliBackendsHint: "Allow local bili, yt-dlp, OpenCLI, and Agent Reach backends.",
			opencliEnabled: "Enable OpenCLI",
			opencliEnabledHint: "Use site adapters through the connected Chrome Browser Bridge.",
			agentReachEnabled: "Enable Agent Reach",
			agentReachEnabledHint: "Allow compatible external Agent Reach search backends.",
			registerProvider: "Register ctx.web provider",
			registerProviderHint: "Route built-in web_search / web_fetch through Web Search Pro.",
			providerId: "Provider ID",
			providerIdHint: "Stable id used by DSH_WEB_SEARCH_PROVIDER or Web settings.",
			playwright: "Playwright settings (JSON)",
			playwrightHint: "For example {\"enabled\":true,\"snapshotDir\":\"D:/...\"}; omit the directory to inherit.",
			advancedSection: "Advanced: ranking, cache, and platform rules",
			advancedSectionHint: "For debugging and custom platforms; JSON fields must contain objects.",
			ttlSeconds: "Cache TTL (seconds)",
			ttlSecondsHint: "0 makes every cached result immediately stale.",
			memoryCacheEntries: "Memory cache entries",
			memoryCacheEntriesHint: "In-process LRU capacity; minimum 1.",
			rrfConstant: "RRF constant",
			rrfConstantHint: "Rank smoothing constant for multi-engine fusion.",
			freshnessBoost: "Freshness boost",
			authorityBoost: "Authority boost",
			boostHint: "0–1: fraction of one rank position, applied once per URL.",
			freshnessDays: "Freshness decay days",
			freshnessDaysHint: "Days until the freshness bonus decays to zero.",
			authorityDomains: "Extra authority domains",
			authorityDomainsHint: "Comma-separated, without schemes or paths.",
			dbPath: "SQLite path",
			dbPathHint: "Clear to restore the plugin default.",
			allowProxyFakeIp: "Allow proxy fake-IP DNS",
			allowProxyFakeIpHint: "With a Clash / TUN proxy on, if searches fail with \"address blocked / private address\" and the host resolves to 198.18.x.x, turn this on: only the fake-IP ranges (198.18/15, fdfe:dcba:9876::/64, 2001:2::/48) are trusted; other private and literal IP targets stay blocked.",
			platformRules: "Platform selector overrides (JSON)",
			platformRulesHint: "Set item/title/link/text selectors per platform.",
			customPlatforms: "Custom platforms (JSON)",
			customPlatformsHint: "Define search URLs and selectors; bind an AuthProfile for authenticated access.",
			platformBackends: "Platform backend order (JSON)",
			platformBackendsHint: "Backends each platform tries in order, e.g. {\"xiaohongshu\": [\"xhs\", \"opencli\", \"browser-opencli\"]}. Ids: the CLIs (xhs, rdt, zhihu, twitter, bili, yt-dlp, omnireach, wx-search-cli, gh, tanso), opencli, browser-opencli, browser-search, rest, custom-cli:<id>. A missing or logged-out backend is skipped with its reason.",
			cliAdapters: "Custom CLI adapters (JSON)",
			cliAdaptersHint: "Read-only CLI adapter specs by id (argv array, output fields, probe contract, allowedSubcommands). Write commands and cookie-reading flags are rejected; an invalid entry is ignored and explained in sources.status. Logging in is always yours to do.",
			browserBindings: "Browser bindings (JSON)",
			browserBindingsHint: "Bind platforms to dsh-browser AuthProfiles and RulePacks.",
			verbose: "Verbose diagnostics",
			verboseHint: "Write apply markers and additional runtime diagnostics.",
			networkSection: "Network",
			networkSectionHint: "Proxy environment and the per-search timeout.",
			toolSurfaceSection: "Tool surface",
			toolSurfaceSectionHint: "The tool shape the model sees; read at startup, restart after changing.",
			toolSurface: "Tool surface",
			toolSurfaceHint: "indexed: only web_index / web_call, the smallest resident text (default). flat: one tool per action, for comparison and debugging only.",
			optIndexed: "indexed (default)",
			optFlat: "flat (debugging)",
			routeSection: "Built-in web tools route",
			routeSectionHint: "Send the Host's built-in web_search / web_fetch through this plugin's evidence pipeline.",
			providerEvidence: "Built-in web_search returns",
			providerEvidenceHint: "auto: an evidence pack (plain sources when it fails or times out). off: the source list only, as before.",
			optAuto: "auto (evidence pack)",
			optOff: "off (source list)",
			providerDeadlineMs: "Evidence deadline (ms)",
			providerDeadlineMsHint: "Deadline of the evidence run inside one built-in web_search; a partial pack is returned at the deadline. Minimum 100.",
			routeHelpTitle: "Selecting this plugin also needs a profile patch",
			routeHelpIntro: "Registering only makes it selectable. The Host uses a provider only when the web entry names its id or it is the only one available. In $DSH_HOME/profiles/<profile>/cordis.patch.yml write:",
			routeHelpAfter: "Or set DSH_WEB_SEARCH_PROVIDER / DSH_WEB_FETCH_PROVIDER in the environment. Do not register without fetchProvider (with the Host's own http provider also available, web_fetch fails with AMBIGUOUS). After a restart, web_call sources.status shows a \"ctx.web route\" line.",
			evidenceSection: "Evidence pipeline",
			evidenceSectionHint: "Source selection, extra rounds, and the output caps of page reads and contents.",
			evAutoProviders: "Pick sources by language",
			evAutoProvidersHint: "Ready sources strong in the task language (Bocha, Exa, ...) go ahead of the profile table; off keeps the table and engines as they are.",
			evMaxRounds: "Retrieval rounds",
			evMaxRoundsHint: "1 disables the extra round; default 2 (one more round when a critical need is open).",
			evMaxQueries: "Search requests per task",
			evMaxQueriesHint: "Over all rounds; the extra round only runs while this is not used up. Default 4.",
			evidenceNote: "The keep floor (minKeep, 3) and the pack character budget are built-in defaults or per-call parameters (search.run budget); they have no setting.",
			judgeSection: "Judge model",
			judgeSectionHint: "An optional paid or local model for S6 scoring and S8 coverage. Off by default; check the key and the usage caps before turning it on.",
			judgeGroupModel: "Scoring",
			judgeGroupCoverage: "Coverage judge",
			judgeGroupBudget: "Usage caps",
			judgeGroupProviders: "Custom providers",
			judgeMode: "Scoring mode",
			judgeModeHint: "off: never called; shadow: scores recorded only; control: the model decides; hybrid: rules lead, the model re-scores language-mismatched (and borderline) pairs. Also writes the legacy jevMode / scorer keys so they agree.",
			optShadow: "shadow (observe)",
			optControl: "control (model decides)",
			optHybrid: "hybrid",
			hybridBorderline: "hybrid: re-score borderline pairs",
			hybridBorderlineHint: "Pairs the rules grade 1 also go to the model; roughly doubles the cost.",
			judgeProvider: "Judge provider",
			judgeProviderHint: "Default bocha-jev. Presets and the custom ids below are offered; placeholders and uncalibrated rerankers raise a warning.",
			maxJevQuestions: "Questions per search",
			maxJevQuestionsHint: "Upper bound of (need, block) pairs sent to the model; default 64.",
			allowLlm: "Allow the llm protocol",
			allowLlmHint: "Off by default; providers speaking the llm protocol need it.",
			judgeProviders: "Custom providers (JSON)",
			judgeProvidersHint: "By id: {protocol, baseUrl, model, keyRef, ...}; the same id as a preset overrides its fields. keyRef is only the name of the key: no key value is entered or shown here.",
			coverageMode: "Coverage judge mode",
			coverageModeHint: "off (default); shadow records probabilities; control turns weak support into gaps. Never switched on by the scoring mode.",
			coverageProvider: "Coverage judge provider",
			coverageProviderHint: "Defaults to the judge provider; it must speak the systemone protocol.",
			thresholdWeak: "Weak threshold",
			thresholdWeakHint: "A probability below it is weak. Blank uses the value shipped with the plugin, calibrated only for bocha-jev + cover.sufficient v1.",
			thresholdCovered: "Covered threshold",
			thresholdCoveredHint: "A probability at or above it is covered. Set both thresholds together; weak <= covered.",
			budgetPerSearch: "Input tokens per search",
			budgetPerSearchHint: "Default 60000; past it the search falls back to rule scoring. 0 forbids calls.",
			budgetDaily: "Input tokens per day",
			budgetDailyHint: "Default 1000000; counted per calendar day in the time zone below.",
			budgetTimezone: "Day boundary time zone",
			budgetTimezoneHint: "An IANA name such as Asia/Shanghai; blank uses the system zone.",
			budgetProviders: "Per-provider caps (JSON)",
			budgetProvidersHint: "For example {\"bocha-jev\":{\"dailyInputTokens\":200000}}; the stricter of this and the global cap applies.",
			promptsSection: "Prompts (rubrics)",
			promptsSectionHint: "The question texts of scoring and coverage. A built-in version can be overridden; an override needs a new version label, and an invalid one is ignored.",
			rubricActive: "Active version",
			rubricBuiltin: "built-in",
			rubricOverrideOn: "overridden",
			rubricCreate: "Override starting from the built-in text",
			rubricRestore: "Restore default",
			rubricVersion: "Version",
			rubricVersionHint: "Letters, digits and . _ - (at most 32), and different from the built-in version.",
			rubricInstructions: "Prompt template",
			rubricInstructionsHint: "Only the variables this rubric allows from {task} {need} {constraint} {candidate}; the required ones must appear.",
			rubricCriteria: "Levels (one per line, lowest first)",
			rubricCriteriaHint: "Score rubrics only, 2-10 levels.",
			rubricMaxState: "Task text limit (chars)",
			rubricMaxStateHint: "20-2000.",
			rubricMaxCandidate: "Candidate text limit (chars)",
			rubricMaxCandidateHint: "100-8000.",
			rubricUnknown: "Settings hold overrides that name no built-in rubric; they are ignored:",
			rubricNotes: "Built-in values show as placeholders; blank keeps the built-in. A change alters the question hash, so old cache entries are not reused.",
			sourcesSection: "Sources",
			sourcesSectionHint: "Bocha, keyed sources, a self-hosted SearXNG and the polite-pool mailbox; anonymous sources are listed below.",
			bochaGroup: "Bocha",
			bochaApiKey: "Bocha API Key",
			bochaApiKeyEnv: "Bocha key reference",
			bochaApiKeyEnvHint: "Credentials / environment variable name, default BOCHA_SEARCH_API_KEY; falls back to BOCHA_JEV_API_KEY.",
			bochaBaseUrl: "Bocha endpoint",
			bochaBaseUrlHint: "Default https://api.bocha.cn (the host of the official reference plugin, verified live; https://api.bochaai.com accepts the same key); /v1/web-search is appended.",
			bochaSummary: "Ask Bocha for the long summary",
			bochaSummaryHint: "On by default; turn off for smaller responses.",
			keyedGroup: "Keyed sources",
			keyedGroupHint: "Naming the key reference enables a source (it is unusable until a key is set); keys go to DSH Credentials and are never shown here. Override the endpoint only for a proxy or private gateway. None has been verified against the live service.",
			keyedEnv: "Key reference",
			keyedEnvHint: "Credentials / environment variable name; blank uses the default: ",
			keyedBaseUrl: "Endpoint",
			keyedBaseUrlHint: "Blank uses the built-in endpoint; an http(s) URL.",
			keyedApiKey: "API Key",
			searxngUrl: "SearXNG URL",
			searxngUrlHint: "A self-hosted instance with the JSON format enabled; the searxng source exists only when set. No public instance is built in.",
			openalexMailto: "OpenAlex contact email",
			openalexMailtoHint: "Put in the User-Agent of OpenAlex requests; etiquette, optional.",
			reqBudgetGroup: "Request budgets (optional)",
			reqBudgetNote: "Cap the requests of a source, counted in the usage ledger (it survives restarts). A used-up source is skipped and the plan falls back to other sources; it is never an error. Nothing is capped by default. Example: a Bocha account with 1000 requests: total 1000, daily 50. Used / remaining: web_call sources.status.",
			reqTotal: "Total cap (requests)",
			reqTotalHint: "Most requests this source may ever make; empty = no cap.",
			reqDaily: "Daily cap (requests)",
			reqDailyHint: "Most requests per calendar day (time zone from the judge usage caps); empty = no cap.",
			strategyGroup: "Source strategy",
			strategyNote: "Order of precedence: engines / platform named in a call first; then the \"priority\" list below; then sources you configured a key for (promoted by language and profile); with nothing configured, the anonymous / free sources (English: Exa over its keyless route first, then DuckDuckGo / Bing). A paid source is used only once you configured its key.",
			sourcePolicy: "Source policy",
			sourcePolicyHint: "default: the order above. anonymous-only: automatic planning never uses a source that needs a key, account or login, even a configured one (a source named in a call still runs).",
			optPolicyDefault: "default",
			optPolicyAnonymousOnly: "anonymous-only (no key, account or login)",
			srcPriority: "Priority sources",
			srcPriorityHint: "Source ids, comma separated, ranked first in this order (only when ready and fitting the task language and profile), e.g. bocha, exa. Empty = no preference.",
			srcDisabled: "Disabled sources",
			srcDisabledHint: "Source ids, comma separated: automatic planning and the engines list never use them (a source named in a call still runs).",
			anonymousTitle: "Anonymous sources (no key)",
			anonymousHint: "A reference table, not a statement of what works right now; live readiness is shown by web_call sources.status.",
			anonymousName: "Source",
			anonymousUse: "Use",
			sourcesStatusLine: "Live readiness of each source (installation, key, last success) is shown by web_call sources.status.",
			emptyDefault: "(default)",
			optionOff: "off",
			srcUseDdg: "general web, a default first choice",
			srcUseBing: "general web, complements DuckDuckGo",
			srcUseWikipedia: "encyclopedic facts, zh / en",
			srcUseHackernews: "English tech discussion and experience",
			srcUseStackexchange: "programming Q&A (Stack Overflow)",
			srcUseOpenalex: "scholarly paper index",
			srcUseSemanticscholar: "papers; the anonymous pool is often busy",
			srcUseAnysearch: "anonymous general search, small quota",
			srcUseArxiv: "preprints",
			srcUsePubmed: "biomedical literature",
			srcUseV2ex: "Chinese community discussion",
			reset: "Restore deployment value",
			invalid: "Invalid value; check its range or format.",
			invalidJson: "Invalid JSON; an object is required.",
			save: "Save",
			saving: "Saving…",
			discard: "Discard",
			saved: "Configuration is synchronized with the Host.",
			pendingSave: "Changes are written to settings.yaml only after Save.",
			invalidSave: "Fix invalid fields before saving.",
			saveFailed: "The Host rejected part of the change. Drafts were kept; check conflicts or logs."
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