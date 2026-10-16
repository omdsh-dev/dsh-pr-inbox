---
category: bug-fix
date: 2026-10-16
---

# PR 正文里的图片：用 refs/pull/<n>/head 并过宿主代理

## Problem

PR 正文里贴的图片是仓库内相对路径（`docs/x.png`）。要把它变成可渲染的 URL，得知道
"相对哪个 ref"。第一版用 `headRefName`（PR 的头分支名）——**fork 来的 PR 上必然 404**，
因为那个分支只存在于 fork 仓库里，不在 base 仓库。

## Decision

用 **`refs/pull/<n>/head`**：base 仓库里就有这个 ref，fork PR 与同仓分支一律适用。
取字节走插件自己的 host 路由 `/plugins/dsh-pr-inbox/image`，而不是让浏览器直连
`raw.githubusercontent.com`——后者在本机实测**完全不可达**（curl HTTP 000），
而且直连也覆盖不到私有仓库。

## Alternatives considered

- **`headRefName`**：fork PR 404。已证伪。
- **`headRepository` + `headRefName`**（拼 fork 的 raw URL）：同仓分支反而要绕，
  且必须拿到 fork 的 owner/name，多一次字段依赖。否掉。
- **`/contents/<path>?ref=<sha>` API 拿 base64**：可行但要走 API 配额、响应体积大
  （base64 膨胀 33%）。图片代理走 raw 更省。

## Consequences

- 相对路径 → 代理 URL 的转换抽成纯函数 `resolvePrImagePath`（路径逃逸、绝对 URL、
  非 github host 一律拒），带单测——这类"看着对但 fork 上必 404"的坑只有纯函数+测试
  才钉得住。
- 代理要做路径/ref 的词法围栏、扩展名与魔数确认、体积两段闸、`nosniff`。
