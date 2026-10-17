/**
 * PR 详情视图：**插件自己渲染**（不嵌网页、不跳浏览器）。
 *
 * 正文与评论直接用**宿主的 markdown 渲染器** `MarkdownText`
 * （`@deepseek-ai/dsh-client-ui-primitives`）——它自带 GFM + TeX、围栏代码走官方
 * `CodeBlock`、丢弃原始 HTML、限制协议；`labels` 是必填契约（复制/脚注/代码卡工具栏
 * 文案），走本插件字典，漏传会回退硬编码中文。
 *
 * **图片**要走两步才渲染得出来（实测，见 markdown-images.ts 与 docs/engineering-notes.md）：
 * ① GitHub 编辑器插入的图片是原始 `<img>` 标签，而官方渲染器丢弃原始 HTML → 先经
 * `expandHtmlImages` 改写成 markdown 图片语法；② 官方只接受绝对 http(s)/blob/data 地址
 * → 仓库内相对路径经 `absoluteHostUrl` 走插件自己的图片代理。
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
import type { PrDetailComment, PrDetailFile, PrDetailValue, PrDetailWarning } from '../shared/types'
import { absoluteHostUrl } from './api'
import { Author } from './bits'
import { errorText } from './errors'
import { ageText, avatarUrlOf, formatDate } from './format'
import { expandHtmlImages } from './markdown-images'
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
const WARNING_KEY: Record<PrDetailWarning['part'], string> = {
  files: 'warningFiles',
  comments: 'warningComments',
  reviews: 'warningReviews',
}

/** GitHub 用户主页；空 login 不产出链接。 */
function profileUrl(login: string): string | undefined {
  return login === '' ? undefined : `https://github.com/${encodeURIComponent(login)}`
}

function Comment({ entry, labels, pathImages, i18n }: { entry: PrDetailComment, labels: MarkdownLabels, pathImages: MarkdownPathImages, i18n: I18n }) {
  const { t, tf } = i18n
  const avatar = avatarUrlOf(entry)
  const href = profileUrl(entry.author)
  const head: ReactNode[] = [createElement(Author, {
    key: 'a', login: entry.author, ...(avatar === undefined ? {} : { avatar }), ...(href === undefined ? {} : { href }),
  })]
  if (entry.kind === 'review') {
    const state = entry.reviewState ?? 'COMMENTED'
    head.push(createElement(Tag, { key: 's', tone: REVIEW_TONE[state] ?? 'neutral' }, t(REVIEW_KEY[state] ?? 'reviewCommented')))
  }
  head.push(createElement(Tag, { key: 't', tone: 'quiet' }, ageText(tf, entry.createdAt)))
  const children: ReactNode[] = [createElement('div', { key: 'h', className: 'pi-commentHead' }, head)]
  // 没有正文的 review（直接 APPROVE / REQUEST_CHANGES）只留 head，不显示「（没有正文）」。
  if (entry.kind === 'comment' || entry.body !== '') {
    children.push(createElement(MarkdownText, {
      key: 'b',
      text: entry.body === '' ? t('emptyBody') : expandHtmlImages(entry.body),
      labels,
      pathImages,
      variant: 'compact',
    }))
  }
  return createElement('div', { className: 'pi-card pi-comment', 'data-pi-comment': entry.kind }, children)
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

interface DetailFailure { message: string, code?: string }

export interface DetailProps {
  detail: PrDetailValue | undefined
  loading: boolean
  error: DetailFailure | undefined
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
  const detailAuthorHref = detail === undefined ? undefined : profileUrl(detail.author)
  // labels 必须引用稳定（新 identity 会丢掉 MarkdownText 的流式渲染缓存）。
  const labels = useMemo<MarkdownLabels>(() => ({
    code: {
      copyLabel: t('copy'),
      copiedLabel: t('copiedLabel'),
      toolbarLabels: { codeLabel: t('codeLabel'), wrapLabel: t('wrapLabel'), unwrapLabel: t('unwrapLabel') },
    },
    footnotes: t('footnotes'),
  }), [t])
  /**
   * 正文 / 评论里的仓库内相对图片 → 插件自己的图片代理（绝对 URL，官方只认这种）。
   * ref 用 `refs/pull/<n>/head`：base 仓里就有这个 ref，fork PR 也适用（headRef 会 404）。
   */
  const pathImages = useMemo(() => ({
    resolve: (value: string): string | undefined => {
      if (detail === undefined) return undefined
      // refs/pull/<n>/head：base 仓里就有这个 ref；headRef 对 fork PR 只在 fork 上，
      // 用它会 404（这条来自图片代理那一侧的实测建议）。
      const relative = resolvePrImagePath(value, detail.repo, `refs/pull/${detail.number}/head`, cwd)
      return relative === undefined ? undefined : absoluteHostUrl(ctx, relative)
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
      disabled: loading,
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
    body.push(createElement('div', {
      key: 'e', className: 'pi-notice', 'data-tone': 'error', 'aria-live': 'polite', title: error.message,
    }, errorText(i18n, error)))
  }
  if (detail === undefined) {
    if (error === undefined) body.push(createElement('div', { key: 'l', className: 'pi-empty', role: 'status' }, t('reading')))
  } else {
    const meta: ReactNode[] = [
      createElement(Author, {
        key: 'a', login: detail.author, ...(detailAvatar === undefined ? {} : { avatar: detailAvatar }),
        ...(detailAuthorHref === undefined ? {} : { href: detailAuthorHref }),
      }),
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
      createElement('span', { key: 'f' }, tf(detail.changedFiles === 1 ? 'filesOne' : 'files', { count: detail.changedFiles })),
      createElement('span', { key: 'c' }, tf(detail.commits === 1 ? 'commitsOne' : 'commits', { count: detail.commits })),
      createElement('span', { key: 'u' }, `${t('updated')} ${ageText(tf, detail.updatedAt)}`),
      detail.mergedAt === undefined ? null : createElement('span', { key: 'm' }, `${t('mergedAt')} ${formatDate(detail.mergedAt)}`),
    ]))
    for (const warning of detail.warnings) {
      body.push(createElement('div', {
        key: `w:${warning.part}:${warning.message}`,
        className: 'pi-notice',
        'data-tone': 'warn',
        'aria-live': 'polite',
        title: warning.message,
      }, `${t(WARNING_KEY[warning.part])}: ${errorText(i18n, warning)}`))
    }
    body.push(createElement('div', { key: 'prose', className: 'pi-card', 'data-pi-body': '' },
      createElement(MarkdownText, {
        text: detail.body === '' ? t('emptyBody') : expandHtmlImages(detail.body),
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
    const comments = detail.timeline.map((entry, index) => createElement(Comment, {
      key: `${entry.kind}:${entry.createdAt}:${index}`, entry, labels, pathImages, i18n,
    }))
    body.push(createElement('div', { key: 'tl', className: 'pi-stack' },
      comments.length === 0 ? [createElement('div', { key: 'te', className: 'pi-empty' }, t('noTimeline'))] : comments))
    if (detail.timelineTruncated) {
      body.push(createElement('div', { key: 'tt', className: 'pi-notice', 'data-tone': 'warn' }, t('timelineTruncated')))
    }
    body.push(createElement('div', { key: 'fh', className: 'pi-sectionTitle' }, [
      t('filesTitle'),
      createElement('span', { key: 'n', className: 'pi-sectionCount' }, String(detail.changedFiles)),
    ]))
    if (detail.files.length === 0) {
      body.push(createElement('div', { key: 'fe', className: 'pi-empty' }, t('noFiles')))
    } else {
      body.push(createElement('div', { key: 'fl', className: 'pi-card', 'data-flush': 'true' },
        detail.files.map(file => createElement(FileRow, { key: file.path, file, i18n }))))
    }
    if (detail.filesTruncated) {
      body.push(createElement('div', { key: 'ft', className: 'pi-notice', 'data-tone': 'warn' }, t('filesTruncated')))
    }
  }

  return createElement('div', {
    className: 'pi-detail',
    'data-dsh-pr-inbox-detail': String(detail?.number ?? ''),
    tabIndex: -1,
    role: 'region',
    'aria-label': detail === undefined ? t('tabTitle') : `#${detail.number} ${detail.title}`,
  },
  head,
  createElement('div', { className: 'pi-detailBody' }, body))
}
