/**
 * 列表与详情共用的小件：头像 / 作者 / 相对时间。
 *
 * 抽出来是因为两边都要用，且**头像有回退语义**：`*.githubusercontent.com` 这条 CDN 在
 * 受限网络里整体不可达（实测 curl HTTP 000），直连必然得到破图。所以这里的策略是
 * 「URL 存在且加载成功 → 显示图片；失败/缺失 → 用首字母圆底占位」，任何情况下都不会
 * 把浏览器的破图图标露给用户。
 */
import { createElement, useState } from 'react'
import { formatAge, isFresh } from './format'

/** 16px 圆头像；加载失败或没有 URL 时回退成首字母（同一几何，视觉上不跳）。 */
export function Avatar({ login, url }: { login: string, url?: string }) {
  const [failed, setFailed] = useState(false)
  if (url === undefined || failed) {
    return createElement('span', {
      className: 'pi-avatar pi-avatarInitials',
      'aria-hidden': true,
      title: login,
    }, (login.slice(0, 1) || '?').toUpperCase())
  }
  return createElement('img', {
    className: 'pi-avatar',
    src: url,
    alt: '',
    decoding: 'async',
    onError: () => { setFailed(true) },
  })
}

/** 作者名 + 头像。`href` 给出时按官方链接外观渲染（详情页用），列表里只显示名字。 */
export function Author({ login, avatar, href }: { login: string, avatar?: string, href?: string }) {
  const name = href === undefined
    ? createElement('span', { key: 'l' }, login)
    : createElement('a', {
      key: 'l', className: 'pi-author', href,
      target: '_blank', rel: 'noopener noreferrer',
      onClick: (event: { stopPropagation: () => void }) => { event.stopPropagation() },
    }, login)
  return createElement('span', { className: 'pi-authorName' }, [
    createElement(Avatar, { key: 'a', login, ...(avatar === undefined ? {} : { url: avatar }) }),
    name,
  ])
}

/** 相对时间；24h 内动过的行取第二层色阶（`.pi-meta[data-fresh]`）。 */
export function Age({ iso }: { iso: string }) {
  return createElement('span', {
    className: 'pi-meta',
    'data-fresh': isFresh(iso) ? 'true' : undefined,
  }, formatAge(iso))
}