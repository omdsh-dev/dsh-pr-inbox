/**
 * 客户端字典：面板所有文案走宿主 locale 服务（`ctx.locale.register`），跟随 DSH
 * 的语言偏好实时切换——这是 make-dsh-plugin 的 i18n 纪律（插件不自己判语言、
 * 不依赖宿主内部 `t()`）。服务缺失时（老宿主 / 服务改名）退回浏览器语言兜底，
 * 面板仍然可用，只是不跟随偏好。
 */
export interface I18n {
  /** 取一条文案；缺键回退到兜底表，再缺就原样返回 key（便于发现漏翻）。 */
  t: (key: string) => string
  /** 带 `{name}` 占位符的文案。 */
  tf: (key: string, params: Record<string, string | number>) => string
  dispose: () => void
}

interface LocaleService {
  register: (namespace: string, language: string, dict: Record<string, string>) => () => void
  /** `bind(ns)` 返回该命名空间的取词函数（引用稳定；调用时读当前语言）。 */
  bind: (namespace: string) => Translate
}

/** 与 `@deepseek-ai/dsh-client-ui-slots` 的 `Translate` 同形：`(key, params?) => string`。 */
type Translate = (key: string, params?: Record<string, unknown>) => string

const NS = 'dsh-pr-inbox'

const zh: Record<string, string> = {
  tabTitle: 'PR',
  tabDescription: '本项目 Pull Request：我提的 / 待我审 / 最近合并',
  searchPlaceholder: '搜索标题 / 编号 / 作者 / 标签…',
  refresh: '刷新',
  reading: '读取中…',
  compact: '简洁',
  detailed: '详细',
  bucketAuthored: '我提的',
  bucketReview: '待我审',
  bucketMerged: '最近合并',
  hintAuthored: 'author:@me',
  hintReview: 'review-requested:@me',
  hintMerged: 'is:merged · 最近 20',
  bucketEmpty: '这个桶暂时是空的',
  noMatch: '没有匹配的 PR',
  hits: '命中 {hit} / {total}',
  draft: '草稿',
  open: '开放',
  closed: '已关闭',
  merged: '已合并',
  mergedAt: '合并于',
  updated: '更新于',
  comments: '评论',
  commentsCount: '{count} 条评论',
  unbound: '当前工作区不是 git 仓库，或者它的 remote 解析不出 forge 项目（需要形如 origin → github.com/owner/repo）。',
  unboundShort: '未绑定项目',
  openOnGitHub: '在 GitHub 打开',
  back: '返回列表',
  emptyBody: '（没有正文）',
  bodyTruncated: '正文过长，已截断显示。',
  timeline: '评论与评审',
  noTimeline: '还没有评论',
  timelineTruncated: '时间线过长，只显示最近的一部分。',
  filesTitle: '改动文件',
  filesTruncated: '文件过多，只显示前一部分。',
  files: '{count} 个文件',
  commits: '{count} 次提交',
  added: '新增',
  removed: '删除',
  modified: '修改',
  renamed: '改名',
  copied: '复制',
  changed: '改动',
  unchanged: '未变',
  reviewApproved: '已批准',
  reviewChangesRequested: '要求修改',
  reviewCommented: '评论',
  reviewDismissed: '已忽略',
  reviewPending: '待处理',
  copy: '复制',
  copiedLabel: '已复制',
  codeLabel: '代码',
  wrapLabel: '换行',
  unwrapLabel: '不换行',
  footnotes: '脚注',
}

const en: Record<string, string> = {
  tabTitle: 'PR',
  tabDescription: 'Pull requests of this project: authored by me / needs my review / recently merged',
  searchPlaceholder: 'Search title / number / author / label…',
  refresh: 'Refresh',
  reading: 'Loading…',
  compact: 'Compact',
  detailed: 'Detailed',
  bucketAuthored: 'Authored by me',
  bucketReview: 'Needs my review',
  bucketMerged: 'Recently merged',
  hintAuthored: 'author:@me',
  hintReview: 'review-requested:@me',
  hintMerged: 'is:merged · last 20',
  bucketEmpty: 'Nothing in this bucket yet',
  noMatch: 'No matching PRs',
  hits: '{hit} / {total} shown',
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  merged: 'Merged',
  mergedAt: 'merged',
  updated: 'updated',
  comments: 'comments',
  commentsCount: '{count} comments',
  unbound: 'This workspace is not a git repository, or its remote does not resolve to a forge project (origin → github.com/owner/repo).',
  unboundShort: 'no project',
  openOnGitHub: 'Open on GitHub',
  back: 'Back to list',
  emptyBody: '(no description)',
  bodyTruncated: 'Description was long; shown truncated.',
  timeline: 'Comments and reviews',
  noTimeline: 'No comments yet',
  timelineTruncated: 'Timeline is long; only the most recent part is shown.',
  filesTitle: 'Changed files',
  filesTruncated: 'Too many files; only the first part is shown.',
  files: '{count} files',
  commits: '{count} commits',
  added: 'added',
  removed: 'removed',
  modified: 'modified',
  renamed: 'renamed',
  copied: 'copied',
  changed: 'changed',
  unchanged: 'unchanged',
  reviewApproved: 'approved',
  reviewChangesRequested: 'changes requested',
  reviewCommented: 'commented',
  reviewDismissed: 'dismissed',
  reviewPending: 'pending',
  copy: 'Copy',
  copiedLabel: 'Copied',
  codeLabel: 'Code',
  wrapLabel: 'Wrap',
  unwrapLabel: 'No wrap',
  footnotes: 'Footnotes',
}

function browserIsChinese(): boolean {
  if (typeof navigator === 'undefined') return false
  return (navigator.language ?? '').toLowerCase().startsWith('zh')
}

/**
 * 注册本插件的字典并给出一对取词函数。
 * @param ctx - client cordis context（用结构化探测取 `locale`，不写进 inject 的强依赖）。
 */
export function createI18n(ctx: unknown): I18n {
  const get = (ctx as { get?: (name: string) => unknown }).get
  const service = (typeof get === 'function' ? get.call(ctx, 'locale') : undefined) as Partial<LocaleService> | undefined
  const disposers: (() => void)[] = []
  let bound: Translate | undefined
  if (typeof service?.register === 'function') {
    try {
      disposers.push(service.register(NS, 'zh', zh), service.register(NS, 'en', en))
      // 取词走 `bind(ns)`：返回的函数引用稳定（可为 memo 依赖）、调用时读当前语言。
      // 注意 `lookup` 是 LocaleRuntime 的私有方法，签名是 (key, params, chain) ——
      // 外部照 `lookup(ns, key)` 调会把第二个参数当 chain 遍历，抛
      // `TypeError: chain is not iterable`。
      bound = typeof service.bind === 'function' ? service.bind(NS) : undefined
    } catch {
      // 服务形状不符（跨 rc 改名）：退回浏览器语言兜底，面板照常可用。
      bound = undefined
    }
  }
  const fallback = browserIsChinese() ? zh : en
  const local = (key: string, params?: Record<string, unknown>): string => {
    let text = fallback[key] ?? en[key] ?? key
    if (params !== undefined) {
      for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  }
  /**
   * 取词**永不抛**。宿主会把我们的函数放进它自己的渲染路径（tab 标题、原生芯片、
   * 槽内容），在里面抛一次就会带崩整块 UI —— 实测一次 `lookup` 签名写错导致
   * `slot entry crashed in 'sidebar.right.pane.tab'`，整个原生右栏渲染不出来。
   */
  const safe = (key: string, params?: Record<string, unknown>): string => {
    if (bound !== undefined) {
      try {
        const text = bound(key, params)
        if (typeof text === 'string' && text !== '') return text
      } catch {
        // 落到本地表：语言的实时性让位于「面板必须能渲染」。
      }
    }
    return local(key, params)
  }
  return {
    t: key => safe(key),
    tf: (key, params) => safe(key, params as Record<string, unknown>),
    dispose: () => { for (const off of disposers) off() },
  }
}