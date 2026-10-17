/**
 * 列表密度偏好：按设计稿持久化到 localStorage（`Panel` 重新挂载/切页签后不回到默认）。
 * 读写在私有模式、沙箱、`localStorage` 被禁用时都可能抛错——一律吞掉回默认值，
 * 这个偏好不该让面板渲染失败。
 */
export type Density = 'compact' | 'detailed'

const KEY = 'dsh-pr-inbox:density'

export interface KeyValueStore {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function defaultStore(): KeyValueStore | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined
    return localStorage
  } catch {
    return undefined
  }
}

export function loadDensity(store: KeyValueStore | undefined = defaultStore()): Density {
  try {
    return store?.getItem(KEY) === 'detailed' ? 'detailed' : 'compact'
  } catch {
    return 'compact'
  }
}

export function saveDensity(value: Density, store: KeyValueStore | undefined = defaultStore()): void {
  try {
    store?.setItem(KEY, value)
  } catch {
    // 存储不可用：偏好只在本次挂载里生效。
  }
}
