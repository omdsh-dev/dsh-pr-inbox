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
    }