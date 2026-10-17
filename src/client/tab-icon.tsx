/**
 * 页签图标：官方 primitives 里没有 PR 专用图标，分支图标又会和内置 Git 页签撞车，
 * 所以画一个最小的「两个提交点 + 汇入弧」的 PR 形状。用 `currentColor`，
 * 跟随宿主的页签前色（React 内联 SVG 与 `<img>` 不同，能继承 currentColor）。
 */
import { createElement } from 'react'

export function PrIcon({ size = 16 }: { size?: number }) {
  return createElement('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
    'aria-hidden': true, focusable: false,
  }, [
    createElement('circle', { key: 'a', cx: 4, cy: 3, r: 1.8 }),
    createElement('circle', { key: 'b', cx: 4, cy: 13, r: 1.8 }),
    createElement('circle', { key: 'c', cx: 12, cy: 6, r: 1.8 }),
    createElement('path', { key: 'd', d: 'M4 4.8v6.4' }),
    createElement('path', { key: 'e', d: 'M12 7.8c0 2.2-1.6 3.2-3.4 3.2H8.2' }),
  ])
}
