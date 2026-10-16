/**
 * PR 列表面板（阶段二）：三桶分区 + 顶部搜索 + 简洁/详细两种密度。
 *
 * 视觉规格照 better-sidebar 的原生尺度（见 styles.ts 的头注释）：36px 头带、
 * 28px 分区头与控件、28px 简洁行、两行式详细行、悬停 hover / 选中 active+2px
 * 强调条；错误一律是纯文本 notice（不画盒子），与 bsb 的 kit 一致。
 *
 * 稳态开销（照 bsb 的硬约束）：只在 `visible` 时取数、不持有定时器、每次可见即
 * 刷一次；列表数据在 host 侧还有 60 s 有界缓存，反复切 tab 不会打爆搜索配额。
 *
 * 可寻址面（也给挂载自检用）：`[data-dsh-pr-inbox-panel]` / `[data-pi-search]` /
 * `[data-pi-density]` / `[data-bucket]` / `[data-pr-row="<number>"]` / `[data-pi-foot]`。
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { BucketKey, BucketValue, ListValue, PrRow } from '../shared/types'
import { RouteError, callOp, resolveCwd } from './api'
import { formatAge, matchesQuery } from './format'
import { ChevronIcon, ExternalIcon, RefreshIcon } from './icons'
import { L } from './labels'

export interface PanelProps {
  ctx: Context
  sessionId: string
  cwd: string | undefined
  visible: boolean
}

export type Density = 'compact' | 'detailed'

/** 按桶的顺序渲染（orders 与「与我相关」的紧迫度一致：我先提的 → 等我审 → 已合并）。 */
const BUCKETS: readonly BucketKey[] = ['authored', 'review', 'merged']

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

function IconButton(props: {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  spinning?: boolean
}) {
  return createElement('button', {
    type: 'button',
    className: 'pi-iconButton',
    title: props.label,
    'aria-label': props.label,
    disabled: props.disabled === true,
    'data-spinning': props.spinning === true ? 'true' : undefined,
    onClick: props.onClick,
  }, props.icon)
}

/** 一行 PR。简洁=单行 28px（扫描用）；详细=两行（标题 + 作者/标签/评论/时间）。 */
function Row(props: { row: PrRow; density: Density; selected: boolean; onSelect: (row: PrRow) => void }) {
  const { row, density } = props
  const open = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    window.open(row.url, '_blank', 'noopener,noreferrer')
  }
  const num = createElement('span', { key: 'n', className: 'pi-num' }, `#${row.number}`)
  const subject = createElement('span', { key: 't', className: 'pi-subject', title: row.title }, row.title)
  const external = createElement(IconButton, {
    key: 'x', icon: createElement(ExternalIcon, {}), label: L.openOnGitHub, onClick: () => { open({ stopPropagation: () => {} }) },
  })
  if (density === 'compact') {
    return createElement('div', {
      className: 'pi-row', 'data-density': 'compact', 'data-pr-row': String(row.number),
      'data-selected': props.selected ? 'true' : undefined,
      onClick: () => { props.onSelect(row) },
      title: `${row.author} · ${formatAge(row.updatedAt)}`,
    }, [
      num, subject,
      row.isDraft ? createElement('span', { key: 'd', className: 'pi-pill', 'data-tone': 'draft' }, L.draft) : null,
      external,
      createElement('span', { key: 'm', className: 'pi-meta' }, `${row.author} · ${formatAge(row.updatedAt)}`),
    ])
  }
  const pills: ReactNode[] = [
    createElement('span', { key: 'a', className: 'pi-pill', 'data-tone': 'author' }, row.author),
  ]
  if (row.isDraft) pills.push(createElement('span', { key: 'd', className: 'pi-pill', 'data-tone': 'draft' }, L.draft))
  if (row.mergedAt !== undefined) {
    pills.push(createElement('span', { key: 'm', className: 'pi-pill', 'data-tone': 'merged' }, `${L.mergedAt} ${formatAge(row.mergedAt)}`))
  }
  for (const label of row.labels.slice(0, 4)) {
    pills.push(createElement('span', { key: `l:${label}`, className: 'pi-pill', title: label }, label))
  }
  if (row.labels.length > 4) {
    pills.push(createElement('span', { key: 'l+', className: 'pi-pill', 'data-tone': 'quiet' }, `+${row.labels.length - 4}`))
  }
  if (row.comments > 0) {
    pills.push(createElement('span', { key: 'c', className: 'pi-pill', 'data-tone': 'quiet', title: L.comments }, `${row.comments} ${L.comments}`))
  }
  return createElement('div', {
    className: 'pi-row', 'data-density': 'detailed', 'data-pr-row': String(row.number),
    'data-selected': props.selected ? 'true' : undefined,
    onClick: () => { props.onSelect(row) },
  }, [
    createElement('div', { key: 'l1', className: 'pi-line1' }, [num, subject, external, createElement('span', { key: 'm', className: 'pi-meta' }, formatAge(row.updatedAt))]),
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
}) {
  const { bucket, value, query } = props
  const rows = useMemo(() => (value?.rows ?? []).filter(row => matchesQuery(row, query)), [value, query])
  const total = value?.total ?? 0
  const filtered = query.trim() !== ''
  const count = filtered ? L.hits(rows.length, total) : String(total)
  const body: ReactNode[] = []
  if (value?.error !== undefined) {
    body.push(createElement('div', { key: 'e', className: 'pi-notice', 'data-tone': 'error' }, value.error.message))
  } else if (rows.length === 0) {
    body.push(createElement('div', { key: 'z', className: 'pi-empty' }, filtered ? L.noMatch : L.bucketEmpty))
  }
  for (const row of rows) {
    body.push(createElement(Row, {
      key: row.number, row, density: props.density, selected: props.selected === row.number, onSelect: props.onSelect,
    }))
  }
  return createElement('section', { className: 'pi-section', 'data-bucket': bucket, 'data-open': props.open ? 'true' : 'false' }, [
    createElement('button', {
      key: 'h', type: 'button', className: 'pi-sectionHeader', onClick: props.onToggle,
      'aria-expanded': props.open,
    }, [
      createElement('span', { key: 'c', className: 'pi-chevron' }, createElement(ChevronIcon, {})),
      createElement('span', { key: 'l', className: 'pi-sectionLabel' }, L.bucket[bucket] ?? bucket),
      createElement('span', { key: 'n', className: 'pi-sectionCount' }, count),
      createElement('span', { key: 'q', className: 'pi-sectionCount' }, L.bucketHint[bucket] ?? ''),
    ]),
    createElement('div', { key: 'b', className: 'pi-rows' }, body),
  ])
}

export function Panel({ ctx, sessionId, cwd, visible }: PanelProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [query, setQuery] = useState('')
  const [density, setDensity] = useState<Density>('compact')
  const [collapsed, setCollapsed] = useState<Partial<Record<BucketKey, boolean>>>({})
  const [selected, setSelected] = useState<number | undefined>(undefined)
  const generation = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const mine = generation.current + 1
    generation.current = mine
    setState({ phase: 'loading' })
    try {
      const resolved = await resolveCwd(ctx, sessionId, cwd)
      if (resolved === undefined) {
        if (mine === generation.current) setState({ phase: 'failed', message: '会话还没有工作目录', code: 'no-cwd' })
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
  }, [ctx, sessionId, cwd])

  // 可见性门控：隐藏时什么都不做，重新可见立刻补一次（不持定时器）。
  useEffect(() => {
    if (!visible) return
    void load()
  }, [visible, load])

  const ready = state.phase === 'ready' ? state.value : undefined
  const gh = ready?.gh
  const repo = ready?.repo ?? undefined

  const head = createElement('div', { className: 'pi-head' }, [
    createElement('input', {
      key: 's', className: 'pi-search', 'data-pi-search': '', type: 'search',
      placeholder: L.search, value: query, spellCheck: false,
      onChange: (event: { target: { value: string } }) => { setQuery(event.target.value) },
    }),
    createElement('div', { key: 'd', className: 'pi-switch' }, (['compact', 'detailed'] as const).map(mode =>
      createElement('button', {
        key: mode, type: 'button', className: 'pi-chip', 'data-pi-density': mode,
        'data-active': density === mode ? 'true' : undefined,
        onClick: () => { setDensity(mode) },
      }, mode === 'compact' ? L.compact : L.detailed))),
    createElement(IconButton, {
      key: 'r', icon: createElement(RefreshIcon, {}), label: L.refresh,
      disabled: !visible, spinning: state.phase === 'loading', onClick: () => { void load() },
    }),
  ])

  const body: ReactNode[] = []
  if (state.phase === 'failed') {
    body.push(createElement('div', { key: 'e', className: 'pi-notice', 'data-tone': 'error' }, state.message))
    const hint = state.code === undefined ? undefined : GH_HINT[state.code]
    if (hint !== undefined) body.push(createElement('div', { key: 'h', className: 'pi-notice' }, hint))
  } else if (state.phase === 'loading') {
    body.push(createElement('div', { key: 'l', className: 'pi-empty' }, L.reading))
  } else {
    const value = state.value
    if (value.gh.available !== true) {
      body.push(createElement('div', { key: 'g', className: 'pi-notice', 'data-tone': 'error' }, value.gh.error ?? 'gh 不可用'))
      body.push(createElement('div', { key: 'gh', className: 'pi-notice' }, GH_HINT['gh-missing']!))
    } else if (value.gh.login === undefined) {
      body.push(createElement('div', { key: 'g', className: 'pi-notice', 'data-tone': 'error' }, value.gh.error ?? 'gh 未登录'))
      body.push(createElement('div', { key: 'h', className: 'pi-notice' }, GH_HINT['gh-unauthenticated']!))
    }
    if (value.repo === null) {
      body.push(createElement('div', { key: 'r', className: 'pi-notice', 'data-tone': 'warn' }, L.unbound))
    } else if (value.note !== undefined) {
      body.push(createElement('div', { key: 'n', className: 'pi-notice', 'data-tone': 'warn' }, value.note))
    }
    for (const bucket of BUCKETS) {
      body.push(createElement(Section, {
        key: bucket, bucket, value: value.buckets[bucket], query, density,
        open: collapsed[bucket] !== true,
        onToggle: () => { setCollapsed(previous => ({ ...previous, [bucket]: previous[bucket] !== true })) },
        selected, onSelect: (row: PrRow) => { setSelected(row.number) },
      }))
    }
  }

  const foot = createElement('div', { className: 'pi-foot', 'data-pi-foot': '' }, [
    createElement('span', { key: 'r', className: 'pi-footRepo' }, repo?.fullName ?? L.unboundShort),
    createElement('span', { key: 'm', className: 'pi-footMeta' },
      [gh?.login === undefined ? '' : `@${gh.login}`, ready === undefined ? '' : `${L.updated} ${formatAge(ready.fetchedAt)}`]
        .filter(part => part !== '').join(' · ')),
  ])

  return createElement('div', { className: 'pi-root', 'data-dsh-pr-inbox-panel': '' },
    head,
    createElement('div', { className: 'pi-body' }, body),
    foot)
}