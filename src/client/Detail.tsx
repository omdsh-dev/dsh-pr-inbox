/**
 * PR 详情视图：**插件自己渲染**（不嵌网页、不跳浏览器）。
 *
 * 数据全部来自 host 的 `detail` op（`PrDetailValue`）：正文、review/评论时间线、
 * 改动文件清单；三者都可能被**如实**截断（`bodyTruncated` / `timelineTruncated`
 * / `filesTruncated`），支线失败则进 `warnings` —— 详情因此永不因为一条支线失败
 * 变空白。
 *
 * 规格与列表同一套（见 styles.ts）：36px 头带放返回 + 标题 + 刷新 + 外链，
 * 关卡式分区标题 28px，正文与评论这一版是**纯文本 + 保留换行**。
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import type { PrDetailComment, PrDetailFile, PrDetailValue } from '../shared/types'
import { formatAge, formatDate } from './format'
import { ExternalIcon, RefreshIcon } from './icons'
import { L } from './labels'

/** 文件状态 → 药丸色调（与 bsb 的 statusBadge 同一套语义色）。 */
const FILE_TONE: Record<string, string> = {
  added: 'merged',
  removed: 'error',
  modified: 'draft',
  renamed: 'review',
  copied: 'review',
}

function fileTone(status: string): string {
  return FILE_TONE[status] ?? 'quiet'
}

function fileLabel(status: string): string {
  const labels = L.fileStatus as Record<string, string | undefined>
  return labels[status] ?? status
}

function IconButton(props: { icon: ReactNode; label: string; onClick: () => void; spinning?: boolean }) {
  return createElement('button', {
    type: 'button', className: 'pi-iconButton', title: props.label, 'aria-label': props.label,
    'data-spinning': props.spinning === true ? 'true' : undefined,
    onClick: props.onClick,
  }, props.icon)
}

function Comment({ entry }: { entry: PrDetailComment }) {
  const pills: ReactNode[] = [
    createElement('span', { key: 'a', className: 'pi-pill', 'data-tone': 'author' }, entry.author),
  ]
  if (entry.kind === 'review') {
    const state = entry.reviewState ?? 'COMMENTED'
    const tone = state === 'APPROVED' ? 'merged' : state === 'CHANGES_REQUESTED' ? 'error' : 'quiet'
    pills.push(createElement('span', { key: 's', className: 'pi-pill', 'data-tone': tone }, L.reviewState[state] ?? state))
  }
  pills.push(createElement('span', { key: 't', className: 'pi-pill', 'data-tone': 'quiet' }, formatAge(entry.createdAt)))
  return createElement('div', { className: 'pi-comment', 'data-pi-comment': entry.kind }, [
    createElement('div', { key: 'h', className: 'pi-commentHead' }, pills),
    createElement('div', { key: 'b', className: 'pi-prose' }, entry.body === '' ? L.emptyBody : entry.body),
  ])
}

function FileRow({ file }: { file: PrDetailFile }) {
  const name = file.previousPath === undefined ? file.path : file.path
  return createElement('div', { className: 'pi-file', 'data-pi-file': file.path, title: file.path }, [
    createElement('span', { key: 's', className: 'pi-pill', 'data-tone': fileTone(file.status) }, fileLabel(file.status)),
    file.previousPath === undefined ? null : createElement('span', { key: 'o', className: 'pi-fileOld' }, file.previousPath),
    createElement('span', { key: 'p', className: 'pi-filePath' }, name),
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
  onBack: () => void
  onRefresh: () => void
}

export function Detail({ detail, loading, error, onBack, onRefresh }: DetailProps) {
  const title = detail === undefined ? L.reading : `#${detail.number} ${detail.title}`
  const head = createElement('div', { className: 'pi-head' }, [
    createElement(IconButton, { key: 'b', icon: createElement('span', { 'aria-hidden': true }, '←'), label: L.back, onClick: onBack }),
    createElement('span', { key: 't', className: 'pi-detailTitle', title }, title),
    createElement(IconButton, { key: 'r', icon: createElement(RefreshIcon, {}), label: L.refresh, spinning: loading, onClick: onRefresh }),
    detail === undefined ? null : createElement(IconButton, {
      key: 'x', icon: createElement(ExternalIcon, {}), label: L.openOnGitHub,
      onClick: () => { window.open(detail.url, '_blank', 'noopener,noreferrer') },
    }),
  ])

  const body: ReactNode[] = []
  if (error !== undefined) {
    body.push(createElement('div', { key: 'e', className: 'pi-notice', 'data-tone': 'error' }, error))
  }
  if (detail === undefined) {
    body.push(createElement('div', { key: 'l', className: 'pi-empty' }, L.reading))
  } else {
    const meta: ReactNode[] = [
      createElement('span', { key: 'a', className: 'pi-pill', 'data-tone': 'author' }, detail.author),
      createElement('span', { key: 's', className: 'pi-pill', 'data-tone': detail.mergedAt !== undefined ? 'merged' : detail.state === 'open' ? 'review' : 'quiet' },
        detail.mergedAt !== undefined ? L.merged : detail.state === 'open' ? L.open : L.closed),
    ]
    if (detail.isDraft) meta.push(createElement('span', { key: 'd', className: 'pi-pill', 'data-tone': 'draft' }, L.draft))
    for (const label of detail.labels) {
      meta.push(createElement('span', { key: `l:${label}`, className: 'pi-pill', title: label }, label))
    }
    body.push(createElement('div', { key: 'meta', className: 'pi-detailMeta', 'data-pi-detail': '' }, meta))
    body.push(createElement('div', { key: 'stats', className: 'pi-detailStats' }, [
      createElement('span', { key: 'b', className: 'pi-filePath' }, `${detail.baseRef} ← ${detail.headRef}`),
      createElement('span', { key: 'a', className: 'pi-add' }, `+${detail.additions}`),
      createElement('span', { key: 'd', className: 'pi-del' }, `−${detail.deletions}`),
      createElement('span', { key: 'f' }, L.files(detail.changedFiles)),
      createElement('span', { key: 'c' }, L.commits(detail.commits)),
      createElement('span', { key: 'u' }, `${L.updated} ${formatAge(detail.updatedAt)}`),
      detail.mergedAt === undefined ? null : createElement('span', { key: 'm' }, `${L.mergedAt} ${formatDate(detail.mergedAt)}`),
    ]))
    for (const warning of detail.warnings) {
      body.push(createElement('div', { key: `w:${warning}`, className: 'pi-notice', 'data-tone': 'warn' }, warning))
    }
    body.push(createElement('div', { key: 'prose', className: 'pi-prose', 'data-pi-body': '' }, detail.body === '' ? L.emptyBody : detail.body))
    if (detail.bodyTruncated) {
      body.push(createElement('div', { key: 'bt', className: 'pi-notice', 'data-tone': 'warn' }, L.bodyTruncated))
    }
    body.push(createElement('div', { key: 'th', className: 'pi-sectionTitle' }, [
      L.timeline,
      createElement('span', { key: 'n', className: 'pi-sectionCount' }, String(detail.timeline.length)),
    ]))
    if (detail.timeline.length === 0) {
      body.push(createElement('div', { key: 'te', className: 'pi-empty' }, L.noTimeline))
    }
    for (const [index, entry] of detail.timeline.entries()) {
      body.push(createElement(Comment, { key: `${entry.kind}:${entry.createdAt}:${index}`, entry }))
    }
    if (detail.timelineTruncated) {
      body.push(createElement('div', { key: 'tt', className: 'pi-notice', 'data-tone': 'warn' }, L.timelineTruncated))
    }
    body.push(createElement('div', { key: 'fh', className: 'pi-sectionTitle' }, [
      L.filesTitle,
      createElement('span', { key: 'n', className: 'pi-sectionCount' }, String(detail.changedFiles)),
    ]))
    for (const file of detail.files) body.push(createElement(FileRow, { key: file.path, file }))
    if (detail.filesTruncated) {
      body.push(createElement('div', { key: 'ft', className: 'pi-notice', 'data-tone': 'warn' }, L.filesTruncated))
    }
  }

  return createElement('div', { className: 'pi-detail', 'data-dsh-pr-inbox-detail': String(detail?.number ?? '') },
    head,
    createElement('div', { className: 'pi-detailBody' }, body))
}