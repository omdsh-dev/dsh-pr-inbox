/**
 * 面板样式：一条注入式 `<style>`（幂等），类名稳定（不是 CSS Modules 哈希）。
 *
 * **规格照 better-sidebar 的原生尺度**（其 UIUX 冻结契约 §1，与本插件同属一个
 * 右侧栏，必须看起来像同一套东西）：正文 12px / 元信息 11px / 行与控件 28px /
 * 圆角阶梯 2px 徽标 · 3px 控件 · 4px 行 · 8px 卡片；分隔线 `border-l1`、结构边
 * `border-l2`、悬停 `interactive-bg-hover`、选中 `interactive-bg-active` + 2px
 * 内嵌强调条（`::before`，上下内缩 4px）；唯一强调色 `state-business-primary`。
 *
 * 颜色**只**消费 `--dsw-alias-*` / `--dsw-font-*` / `--ds-*` 令牌 —— 没有硬编码
 * 颜色字面量，因此自动跟随深浅主题与皮肤中心。
 */
const STYLE_ID = 'dsh-pr-inbox-styles'

const CSS = `
.pi-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
}

/* ── 头带 36px：搜索 · 密度切换 · 刷新 ─────────────────────────────────── */
.pi-head {
  box-sizing: border-box;
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.pi-search {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 3px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
}
.pi-search::placeholder { color: var(--dsw-alias-label-tertiary); }
.pi-search:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }

/* 密度切换：22px 胶囊 chip（与 kit 的 chip / chipActive 同规格） */
.pi-switch { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.pi-chip {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  white-space: nowrap;
  cursor: pointer;
}
.pi-chip:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pi-chip[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-hover-accent);
  border-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary);
}

/* 28px 方形图标按钮（工具栏统一用它） */
.pi-iconButton {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.pi-iconButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.pi-iconButton:disabled { opacity: .45; cursor: default; }
.pi-iconButton[data-spinning='true'] svg { animation: pi-spin 900ms linear infinite; }
@keyframes pi-spin { to { transform: rotate(360deg); } }

/* ── 列表体 ───────────────────────────────────────────────────────────── */
.pi-body { flex: 1; min-height: 0; overflow: auto; padding: 0 0 8px; }
.pi-section + .pi-section { border-top: 1px solid var(--dsw-alias-border-l1); }
.pi-sectionHeader {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: none;
  font: var(--dsw-font-xxs-strong-12);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.pi-sectionLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-sectionCount {
  flex: none;
  font: var(--dsw-font-xxxs-11);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}
.pi-chevron { flex: none; color: var(--dsw-alias-label-tertiary); transition: transform 120ms var(--ds-ease-in-out); }
.pi-section[data-open='false'] .pi-chevron { transform: rotate(-90deg); }
.pi-section[data-open='false'] .pi-rows { display: none; }

.pi-row {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 10px;
  margin: 0 6px;
  border-radius: 4px;
  cursor: pointer;
}
.pi-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pi-row[data-selected='true'] { background: var(--dsw-alias-interactive-bg-active); }
.pi-row[data-selected='true']::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-state-business-primary);
}
/* 简洁密度：单行 28px（扫描式列表） */
.pi-row[data-density='compact'] {
  box-sizing: border-box;
  height: 28px;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
}

.pi-line1 { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.pi-line2 { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.pi-num {
  flex: none;
  padding: 1px 4px;
  border-radius: 2px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
}
.pi-subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxs-strong-12);
  color: var(--dsw-alias-label-primary);
}
.pi-meta {
  margin-left: auto;
  flex: none;
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.pi-pill {
  flex: none;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  font: var(--dsw-font-xxxs-strong-11);
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pi-pill[data-tone='draft'] { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.pi-pill[data-tone='merged'] { color: var(--dsw-alias-state-business-primary); border-color: var(--dsw-alias-state-business-primary); }
.pi-pill[data-tone='review'] { color: var(--dsw-alias-state-business-primary); }
.pi-pill[data-tone='author'] { border-color: transparent; color: var(--dsw-alias-label-tertiary); padding: 0; }
.pi-pill[data-tone='quiet'] { border-color: transparent; color: var(--dsw-alias-label-tertiary); padding: 0; }

.pi-empty {
  padding: 10px 12px;
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-tertiary);
}
.pi-notice {
  box-sizing: border-box;
  padding: 8px 12px;
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
  white-space: pre-wrap;
}
.pi-notice[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.pi-notice[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }

/* ── 脚注：绑定信息（像状态栏，而不是占一行工具栏）───────────────────── */
.pi-foot {
  box-sizing: border-box;
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 12px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-tertiary);
}
.pi-footRepo { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-footMeta { margin-left: auto; flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
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