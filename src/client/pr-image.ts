/**
 * PR 正文里图片目标的**纯决策**（不依赖 React / 宿主控件，便于单测钉住语义）。
 *
 * markdown 作者常写 `![x](./docs/a.png)` 或 `/docs/a.png`（相对仓库根）。为什么不直接
 * 指 raw.githubusercontent.com：**该主机在受限网络里不可达**（实测 curl HTTP 000），
 * 直连只会得到破图；所以这里只产出**本插件图片代理路由的相对路径**，由调用方经
 * `hostRouteUrl()` 解析成同源绝对 URL（cookie 自动带，私有仓也覆盖）。
 *
 * 取图的 `ref` 建议用 **`refs/pull/<n>/head`**：base 仓里就有这个 ref，而 `headRef`
 * 对 fork PR 只存在于 fork，代理会 404。
 */
export interface ImageRepo {
  host: string
  owner: string
  name: string
}

/** 代理路由的相对路径（`plugins/dsh-pr-inbox/image?...`），不是图片本体。 */
export function resolvePrImagePath(value: string, repo: ImageRepo, ref: string, cwd: string | undefined): string | undefined {
  if (repo.host !== 'github.com' || ref === '' || cwd === undefined || cwd === '') return undefined
  const raw = value.trim()
  // 绝对 URL / 协议相对 URL 交给渲染器自己的协议校验，不在这一层改写。
  if (raw === '' || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return undefined
  const path = raw.replace(/^\.\//, '').replace(/^\/+/, '')
  if (path === '' || path.split('/').includes('..') || path.split('/').includes('.')) return undefined
  const query = new URLSearchParams({ cwd, ref, path })
  return `plugins/dsh-pr-inbox/image?${query.toString()}`
}