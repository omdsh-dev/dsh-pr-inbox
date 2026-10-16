import { describe, expect, it } from 'vitest'
import { resolvePrImagePath } from '../src/client/pr-image'

const repo = { host: 'github.com', owner: 'omdsh-dev', name: 'DSH-better-sidebar' }
const cwd = '/Users/vlln/Project/dsh-plugins/DSH-better-sidebar'
const ref = 'refs/pull/969/head'

/** 取 query 里的参数（URLSearchParams 会把 `/` 编成 %2F，这里解回来断言语义）。 */
function paramsOf(relative: string): URLSearchParams {
  return new URLSearchParams(relative.slice(relative.indexOf('?') + 1))
}

describe('resolvePrImagePath', () => {
  it('rewrites repo-relative destinations into the proxy route', () => {
    const relative = resolvePrImagePath('./docs/preview/shot.png', repo, ref, cwd)
    expect(relative?.startsWith('plugins/dsh-pr-inbox/image?')).toBe(true)
    const params = paramsOf(relative!)
    expect(params.get('cwd')).toBe(cwd)
    expect(params.get('ref')).toBe(ref)
    expect(params.get('path')).toBe('docs/preview/shot.png')
  })

  it('accepts the root-relative and bare forms, and keeps spaces encoded', () => {
    expect(paramsOf(resolvePrImagePath('/docs/a.png', repo, ref, cwd)!).get('path')).toBe('docs/a.png')
    expect(paramsOf(resolvePrImagePath('docs/a.png', repo, ref, cwd)!).get('path')).toBe('docs/a.png')
    expect(resolvePrImagePath('./docs/a b.png', repo, ref, cwd)).toContain('path=docs%2Fa+b.png')
  })

  it('refuses anything that could escape the repository', () => {
    for (const value of ['../package.json', 'docs/../../etc/passwd', './', 'docs/./a.png', '', '   ']) {
      expect(resolvePrImagePath(value, repo, ref, cwd), value).toBeUndefined()
    }
  })

  it('leaves absolute / protocol-relative URLs to the renderer', () => {
    for (const value of ['https://user-images.githubusercontent.com/1/a.png', 'http://x/y.png', '//cdn/x.png', 'data:image/png;base64,AAA']) {
      expect(resolvePrImagePath(value, repo, ref, cwd), value).toBeUndefined()
    }
  })

  it('requires a github.com repo, a ref and a cwd', () => {
    expect(resolvePrImagePath('docs/a.png', { ...repo, host: 'gitlab.example.com' }, ref, cwd)).toBeUndefined()
    expect(resolvePrImagePath('docs/a.png', repo, '', cwd)).toBeUndefined()
    expect(resolvePrImagePath('docs/a.png', repo, ref, undefined)).toBeUndefined()
    expect(resolvePrImagePath('docs/a.png', repo, ref, '')).toBeUndefined()
  })
})