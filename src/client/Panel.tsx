/**
 * PR 列表：三桶分区 + 顶部搜索 + 简洁/详细两种密度。
 *
 * 控件**全部来自官方** `@deepseek-ai/dsh-client-ui-primitives`（`Input` / `Pill` /
 * `Button` / `Tag` / 官方图标）——官方铁律是「库里有控件就不要抄第二份」；自绘的只有
 * 官方没有的语义：分组列表的分区头与 PR 行（几何与颜色照官方规范，见 styles.ts）。
 * 文案全部经 `i18n`（宿主 locale 服务），不自己判语言。
 *
 * 稳态开销：只在 `visible` 时取数、不持定时器、重新可见即补刷一次；host 侧还有
 * 60 s 有界缓存，反复切 tab 不会打爆搜索配额。
 *
 * 可寻址面（也给挂载自检用）：`[data-dsh-pr-inbox-panel]` / `[data-pi-search]` /
 * `[data-pi-density]` / `[data-bucket]` / `[data-pr-row="<number>"]` / `[data-pi-foot]`。
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import {
  Button,
  IconChevronDownOutlineRegular,
  IconLinkOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  Pill,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BucketKey, BucketValue, ListValue, PrDetailValue, PrRow } from '../shared/types'
import { RouteError, callOp, resolveCwd } from './api'
import { Detail } from './Detail'
import { formatAge, matchesQuery } from './format'
import type { I18n } from './i18n'

export interface PanelProps {
  ctx: Context
  i18n: I18n
  sessionId: string
  cwd: string | undefined
  visible: boolean
}

export type Density = 'compact' | 'detailed'

const BUCKETS: readonly BucketKey[] = ['authored', 'review', 'merged']
const BUCKET_LABEL: Record<BucketKey, string> = { authored: 'bucketAuthored', review: 'bucketReview', merged: 'bucketMerged' }
const BUCKET_HINT: Record<BucketKey, string> = { authored: 'hintAuthored', review: 'hintReview', merged: 'hintMerged' }

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; value: ListValue }
  | { phase: 'failed'; message: string; code?: string }

/** gh 相关失败给一句「怎么办」，而不是把英文 stderr 原样端给用户。 */
const GH_HINT: Record<string, string> = {
  'gh-missing': '安装 GitHub CLI（https://cli.github.com）后执行 `gh auth login`。',
  'gh-unauthenticated': '执行 `gh auth login` 登录后再刷新。',
  'gh-rate-limit': '触达 GitHub API 速率上限，稍后重试（已认证 30 次/分）。',
  'gh-timeout': '本机 gh 响应超时，检查网络后重试。',
  'no-cwd': '先在该会话里打开一个文件或产生一次工具调用，让会话确定工作目录。',
}

/** 行本身是可点面（开详情），右侧 ↗ 是官方 Button——用 role/tabIndex 而不是嵌套 button。 */
function rowHandlers(onActivate: () => void) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (event: { key: string, preventDefault: () => void }) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onActivate()
      }
    },
  }
}

function OpenExternal(props: { url: string, label: string }) {
  return createElement(Button, {
    variant: 'ghost', size: 'sm',
    icon: createElement(IconLinkOutlineRegular, {}),
    'aria-label': props.label, title: props.label,
    onClick: (event: ReactMouseEvent) => {
      event.stopPropagation()
      window.open(props.url, '_blank', 'noopener,noreferrer')
    },
  })
}

/** 一行 PR。简洁=单行 28px（扫描用）；详细=两行（标题 + 作者/标签/评论/合并时间）。 */
function Row(props: { row: PrRow, density: Density, selected: boolean, onSelect: (row: PrRow) => void, i18n: I18n }) {
  const { row, density, i18n } = props
  const { t, tf } = i18n
  const num = createElement('span', { key: 'n', className: 'pi-num' }, `#${row.number}`)
  const subject = createElement('span', { key: 't', className: 'pi-subject', title: row.title }, row.title)
  const external = createElement(OpenExternal, { key: 'x', url: row.url, label: t('openOnGitHub') })
  const handlers = rowHandlers(() => { props.onSelect(row) })
  if (density === 'compact') {
    return createElement('div', {
      ...handlers,
      className: 'pi-row',
      'data-density': 'compact',
      'data-pr-row': String(row.number),
      'data-selected': props.selected ? 'true' : undefined,
      title: `${row.author} · ${formatAge(row.updatedAt)}`,
    }, [
      num, subject,
      row.isDraft ? createElement(Tag, { key: 'd', tone: 'warning' }, t('draft')) : null,
      external,
      createElement('span', { key: 'm', className: 'pi-meta' }, `${row.author} · ${formatAge(row.updatedAt)}`),
    ])
  }
  const pills: ReactNode[] = [createElement(Tag, { key: 'a', tone: 'quiet' }, row.author)]
  if (row.mergedAt !== undefined) {
    pills.push(createElement(Tag, { key: 'm', tone: 'info' }, `${t('mergedAt')} ${formatAge(row.mergedAt)}`))
  }
  for (const label of row.labels.slice(0, 4)) {
    pills.push(createElement(Tag, { key: `l:${label}`, tone: 'neutral' }, label))
  }
  if (row.labels.length > 4) {
    pills.push(createElement(Tag, { key: 'l+', tone: 'quiet' }, `+${row.labels.length - 4}`))
  }
  if (row.comments > 0) {
    pills.push(createElement(Tag, { key: 'c', tone: 'quiet' }, tf('commentsCount', { count: row.comments })))
  }
  return createElement('div', {
    ...handlers,
    className: 'pi-row',
    'data-density': 'detailed',
    'data-pr-row': String(row.number),
    'data-selected': props.selected ? 'true' : undefined,
  }, [
    createElement('div', { key: 'l1', className: 'pi-line1' }, [
      num, subject,
      row.isDraft ? createElement(Tag, { key: 'd', tone: 'warning' }, t('draft')) : null,
      external,
      createElement('span', { key: 'm', className: 'pi-meta' }, formatAge(row.updatedAt)),
    ]),
    createElement('div', { key: 'l2', className: 'pi-line2' }, pills),
  ])
}

function Section(props: {
  bucket: BucketKey
  value: BucketValue | undefined
  query: string
  density: Density
  open: boolean
  onToggle: () => void
  selected: number | undefined
  onSelect: (row: PrRow) => void
  i18n: I18n
}) {
  const { bucket, value, query, i18n } = props
  const { t, tf } = i18n
  const rows = useMemo(() => (value?.rows ?? []).filter(row => matchesQuery(row, query)), [value, query])
  const total = value?.total ?? 0
  const filtered = query.trim() !== ''
  const count = filtered ? tf('hits', { hit: rows.length, total }) : String(total)
  const body: ReactNode[] = []
  if (value?.error !== undefined) {
    body.push(createElement('div', { key: 'e', className: 'pi-notice', 'data-tone': 'error' }, value.error.message))
  } else if (rows.length === 0) {
    body.push(createElement('div', { key: 'z', className: 'pi-empty' }, filtered ? t('noMatch') : t('bucketEmpty')))
  }
  for (const row of rows) {
    body.push(createElement(Row, {
      key: row.number, row, density: props.density, selected: props.selected === row.number, onSelect: props.onSelect, i18n,
    }))
  }
  return createElement('section', { className: 'pi-section', 'data-bucket': bucket, 'data-open': props.open ? 'true' : 'false' }, [
    createElement('button', {
      key: 'h', type: 'button', className: 'pi-sectionHeader', onClick: props.onToggle, 'aria-expanded': props.open,
    }, [
      createElement('span', { key: 'c', className: 'pi-chevron' }, createElement(IconChevronDownOutlineRegular, { size: 14 })),
      createElement('span', { key: 'l', className: 'pi-sectionLabel' }, t(BUCKET_LABEL[bucket])),
      createElement('span', { key: 'n', className: 'pi-sectionCount' }, count),
      createElement('span', { key: 'q', className: 'pi-hint' }, t(BUCKET_HINT[bucket])),
    ]),
    createElement('div', { key: 'b', className: 'pi-rows' }, body),
  ])
}

export function Panel({ ctx, i18n, sessionId, cwd, visible }: PanelProps) {
  const { t } = i18n
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [query, setQuery] = useState('')
  const [density, setDensity] = useState<Density>('compact')
  const [collapsed, setCollapsed] = useState<Partial<Record<BucketKey, boolean>>>({})
  const [selected, setSelected] = useState<number | undefined>(undefined)
  const [open, setOpen] = useState<number | undefined>(undefined)
  const [detail, setDetail] = useState<{ loading: boolean, value?: PrDetailValue, error?: string }>({ loading: false })
  const generation = useRef(0)
  const detailGeneration = useRef(0)
  const cwdRef = useRef<string | undefined>(undefined)

  const ensureCwd = useCallback(async (): Promise<string | undefined> => {
    if (cwdRef.current !== undefined) return cwdRef.current
    const resolved = await resolveCwd(ctx, sessionId, cwd)
    cwdRef.current = resolved
    return resolved
  }, [ctx, sessionId, cwd])

  const load = useCallback(async (): Promise<void> => {
    const mine = generation.current + 1
    generation.current = mine
    setState({ phase: 'loading' })
    try {
      const resolved = await ensureCwd()
      if (resolved === undefined) {
        if (mine === generation.current) setState({ phase: 'failed', message: t('unbound'), code: 'no-cwd' })
        return
      }
      const value = await callOp<ListValue>(ctx, 'list', { cwd: resolved })
      if (mine === generation.current) setState({ phase: 'ready', value })
    } catch (error) {
      if (mine !== generation.current) return
      const message = error instanceof Error ? error.message : String(error)
      const code = error instanceof RouteError ? error.code : undefined
      setState({ phase: 'failed', message, ...(code === undefined ? {} : { code }) })
    }
  }, [ctx, ensureCwd, t])

  const loadDetail = useCallback(async (number: number): Promise<void> => {
    const mine = detailGeneration.current + 1
    detailGeneration.current = mine
    setDetail({ loading: true })
    try {
      const resolved = await ensureCwd()
      if (resolved === undefined) {
        if (mine === detailGeneration.current) setDetail({ loading: false, error: t('unbound') })
        return
      }
      const value = await callOp<PrDetailValue>(ctx, 'detail', { cwd: resolved, number })
      if (mine === detailGeneration.current) setDetail({ loading: false, value })
    } catch (error) {
      if (mine !== detailGeneration.current) return
      setDetail({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }, [ctx, ensureCwd, t])

  const openRow = useCallback((row: PrRow): void => {
    setSelected(row.number)
    setOpen(row.number)
  }, [])

  const back = useCallback((): void => {
    detailGeneration.current += 1
    setOpen(undefined)
    setDetail({ loading: false })
  }, [])

  useEffect(() => {
    if (!visible) return
    void load()
  }, [visible, load])

  useEffect(() => {
    if (!visible || open === undefined) return
    void loadDetail(open)
  }, [visible, open, loadDetail])

  if (open !== undefined) {
    return createElement('div', { className: 'pi-root', 'data-dsh-pr-inbox-panel': '', 'data-pi-view': 'detail' },
      createElement(Detail, {
        detail: detail.value,
        loading: detail.loading,
        error: detail.error,
        i18n,
        onBack: back,
        onRefresh: () => { void loadDetail(open) },
      }))
  }

  const head = createElement('div', { className: 'pi-head' }, [
    createElement('span', { key: 's', className: 'pi-search' },
      createElement(Input, {
        icon: createElement(IconSearchOutlineRegular, {}),
        placeholder: t('searchPlaceholder'),
        'aria-label': t('searchPlaceholder'),
        'data-pi-search': '',
        value: query,
        spellCheck: false,
        onChange: (event: { target: { value: string } }) => { setQuery(event.target.value) },
      })),
    createElement('span', { key: 'd', className: 'pi-density' }, [
      createElement(Pill, {
        key: 'c', active: density === 'compact', 'data-pi-density': 'compact',
        onClick: () => { setDensity('compact') },
      }, t('compact')),
      createElement(Pill, {
        key: 'x', active: density === 'detailed', 'data-pi-density': 'detailed',
        onClick: () => { setDensity('detailed') },
      }, t('detailed')),
    ]),
    createElement(Button, {
      key: 'r', variant: 'toolbar', size: 'sm',
      icon: createElement(IconRefreshOutlineRegular, {}),
      'aria-label': t('refresh'), title: t('refresh'),
      disabled: !visible,
      onClick: () => { void load() },
    }),
  ])

  const body: ReactNode[] = []
  if (state.phase === 'failed') {
    body.push(createElement('div', { key: 'e', className: 'pi-notice', 'data-tone': 'error' }, state.message))
    const hint = state.code === undefined ? undefined : GH_HINT[state.code]
    if (hint !== undefined) body.push(createElement('div', { key: 'h', className: 'pi-notice' }, hint))
  } else if (state.phase === 'loading') {
    body.push(createElement('div', { key: 'l', className: 'pi-empty' }, t('reading')))
  } else {
    const value = state.value
    if (value.gh.available !== true) {
      body.push(createElement('div', { key: 'g', className: 'pi-notice', 'data-tone': 'error' }, value.gh.error ?? 'gh'))
      body.push(createElement('div', { key: 'gh', className: 'pi-notice' }, GH_HINT['gh-missing']!))
    } else if (value.gh.login === undefined) {
      body.push(createElement('div', { key: 'g', className: 'pi-notice', 'data-tone': 'error' }, value.gh.error ?? 'gh'))
      body.push(createElement('div', { key: 'h', className: 'pi-notice' }, GH_HINT['gh-unauthenticated']!))
    }
    if (value.repo === null) {
      body.push(createElement('div', { key: 'r', className: 'pi-notice', 'data-tone': 'warn' }, t('unbound')))
    } else if (value.note !== undefined) {
      body.push(createElement('div', { key: 'n', className: 'pi-notice', 'data-tone': 'warn' }, value.note))
    }
    for (const bucket of BUCKETS) {
      body.push(createElement(Section, {
        key: bucket, bucket, value: value.buckets[bucket], query, density, i18n,
        open: collapsed[bucket] !== true,
        onToggle: () => { setCollapsed(previous => ({ ...previous, [bucket]: previous[bucket] !== true })) },
        selected, onSelect: openRow,
      }))
    }
  }

  const ready = state.phase === 'ready' ? state.value : undefined
  const foot = createElement('div', { className: 'pi-foot', 'data-pi-foot': '' }, [
    createElement('span', { key: 'r', className: 'pi-footRepo' }, ready?.repo?.fullName ?? t('unboundShort')),
    createElement('span', { key: 'm', className: 'pi-footMeta' },
      [
        ready?.gh.login === undefined ? '' : `@${ready.gh.login}`,
        ready === undefined ? '' : `${t('updated')} ${formatAge(ready.fetchedAt)}`,
      ].filter(part => part !== '').join(' · ')),
  ])

  return createElement('div', { className: 'pi-root', 'data-dsh-pr-inbox-panel': '' },
    head,
    createElement('div', { className: 'pi-body' }, body),
    foot)
}