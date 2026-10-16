/**
 * PR 面板。阶段一：绑定当前工作区 + gh 环境自检（把 host 通路与「这个会话是哪个
 * 项目」跑通）；三桶列表 / 搜索 / 简洁·详细 / 详情渲染在阶段二接入本组件的
 * `dsh-pr-inbox__body`。
 *
 * 稳态开销（照 better-sidebar 的硬约束）：只在 `visible` 时取数、不持有定时器、
 * 每次可见即刷新；阶段二加轮询时同样按可见性门控。
 */
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { StatusValue } from '../shared/types'
import { RouteError, callOp, resolveCwd } from './api'

export interface PanelProps {
  ctx: Context
  sessionId: string
  cwd: string | undefined
  visible: boolean
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; value: StatusValue }
  | { phase: 'failed'; message: string; code?: string }

/** gh 相关的失败给一句「怎么办」，而不是把英文 stderr 原样抛给用户。 */
const GH_HINT: Record<string, string> = {
  'gh-missing': '安装 GitHub CLI（https://cli.github.com）后执行 `gh auth login`。',
  'gh-unauthenticated': '执行 `gh auth login` 登录后再刷新。',
  'gh-rate-limit': '触达 GitHub API 速率上限，稍后重试（已认证为 30 次/分）。',
  'gh-timeout': '本机 gh 响应超时，检查网络后重试。',
  'no-cwd': '先在该会话里打开一个文件或产生一次工具调用，让会话确定工作目录。',
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return createElement('div', { className: 'dsh-pr-inbox__kv' }, [
    createElement('b', { key: 'l' }, label),
    createElement('span', { key: 'v', className: mono ? 'dsh-pr-inbox__mono' : undefined }, value),
  ])
}

function Card({ title, children }: { title: string; children?: ReactNode }) {
  return createElement('section', { className: 'dsh-pr-inbox__card' }, [
    createElement('div', { key: 't', className: 'dsh-pr-inbox__card-title' }, title),
    ...(Array.isArray(children) ? children : [children]),
  ])
}

export function Panel({ ctx, sessionId, cwd, visible }: PanelProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
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
      const value = await callOp<StatusValue>(ctx, 'status', { cwd: resolved })
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
  const repo = ready?.repo ?? undefined
  const gh = ready?.gh

  const bar = createElement('div', { className: 'dsh-pr-inbox__bar' }, [
    createElement('span', { key: 'r', className: 'dsh-pr-inbox__repo dsh-pr-inbox__grow' },
      repo === undefined ? (state.phase === 'loading' ? 'PR · 读取中…' : 'PR · 未绑定项目') : repo.fullName),
    createElement('span', { key: 'g', className: 'dsh-pr-inbox__meta' },
      gh?.login !== undefined ? `@${gh.login}` : (gh?.available === true ? '未登录' : '')),
    createElement('button', {
      key: 'refresh', type: 'button', className: 'dsh-pr-inbox__button',
      disabled: state.phase === 'loading' || !visible, onClick: () => { void load() },
      title: '刷新',
    }, '刷新'),
  ])

  const body: ReturnType<typeof createElement>[] = []
  if (state.phase === 'loading') {
    body.push(createElement('div', { key: 'l', className: 'dsh-pr-inbox__empty' }, '读取中…'))
  } else if (state.phase === 'failed') {
    body.push(createElement('div', { key: 'e', className: 'dsh-pr-inbox__alert', 'data-tone': 'error' }, state.message))
    const hint = state.code === undefined ? undefined : GH_HINT[state.code]
    if (hint !== undefined) body.push(createElement('div', { key: 'h', className: 'dsh-pr-inbox__muted' }, hint))
  } else {
    const value = state.value
    if (value.repo === null) {
      body.push(createElement('div', { key: 'n', className: 'dsh-pr-inbox__alert' },
        '当前工作区不是 git 仓库，或者它的 remote 解析不出 forge 项目（需要形如 origin → github.com/owner/repo）。'))
    } else {
      body.push(createElement(Card, { key: 'repo', title: '绑定的项目' }, [
        createElement(Row, { key: 'a', label: '仓库', value: value.repo.fullName, mono: true }),
        createElement(Row, { key: 'b', label: 'Remote', value: value.repo.remoteUrl, mono: true }),
        createElement(Row, { key: 'c', label: '仓库根', value: value.repo.root, mono: true }),
      ]))
    }
    const ghCard: ReturnType<typeof createElement>[] = []
    if (!value.gh.available) {
      ghCard.push(createElement('div', { key: 'x', className: 'dsh-pr-inbox__alert', 'data-tone': 'error' },
        value.gh.error ?? '本机没有可用的 gh CLI'))
      ghCard.push(createElement('div', { key: 'y', className: 'dsh-pr-inbox__muted' }, GH_HINT['gh-missing']!))
    } else {
      ghCard.push(createElement(Row, { key: 'v', label: '版本', value: value.gh.version ?? '未知', mono: true }))
      ghCard.push(createElement(Row, { key: 'a', label: '账号', value: value.gh.login ?? '未登录' }))
      if (value.gh.error !== undefined) {
        const hint = value.gh.code === undefined ? undefined : GH_HINT[value.gh.code]
        ghCard.push(createElement('div', { key: 'e', className: 'dsh-pr-inbox__alert' }, value.gh.error))
        if (hint !== undefined) ghCard.push(createElement('div', { key: 'h', className: 'dsh-pr-inbox__muted' }, hint))
      }
    }
    body.push(createElement(Card, { key: 'gh', title: '本机 gh' }, ghCard))
    body.push(createElement('div', { key: 'next', className: 'dsh-pr-inbox__muted' },
      '阶段一：绑定与自检已通。下一步：三桶列表（我提的 / 待我审 / 最近合并）、顶部搜索、简洁·详细切换、PR 详情原生渲染。'))
  }

  return createElement('div', { className: 'dsh-pr-inbox', 'data-dsh-pr-inbox-panel': '' },
    bar,
    createElement('div', { className: 'dsh-pr-inbox__body' }, body))
}