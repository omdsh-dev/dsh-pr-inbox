---
category: bug-fix
date: 2026-10-16
---

# 正文里的图片：GitHub 用 HTML 插图，官方渲染器只认 markdown

## Problem

用户报告"PR 内容里的图片渲染不出来"。取 #969 的正文一看，两张图都是
`<img width="1152" height="1162" alt="image" src="https://github.com/user-attachments/assets/…">`
——**GitHub 自己的编辑器拖拽上传后写进去的就是 HTML 标签**，这是 PR 正文里最常见的图片形态。

而官方 `MarkdownText` 是"不可信 assistant markdown"渲染器：原始 HTML 一律不渲染。
实测这条不是"整块丢掉"而是"**以字面文本出现**"（行内 `html` 节点走
`case "html": return node.value`），所以正文里显示的是一串 `<img width="1152" …>` 文字。
同一个数字可以对上：修复前 `[data-pi-body]` 的 `innerText` 2517 字符，修复后 2253 字符，
差值 264 ≈ 两个标签串的长度。

## Decision

在交给 `MarkdownText` **之前**把正文与评论里的 `<img>` 改写成 markdown 图片语法
（`src/client/markdown-images.ts`，纯函数 + 7 条单测）：

- 只动**代码段之外**的标签：围栏（``` / ~~~）与行内反引号串里的 `<img>` 原样保留——
  文档里讲"怎么写 img 标签"不能被改写；这是最容易改错的一类输入，所以专门有测试。
- 属性取 `src` / `alt`（双引号、单引号、裸值都认，且 `data-src` 不算 `src`）；
  丢弃 `width`/`height`——markdown 没有尺寸语法，官方 `.image` 本身就是 `max-width: 100%`，
  窄侧栏里按容器缩放才是想要的。
- HTML 实体解码（正文里的 URL 常见 `&amp;`）；地址含空白/圆括号时用 `<…>` 包裹。
- 目标地址原样交给官方渲染器：绝对 URL 直接渲染；仓库内相对路径继续走 `pathImages`
  → 插件自己的图片代理（fork PR 用 `refs/pull/<n>/head`）。

顺带修掉一处同源问题：官方对图片地址的白名单只认**绝对** `http(s)/blob/data`
（`vocabularyImageUrl` 里 `new URL(url)` 必须成功），而 `pathImages.resolve` 之前在宿主
服务在场时返回的是 `URL` **实例**（better-sidebar 的 `hostRouteUrl` 返回 `URL`，我按
`string` 声明了它）。现在 `absoluteHostUrl()` 统一规范化成绝对字符串：页面基址是 http(s)
就用它；桌面壳的 `dsh-app://app/` 不在白名单里，改用注入的 `__DSH_TRANSPORT__.streamBaseUrl`
（宿主真实 origin，`<img>` 跨源不需要 CORS）。

## Alternatives considered

- **继续依赖官方渲染原始 HTML**：那是它的安全设计（不可信 assistant 内容），不会为我改。否掉。
- **自己写一套 markdown → HTML 渲染器**：与"库里有控件就不要抄第二份"直接冲突。否掉。
- **把 HTML 标签整段剥掉，只留 alt 文本**：等于承认图片丢失。否掉。
- **在 host 侧改正文（把 HTML 换成 markdown 再返回）**：① 会把"插件改造过的正文"混进
  数据层，截断计数与 `warnings` 的语义都会变得含糊；② 正文是 UI 关注点。放在客户端更清楚。

## Consequences

- 挂载门里加了一条端到端断言：详情正文必须有 `<img>`、地址协议在官方白名单内、
  且**没有悬挂**（要么解码成功要么明确失败），并单独断言"标签字面残留"为 false。
  实测 #969：2 个 `<img>`、全部解码、字面残留 false。
- 已知边界：`<picture>` / `<source>` / `srcset` 不做展开（只取 `<img src>`），
  `<a href><img></a>` 会丢掉外层链接只留图。
- 环境事实（已写入 docs/engineering-notes.md §3）：官方渲染器**丢弃块级原始 HTML、
  把行内原始 HTML 当字面文本**；图片地址白名单只认绝对 `http(s)/blob/data`。
