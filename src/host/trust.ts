/**
 * 跨站请求围栏：本插件的路由读写的是「本机 gh 的登录态」，不能让任意网页
 * 借用户的浏览器打它（CSRF 不是写操作才有意义：列表/详情会消耗搜索配额，
 * 图片代理还能当读取 oracle）。
 *
 * 规则：**带 `Origin` 的请求必须是同源**；没有 `Origin` 的请求（curl、本地脚本、
 * 同源 GET 图片）放行。同源判定比较 `Origin.host` 与 `Host`，两者都由浏览器
 * 按当前页面/请求生成；反代场景下两者一致（Host 已被转发改写）。
 */
import type { IncomingMessage } from 'node:http'

export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
