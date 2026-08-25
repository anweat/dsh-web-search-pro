window.__ModuleLoader__.load({
	id: "dsh-web-search-pro",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/form.ts
		const textField = (field, required = false) => ({
			field,
			format: (value) => typeof value === "string" ? value : "",
			parse(text) {
				const value = text.trim();
				if (value.length === 0) return required ? void 0 : { kind: "clear" };
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
		const booleanField = (field) => ({
			field,
			format: (value) => value === true ? "true" : "false",
			parse: (text) => text === "true" || text === "false" ? {
				kind: "set",
				value: text === "true"
			} : void 0
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
			format: (value) => value && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value, null, 2) : "",
			parse(text) {
				if (text.trim() === "") return required ? void 0 : { kind: "clear" };
				try {
					const value = JSON.parse(text);
					if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
					return {
						kind: "set",
						value
					};
				} catch {
					return;
				}
			}
		});
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
			textField("exaApiKeyEnv", true),
			textField("jinaApiKeyEnv", true),
			textField("githubTokenEnv", true),
			booleanField("enableCliBackends"),
			booleanField("opencliEnabled"),
			booleanField("agentReachEnabled"),
			textField("providerId", true),
			booleanField("registerProvider"),
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
			booleanField("verbose")
		];
		const SPEC_BY_FIELD = new Map(FIELD_SPECS.map((spec) => [spec.field, spec]));
		const REF_FIELDS = {
			exa: "exaApiKeyEnv",
			jina: "jinaApiKeyEnv",
			github: "githubTokenEnv"
		};
		const DEFAULT_REFS = {
			exa: "EXA_API_KEY",
			jina: "JINA_API_KEY",
			github: "GITHUB_TOKEN"
		};
		function stable(value) {
			if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
			if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
			return JSON.stringify(value);
		}
		function same(left, right) {
			return stable(left) === stable(right);
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
		var WebSearchSettingsController = class {
			scope;
			api;
			staged = /* @__PURE__ */ new Map();
			secretDrafts = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			store;
			unsubscribe;
			saving = false;
			failed = false;
			credentialGeneration = 0;
			credentialRefSignature = "";
			credentialStates = {
				exa: {
					configured: false,
					writable: true,
					loading: true
				},
				jina: {
					configured: false,
					writable: true,
					loading: true
				},
				github: {
					configured: false,
					writable: true,
					loading: true
				}
			};
			constructor(scope, api) {
				this.scope = scope;
				this.api = api;
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
			discard() {
				this.staged.clear();
				this.secretDrafts.clear();
				this.failed = false;
				this.publish();
			}
			async save() {
				const plan = this.plan();
				const invalid = plan.settings.some((item) => item.write === void 0);
				if (this.saving || invalid || plan.settings.length === 0 && plan.credentials.length === 0) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				let landed = true;
				try {
					for (const item of plan.settings) {
						if (item.write === void 0) {
							landed = false;
							break;
						}
						if (item.write.kind === "clear") {
							await this.scope.unset(item.field);
							landed = !this.stored(item.field) && landed;
						} else {
							await this.scope.set(item.field, item.write.value);
							landed = same(this.userLayer()?.[item.field], item.write.value) && landed;
						}
					}
					if (landed) for (const id of plan.credentials) {
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
				}
				this.saving = false;
				this.failed = !landed;
				this.publish();
			}
			async refreshCredentials() {
				const generation = ++this.credentialGeneration;
				const refs = this.credentialRefs();
				this.credentialRefSignature = stable(refs);
				for (const id of Object.keys(refs)) this.credentialStates[id].loading = true;
				this.publish();
				try {
					const response = await this.api.credentials.describe({ refs: Object.values(refs) });
					if (generation !== this.credentialGeneration || !response.result.ok) return;
					for (const id of Object.keys(refs)) {
						const view = response.result.value.credentials[refs[id]];
						this.credentialStates[id] = {
							configured: view?.configured ?? false,
							writable: view?.writable ?? true,
							loading: false
						};
					}
				} catch {
					if (generation !== this.credentialGeneration) return;
					for (const id of Object.keys(refs)) this.credentialStates[id].loading = false;
				} finally {
					if (generation === this.credentialGeneration) this.publish();
				}
			}
			dispose() {
				this.unsubscribe();
				this.listeners.clear();
				this.credentialGeneration += 1;
			}
			project() {
				const fields = {};
				for (const spec of FIELD_SPECS) fields[spec.field] = this.field(spec.field);
				const settingsPlan = this.plan().settings;
				return {
					available: this.scope.getSnapshot().status === "ready",
					writable: this.scope.getSnapshot().writable,
					dirty: settingsPlan.length > 0 || [...this.secretDrafts.values()].some((value) => value.trim() !== ""),
					invalid: settingsPlan.some((item) => item.write === void 0),
					saving: this.saving,
					failed: this.failed,
					fields,
					credentials: {
						exa: {
							text: this.secretDrafts.get("exa") ?? "",
							...this.credentialStates.exa
						},
						jina: {
							text: this.secretDrafts.get("jina") ?? "",
							...this.credentialStates.jina
						},
						github: {
							text: this.secretDrafts.get("github") ?? "",
							...this.credentialStates.github
						}
					}
				};
			}
			field(field) {
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
			plan() {
				const settings = [];
				for (const [field, draft] of this.staged) {
					const spec = this.spec(field);
					if (draft.clear) {
						if (this.stored(field)) settings.push({
							field,
							write: { kind: "clear" }
						});
						continue;
					}
					if (draft.text === spec.format(this.sectionValue(field))) continue;
					settings.push({
						field,
						write: spec.parse(draft.text)
					});
				}
				return {
					settings,
					credentials: [...this.secretDrafts].filter(([, value]) => value.trim() !== "").map(([id]) => id)
				};
			}
			async writeCredential(id, value) {
				const ref = this.credentialRefs()[id];
				try {
					await this.api.credentials.set({
						ref,
						value
					});
					const response = await this.api.credentials.describe({ refs: [ref] });
					return response.result.ok && (response.result.value.credentials[ref]?.configured ?? false);
				} catch {
					return false;
				}
			}
			credentialRefs() {
				const value = this.scope.getSnapshot().value ?? {};
				return Object.fromEntries(Object.keys(REF_FIELDS).map((id) => {
					const candidate = value[REF_FIELDS[id]];
					return [id, typeof candidate === "string" && candidate.trim() !== "" ? candidate : DEFAULT_REFS[id]];
				}));
			}
			spec(field) {
				const spec = SPEC_BY_FIELD.get(field);
				if (!spec) throw new Error(`unknown web-search-pro settings field: ${field}`);
				return spec;
			}
			sectionValue(field) {
				return this.scope.getSnapshot().value?.[field];
			}
			baseValue(field) {
				return this.scope.getSnapshot().base?.[field];
			}
			userLayer() {
				return this.scope.getSnapshot().user;
			}
			stored(field) {
				const user = this.userLayer();
				return user !== void 0 && Object.hasOwn(user, field);
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
			primaryButton: "wsp-primary-button"
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: styles.hint,
						children: props.state?.invalid ? props.invalidLabel : props.hint
					})
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
		function ToggleField(props) {
			const checked = props.state.text === "true";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: styles.toggleField,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: styles.toggleLabel,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: styles.checkbox,
						type: "checkbox",
						checked,
						disabled: props.disabled,
						onChange: (event) => {
							props.edit(props.field, String(event.currentTarget.checked));
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: styles.toggleCopy,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: styles.label,
							children: props.label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: styles.hint,
							children: props.hint
						})]
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
		//#region src/client/SettingsCard.tsx
		function SettingsCard(props) {
			const { t } = props;
			const state = props.useWebSearchPro((snapshot) => snapshot);
			const [open, setOpen] = (0, react.useState)(false);
			if (!state.available) return null;
			const disabled = !state.writable || state.saving;
			const text = (field, label, hint, type) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextField, {
				field,
				state: state.fields[field],
				label: t(label),
				hint: t(hint),
				disabled,
				t,
				edit: props.edit,
				reset: props.resetField,
				type
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
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
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: styles.section,
							"aria-labelledby": "web-search-pro-search-heading",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.sectionHeading,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									id: "web-search-pro-search-heading",
									children: t("searchSection")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("searchSectionHint") })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.grid,
								children: [
									text("engines", "engines", "enginesHint"),
									text("searchMaxResults", "searchMaxResults", "searchMaxResultsHint", "number"),
									text("timeoutMs", "timeoutMs", "timeoutMsHint", "number"),
									toggle("parallelEngines", "parallelEngines", "parallelEnginesHint")
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: styles.section,
							"aria-labelledby": "web-search-pro-credentials-heading",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.sectionHeading,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									id: "web-search-pro-credentials-heading",
									children: t("credentialsSection")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("credentialsSectionHint") })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.grid,
								children: [
									text("exaApiKeyEnv", "exaApiKeyEnv", "credentialRefHint"),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CredentialField, {
										id: "exa",
										label: t("exaApiKey"),
										hint: t("credentialWriteOnlyHint"),
										state: state.credentials.exa,
										disabled,
										t,
										edit: props.editCredential
									}),
									text("jinaApiKeyEnv", "jinaApiKeyEnv", "credentialRefHint"),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CredentialField, {
										id: "jina",
										label: t("jinaApiKey"),
										hint: t("credentialWriteOnlyHint"),
										state: state.credentials.jina,
										disabled,
										t,
										edit: props.editCredential
									}),
									text("githubTokenEnv", "githubTokenEnv", "credentialRefHint"),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CredentialField, {
										id: "github",
										label: t("githubToken"),
										hint: t("credentialWriteOnlyHint"),
										state: state.credentials.github,
										disabled,
										t,
										edit: props.editCredential
									})
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: styles.section,
							"aria-labelledby": "web-search-pro-runtime-heading",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.sectionHeading,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									id: "web-search-pro-runtime-heading",
									children: t("runtimeSection")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("runtimeSectionHint") })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: styles.grid,
								children: [
									toggle("enableCliBackends", "enableCliBackends", "enableCliBackendsHint"),
									toggle("opencliEnabled", "opencliEnabled", "opencliEnabledHint"),
									toggle("agentReachEnabled", "agentReachEnabled", "agentReachEnabledHint"),
									toggle("registerProvider", "registerProvider", "registerProviderHint"),
									text("providerId", "providerId", "providerIdHint"),
									json("playwright", "playwright", "playwrightHint", 4)
								]
							})]
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
										toggle("allowProxyFakeIp", "allowProxyFakeIp", "allowProxyFakeIpHint"),
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
			boostHint: "0–1 之间的附加分值。",
			freshnessDays: "时效衰减天数",
			freshnessDaysHint: "新鲜度加权在多少天内衰减到 0。",
			authorityDomains: "额外权威域名",
			authorityDomainsHint: "逗号分隔，不需要协议或路径。",
			dbPath: "SQLite 路径",
			dbPathHint: "留空恢复插件默认路径。",
			allowProxyFakeIp: "允许代理 fake-IP DNS",
			allowProxyFakeIpHint: "仅信任 Clash/TUN 的 198.18/15 与 fdfe:dcba:9876::/96；其他私网和字面 IP 仍拒绝。",
			platformRules: "平台选择器覆盖（JSON）",
			platformRulesHint: "按平台设置 item/title/link/text 选择器。",
			customPlatforms: "自定义平台（JSON）",
			customPlatformsHint: "按平台定义搜索 URL 与选择器；登录态请通过浏览器绑定引用 AuthProfile。",
			browserBindings: "浏览器绑定（JSON）",
			browserBindingsHint: "把平台绑定到 dsh-browser AuthProfile 与 RulePack。",
			verbose: "详细诊断日志",
			verboseHint: "写入加载标记并输出更多运行诊断。",
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
			boostHint: "Additional score between 0 and 1.",
			freshnessDays: "Freshness decay days",
			freshnessDaysHint: "Days until the freshness bonus decays to zero.",
			authorityDomains: "Extra authority domains",
			authorityDomainsHint: "Comma-separated, without schemes or paths.",
			dbPath: "SQLite path",
			dbPathHint: "Clear to restore the plugin default.",
			allowProxyFakeIp: "Allow proxy fake-IP DNS",
			allowProxyFakeIpHint: "Trust only Clash/TUN 198.18/15 and fdfe:dcba:9876::/96; other private and literal IP targets remain blocked.",
			platformRules: "Platform selector overrides (JSON)",
			platformRulesHint: "Set item/title/link/text selectors per platform.",
			customPlatforms: "Custom platforms (JSON)",
			customPlatformsHint: "Define search URLs and selectors; bind an AuthProfile for authenticated access.",
			browserBindings: "Browser bindings (JSON)",
			browserBindingsHint: "Bind platforms to dsh-browser AuthProfiles and RulePacks.",
			verbose: "Verbose diagnostics",
			verboseHint: "Write apply markers and additional runtime diagnostics.",
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
			"connection",
			"settingsScope"
		];
		const NS = "web-search-pro.card";
		function apply(ctx) {
			ensureStyles();
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "web-search-pro: settings dictionaries");
			const { api } = ctx.get("connection");
			const controller = new WebSearchSettingsController(ctx.settingsScope.bind({ namespace: "web-search-pro" }), api);
			ctx.effect(() => () => {
				controller.dispose();
			}, "web-search-pro: settings controller");
			ctx.slots.inject("settings.plugin.item", () => {
				const options = {
					name: "settings.plugin.item",
					key: "web-search-pro",
					id: "web-search-pro",
					locale: NS,
					inject: () => controller.inject()
				};
				return ctx.slots.register(options, SettingsCard);
			});
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