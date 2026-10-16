import { createElement } from 'react'

/** 面板图标：自绘的 PR 形状（两点一竖 + 分支弧），颜色走 currentColor，
 *  具体色值由样式表用 `--dsw-alias-*` 令牌给出——插件不持有颜色字面量。 */
export function PrIcon({ size = 16 }: { size?: number }) {
  return createElement('svg', {
    width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
  }, [
    createElement('circle', { key: 'a', cx: 4, cy: 3.5, r: 1.7 }),
    createElement('circle', { key: 'b', cx: 4, cy: 12.5, r: 1.7 }),
    createElement('circle', { key: 'c', cx: 12, cy: 6.5, r: 1.7 }),
    createElement('path', { key: 'd', d: 'M4 5.2v5.6' }),
    createElement('path', { key: 'e', d: 'M12 8.2v1.1a3 3 0 0 1-3 3H4' }),
  ])
}