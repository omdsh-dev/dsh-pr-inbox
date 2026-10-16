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
/* 分区分界 = 「上一区块的行线 + 28px 头带 + 头带底线」两道线夹一条带；
   行与行之间只有一道线。同一档线（l2）靠**线的数量与带的间隔**区分层级，
   而不是靠线本身的深浅——官方 border-l1..l4 的浅端（l1 = 4% 黑）在浅色主题下
   几乎看不见，做行边界不合格（这也是上一轮详情分块踩过的同一个坑）。 */
.pi-section + .pi-section { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.pi-sectionHeader {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-strong-12);
  cursor: pointer;
  /* 分区头在长列表里跟随滚动：条带自身填底（官方 bg-base），否则行会从字下面穿过。
     z-index 必须给：PR 行是定位元素（选中竖条的定位上下文），不压上去就会被盖住。 */
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--dsw-alias-bg-base);
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
.pi-hint { flex: none; margin-left: auto; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.pi-chevron { flex: none; display: inline-flex; color: var(--dsw-alias-label-tertiary); transition: transform 120ms var(--ds-ease-in-out); }
.pi-section[data-open='false'] .pi-chevron { transform: rotate(-90deg); }
.pi-section[data-open='false'] .pi-rows { display: none; }

/* 一行 = 「行首头像列 + 内容列」的通栏条带。条带满宽铺开（与分区头同一套几何）：
   实测浅色主题下宿主各层填充全是 #fff，静止行没有填充差可依，**行与行的边界只能靠
   0.5px 中性发丝线**——这也正是官方「中性边框/分隔线一律 0.5px」的用法。 */
.pi-row {
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 10px 5px 12px;
  cursor: pointer;
  animation: pi-row-in 150ms var(--ds-ease-in-out);
}
.pi-row + .pi-row { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.pi-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pi-row[data-selected='true'] { background: var(--dsw-alias-interactive-bg-active); }
/* 当前项再加官方那根 2px 内嵌强调条（伪元素，行高不因此变化）。 */
.pi-row[data-selected='true']::before {
  content: '';
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-state-business-primary);
}
.pi-row:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent); outline-offset: -1px; }

/* 头像列：**两种密度同宽同 x、与首行中线对齐**——「头像固定在行首」的几何保证。
   高度 20px = 首行高度，所以详细档两行时头像仍钉在标题那一行的中线上。 */
.pi-avatarCell {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 20px;
}
.pi-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
/* 简洁档 = 只有首行（28px 通栏，官方控件高度）；详细档 = 首行 + 事实行。 */
.pi-row[data-density='compact'] { align-items: center; height: 28px; padding-top: 0; padding-bottom: 0; }
.pi-line1 { display: flex; align-items: center; gap: 8px; min-width: 0; height: 20px; }
.pi-line2 { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.pi-age { flex: none; display: inline-flex; align-items: center; }
/* 「在 GitHub 打开」静止时不占视线（官方/sidebar 惯例：hover 或键盘聚焦才现形）。
   opacity + pointer-events：静止时那 24px 点击**穿透到行**（开详情），不会误开外链。
   触屏没有 hover，那里常显。 */
.pi-row .pi-external { opacity: 0; pointer-events: none; transition: opacity 120ms var(--ds-ease-in-out); }
.pi-row:hover .pi-external, .pi-row:focus-within .pi-external { opacity: 1; pointer-events: auto; }
@media (hover: none) {
  .pi-row .pi-external { opacity: 1; pointer-events: auto; }
}
@keyframes pi-row-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .pi-row { animation: none; }
}
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
.pi-detailBody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 区分「正文 / 评论 / 文件清单」三块：**0.5px 发丝边界 + 圆角**。
   为什么不靠填充差：实测 DSH 浅色主题下 bg-base / layer-1 / layer-2 / layer-3
   **全是 #fff**（grep 主题表与页面实测一致），填充差在浅色下恒为零——只靠它分块
   就是隐形分块（这一版第一稿正是如此，被挂载门的几何断言当场抓出来）。官方规则里
   「中性边框与分隔线一律 0.5px」才是流内分组的边界手段；填充留给暗色下的额外分层。 */
.pi-card {
  background: var(--dsw-alias-bg-layer-2);
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  padding: 10px 12px;
}
.pi-card[data-flush='true'] { padding: 4px; }
.pi-stack { display: flex; flex-direction: column; gap: 8px; }
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
  height: 30px;
  margin-top: 2px;
  padding: 0 2px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-strong-13);
}
.pi-comment { display: flex; flex-direction: column; gap: 6px; }
.pi-commentHead { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pi-file {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
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