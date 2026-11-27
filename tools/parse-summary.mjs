#!/usr/bin/env node
// Emits machine-readable statement boundaries, top-level statement kinds,
// and error byte ranges as JSON Lines for differential parser testing.
//
// Usage:
//   node tools/parse-summary.mjs <corpus-root-or-file> [--grammar <dir>] [--out <file>]

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveTreeSitterCli } from './fixture-result.mjs';
import { batchParse, byteOffset, lineStarts } from './lib/parse-batch.mjs';
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

export function parseSummaryFromXml(xml, starts) {
  const statements = [];
  const errors = [];
  const seenErrors = new Set();
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w.]*)([^>]*)>/g;
  let m;
  /** @type {any} */
  let currentTopLevelStatement = null;

  const sourceEndIdx = xml.indexOf('</source>');
  const xmlTree = sourceEndIdx !== -1 ? xml.slice(0, sourceEndIdx + 9) : xml;
  const statusText = sourceEndIdx !== -1 ? xml.slice(sourceEndIdx + 9) : xml;

  while ((m = re.exec(xmlTree)) !== null) {
    const isClosing = m[1] === '/';
    const tag = m[2];
    const isSelfClosing = m[0].endsWith('/>');

    if (isClosing) {
      const idx = stack.findLastIndex((s) => s.tag === tag);
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
    /\((?:ERROR|MISSING)(?:\s+(?:[A-Za-z0-9_]+|"[^"]+"))?\s+\[(\d+),\s*(\d+)\]\s*-\s*\[(\d+),\s*(\d+)\]\)/g;
  while ((m = statusRe.exec(statusText)) !== null) {
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
  const files = isDirectory ? walkSql(inputPath).toSorted() : [inputPath];

  if (files.length === 0) {
    process.exit(0);
  }

  const cli = resolveTreeSitterCli(repoDir, grammarDir);
  const scratch = join(os.tmpdir(), `parse-summary-${process.pid}`);
  process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

  const normalized = [];
  let fileIndex = 0;
  for (const file of files) {
    const [, text] = decode(readFileSync(file));
    const rel = isDirectory ? relative(inputPath, file) : file;
    const safeBase = basename(file).replace(/[^a-zA-Z0-9._-]/g, '_');
    const norm = join(scratch, `${fileIndex++}__${safeBase}`);
    mkdirSync(dirname(norm), { recursive: true });
    writeFileSync(norm, text, 'utf8');
    normalized.push({
      original: file,
      displayPath: rel
        .split(sep)
        .join('/')
        .replace(/^(\.\/)+/, ''),
      norm,
      text,
    });
  }

  const parsed = batchParse({
    tool: 'parse-summary',
    cli,
    cwd: grammarDir,
    items: normalized,
    path: (f) => f.norm,
  });
  const results = Array.from(parsed, ({ item, body }) => ({
    file: item.displayPath,
    ...parseSummaryFromXml(body, lineStarts(item.text)),
  }));

  const outputLines =
    results.map((r) => JSON.stringify(r)).join('\n') + (results.length > 0 ? '\n' : '');
  if (outFile) {
    writeFileSync(outFile, outputLines, 'utf8');
  } else {
    process.stdout.write(outputLines);
  }
}
