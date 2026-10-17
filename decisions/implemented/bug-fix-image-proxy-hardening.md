---
category: bug-fix
date: 2026-10-17
---

# 图片代理的三处安全收口（SVG / Origin / 路径词法）

## Problem

图片代理是插件里唯一「按调用方给的坐标取字节再同源发」的路由，原实现有三处缺口：

1. **SVG 同源 XSS 面**：`image/svg+xml` 原样发出、只加了 `nosniff`。`<img>` 里安全，
   但右键「在新标签页打开图片」会变成同源顶层文档，脚本可以执行；fork PR 的
   `refs/pull/<n>/head` 里就能放这样一个 SVG。
2. **没有 Origin 围栏**：`/api` 与 `/image` 都只依赖 DSH 的全局 auth；任意网页借用户
   浏览器发请求（CSRF）可以消耗搜索配额，图片路由还能当读取 oracle。
3. **路径词法只挡字面 `.`/`..`**：`%2e%2e`、`%2f`、`%5c`、`?`、`#`、反斜杠会原样拼进
   `gh api .../contents/<path>`。

## Decision

1. SVG 响应加 `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
   ——顶层文档没有脚本与外部请求；`<img>` 子资源不受影响。保留 SVG（`icon.svg` 与
   文档里的 SVG 仍可代理），不牺牲现有能力。
2. 两条路由共用 `isSameOrigin`：带 `Origin` 的请求必须与 `Host` 同源，否则 403；
   没有 `Origin` 的本地脚本/同源 GET 图片放行。
3. `requireRepoPath` 拒绝控制字符、`?`、`#`、`\`，以及百分号编码的 dot/slash/backslash；
   `%20` 这类普通编码不误伤。
4. 图片侧加 `cwd → repo` 的 60s 短缓存（不缓存失败），一篇正文的 N 张图只跑一次 git。

## Alternatives considered

- **完全禁用 SVG**：最彻底，但会打断 `icon.svg` 的实例门与文档里的 SVG；CSP sandbox
  已经覆盖真正的风险（顶层执行脚本）。
- **按会话 workspace 白名单限制 `cwd`**：需要 `sessions` 服务与新的 inject，属于下一层
  权限模型；当前先做 Origin 围栏 + 词法收口。
- **给图片换一个独立 origin**：DSH 只起一个 web server，做不到；CSP 是当前最小代价。

## Consequences

- 反代部署必须让 `Origin` 与 `Host` 一致（正常的 Host 转发即满足）。
- 顶层打开 SVG 只会下载/静态显示，不再执行脚本；`<img>` 内联不受影响。
- 新增 `tests/trust.spec.ts` 与 image/routes 的 SVG、Origin、编码路径单测。
