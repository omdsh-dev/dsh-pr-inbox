/**
 * 面板样式：一条注入式 `<style>`（幂等），类名稳定（不是 CSS Modules 的哈希），
 * 颜色**只**消费 DSH 的 `--dsw-alias-*` 设计令牌 —— 因此自动跟随深浅主题与皮肤中心，
 * 插件没有任何硬编码颜色。
 */
const STYLE_ID = 'dsh-pr-inbox-styles'

const CSS = `
.dsh-pr-inbox {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsw-font-xxs-12, 12px);
}
.dsh-pr-inbox__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: none;
}
.dsh-pr-inbox__grow { flex: 1; min-width: 0; }
.dsh-pr-inbox__repo {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-pr-inbox__meta {
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-pr-inbox__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-pr-inbox__card {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  padding: 8px;
  background: var(--dsw-alias-bg-layer-2);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-pr-inbox__card-title {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dsh-pr-inbox__kv { display: flex; gap: 6px; align-items: baseline; }
.dsh-pr-inbox__kv > b { font-weight: 500; color: var(--dsw-alias-label-secondary); min-width: 68px; }
.dsh-pr-inbox__mono { font-family: var(--ds-font-family-code, ui-monospace, monospace); }
.dsh-pr-inbox__muted { color: var(--dsw-alias-label-tertiary); }
.dsh-pr-inbox__alert {
  border: 1px solid var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-state-warn-primary);
  border-radius: 6px;
  padding: 7px 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent);
}
.dsh-pr-inbox__alert[data-tone='error'] {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}
.dsh-pr-inbox__button {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border-radius: 5px;
  padding: 2px 6px;
  cursor: pointer;
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dsh-pr-inbox__button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-pr-inbox__button:disabled { opacity: .5; cursor: default; }
.dsh-pr-inbox__pill {
  border-radius: 999px;
  padding: 0 6px;
  font-size: var(--dsw-font-xxxs-11, 11px);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.dsh-pr-inbox__empty {
  color: var(--dsw-alias-label-tertiary);
  padding: 12px 4px;
  text-align: center;
}
`

/** 注入一次；已存在就直接返回（HMR 重复 apply 不会叠第二份）。 */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}