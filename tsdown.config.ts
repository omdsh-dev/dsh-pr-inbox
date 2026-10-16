/**
 * dsh-pr-inbox 双 half 构建：
 *  - Node half：`src/index.ts` → `lib/index.js`（ESM，跑 gh 子进程 + 注册自有路由）
 *  - Client half：`src/client/index.tsx` → `lib/client.js`（CJS，DSH 的 `__ModuleLoader__` 契约）
 *
 * 顺序有意如此：第一个 entry `clean: true` 清空 lib，第二个不清（否则把自己删掉）。
 */
export default [
  {
    entry: ['src/index.ts'],
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    outDir: 'lib',
    dts: false,
    clean: true,
    deps: { neverBundle: [/^@deepseek-ai\//] },
    outputOptions: { entryFileNames: 'index.js' },
  },
  {
    name: 'dsh-pr-inbox/client',
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    deps: { neverBundle: [/@deepseek-ai\/dsh-client-/, 'react', 'react-dom'] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-pr-inbox", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]