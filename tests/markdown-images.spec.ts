/**
 * `expandHtmlImages` 的口径：只动代码段之外的 `<img>`。
 *
 * 钉住的是三类**很容易改错**的输入：代码里讲的 img 标签、属性写法变体
 * （单引号 / 裸值 / 属性顺序 / `data-src`）、以及实体与带空格的地址。
 */
import { describe, expect, it } from 'vitest'
import { expandHtmlImages } from '../src/client/markdown-images'

describe('expandHtmlImages', () => {
  it('把 GitHub 编辑器那种 img 标签改写成 markdown 图片', () => {
    const body = '<img width="1152" height="1162" alt="image" src="https://github.com/user-attachments/assets/abc" />'
    expect(expandHtmlImages(body)).toBe('![image](https://github.com/user-attachments/assets/abc)')
  })

  it('属性顺序、单引号、裸值、无 alt 都要认', () => {
    expect(expandHtmlImages('<img src="a.png" alt="图" />')).toBe('![图](a.png)')
    expect(expandHtmlImages("<img alt='shot' src='docs/shot.png'>")).toBe('![shot](docs/shot.png)')
    expect(expandHtmlImages('<img src=docs/bare.png>')).toBe('![](docs/bare.png)')
    expect(expandHtmlImages('<IMG SRC="upper.png">')).toBe('![](upper.png)')
  })

  it('代码段里的 img 标签原样保留（围栏与行内反引号）', () => {
    const fenced = ['```html', '<img src="keep.png">', '```'].join('\n')
    expect(expandHtmlImages(fenced)).toBe(fenced)
    const tilde = ['~~~', '<img src="keep.png">', '~~~'].join('\n')
    expect(expandHtmlImages(tilde)).toBe(tilde)
    expect(expandHtmlImages('行内：`<img src="keep.png">` 结束')).toBe('行内：`<img src="keep.png">` 结束')
  })

  it('围栏结束后恢复改写', () => {
    const body = ['```', '<img src="a.png">', '```', '', '<img src="b.png">'].join('\n')
    expect(expandHtmlImages(body)).toBe(['```', '<img src="a.png">', '```', '', '![](b.png)'].join('\n'))
  })

  it('实体解码与需要包裹的地址', () => {
    expect(expandHtmlImages('<img src="https://img.shields.io/badge/x?a=1&amp;b=2">'))
      .toBe('![](https://img.shields.io/badge/x?a=1&b=2)')
    expect(expandHtmlImages('<img src="docs/my shot.png">')).toBe('![](<docs/my shot.png>)')
  })

  it('不含 img 的正文原样返回；`data-src` 不算 src；没有 src 就不动', () => {
    const plain = '# 标题\n\n![已有](a.png)\n'
    expect(expandHtmlImages(plain)).toBe(plain)
    expect(expandHtmlImages('<img data-src="lazy.png">')).toBe('<img data-src="lazy.png">')
    expect(expandHtmlImages('<img alt="无地址">')).toBe('<img alt="无地址">')
  })

  it('alt 里的方括号被剔除（否则截断 markdown 语法）', () => {
    expect(expandHtmlImages('<img alt="a[b]" src="x.png">')).toBe('![ab](x.png)')
  })
})