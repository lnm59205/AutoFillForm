import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const staticSrc = path.join(root, 'static');
const staticDest = path.join(distDir, 'static');

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(staticDest, { recursive: true });

fs.copyFileSync(path.join(root, 'templates', 'index.html'), path.join(distDir, 'index.html'));
fs.cpSync(staticSrc, staticDest, { recursive: true });
fs.copyFileSync(path.join(staticSrc, 'manifest.json'), path.join(distDir, 'manifest.json'));
fs.copyFileSync(path.join(staticSrc, 'sw.js'), path.join(distDir, 'sw.js'));

console.log('Built static assets into ./dist');
