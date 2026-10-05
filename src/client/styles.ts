export const styles = {
  card: 'wsp-card', cardOpen: 'wsp-card-open', header: 'wsp-header', headText: 'wsp-head-text',
  titleRow: 'wsp-title-row', name: 'wsp-name', description: 'wsp-description', dirtyBadge: 'wsp-dirty-badge',
  chevron: 'wsp-chevron', chevronOpen: 'wsp-chevron-open', body: 'wsp-body', notice: 'wsp-notice',
  section: 'wsp-section', sectionHeading: 'wsp-section-heading', grid: 'wsp-grid', field: 'wsp-field',
  fieldInvalid: 'wsp-field-invalid', fieldHeading: 'wsp-field-heading', label: 'wsp-label', hint: 'wsp-hint',
  input: 'wsp-input', textarea: 'wsp-textarea', code: 'wsp-code', reset: 'wsp-reset', toggleField: 'wsp-toggle-field',
  toggleLabel: 'wsp-toggle-label', toggleCopy: 'wsp-toggle-copy', checkbox: 'wsp-checkbox', secretRow: 'wsp-secret-row',
  credentialStatus: 'wsp-credential-status', advanced: 'wsp-advanced', advancedHint: 'wsp-advanced-hint', footer: 'wsp-footer',
  status: 'wsp-status', failed: 'wsp-failed', actions: 'wsp-actions', secondaryButton: 'wsp-secondary-button',
  primaryButton: 'wsp-primary-button', select: 'wsp-select', problem: 'wsp-problem', warning: 'wsp-warning',
  sectionSummary: 'wsp-section-summary', sectionBody: 'wsp-section-body', subheading: 'wsp-subheading', codeBlock: 'wsp-code-block',
  note: 'wsp-note', table: 'wsp-table', rubric: 'wsp-rubric', rubricHead: 'wsp-rubric-head', badge: 'wsp-badge', fullRow: 'wsp-full-row',
  keyedSource: 'wsp-keyed-source', linkButton: 'wsp-link-button',
} as const

const STYLE_ID = 'web-search-pro-settings-styles'

export function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
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
`
  document.head.append(style)
}
