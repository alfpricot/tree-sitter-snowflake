#!/usr/bin/env node
// Parse-rate harness: walks a directory tree for *.sql, decodes
// UTF-8/UTF-8-BOM/UTF-16LE/UTF-16BE, parses each file with the
// tree-sitter CLI, and reports error-free file count plus the share of
// bytes covered by outermost ERROR/MISSING nodes (each error region
// counted once, at its outermost node).
//
// Usage:
//   node tools/parse-rate/parse-rate.mjs <corpus-root> [--grammar <dir>] [--json]
//
// The grammar directory defaults to the repository root (this repo). To
// measure another grammar, pass its checkout with --grammar; the CLI
// compiles and caches the parser keyed by grammar name, so clear the
// global cache (~/.cache/tree-sitter or ~/AppData/Local/tree-sitter)
// before a differential comparison.

import { Buffer } from 'node:buffer';
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { resolveTreeSitterCli } from '../fixture-result.mjs';
import { batchParse, byteOffset, lineStarts } from '../lib/parse-batch.mjs';

// --- collect and decode -----------------------------------------------------

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) out.push(p);
  }
  return out;
}

// Node's Buffer already stores multi-byte values little-endian, so its
// 'utf16le' string decoder reads little-endian UTF-16 directly — a
// little-endian source needs no byte swap, and only a big-endian source
// (BOM FE FF, or the BOM-less zerosEven shape below) needs one first.
export function decode(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return ['utf-8', buf.subarray(3).toString('utf8')];
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return ['utf-16le', buf.subarray(2).toString('utf16le')];
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return ['utf-16be', swapped.toString('utf16le')];
  }
  // Heuristic from the BOM-less UTF-16 shape: SQL text is ASCII-heavy, so
  // every other byte being NUL indicates UTF-16. Which half is NUL says
  // which byte order: a little-endian ASCII byte sits at an even index
  // with its NUL high byte at the following odd index, so zerosOdd
  // indicates little-endian and zerosEven indicates big-endian.
  const n = Math.min(buf.length, 512);
  let zerosEven = 0;
  let zerosOdd = 0;
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) {
      if (i % 2 === 0) zerosEven++;
      else zerosOdd++;
    }
  }
  if (n >= 64 && zerosOdd > n / 3) {
    return ['utf-16le', buf.toString('utf16le')];
  }
  if (n >= 64 && zerosEven > n / 3) {
    const swapped = Buffer.from(buf);
    swapped.swap16();
    return ['utf-16be', swapped.toString('utf16le')];
  }
  return ['utf-8', buf.toString('utf8')];
}

// --- parse in batches and measure error bytes from the XML tree --------------

// Extracts outermost ERROR/MISSING byte ranges from tree-sitter's XML
// output. The XML is not balanced in the DOM sense (text between tags is
// arbitrary source), so ranges are collected with a small scanner over
// the element open tags.
function errorRangesFromXml(xml, starts) {
  const ranges = [];
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w.]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2];
    if (closing) {
      const idx = stack.map((s) => s.tag).lastIndexOf(tag);
      if (idx !== -1) stack.length = idx;
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
    const insideError = stack.some((s) => s.tag === 'ERROR' || s.tag === 'MISSING');
    if (!insideError && (tag === 'ERROR' || tag === 'MISSING')) {
      ranges.push([
        byteOffset(starts, node.srow, node.scol),
        byteOffset(starts, node.erow, node.ecol),
      ]);
    }
    if (!m[0].endsWith('/>')) stack.push(node);
  }
  return ranges;
}

// --- CLI entry point ---------------------------------------------------------

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes('--json');
  const repoDir = join(fileURLToPath(new URL('../..', import.meta.url)));
  const grammarFlag = argv.indexOf('--grammar');
  const grammarDir = grammarFlag !== -1 ? argv[grammarFlag + 1] : repoDir;
  const corpusRoot =
    argv.find(
      (a, i) => i > 0 && !a.startsWith('--') && argv[i - 1] !== '--grammar' && a !== '--json',
    ) || argv[0];
  if (!corpusRoot || corpusRoot.startsWith('--')) {
    console.error('usage: parse-rate.mjs <corpus-root> [--grammar <dir>] [--json]');
    process.exit(2);
  }

  const cli = resolveTreeSitterCli(repoDir, grammarDir);

  const files = walk(corpusRoot, []).sort();
  const scratch = join(os.tmpdir(), `parse-rate-${process.pid}`);
  process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
  const normalized = [];
  for (const file of files) {
    const [, text] = decode(readFileSync(file));
    const norm = join(scratch, relative(corpusRoot, file).split(sep).join('__'));
    mkdirSync(scratch, { recursive: true });
    writeFileSync(norm, text, 'utf8');
    normalized.push({ original: file, norm, text });
  }

  const perFile = batchParse({
    tool: 'parse-rate',
    cli,
    cwd: grammarDir,
    items: normalized,
    path: (f) => f.norm,
  }).map(({ item, body }) => {
    const ranges = errorRangesFromXml(body, lineStarts(item.text));
    return {
      file: item.original,
      bytes: Buffer.byteLength(item.text, 'utf8'),
      errorBytes: ranges.reduce((sum, [a, b]) => sum + (b - a), 0),
      hasError: ranges.length > 0,
    };
  });

  const totalFiles = perFile.length;
  const totalBytes = perFile.reduce((s, f) => s + f.bytes, 0);
  const errorFree = perFile.filter((f) => !f.hasError).length;
  const errorBytes = perFile.reduce((s, f) => s + f.errorBytes, 0);
  const result = {
    corpus: corpusRoot,
    files: totalFiles,
    errorFreeFiles: errorFree,
    errorFreePct: totalFiles ? +(100 * (errorFree / totalFiles)).toFixed(1) : 0,
    errorBytesPct: totalBytes ? +(100 * (errorBytes / totalBytes)).toFixed(1) : 0,
  };
  if (jsonOut) {
    console.log(JSON.stringify({ ...result, perFile }, null, 2));
  } else {
    console.log(`corpus:            ${result.corpus}`);
    console.log(`files:             ${result.files}`);
    console.log(`error-free files:  ${result.errorFreeFiles} (${result.errorFreePct}%)`);
    console.log(`bytes in errors:   ${result.errorBytesPct}%`);
  }
}
