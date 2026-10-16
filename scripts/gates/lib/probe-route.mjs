/**
 * 路由探针（负控用）：确认插件的自有路由**挂没挂上**。
 *
 * 用法： node scripts/gates/lib/probe-route.mjs <launch-url> [op]
 * 输出： HTTP 状态码一行（未挂载 = 404；挂上但入参不合格 = 400）。
 * 不依赖 Playwright：token → cookie 用 fetch 完成。
 */
const [launchUrl, op = 'status'] = process.argv.slice(2)
if (launchUrl === undefined) {
  console.error('用法：node scripts/gates/lib/probe-route.mjs <launch-url> [op]')
  process.exit(2)
}
const origin = new URL(launchUrl).origin
const handshake = await fetch(launchUrl, { redirect: 'manual' })
const cookie = (handshake.headers.getSetCookie?.() ?? []).map(entry => entry.split(';')[0]).join('; ')
if (cookie === '') {
  console.error('拿不到会话 cookie（实例没起来？）')
  process.exit(2)
}
const response = await fetch(`${origin}/plugins/dsh-pr-inbox/api`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ op }),
})
console.log(response.status)