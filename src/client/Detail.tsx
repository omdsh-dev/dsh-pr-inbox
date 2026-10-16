/**
 * PR 详情视图：**插件自己渲染**（不嵌网页、不跳浏览器）。
 *
 * 正文与评论直接用**宿主的 markdown 渲染器** `MarkdownText`
 * （`@deepseek-ai/dsh-client-ui-primitives`）——它自带 GFM + TeX、围栏代码走官方
 * `CodeBlock`、丢弃原始 HTML、限制协议；`labels` 是必填契约（复制/脚注/代码卡工具栏
 * 文案），走本插件字典，漏传会回退硬编码中文。
 *
 * 其余官方件：`Tag`（身份/状态/标签/文件状态）、`Button`（返回/刷新/外链）、
 * `PathLabel`（文件路径：目录弱化、文件名主色、窄列保后缀）、官方图标。
 *
 * 有界与降级如实呈现：三处截断各一行提示，`warnings` 逐条列出——详情不因支线失败空白。
 */
import { createElement, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import {
  Button,
  IconBranchOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconLinkOutlineRegular,
  IconRefreshOutlineRegular,
  MarkdownText,
  PathLabel,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels, MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PrDetailComment, PrDetailFile, PrDetailValue } from '../shared/types'
import { hostRouteUrl } from './api'
import { Author } from './bits'
import { avatarUrlOf, formatAge, formatDate } from './format'
import { resolvePrImagePath } from './pr-image'
import type { I18n } from './i18n'

/** 文件状态 → 官方 Tag 色调 + 文案键。 */
const FILE_TONE: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  added: 'success',
  removed: 'danger',
  modified: 'warning',
  renamed: 'info',
  copied: 'info',
}
const FILE_KEY: Record<string, string> = {
  added: 'added',
  removed: 'removed',
  modified: 'modified',
  renamed: 'renamed',
  copied: 'copied',
  changed: 'changed',
  unchanged: 'unchanged',
}
const REVIEW_TONE: Record<string, 'success' | 'danger' | 'neutral' | 'quiet'> = {
  APPROVED: 'success',
  CHANGES_REQUESTED: 'danger',
  COMMENTED: 'neutral',
  DISMISSED: 'quiet',
  PENDING: 'quiet',
}
const REVIEW_KEY: Record<string, string> = {
  APPROVED: 'reviewApproved',
  CHANGES_REQUESTED: 'reviewChangesRequested',
  COMMENTED: 'reviewCommented',
  DISMISSED: 'reviewDismissed',
  PENDING: 'reviewPending',
}

function Comment({ entry, labels, pathImages, i18n }: { entry: PrDetailComment, labels: MarkdownLabels, pathImages: MarkdownPathImages, i18n: I18n }) {
  const { t } = i18n
  const avatar = avatarUrlOf(entry)
  const head: ReactNode[] = [createElement(Author, { key: 'a', login: entry.author, ...(avatar === undefined ? {} : { avatar }) })]
  if (entry.kind === 'review') {
    const state = entry.reviewState ?? 'COMMENTED'
    head.push(createElement(Tag, { key: 's', tone: REVIEW_TONE[state] ?? 'neutral' }, t(REVIEW_KEY[state] ?? 'reviewCommented')))
  }
  head.push(createElement(Tag, { key: 't', tone: 'quiet' }, formatAge(entry.createdAt)))
  return createElement('div', { className: 'pi-comment', 'data-pi-comment': entry.kind }, [
    createElement('div', { key: 'h', className: 'pi-commentHead' }, head),
    createElement(MarkdownText, {
      key: 'b',
      text: entry.body === '' ? t('emptyBody') : entry.body,
      labels,
      pathImages,
      variant: 'compact',
    }),
  ])
}

function FileRow({ file, i18n }: { file: PrDetailFile, i18n: I18n }) {
  const { t } = i18n
  return createElement('div', { className: 'pi-file', 'data-pi-file': file.path, title: file.path }, [
    createElement(Tag, { key: 's', tone: FILE_TONE[file.status] ?? 'neutral' }, t(FILE_KEY[file.status] ?? file.status)),
    file.previousPath === undefined ? null : createElement('span', { key: 'o', className: 'pi-fileOld' }, file.previousPath),
    createElement(PathLabel, { key: 'p', className: 'pi-filePath', path: file.path }),
    createElement('span', { key: 'c', className: 'pi-fileCounts' }, [
      createElement('span', { key: 'a', className: 'pi-add' }, `+${file.additions}`),
      ' ',
      createElement('span', { key: 'd', className: 'pi-del' }, `−${file.deletions}`),
    ]),
  ])
}

export interface DetailProps {
  detail: PrDetailValue | undefined
  loading: boolean
  error: string | undefined
  i18n: I18n
  /** host 路由解析与图片代理都需要它们。 */
  ctx: Context
  cwd: string | undefined
  onBack: () => void
  onRefresh: () => void
}

export function Detail({ detail, loading, error, i18n, ctx, cwd, onBack, onRefresh }: DetailProps) {
  const { t, tf } = i18n
  const detailAvatar = detail === undefined ? undefined : avatarUrlOf(detail)
  // labels 必须引用稳定（新 identity 会丢掉 MarkdownText 的流式渲染缓存）。
  const labels = useMemo<MarkdownLabels>(() => ({
    code: {
      copyLabel: t('copy'),
      copiedLabel: t('copiedLabel'),
      toolbarLabels: { codeLabel: t('codeLabel'), wrapLabel: t('wrapLabel'), unwrapLabel: t('unwrapLabel') },
    },
    footnotes: t('footnotes'),
  }), [t])
  /** 正文里的相对图片按 head 提交改写成 raw URL（见 resolvePrImage 的边界说明）。 */
  const pathImages = useMemo(() => ({
    resolve: (value: string): string | undefined => {
      if (detail === undefined) return undefined
      // refs/pull/<n>/head：base 仓里就有这个 ref；headRef 对 fork PR 只在 fork 上，
      // 用它会 404（这条来自图片代理那一侧的实测建议）。
      const relative = resolvePrImagePath(value, detail.repo, `refs/pull/${detail.number}/head`, cwd)
      return relative === undefined ? undefined : hostRouteUrl(ctx as never, relative)
    },
  }), [ctx, cwd, detail?.repo.host, detail?.repo.owner, detail?.repo.name, detail?.number])

  const head = createElement('div', { className: 'pi-head' }, [
    createElement(Button, {
      key: 'b', variant: 'ghost', size: 'sm',
      icon: createElement(IconChevronLeftOutlineRegular, {}),
      'aria-label': t('back'), title: t('back'), onClick: onBack,
    }),
    createElement('span', { key: 't', className: 'pi-detailTitle', title: detail === undefined ? '' : `#${detail.number} ${detail.title}` },
      detail === undefined ? t('reading') : `#${detail.number} ${detail.title}`),
    createElement(Button, {
      key: 'r', variant: 'toolbar', size: 'sm',
      icon: createElement(IconRefreshOutlineRegular, {}),
      'aria-label': t('refresh'), title: t('refresh'), onClick: onRefresh,
    }),
    detail === undefined ? null : createElement(Button, {
      key: 'x', variant: 'ghost', size: 'sm',
      icon: createElement(IconLinkOutlineRegular, {}),
      'aria-label': t('openOnGitHub'), title: t('openOnGitHub'),
      onClick: () => { window.open(detail.url, '_blank', 'noopener,noreferrer') },
    }),
  ])

  const body: ReactNode[] = []
  if (error !== undefined) {
    body.push(createElement('div', { key: 'e', className: 'pi-notice', 'data-tone': 'error' }, error))
  }
  if (detail === undefined) {
    body.push(createElement('div', { key: 'l', className: 'pi-empty' }, t('reading')))
  } else {
    const meta: ReactNode[] = [
      createElement(Author, { key: 'a', login: detail.author, ...(detailAvatar === undefined ? {} : { avatar: detailAvatar }) }),
      createElement(Tag, {
        key: 's',
        tone: detail.mergedAt !== undefined ? 'info' : detail.state === 'open' ? 'success' : 'neutral',
      }, detail.mergedAt !== undefined ? t('merged') : detail.state === 'open' ? t('open') : t('closed')),
    ]
    if (detail.isDraft) meta.push(createElement(Tag, { key: 'd', tone: 'warning' }, t('draft')))
    for (const label of detail.labels) meta.push(createElement(Tag, { key: `l:${label}`, tone: 'neutral' }, label))
    body.push(createElement('div', { key: 'meta', className: 'pi-detailMeta', 'data-pi-detail': '' }, meta))
    body.push(createElement('div', { key: 'stats', className: 'pi-detailStats' }, [
      createElement('span', { key: 'b', className: 'pi-branch' }, [
        createElement(IconBranchOutlineRegular, { key: 'i', size: 14 }),
        `${detail.baseRef} ← ${detail.headRef}`,
      ]),
      createElement('span', { key: 'a', className: 'pi-add' }, `+${detail.additions}`),
      createElement('span', { key: 'd', className: 'pi-del' }, `−${detail.deletions}`),
      createElement('span', { key: 'f' }, tf('files', { count: detail.changedFiles })),
      createElement('span', { key: 'c' }, tf('commits', { count: detail.commits })),
      createElement('span', { key: 'u' }, `${t('updated')} ${formatAge(detail.updatedAt)}`),
      detail.mergedAt === undefined ? null : createElement('span', { key: 'm' }, `${t('mergedAt')} ${formatDate(detail.mergedAt)}`),
    ]))
    for (const warning of detail.warnings) {
      body.push(createElement('div', { key: `w:${warning}`, className: 'pi-notice', 'data-tone': 'warn' }, warning))
    }
    body.push(createElement('div', { key: 'prose', 'data-pi-body': '' },
      createElement(MarkdownText, {
        text: detail.body === '' ? t('emptyBody') : detail.body,
        labels,
        pathImages,
        variant: 'body',
      })))
    if (detail.bodyTruncated) {
      body.push(createElement('div', { key: 'bt', className: 'pi-notice', 'data-tone': 'warn' }, t('bodyTruncated')))
    }
    body.push(createElement('div', { key: 'th', className: 'pi-sectionTitle' }, [
      t('timeline'),
      createElement('span', { key: 'n', className: 'pi-sectionCount' }, String(detail.timeline.length)),
    ]))
    if (detail.timeline.length === 0) {
      body.push(createElement('div', { key: 'te', className: 'pi-empty' }, t('noTimeline')))
    }
    for (const [index, entry] of detail.timeline.entries()) {
      body.push(createElement(Comment, { key: `${entry.kind}:${entry.createdAt}:${index}`, entry, labels, pathImages, i18n }))
    }
    if (detail.timelineTruncated) {
      body.push(createElement('div', { key: 'tt', className: 'pi-notice', 'data-tone': 'warn' }, t('timelineTruncated')))
    }
    body.push(createElement('div', { key: 'fh', className: 'pi-sectionTitle' }, [
      t('filesTitle'),
      createElement('span', { key: 'n', className: 'pi-sectionCount' }, String(detail.changedFiles)),
    ]))
    for (const file of detail.files) body.push(createElement(FileRow, { key: file.path, file, i18n }))
    if (detail.filesTruncated) {
      body.push(createElement('div', { key: 'ft', className: 'pi-notice', 'data-tone': 'warn' }, t('filesTruncated')))
    }
  }

  return createElement('div', { className: 'pi-detail', 'data-dsh-pr-inbox-detail': String(detail?.number ?? '') },
    head,
    createElement('div', { className: 'pi-detailBody' }, body))
}