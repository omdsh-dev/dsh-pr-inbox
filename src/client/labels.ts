/**
 * 面板文案。消费插件不该依赖 better-sidebar 内部的 `t()`（指南 §10），所以这里
 * 自带一份极小双语表。
 *
 * 语言按 `navigator.language` 在**模块求值期**选一次：足够覆盖中文/其它两种，
 * 但不跟随宿主 `ctx.locale` 的实时切换（要跟随得把宿主 locale 服务 inject 进来，
 * 留到接入设置页那一批一起做）。
 */
const zh = typeof navigator !== 'undefined' && (navigator.language ?? '').toLowerCase().startsWith('zh')

export interface Labels {
  refresh: string
  reading: string
  search: string
  compact: string
  detailed: string
  noMatch: string
  bucketEmpty: string
  openOnGitHub: string
  draft: string
  comments: string
  mergedAt: string
  updated: string
  unbound: string
  unboundShort: string
  hits: (hit: number, total: number) => string
  bucket: Record<string, string>
  bucketHint: Record<string, string>
  /** ── 详情视图 ─────────────────────────────────────────────────────── */
  back: string
  open: string
  closed: string
  merged: string
  emptyBody: string
  bodyTruncated: string
  timeline: string
  noTimeline: string
  timelineTruncated: string
  filesTitle: string
  filesTruncated: string
  files: (count: number) => string
  commits: (count: number) => string
  fileStatus: Record<string, string>
  reviewState: Record<string, string>
}

export const L: Labels = zh
  ? {
      refresh: '刷新',
      reading: '读取中…',
      search: '搜索标题 / 编号 / 作者 / 标签…',
      compact: '简洁',
      detailed: '详细',
      noMatch: '没有匹配的 PR',
      bucketEmpty: '这个桶暂时是空的',
      openOnGitHub: '在 GitHub 打开',
      draft: '草稿',
      comments: '评论',
      mergedAt: '合并于',
      updated: '更新于',
      unbound: '当前工作区不是 git 仓库，或者它的 remote 解析不出 forge 项目（需要形如 origin → github.com/owner/repo）。',
      unboundShort: '未绑定项目',
      hits: (hit, total) => `命中 ${hit} / ${total}`,
      bucket: { authored: '我提的', review: '待我审', merged: '最近合并' },
      bucketHint: { authored: 'author:@me', review: 'review-requested:@me', merged: 'is:merged · 最近 20' },
      back: '返回列表',
      open: '开放',
      closed: '已关闭',
      merged: '已合并',
      emptyBody: '（没有正文）',
      bodyTruncated: '正文过长，已截断显示。',
      timeline: '评论与评审',
      noTimeline: '还没有评论',
      timelineTruncated: '时间线过长，只显示最近的一部分。',
      filesTitle: '改动文件',
      filesTruncated: '文件过多，只显示前一部分。',
      files: count => `${count} 个文件`,
      commits: count => `${count} 次提交`,
      fileStatus: { added: '新增', removed: '删除', modified: '修改', renamed: '改名', copied: '复制', changed: '改动', unchanged: '未变' },
      reviewState: { APPROVED: '已批准', CHANGES_REQUESTED: '要求修改', COMMENTED: '评论', DISMISSED: '已忽略', PENDING: '待处理' },
    }
  : {
      refresh: 'Refresh',
      reading: 'Loading…',
      search: 'Search title / number / author / label…',
      compact: 'Compact',
      detailed: 'Detailed',
      noMatch: 'No matching PRs',
      bucketEmpty: 'Nothing in this bucket yet',
      openOnGitHub: 'Open on GitHub',
      draft: 'Draft',
      comments: 'comments',
      mergedAt: 'merged',
      updated: 'updated',
      unbound: 'This workspace is not a git repository, or its remote does not resolve to a forge project (origin → github.com/owner/repo).',
      unboundShort: 'no project',
      hits: (hit, total) => `${hit} / ${total} shown`,
      bucket: { authored: 'Authored by me', review: 'Needs my review', merged: 'Recently merged' },
      bucketHint: { authored: 'author:@me', review: 'review-requested:@me', merged: 'is:merged · last 20' },
      back: 'Back to list',
      open: 'Open',
      closed: 'Closed',
      merged: 'Merged',
      emptyBody: '(no description)',
      bodyTruncated: 'Description was long; shown truncated.',
      timeline: 'Comments and reviews',
      noTimeline: 'No comments yet',
      timelineTruncated: 'Timeline is long; only the most recent part is shown.',
      filesTitle: 'Changed files',
      filesTruncated: 'Too many files; only the first part is shown.',
      files: count => `${count} file${count === 1 ? '' : 's'}`,
      commits: count => `${count} commit${count === 1 ? '' : 's'}`,
      fileStatus: { added: 'added', removed: 'removed', modified: 'modified', renamed: 'renamed', copied: 'copied', changed: 'changed', unchanged: 'unchanged' },
      reviewState: { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', COMMENTED: 'commented', DISMISSED: 'dismissed', PENDING: 'pending' },
    }