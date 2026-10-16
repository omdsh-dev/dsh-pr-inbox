/**
 * 浏览器驱动模块的解析：**不写本机绝对路径**（发布卫生门禁会拒绝）。
 *
 * 解析顺序（任一成功即用）：
 *   1. `PLAYWRIGHT_MODULE` —— 显式指定 `@playwright/test` 或 `playwright` 的
 *      模块路径/包名（本机开发常用：别人的 worktree 里有一份）；
 *   2. 从本仓库的 node_modules 解析 `@playwright/test`；
 *   3. 同上试 `playwright`。
 *
 * 三个都不成则抛一句可照做的错——浏览器门是**可选的重门**，缺它不该让静态门也跑不起来。
 * 浏览器二进制另由 `PLAYWRIGHT_BROWSERS_PATH` 指出（默认国内工作区那份缓存）。
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function loadPlaywright() {
  const attempts = []
  const explicit = process.env.PLAYWRIGHT_MODULE
  if (explicit !== undefined && explicit !== '') attempts.push(explicit)
  attempts.push('@playwright/test', 'playwright')
  for (const spec of attempts) {
    try {
      const mod = require(spec)
      if (typeof mod?.chromium?.launch === 'function') return { mod, spec }
    } catch {
      // 试下一个
    }
  }
  throw new Error(
    '找不到 Playwright 驱动：装一份 @playwright/test，或设 PLAYWRIGHT_MODULE=<模块路径>'
    + `（已试：${attempts.join(' / ')}）；浏览器二进制用 PLAYWRIGHT_BROWSERS_PATH 指出`,
  )
}