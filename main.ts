// BASTION PROTOCOL — main.ts (make.fun threejs-fps-02 entry program)
// Node 22, standard library only. It hands the game in: copies game/
// and screenshots/ from beside this file into /output (or
// $MAKEFUN_OUTPUT_DIR outside the grader) and writes /output/dossier.json
// with the kit's buildDossier library, so the judge reads exactly the
// files the browser plays. The program is deterministic: two runs write
// the same bytes, because it only copies files and hashes them.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Start from a clean output directory so a stale screenshot or dossier
// from an earlier run can never leak into this one.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');

cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps, as the kit's RULES.txt states them: the dossier
// text is capped at 160 KiB, at most 4 screenshots of at most 256 KiB,
// game/ at most 993 files and 48 MiB in all.
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(out, 'dossier.json'), dossier);

// One line of proof on stdout: what landed in /output.
const countFiles = (dir) => readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? countFiles(join(dir, e.name)) : 1), 0);
console.log(
  `BASTION PROTOCOL -> ${out}: ${countFiles(join(out, 'game'))} game files, ` +
  `${readdirSync(join(out, 'screenshots')).length} screenshots, ` +
  `dossier ${statSync(join(out, 'dossier.json')).size} bytes`,
);
