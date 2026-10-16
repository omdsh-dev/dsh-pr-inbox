/**
 * 只留**库内没有的布局粘合**样式：控件（Input / Button / Pill / Tag）、图标、
 * markdown 正文、文件路径都直接用 `@deepseek-ai/dsh-client-ui-primitives` 的官方
 * 件——官方铁律是「能复用就复用，不要抄第二份」，所以这里没有第二套按钮/输入框/
 * 胶囊/markdown 排版。
 *
 * 自绘的只有官方没有的语义：分组列表的分区头、PR 行、文件行、状态行的排版。
 * 几何与颜色照官方规范取：分隔线 **0.5px** 中性线、圆角按角色取 token
 * （紧凑行 H20–28 → `--dsw-radius-sm`；微元素 → `--dsw-radius-xs`），
 * 颜色只消费 `--dsw-alias-*`，不定义第二套主题、不写死色值。
 */
const STYLE_ID = 'dsh-pr-inbox-styles'

const CSS = `
.pi-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
}

/* ── 头带：官方 Input + Pill + Button ───────────────────────────────────── */
.pi-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}
.pi-search { flex: 1; min-width: 0; display: flex; }
.pi-search > * { flex: 1; min-width: 0; }
.pi-density { display: inline-flex; align-items: center; gap: 4px; flex: none; }

/* ── 列表 ───────────────────────────────────────────────────────────────── */
.pi-body { flex: 1; min-height: 0; overflow: auto; padding: 0 0 8px; }
.pi-section + .pi-section { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.pi-sectionHeader {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-strong-12);
  cursor: pointer;
}
.pi-sectionLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-sectionCount {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxxs-11);
  font-variant-numeric: tabular-nums;
}
/* 「待我审」有货时计数取警告色：这是面板里唯一「需要你动作」的信号。 */
.pi-sectionCount[data-attention='true'] { color: var(--dsw-alias-state-warn-primary); }
.pi-hint { flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.pi-chevron { flex: none; display: inline-flex; color: var(--dsw-alias-label-tertiary); transition: transform 120ms var(--ds-ease-in-out); }
.pi-section[data-open='false'] .pi-chevron { transform: rotate(-90deg); }
.pi-section[data-open='false'] .pi-rows { display: none; }

.pi-row {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  margin: 2px 6px;
  border-radius: var(--dsw-radius-sm);
  cursor: pointer;
}
.pi-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pi-row[data-selected='true'] { background: var(--dsw-alias-interactive-bg-active); }
.pi-row[data-density='compact'] {
  height: 28px;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
}
.pi-line1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pi-line2 { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.pi-num {
  flex: none;
  padding: 1px 4px;
  border-radius: var(--dsw-radius-xs);
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
  color: var(--dsw-alias-label-primary);
  /* 正文档跟随用户字号设置（官方：正文/描述读 --dsh-content-font-size，别写死 px）。 */
  font-size: var(--dsh-content-font-size);
  line-height: 1.35;
  font-weight: 500;
}
.pi-meta {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--dsh-content-font-size-secondary);
  line-height: 1.3;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
/* 作者名 + 16px 圆头像的横排（头像只在 host 给出 URL 时渲染）。 */
.pi-authorName { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
/* 24h 内动过的行给第二层色阶（不是强调色：强调色只留给「当前项」）。 */
.pi-meta[data-fresh='true'] { color: var(--dsw-alias-label-secondary); }
.pi-grow { flex: 1; min-width: 0; }

.pi-empty { padding: 10px 12px; color: var(--dsw-alias-label-tertiary); font-size: var(--dsh-content-font-size-secondary); line-height: 1.4; }
.pi-notice { padding: 8px 12px; color: var(--dsw-alias-label-tertiary); font-size: var(--dsh-content-font-size-secondary); line-height: 1.45; white-space: pre-wrap; }
.pi-notice[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.pi-notice[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }

/* ── 状态行（绑定信息）──────────────────────────────────────────────────── */
.pi-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 12px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxxs-11);
}
.pi-footRepo { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-footMeta { margin-left: auto; flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }

/* ── 详情（正文与评论排版交给官方 MarkdownText，这里只管骨架）──────────── */
.pi-detail { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.pi-detailTitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--dsh-content-font-size);
  font-weight: 500;
}
/* 作者名：官方链接外观（link 色 + 500；静止无下划线，hover/focus 点线下划线）。 */
.pi-author {
  color: var(--dsw-alias-link);
  font-weight: 500;
  text-decoration: none;
}
.pi-author:hover, .pi-author:focus-visible { text-decoration: underline dotted; text-underline-offset: 3px; }
/* 头像：圆必须显式退出超椭圆（否则被 superellipse 压成方角）。 */
.pi-avatar {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  corner-shape: round;
  object-fit: cover;
  background: var(--dsw-alias-interactive-bg-hover);
}
/* 首字母回退：同一几何，圆底 + 次级色小字（CDN 不可达时不出现破图）。 */
.pi-avatarInitials {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-secondary);
  font-size: var(--dsw-font-xxxs-strong-11, 11px);
  font-weight: 500;
  line-height: 1;
  overflow: hidden;
}
.pi-detailBody { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.pi-detailMeta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pi-detailStats {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--dsh-content-font-size-secondary);
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
  flex-wrap: wrap;
}
.pi-branch { display: inline-flex; align-items: center; gap: 4px; font-family: var(--ds-font-family-code, ui-monospace, monospace); }
.pi-add { color: var(--dsw-alias-state-success-primary); }
.pi-del { color: var(--dsw-alias-state-error-primary); }
.pi-sectionTitle {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-strong-12);
}
.pi-comment { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 0.5px solid var(--dsw-alias-border-l1); }
.pi-commentHead { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pi-file {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 4px;
  border-radius: var(--dsw-radius-sm);
}
.pi-file:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pi-fileOld { flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); text-decoration: line-through; }
.pi-filePath { flex: 1; min-width: 0; }
.pi-fileCounts { flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); font-variant-numeric: tabular-nums; }
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