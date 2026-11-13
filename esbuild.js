const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

function copyCss() {
  const srcCss = path.join(__dirname, 'src', 'webview', 'styles', 'globalTheme.css');
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }
  if (fs.existsSync(srcCss)) {
    fs.copyFileSync(srcCss, path.join(distDir, 'globalTheme.css'));
  }
}

async function main() {
  const extCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info',
  });

  const webviewCtx = await esbuild.context({
    entryPoints: ['src/webview/index.ts'],
    bundle: true,
    format: 'iife',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outfile: 'dist/webview.js',
    logLevel: 'info',
  });

  copyCss();

  if (watch) {
    await extCtx.watch();
    await webviewCtx.watch();
  } else {
    await extCtx.rebuild();
    await webviewCtx.rebuild();
    await extCtx.dispose();
    await webviewCtx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
