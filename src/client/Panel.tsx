/**
 * PR 列表：三桶分区 + 顶部搜索 + 简洁/详细两种密度。
 *
 * 控件**全部来自官方** `@deepseek-ai/dsh-client-ui-primitives`（`Input` / `Pill` /
 * `Button` / `Tag` / 官方图标）——官方铁律是「库里有控件就不要抄第二份」；自绘的只有
 * 官方没有的语义：分组列表的分区头与 PR 行（几何与颜色照官方规范，见 styles.ts）。
 * 文案全部经 `i18n`（宿主 locale 服务），不自己判语言；错误按 code 翻译
 * （见 errors.ts），host 的原始 message 只进 `title`（排障用）。
 *
 * 稳态开销：只在 `visible` 时取数、不持定时器、重新可见即补刷一次；host 侧还有
 * 60 s 有界缓存，反复切 tab 不会打爆搜索配额。刷新时保留旧内容（stale-while-revalidate），
 * 不再把列表/详情闪成「读取中…」。
 *
 * 可寻址面（也给挂载自检用）：`[data-dsh-pr-inbox-panel]` / `[data-pi-view]` /
 * `[data-bucket]` / `[data-pr-row="<number>"]` / `[data-pi-foot]`；顶栏的搜索框、
 * 密度开关、刷新是官方控件，按 role/aria 名寻址（官方件不接裸 `data-*`）。
 */
import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
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
import { Age, Author, Avatar } from './bits'
import { Detail } from './Detail'
import { errorText, hintFor } from './errors'
import { ageText, avatarUrlOf, matchesQuery, sortRowsForBucket } from './format'
import type { I18n } from './i18n'
import { loadDensity, saveDensity } from './prefs'
import type { Density } from './prefs'

export type { Density } from './prefs'

export interface PanelProps {
  ctx: Context
  i18n: I18n
  sessionId: string
  cwd: string | undefined
  visible: boolean
}

const BUCKETS: readonly BucketKey[] = ['authored', 'review', 'merged']
const BUCKET_LABEL: Record<BucketKey, string> = { authored: 'bucketAuthored', review: 'bucketReview', merged: 'bucketMerged' }
const BUCKET_HINT: Record<BucketKey, string> = { authored: 'hintAuthored', review: 'hintReview', merged: 'hintMerged' }

interface Failure { message: string, code?: string }

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; value: ListValue }
  | ({ phase: 'failed' } & Failure)

interface DetailState {
  loading: boolean
  value?: PrDetailValue
  error?: Failure
}

/** 行本身是可点面（开详情），右侧 ↗ 是官方 Button——用 role/tabIndex 而不是嵌套 button。
 *  按键只处理**行自身**：外链按钮的 Enter/Space 冒泡上来时不能被行劫持。 */
function rowHandlers(onActivate: () => void) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onActivate()
      }
    },
  }
}

function OpenExternal(props: { url: string, label: string }) {
  return createElement(Button, {
    variant: 'ghost', size: 'sm', className: 'pi-external',
    icon: createElement(IconLinkOutlineRegular, {}),
    'aria-label': props.label, title: props.label,
    onClick: (event: ReactMouseEvent) => {
      event.stopPropagation()
      window.open(props.url, '_blank', 'noopener,noreferrer')
    },
  })
}

function notice(key: string, text: string, tone?: 'error' | 'warn', title?: string) {
  return createElement('div', {
    key,
    className: 'pi-notice',
    ...(tone === undefined ? {} : { 'data-tone': tone }),
    ...(title === undefined || title === '' ? {} : { title }),
    'aria-live': 'polite',
  }, text)
}

/**
 * 一行 PR 的固定几何（两种密度共用同一条身份行）：
 *
 *   ◯  #123  标题…                      [草稿]  2 天前  (↗ 悬停才出现)
 *      alice  [合并于…] [标签] [3 条评论]          ← 只有「详细」多出这条事实行
 *
 * 头像在**行首独立列**（两种密度同 x、同宽、同高，与首行中线对齐），身份行的元素
 * 顺序与右边界也完全相同：切换密度只是增删第二条事实行，已有信息一律不跳位。
 * 挂载门用元素坐标钉住这一点（见 scripts/gates/mount.mjs 的「行几何」断言）。
 */
function Row(props: { row: PrRow, density: Density, selected: boolean, onSelect: (row: PrRow) => void, i18n: I18n }) {
  const { row, density, i18n } = props
  const { t, tf } = i18n
  const avatar = avatarUrlOf(row)
  const handlers = rowHandlers(() => { props.onSelect(row) })

  const identity: ReactNode[] = [
    createElement('span', { key: 'n', className: 'pi-num' }, `#${row.number}`),
    createElement('span', { key: 't', className: 'pi-subject', title: row.title }, row.title),
  ]
  if (row.isDraft) identity.push(createElement(Tag, { key: 'd', tone: 'warning' }, t('draft')))
  identity.push(createElement('span', { key: 'g', className: 'pi-age' }, createElement(Age, { iso: row.updatedAt, tf })))
  identity.push(createElement(OpenExternal, { key: 'x', url: row.url, label: t('openOnGitHub') }))
  const lines: ReactNode[] = [createElement('div', { key: 'l1', className: 'pi-line1' }, identity)]

  if (density === 'detailed') {
    const facts: ReactNode[] = [createElement(Author, { key: 'a', login: row.author, withAvatar: false })]
    if (row.mergedAt !== undefined) {
      facts.push(createElement(Tag, { key: 'm', tone: 'info' }, `${t('mergedAt')} ${ageText(tf, row.mergedAt)}`))
    }
    for (const label of row.labels.slice(0, 4)) {
      facts.push(createElement(Tag, { key: `l:${label}`, tone: 'neutral' }, label))
    }
    if (row.labels.length > 4) {
      facts.push(createElement(Tag, { key: 'l+', tone: 'quiet' }, `+${row.labels.length - 4}`))
    }
    if (row.comments > 0) {
      facts.push(createElement(Tag, { key: 'c', tone: 'quiet' }, tf(row.comments === 1 ? 'commentsCountOne' : 'commentsCount', { count: row.comments })))
    }
    lines.push(createElement('div', { key: 'l2', className: 'pi-line2' }, facts))
  }

  return createElement('div', {
    ...handlers,
    className: 'pi-row',
    'data-density': density,
    'data-pr-row': String(row.number),
    'data-selected': props.selected ? 'true' : undefined,
    'aria-current': props.selected ? 'true' : undefined,
    // 简洁档没有独立的事实行，作者名由原生 tooltip 补上（头像已在行首给出作者）。
    ...(density === 'compact' ? { title: `${row.author} · ${ageText(tf, row.updatedAt)}` } : {}),
  }, [
    createElement('span', { key: 'a', className: 'pi-avatarCell' },
      createElement(Avatar, { login: row.author, ...(avatar === undefined ? {} : { url: avatar }) })),
    createElement('div', { key: 'm', className: 'pi-main' }, lines),
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
  const rows = useMemo(
    () => sortRowsForBucket(bucket, (value?.rows ?? []).filter(row => matchesQuery(row, query))),
    [bucket, value, query],
  )
  const total = value?.total ?? 0
  const filtered = query.trim() !== ''
  const count = filtered
    ? tf('hits', { hit: rows.length, total })
    : rows.length < total ? tf('shownOfTotal', { shown: rows.length, total }) : String(total)
  const body: ReactNode[] = []
  if (value?.error !== undefined) {
    body.push(notice('e', errorText(i18n, value.error), 'error', value.error.message))
    const hint = hintFor(i18n, value.error.code)
    if (hint !== undefined) body.push(notice('h', hint))
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
      key: 'h', type: 'button', className: 'pi-sectionHeader', onClick: props.onToggle,
      'aria-expanded': props.open, 'aria-controls': `pi-rows-${bucket}`,
      // 查询限定词不再常显（窄侧栏里它最先挤掉标题），留给原生 tooltip。
      title: t(BUCKET_HINT[bucket]),
    }, [
      createElement('span', { key: 'c', className: 'pi-chevron' }, createElement(IconChevronDownOutlineRegular, { size: 14 })),
      createElement('span', { key: 'l', className: 'pi-sectionLabel' }, t(BUCKET_LABEL[bucket])),
      createElement('span', {
        key: 'n',
        className: 'pi-sectionCount',
        'data-attention': bucket === 'review' && total > 0 ? 'true' : undefined,
        ...(rows.length < total ? { title: tf('shownOfTotalTitle', { shown: rows.length, total }) } : {}),
      }, count),
    ]),
    createElement('div', { key: 'b', className: 'pi-rows', id: `pi-rows-${bucket}` }, body),
  ])
}

export function Panel({ ctx, i18n, sessionId, cwd, visible }: PanelProps) {
  const { t, tf } = i18n
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<Failure | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [density, setDensityState] = useState<Density>(() => loadDensity())
  const [collapsed, setCollapsed] = useState<Partial<Record<BucketKey, boolean>>>({})
  const [selected, setSelected] = useState<number | undefined>(undefined)
  const [open, setOpen] = useState<number | undefined>(undefined)
  const [detail, setDetail] = useState<DetailState>({ loading: false })
  const generation = useRef(0)
  const detailGeneration = useRef(0)
  const cwdRef = useRef<string | undefined>(undefined)
  const stateRef = useRef<LoadState>(state)
  stateRef.current = state
  const rootRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const restoreScroll = useRef<number | undefined>(undefined)
  const focusRow = useRef<number | undefined>(undefined)
  const densityRef = useRef(density)
  densityRef.current = density

  const ensureCwd = useCallback(async (): Promise<string | undefined> => {
    if (cwdRef.current !== undefined) return cwdRef.current
    const resolved = await resolveCwd(ctx, sessionId, cwd)
    cwdRef.current = resolved
    return resolved
  }, [ctx, sessionId, cwd])

  const load = useCallback(async (): Promise<void> => {
    const mine = generation.current + 1
    generation.current = mine
    const keep = stateRef.current.phase === 'ready'
    if (keep) setRefreshing(true)
    else setState({ phase: 'loading' })
    setRefreshError(undefined)
    try {
      const resolved = await ensureCwd()
      if (resolved === undefined) {
        if (mine !== generation.current) return
        const failure: Failure = { message: t('unbound'), code: 'no-cwd' }
        if (keep) setRefreshError(failure)
        else setState({ phase: 'failed', ...failure })
        return
      }
      const value = await callOp<ListValue>(ctx, 'list', { cwd: resolved })
      if (mine === generation.current) setState({ phase: 'ready', value })
    } catch (error) {
      if (mine !== generation.current) return
      const message = error instanceof Error ? error.message : String(error)
      const code = error instanceof RouteError ? error.code : undefined
      const failure: Failure = { message, ...(code === undefined ? {} : { code }) }
      if (keep) setRefreshError(failure)
      else setState({ phase: 'failed', ...failure })
    } finally {
      if (mine === generation.current) setRefreshing(false)
    }
  }, [ctx, ensureCwd, t])

  const loadDetail = useCallback(async (number: number): Promise<void> => {
    const mine = detailGeneration.current + 1
    detailGeneration.current = mine
    // 刷新时保留旧内容（stale-while-revalidate）：只有首次打开才显示空白 + 读取中。
    setDetail(previous => ({ loading: true, ...(previous.value === undefined ? {} : { value: previous.value }) }))
    try {
      const resolved = await ensureCwd()
      if (resolved === undefined) {
        if (mine !== detailGeneration.current) return
        const failure: Failure = { message: t('unbound'), code: 'no-cwd' }
        setDetail(previous => ({ loading: false, ...(previous.value === undefined ? {} : { value: previous.value }), error: failure }))
        return
      }
      const value = await callOp<PrDetailValue>(ctx, 'detail', { cwd: resolved, number })
      if (mine === detailGeneration.current) setDetail({ loading: false, value })
    } catch (error) {
      if (mine !== detailGeneration.current) return
      const message = error instanceof Error ? error.message : String(error)
      const code = error instanceof RouteError ? error.code : undefined
      const failure: Failure = { message, ...(code === undefined ? {} : { code }) }
      setDetail(previous => ({ loading: false, ...(previous.value === undefined ? {} : { value: previous.value }), error: failure }))
    }
  }, [ctx, ensureCwd, t])

  /**
   * 换 session / 换工作区时**必须作废 cwd 缓存**：`cwdRef` 一旦解析就永不复位的话，
   * 同一个组件实例会继续读上一个仓库。顺手把详情收起来（旧 PR 在新仓库里未必存在）。
   */
  useEffect(() => {
    cwdRef.current = undefined
    setSelected(undefined)
    setOpen(undefined)
    setDetail({ loading: false })
  }, [sessionId, cwd])

  const openRow = useCallback((row: PrRow): void => {
    restoreScroll.current = bodyRef.current?.scrollTop ?? 0
    focusRow.current = row.number
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

  /** 打开详情时把焦点送进详情根（键盘用户不会掉到 body 上）；返回时恢复滚动与行焦点。 */
  useLayoutEffect(() => {
    const root = rootRef.current
    if (open !== undefined) {
      const detailRoot = root?.querySelector('[data-dsh-pr-inbox-detail]') as HTMLElement | null
      detailRoot?.focus({ preventScroll: true })
      return
    }
    if (restoreScroll.current !== undefined) {
      if (bodyRef.current !== null) bodyRef.current.scrollTop = restoreScroll.current
      restoreScroll.current = undefined
    }
    if (focusRow.current !== undefined) {
      const row = root?.querySelector(`[data-pr-row="${focusRow.current}"]`) as HTMLElement | null
      row?.focus({ preventScroll: true })
      focusRow.current = undefined
    }
  }, [open])

  /** Esc 返回列表；输入框里的 Esc 交给输入框自己处理。 */
  useEffect(() => {
    if (open === undefined) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      back()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [open, back])

  const chooseDensity = useCallback((next: Density): void => {
    if (densityRef.current === next) return
    setDensityState(next)
    saveDensity(next)
  }, [])

  const ready = state.phase === 'ready' ? state.value : undefined
  const repoTitle = ready?.repo === null || ready?.repo === undefined
    ? t('unboundShort')
    : `${ready.repo.fullName}${ready.repo.remoteName === undefined ? '' : ` (${ready.repo.remoteName})`}`
  const foot = createElement('div', { className: 'pi-foot', 'data-pi-foot': '' }, [
    createElement('span', { key: 'r', className: 'pi-footRepo', title: repoTitle }, ready?.repo?.fullName ?? t('unboundShort')),
    createElement('span', { key: 'm', className: 'pi-footMeta' },
      [
        ready?.gh.login === undefined ? '' : `@${ready.gh.login}`,
        ready === undefined ? '' : `${t('updated')} ${ageText(tf, ready.fetchedAt)}`,
      ].filter(part => part !== '').join(' · ')),
  ])

  if (open !== undefined) {
    return createElement('div', {
      ref: rootRef,
      className: 'pi-root',
      'data-dsh-pr-inbox-panel': '',
      'data-pi-view': 'detail',
      'aria-busy': detail.loading ? 'true' : undefined,
    }, [
      createElement(Detail, {
        detail: detail.value,
        loading: detail.loading,
        error: detail.error,
        i18n,
        ctx,
        cwd: cwdRef.current ?? cwd,
        onBack: back,
        onRefresh: () => { void loadDetail(open) },
      }),
      foot,
    ])
  }

  const head = createElement('div', { className: 'pi-head' }, [
    createElement('span', { key: 's', className: 'pi-search' },
      createElement(Input, {
        icon: createElement(IconSearchOutlineRegular, {}),
        placeholder: t('searchPlaceholder'),
        'aria-label': t('searchPlaceholder'),
        value: query,
        spellCheck: false,
        onChange: (event: { target: { value: string } }) => { setQuery(event.target.value) },
      })),
    createElement('span', { key: 'd', className: 'pi-density', role: 'group', 'aria-label': t('density') }, [
      createElement(Pill, {
        key: 'c', active: density === 'compact', 'aria-pressed': density === 'compact',
        onClick: () => { chooseDensity('compact') },
      }, t('compact')),
      createElement(Pill, {
        key: 'x', active: density === 'detailed', 'aria-pressed': density === 'detailed',
        onClick: () => { chooseDensity('detailed') },
      }, t('detailed')),
    ]),
    createElement(Button, {
      key: 'r', variant: 'toolbar', size: 'sm',
      icon: createElement(IconRefreshOutlineRegular, {}),
      'aria-label': t('refresh'), title: t('refresh'),
      disabled: !visible || refreshing,
      onClick: () => { void load() },
    }),
  ])

  const body: ReactNode[] = []
  if (state.phase === 'failed') {
    body.push(notice('e', errorText(i18n, state), 'error', state.message))
    const hint = hintFor(i18n, state.code)
    if (hint !== undefined) body.push(notice('h', hint))
  } else if (state.phase === 'loading') {
    body.push(createElement('div', { key: 'l', className: 'pi-empty', role: 'status', 'aria-live': 'polite' }, t('reading')))
  } else {
    const value = state.value
    if (refreshError !== undefined) {
      body.push(notice('re', errorText(i18n, refreshError), 'warn', refreshError.message))
      const hint = hintFor(i18n, refreshError.code)
      if (hint !== undefined) body.push(notice('reh', hint))
    }
    if (value.gh.available !== true) {
      body.push(notice('g', errorText(i18n, { code: value.gh.code ?? 'gh-missing', message: value.gh.error }), 'error', value.gh.error))
      const hint = hintFor(i18n, value.gh.code ?? 'gh-missing')
      if (hint !== undefined) body.push(notice('gh', hint))
    } else {
      if (value.gh.login === undefined) {
        body.push(notice('g', errorText(i18n, { code: value.gh.code ?? 'gh-unauthenticated', message: value.gh.error }), 'error', value.gh.error))
        const hint = hintFor(i18n, value.gh.code ?? 'gh-unauthenticated')
        if (hint !== undefined) body.push(notice('h', hint))
      }
      if (value.repo === null) {
        body.push(notice('r', t('unbound'), 'warn'))
      } else if (value.repo.host !== 'github.com') {
        body.push(notice('n', tf('unsupportedHost', { host: value.repo.host }), 'warn'))
      }
      if (value.repo !== null && value.repo.host === 'github.com') {
        for (const bucket of BUCKETS) {
          body.push(createElement(Section, {
            key: bucket, bucket, value: value.buckets[bucket], query, density, i18n,
            open: collapsed[bucket] !== true,
            onToggle: () => { setCollapsed(previous => ({ ...previous, [bucket]: previous[bucket] !== true })) },
            selected, onSelect: openRow,
          }))
        }
      }
    }
  }

  return createElement('div', {
    ref: rootRef,
    className: 'pi-root',
    'data-dsh-pr-inbox-panel': '',
    'data-refreshing': refreshing ? 'true' : undefined,
    'aria-busy': state.phase === 'loading' || refreshing ? 'true' : undefined,
  },
  head,
  createElement('div', { key: 'b', className: 'pi-body', ref: bodyRef }, body),
  foot)
}
