/**
 * 把正文里的原始 `<img>` 标签改写成 markdown 图片语法。
 *
 * **为什么必须做这一步**（实测，见 docs/engineering-notes.md）：
 *
 * 1. 官方 `MarkdownText` 是「不可信 assistant markdown」渲染器，**原始 HTML 一律不渲染**
 *    （块级 `html` 节点没有对应渲染分支 → 被丢掉；行内 `html` 只以字面文本出现）。
 *    这是它的安全设计，不是 bug。
 * 2. 但 **GitHub 自己的编辑器插入的图片恰恰是 HTML**：拖一张图进 PR 描述会写成
 *    `<img width="1152" height="1162" alt="image" src="https://github.com/user-attachments/assets/…">`。
 *    于是 PR 正文里最常见的图片形态，在官方渲染器下**必然消失**——用户看到的就是
 *    "PR 内容里的图片渲染不出来"。
 * 3. 官方对图片地址的白名单只认绝对 `http(s)/blob/data`（`vocabularyImageUrl`），
 *    或 `pathImages.resolve` 返回的、能被 `new URL()` 解析成上述协议的地址。改写出来的
 *    目标地址原样交给官方渲染器：绝对 URL 直接渲染，仓库内相对路径走 `pathImages`
 *    → 插件自己的图片代理（受限网络下 raw.githubusercontent.com 不可达，私有仓库也要代理）。
 *
 * 改写是**有界**的，只动代码段之外的 `<img …>`：
 * 围栏代码块（``` / ~~~）、行内反引号串里的内容一律原样保留——文档里讲"怎么写 img 标签"
 * 不能被改写。`width`/`height` 属性丢弃：markdown 没有尺寸语法，官方 `.image` 样式
 * 本身就是 `max-width: 100%`（窄侧栏里按容器缩放才是想要的）。
 */

/** HTML 实体解码：只处理标记语言里会真正出现的那几个（正文里的 URL 常见 `&amp;`）。 */
function decodeEntities(value: string): string {
  return value
    .replace(/&(?:amp|#38);/gi, '&')
    .replace(/&(?:lt|#60);/gi, '<')
    .replace(/&(?:gt|#62);/gi, '>')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39|#x27);/gi, "'")
    .replace(/&(?:nbsp|#160);/gi, ' ')
}

/** 取一个属性值：双引号 / 单引号 / 裸值三种写法；只认独立的属性名（`src` 不匹配 `data-src`）。 */
function attribute(tag: string, name: string): string | undefined {
  const boundary = `(?:^|[\\s"'])${name}\\s*=\\s*`
  const patterns = [`${boundary}"([^"]*)"`, `${boundary}'([^']*)'`, `${boundary}([^\\s>]+)`]
  for (const pattern of patterns) {
    const match = new RegExp(pattern, 'i').exec(tag)
    if (match?.[1] !== undefined) return decodeEntities(match[1])
  }
  return undefined
}

/** 一个 `<img …>` 标签 → markdown 图片；取不到 src 就原样返回（交给官方当作原始 HTML 丢掉）。 */
function toMarkdownImage(tag: string): string {
  const src = attribute(tag, 'src')
  if (src === undefined || src === '') return tag
  // 标题里不能有方括号（会截断语法）；目标地址含空白或圆括号时用尖括号包裹。
  const alt = (attribute(tag, 'alt') ?? '').replace(/[[\]]/g, '')
  const destination = /[\s()]/.test(src) ? `<${src}>` : src
  return `![${alt}](${destination})`
}

/** 一行里**代码段之外**的 `<img …>` 改写成 markdown（反引号串里的原样保留）。 */
function rewriteLine(line: string): string {
  let out = ''
  let index = 0
  let open: string | undefined
  while (index < line.length) {
    if (open === undefined) {
      const image = /<img\b[^>]*>/i.exec(line.slice(index))
      const imageAt = image === null ? -1 : index + image.index
      const tick = line.indexOf('`', index)
      if (imageAt !== -1 && (tick === -1 || imageAt < tick)) {
        const tag = image![0]
        out += toMarkdownImage(tag)
        index = imageAt + tag.length
        continue
      }
      if (tick === -1) { out += line.slice(index); break }
      const run = /^`+/.exec(line.slice(tick))![0]
      out += line.slice(index, tick) + run
      open = run
      index = tick + run.length
      continue
    }
    const close = line.indexOf(open, index)
    if (close === -1) { out += line.slice(index); break }
    out += line.slice(index, close + open.length)
    index = close + open.length
    open = undefined
  }
  return out
}

/** 正文 / 评论的正文：把原始 `<img>` 改写成官方渲染器认识的 markdown 图片。 */
export function expandHtmlImages(markdown: string): string {
  if (!/<img\b/i.test(markdown)) return markdown
  let fence: string | undefined
  return markdown
    .split('\n')
    .map(line => {
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
      if (fenceMatch !== null) {
        const marker = fenceMatch[1]![0]!
        if (fence === undefined) { fence = marker; return line }
        if (marker === fence) { fence = undefined; return line }
        return line
      }
      return fence === undefined ? rewriteLine(line) : line
    })
    .join('\n')
}