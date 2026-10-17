---
category: bug-fix
date: 2026-10-17
---

# 英文界面漏中文：相对时间与错误提示

## Problem

英文宿主下，面板 chrome 里出现「5 小时前」「刚刚」「merged 11 分钟前」，gh 失败时
还会出现 host 侧的中文错误（「未找到 gh CLI」「gh 未登录」）。原因有三处：

1. `formatAge` 把中文时间单位写死在展示层；
2. `GH_HINT` 是客户端里的中文常量；
3. host 的 `PrInboxError` / `warnings` / `note` 直接带中文 message，客户端原样渲染。

仓库自己的英文截图（`docs/preview/compact.png`、`detailed.png`）就是证据，而 README
写着「界面文案随 DSH 语言」。

## Decision

1. `format.ts` 只产出**语义**（`ageParts` → `{ key, value }`），文案走字典
   （`ageText(tf, …)` → `minutesAgo: {n} 分钟前 / {n} min ago`）。
2. host 错误保留 `code` + `message`：`code` 由客户端按字典翻译（`errors.ts`），
   `message` 只作为 `title`（排障用）与未知码的回退。
3. `warnings` 从 `string[]` 改成 `{ part, code?, message }[]`；分区名由客户端翻译，
   已知错误码同样翻译。
4. 未知 host 的提示不再读 host 的 `note`，由客户端按 `repo.host` 渲染。
5. 给挂载门加一条**英文 chrome 断言**：英文宿主下顶栏/分区头/状态行不得出现中文时间
   或中文提示（PR 标题可以是中文，不扫整块面板）。

## Alternatives considered

- **在 host 侧按 UI 语言翻译**：host 不知道浏览器/宿主语言，且会把展示逻辑复制到两端。
  否掉。
- **用 `Intl.RelativeTimeFormat`**：能用，但输出与 DSH 自己的文案风格不一致，且不跟
  宿主的 locale 服务；字典才是这个插件既有的单一来源。否掉。
- **把 host message 全部删掉**：会丢掉 gh 的原始 stderr，排障变难；保留为 title 更稳。

## Consequences

- 新增错误码时必须同时补 zh/en 两条字典，否则回退到原始 message（通常是英文）。
- `tests/format.spec.ts` 不再断言中文，改为断言翻译器收到的 key/参数；
  新增 `tests/errors.spec.ts` 与挂载门 chrome 断言。
- host 的中文 message 仍存在，但不再是用户界面的唯一来源。
