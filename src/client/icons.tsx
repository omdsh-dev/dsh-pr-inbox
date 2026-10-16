import { createElement } from 'react'

/** 自绘的 16px 图标集：颜色一律 `currentColor`，具体色值由样式表用
 *  `--dsw-alias-*` 令牌给出——插件不持有颜色字面量（皮肤契约）。 */
function svg(size: number, children: ReturnType<typeof createElement>[]) {
  return createElement('svg', {
    width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
  }, children)
}

/** PR 形状（两点一竖 + 分支弧）。 */
export function PrIcon({ size = 16 }: { size?: number }) {
  return svg(size, [
    createElement('circle', { key: 'a', cx: 4, cy: 3.5, r: 1.7 }),
    createElement('circle', { key: 'b', cx: 4, cy: 12.5, r: 1.7 }),
    createElement('circle', { key: 'c', cx: 12, cy: 6.5, r: 1.7 }),
    createElement('path', { key: 'd', d: 'M4 5.2v5.6' }),
    createElement('path', { key: 'e', d: 'M12 8.2v1.1a3 3 0 0 1-3 3H4' }),
  ])
}

/** 刷新（转一圈的箭头 + 缺口）。 */
export function RefreshIcon({ size = 16 }: { size?: number }) {
  return svg(size, [
    createElement('path', { key: 'a', d: 'M13 8a5 5 0 1 1-1.6-3.7' }),
    createElement('path', { key: 'b', d: 'M13 2.6V5h-2.4' }),
  ])
}

/** 分区折叠箭头（展开时朝下）。 */
export function ChevronIcon({ size = 14 }: { size?: number }) {
  return svg(size, [createElement('path', { key: 'a', d: 'M4 6.2 8 10.2l4-4' })])
}

/** 在浏览器打开（外链）。 */
export function ExternalIcon({ size = 14 }: { size?: number }) {
  return svg(size, [
    createElement('path', { key: 'a', d: 'M6.5 3.5H3.5v9h9v-3' }),
    createElement('path', { key: 'b', d: 'M9.5 3.5h3v3' }),
    createElement('path', { key: 'c', d: 'M12.5 3.5 7.5 8.5' }),
  ])
}