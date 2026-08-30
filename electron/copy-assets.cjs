// Copie les artefacts buildés (racine roaserv) dans electron/ avant packaging.
// Permet à electron-builder d'inclure api-bundle.cjs + dist/browser + roaserv.config.json.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = __dirname;

function copyFile(rel, dstRel) {
  const src = path.join(ROOT, rel);
  const dst = path.join(TARGET, dstRel || rel);
  if (!fs.existsSync(src)) { console.error('MANQUANT:', rel); process.exit(1); }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('copié', rel, '->', dstRel || rel);
}

function copyDir(rel, dstRel) {
  const src = path.join(ROOT, rel);
  const dst = path.join(TARGET, dstRel || rel);
  if (!fs.existsSync(src)) { console.error('MANQUANT:', rel); process.exit(1); }
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  console.log('copié dir', rel, '->', dstRel || rel);
}

copyFile('dist/api-bundle.cjs', 'api-bundle.cjs');
copyDir('dist/browser', 'browser');
// roaserv.config.json est optionnel (git-ignoré, contient le secret) — copie si présent
const cfg = path.join(ROOT, 'roaserv.config.json');
if (fs.existsSync(cfg)) { copyFile('roaserv.config.json', 'roaserv.config.json'); console.log('(config DB embarquee)'); }
else console.log('(pas de roaserv.config.json local — l\'EXE utilisera les defauts/env)');
console.log('assets prets.');
