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
  tf: (key: string, params?: Record<string, string | number>) => string
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
  tabDescription: '本项目 Pull Request：我提的 / 待我审 / 我合并的',
  searchPlaceholder: '搜索标题 / 编号 / 作者 / 标签…',
  refresh: '刷新',
  reading: '读取中…',
  compact: '简洁',
  detailed: '详细',
  bucketAuthored: '我提的',
  bucketReview: '待我审',
  bucketMerged: '我合并的',
  hintAuthored: '你作者、仍在开启的 PR',
  hintReview: '等你 review 的 PR',
  hintMerged: '你合并的最近 20 条（按合并时间倒序）',
  bucketEmpty: '这个桶暂时是空的',
  noMatch: '没有匹配的 PR',
  hits: '命中 {hit} / {total}',
  shownOfTotal: '{shown} / {total}',
  shownOfTotalTitle: '已加载 {shown} 条，共 {total} 条',
  density: '列表密度',
  draft: '草稿',
  open: '开放',
  closed: '已关闭',
  merged: '已合并',
  mergedAt: '合并于',
  updated: '更新于',
  justNow: '刚刚',
  minutesAgo: '{n} 分钟前',
  hoursAgo: '{n} 小时前',
  daysAgo: '{n} 天前',
  monthsAgo: '{n} 个月前',
  yearsAgo: '{n} 年前',
  comments: '评论',
  commentsCount: '{count} 条评论',
  commentsCountOne: '{count} 条评论',
  unbound: '当前工作区不是 git 仓库，或者它的 remote 解析不出 forge 项目（upstream / origin → github.com/owner/repo）。',
  unboundShort: '未绑定项目',
  openOnGitHub: '在 GitHub 打开',
  back: '返回列表',
  emptyBody: '（没有正文）',
  bodyTruncated: '正文过长，已截断显示。',
  timeline: '评论与评审',
  noTimeline: '还没有评论',
  timelineTruncated: '时间线过长，只显示前一部分（最早的）。',
  filesTitle: '改动文件',
  filesTruncated: '文件过多，只显示前一部分。',
  noFiles: '没有文件信息',
  files: '{count} 个文件',
  filesOne: '{count} 个文件',
  commits: '{count} 次提交',
  commitsOne: '{count} 次提交',
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
  warningFiles: '文件清单',
  warningComments: '评论',
  warningReviews: '评审',
  unsupportedHost: '当前只支持 github.com（这个工作区绑定的是 {host}）。',
  errGhMissing: '找不到 GitHub CLI。',
  errGhUnauthenticated: '本机 gh 未登录。',
  errGhRateLimit: '触达 GitHub API 速率上限。',
  errGhTimeout: '本机 gh 响应超时。',
  errNotFound: '找不到这个 PR（已删除或没有权限）。',
  errGhBadOutput: 'gh 返回了无法解析的输出。',
  errGhFailed: 'gh 命令失败。',
  errBadRequest: '请求参数不合法。',
  errUnsupportedHost: '当前只支持 github.com。',
  errNoRepo: '当前工作区没有可识别的 forge 项目。',
  errTooLarge: '文件超过本插件允许的大小。',
  errUnsupportedType: '只支持图片。',
  errMethodNotAllowed: '请求方法不允许。',
  errUnknownOp: '未知操作。',
  errInternal: '插件内部错误。',
  errForbidden: '跨站请求被拒绝。',
  errUnknown: '读取失败。',
  hintGhMissing: '安装 GitHub CLI（https://cli.github.com）后执行 `gh auth login`。',
  hintGhUnauthenticated: '执行 `gh auth login` 登录后再刷新。',
  hintGhRateLimit: '已认证搜索配额是 30 次/分，等一分钟再试。',
  hintGhTimeout: '检查网络/代理后重试。',
  hintCwd: '先在该会话里打开一个文件或产生一次工具调用，让会话确定工作目录。',
}

const en: Record<string, string> = {
  tabTitle: 'PR',
  tabDescription: 'Pull requests of this project: authored by me / needs my review / merged by me',
  searchPlaceholder: 'Search title / number / author / label…',
  refresh: 'Refresh',
  reading: 'Loading…',
  compact: 'Compact',
  detailed: 'Detailed',
  bucketAuthored: 'Authored by me',
  bucketReview: 'Needs my review',
  bucketMerged: 'Merged by me',
  hintAuthored: 'PRs you authored that are still open',
  hintReview: 'PRs awaiting your review',
  hintMerged: 'The 20 most recent PRs you merged (newest merge first)',
  bucketEmpty: 'Nothing in this bucket yet',
  noMatch: 'No matching PRs',
  hits: '{hit} / {total} shown',
  shownOfTotal: '{shown} / {total}',
  shownOfTotalTitle: '{shown} loaded of {total}',
  density: 'List density',
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  merged: 'Merged',
  mergedAt: 'merged',
  updated: 'updated',
  justNow: 'just now',
  minutesAgo: '{n} min ago',
  hoursAgo: '{n} hr ago',
  daysAgo: '{n} d ago',
  monthsAgo: '{n} mo ago',
  yearsAgo: '{n} y ago',
  comments: 'comments',
  commentsCount: '{count} comments',
  commentsCountOne: '{count} comment',
  unbound: 'This workspace is not a git repository, or its remote does not resolve to a forge project (upstream / origin → github.com/owner/repo).',
  unboundShort: 'no project',
  openOnGitHub: 'Open on GitHub',
  back: 'Back to list',
  emptyBody: '(no description)',
  bodyTruncated: 'Description was long; shown truncated.',
  timeline: 'Comments and reviews',
  noTimeline: 'No comments yet',
  timelineTruncated: 'Timeline is long; only the earliest part is shown.',
  filesTitle: 'Changed files',
  filesTruncated: 'Too many files; only the first part is shown.',
  noFiles: 'No file information',
  files: '{count} files',
  filesOne: '{count} file',
  commits: '{count} commits',
  commitsOne: '{count} commit',
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
  warningFiles: 'Files',
  warningComments: 'Comments',
  warningReviews: 'Reviews',
  unsupportedHost: 'Only github.com is supported (this workspace is bound to {host}).',
  errGhMissing: 'GitHub CLI not found.',
  errGhUnauthenticated: 'The local gh is not logged in.',
  errGhRateLimit: 'GitHub API rate limit reached.',
  errGhTimeout: 'The local gh timed out.',
  errNotFound: 'PR not found (deleted or no access).',
  errGhBadOutput: 'gh returned unparsable output.',
  errGhFailed: 'gh command failed.',
  errBadRequest: 'Invalid request.',
  errUnsupportedHost: 'Only github.com is supported.',
  errNoRepo: 'This workspace is not a recognised forge project.',
  errTooLarge: 'File exceeds this plugin\'s size limit.',
  errUnsupportedType: 'Only images are supported.',
  errMethodNotAllowed: 'Method not allowed.',
  errUnknownOp: 'Unknown operation.',
  errInternal: 'Internal plugin error.',
  errForbidden: 'Cross-site request rejected.',
  errUnknown: 'Request failed.',
  hintGhMissing: 'Install GitHub CLI (https://cli.github.com), then run `gh auth login`.',
  hintGhUnauthenticated: 'Run `gh auth login`, then refresh.',
  hintGhRateLimit: 'Authenticated search quota is 30/min; wait a minute and retry.',
  hintGhTimeout: 'Check your network/proxy and retry.',
  hintCwd: 'Open a file or run a tool call in this session so it has a working directory.',
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