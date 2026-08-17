// 构建客户端 bundle：esbuild 打包 + window.__ModuleLoader__.load({id, factory}) 包装
// 产出 lib/client.js，格式与 DSH 官方客户端插件 bundle 一致。
import { build } from 'esbuild'

const PACKAGE_ID = 'dsh-daily-tasks'
const externals = ['react', 'react/jsx-runtime', 'react-dom']

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2023',
  jsx: 'automatic',
  external: externals,
  sourcemap: true,
  logLevel: 'info',
  banner: {
    js: `window.__ModuleLoader__.load({ id: "${PACKAGE_ID}", factory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;`,
  },
  footer: {
    js: '\nreturn module.exports;\n} });',
  },
})

console.log('[dsh-daily-tasks] client bundle -> lib/client.js')
