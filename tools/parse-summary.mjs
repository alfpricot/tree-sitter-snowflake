#!/usr/bin/env node
// Emits machine-readable statement boundaries, top-level statement kinds,
// and error byte ranges as JSON Lines for differential parser testing.
//
// Usage:
//   node tools/parse-summary.mjs <corpus-root-or-file> [--grammar <dir>] [--out <file>]

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveTreeSitterCli } from './fixture-result.mjs';
import { decode } from './parse-rate/parse-rate.mjs';

export function walkSql(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSql(p, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
      out.push(p);
    }
  }
  return out;
}

export function lineStarts(text) {
  const lines = text.split('\n');
  const starts = [0];
  let offset = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    offset += Buffer.byteLength(lines[i], 'utf8') + 1;
    starts.push(offset);
  }
  return starts;
}

export function byteOffset(starts, row, col) {
  return (starts[row] ?? 0) + col;
}

export function parseSummaryFromXml(xml, starts) {
  const statements = [];
  const errors = [];
  const seenErrors = new Set();
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w.]*)([^>]*)>/g;
  let m;
  let currentTopLevelStatement = null;

  while ((m = re.exec(xml)) !== null) {
    const isClosing = m[1] === '/';
    const tag = m[2];
    const isSelfClosing = /\/>$/.test(m[0]);

    if (isClosing) {
      const idx = stack.map((s) => s.tag).lastIndexOf(tag);
      if (idx !== -1) {
        if (currentTopLevelStatement && stack[idx] === currentTopLevelStatement) {
          currentTopLevelStatement = null;
        }
        stack.length = idx;
      }
      continue;
    }

    const attrs = m[3];
    const num = (name) => {
      const a = attrs.match(new RegExp(`${name}="(\\d+)"`));
      return a ? Number(a[1]) : 0;
    };

    const node = {
      tag,
      srow: num('srow'),
      scol: num('scol'),
      erow: num('erow'),
      ecol: num('ecol'),
    };

    const start = byteOffset(starts, node.srow, node.scol);
    const end = byteOffset(starts, node.erow, node.ecol);
    node.start = start;
    node.end = end;

    const parent = stack.length > 0 ? stack[stack.length - 1] : null;

    const insideError = stack.some((s) => s.tag === 'ERROR' || s.tag === 'MISSING');
    if (!insideError && (tag === 'ERROR' || tag === 'MISSING')) {
      const key = `${start}:${end}`;
      if (!seenErrors.has(key)) {
        seenErrors.add(key);
        errors.push({ start, end });
      }
    }

    if (tag === 'statement' && parent && parent.tag === 'program') {
      currentTopLevelStatement = node;
      node.statementEntry = {
        kind: 'unknown',
        start,
        end,
      };
      statements.push(node.statementEntry);
    } else if (
      currentTopLevelStatement &&
      parent === currentTopLevelStatement &&
      currentTopLevelStatement.statementEntry.kind === 'unknown' &&
      tag !== 'comment' &&
      tag !== 'marginalia'
    ) {
      currentTopLevelStatement.statementEntry.kind = tag;
    }

    if (!isSelfClosing) {
      stack.push(node);
    }
  }

  const statusRe =
    /\((?:ERROR|MISSING)(?:\s+[A-Za-z0-9_]+)?\s+\[(\d+),\s*(\d+)\]\s*-\s*\[(\d+),\s*(\d+)\]\)/g;
  while ((m = statusRe.exec(xml)) !== null) {
    const start = byteOffset(starts, Number(m[1]), Number(m[2]));
    const end = byteOffset(starts, Number(m[3]), Number(m[4]));
    const key = `${start}:${end}`;
    if (!seenErrors.has(key)) {
      seenErrors.add(key);
      errors.push({ start, end });
    }
  }

  for (const s of statements) {
    if (s.kind === 'unknown') {
      s.kind = 'statement';
    }
  }

  statements.sort((a, b) => a.start - b.start || a.end - b.end);
  errors.sort((a, b) => a.start - b.start || a.end - b.end);

  return { statements, errors };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const repoDir = join(fileURLToPath(new URL('..', import.meta.url)));
  const grammarFlag = argv.indexOf('--grammar');
  const grammarDir = grammarFlag !== -1 ? argv[grammarFlag + 1] : repoDir;
  const outFlag = argv.indexOf('--out');
  const outFile = outFlag !== -1 ? argv[outFlag + 1] : null;

  const inputPath =
    argv.find(
      (a, i) =>
        i > 0 && !a.startsWith('--') && argv[i - 1] !== '--grammar' && argv[i - 1] !== '--out',
    ) || argv[0];

  if (!inputPath || inputPath.startsWith('--')) {
    console.error(
      'usage: parse-summary.mjs <corpus-root-or-file> [--grammar <dir>] [--out <file>]',
    );
    process.exit(2);
  }

  const isDirectory = statSync(inputPath).isDirectory();
  const files = isDirectory ? walkSql(inputPath).sort() : [inputPath];

  if (files.length === 0) {
    process.exit(0);
  }

  const cli = resolveTreeSitterCli(repoDir, grammarDir);
  const scratch = join(os.tmpdir(), `parse-summary-${process.pid}`);
  process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

  const normalized = [];
  for (const file of files) {
    const [, text] = decode(readFileSync(file));
    const rel = isDirectory ? relative(inputPath, file) : file;
    const normName = rel.split(sep).join('__');
    const norm = join(scratch, normName);
    mkdirSync(dirname(norm), { recursive: true });
    writeFileSync(norm, text, 'utf8');
    normalized.push({
      original: file,
      displayPath: rel.split(sep).join('/'),
      norm,
      text,
    });
  }

  const results = [];
  const BATCH = 40;
  for (let i = 0; i < normalized.length; i += BATCH) {
    const batch = normalized.slice(i, i + BATCH);
    const proc = spawnSync(cli, ['parse', '-x', ...batch.map((f) => f.norm)], {
      cwd: grammarDir,
      encoding: 'buffer',
      maxBuffer: 1 << 28,
      env: process.platform === 'win32' ? { ...process.env, CC: 'gcc', CXX: 'g++' } : process.env,
    });

    if (proc.error) {
      throw new Error(`parse-summary: could not run ${cli}: ${proc.error.message}`);
    }

    const xml = proc.stdout.toString('utf8');
    const chunks = xml.split('<source name="');

    for (let c = 1; c < chunks.length; c++) {
      const nl = chunks[c].indexOf('\n');
      const name = chunks[c].slice(0, nl).replace(/"?>?$/, '');
      const body = chunks[c].slice(nl);
      const target =
        batch.find((f) => f.norm === name) ||
        batch.find((f) => name.replace(/\\/g, '/').endsWith(f.norm.replace(/\\/g, '/')));

      if (!target) {
        throw new Error(
          `parse-summary: could not match XML <source name="${name}"> to a file in this batch`,
        );
      }

      const starts = lineStarts(target.text);
      const { statements, errors } = parseSummaryFromXml(body, starts);
      results.push({
        file: target.displayPath,
        statements,
        errors,
      });
    }
  }

  const outputLines =
    results.map((r) => JSON.stringify(r)).join('\n') + (results.length > 0 ? '\n' : '');
  if (outFile) {
    writeFileSync(outFile, outputLines, 'utf8');
  } else {
    process.stdout.write(outputLines);
  }
}
