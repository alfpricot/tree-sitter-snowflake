import assert from 'node:assert/strict';
import test from 'node:test';
import { byteOffset, lineStarts, parseSummaryFromXml } from './parse-summary.mjs';

test('lineStarts and byteOffset accurately compute UTF-8 byte positions', () => {
  const text = 'SELECT 1;\nSELECT 2;\nSELECT 3;';
  const starts = lineStarts(text);
  assert.deepEqual(starts, [0, 10, 20]);
  assert.equal(byteOffset(starts, 0, 0), 0);
  assert.equal(byteOffset(starts, 1, 7), 17);

  // Multi-byte character (3 bytes in UTF-8)
  const nonAscii = 'SELECT "★";\nSELECT 1;';
  const nonAsciiStarts = lineStarts(nonAscii);
  // 'SELECT "★";\n' length in bytes: 7 + 1 + 3 + 1 + 1 + 1 = 14 bytes
  assert.deepEqual(nonAsciiStarts, [0, 14]);
  assert.equal(byteOffset(nonAsciiStarts, 1, 0), 14);
});

test('parseSummaryFromXml extracts clean statements with their kinds and byte boundaries', () => {
  const xml = `
    <program srow="0" scol="0" erow="2" ecol="10">
      <statement srow="0" scol="0" erow="0" ecol="9">
        <select srow="0" scol="0" erow="0" ecol="9">
          <keyword_select srow="0" scol="0" erow="0" ecol="6">SELECT</keyword_select>
          <term srow="0" scol="7" erow="0" ecol="8">1</term>
        </select>
      </statement>
      ;
      <statement srow="1" scol="0" erow="1" ecol="24">
        <create_table srow="1" scol="0" erow="1" ecol="24">
          <keyword_create srow="1" scol="0" erow="1" ecol="6">CREATE</keyword_create>
          <keyword_table srow="1" scol="7" erow="1" ecol="12">TABLE</keyword_table>
        </create_table>
      </statement>
      ;
    </program>
  `;
  const starts = [0, 20, 50];
  const { statements, errors } = parseSummaryFromXml(xml, starts);

  assert.equal(errors.length, 0);
  assert.equal(statements.length, 2);
  assert.deepEqual(statements[0], {
    kind: 'select',
    start: 0,
    end: 9,
  });
  assert.deepEqual(statements[1], {
    kind: 'create_table',
    start: 20,
    end: 44,
  });
});

test('parseSummaryFromXml captures outermost ERROR and MISSING byte ranges', () => {
  const xml = `
    <program srow="0" scol="0" erow="0" ecol="25">
      <statement srow="0" scol="0" erow="0" ecol="8">
        <select srow="0" scol="0" erow="0" ecol="8">
          <keyword_select srow="0" scol="0" erow="0" ecol="6">SELECT</keyword_select>
        </select>
      </statement>
      <ERROR srow="0" scol="9" erow="0" ecol="12">
        <plus srow="0" scol="9" erow="0" ecol="10">+</plus>
        <minus srow="0" scol="11" erow="0" ecol="12">-</minus>
      </ERROR>
      ;
    </program>
  `;
  const starts = [0];
  const { statements, errors } = parseSummaryFromXml(xml, starts);

  assert.equal(statements.length, 1);
  assert.deepEqual(statements[0], {
    kind: 'select',
    start: 0,
    end: 8,
  });
  assert.deepEqual(errors, [{ start: 9, end: 12 }]);
});

test('parseSummaryFromXml captures status-line MISSING errors and deduplicates', () => {
  const xml = `
    <program srow="0" scol="0" erow="0" ecol="10">
      <statement srow="0" scol="0" erow="0" ecol="6">
        <select srow="0" scol="0" erow="0" ecol="6">
          <keyword_select srow="0" scol="0" erow="0" ecol="6">SELECT</keyword_select>
        </select>
      </statement>
      ;
    </program>
    test.sql\tParse: 0.40 ms 44 bytes/ms (MISSING identifier [0, 6] - [0, 6])
  `;
  const starts = [0];
  const { statements, errors } = parseSummaryFromXml(xml, starts);

  assert.equal(statements.length, 1);
  assert.deepEqual(statements[0], {
    kind: 'select',
    start: 0,
    end: 6,
  });
  assert.deepEqual(errors, [{ start: 6, end: 6 }]);
});

test('parseSummaryFromXml ignores marginalia when determining statement kind', () => {
  const xml = `
    <program srow="0" scol="0" erow="0" ecol="30">
      <marginalia srow="0" scol="0" erow="0" ecol="7">/* c */</marginalia>
      <statement srow="0" scol="8" erow="0" ecol="30">
        <create_table srow="0" scol="8" erow="0" ecol="30">
          <keyword_create srow="0" scol="8" erow="0" ecol="14">CREATE</keyword_create>
        </create_table>
      </statement>
      ;
    </program>
  `;
  const starts = [0];
  const { statements, errors } = parseSummaryFromXml(xml, starts);

  assert.equal(errors.length, 0);
  assert.equal(statements.length, 1);
  assert.equal(statements[0].kind, 'create_table');
  assert.equal(statements[0].start, 8);
  assert.equal(statements[0].end, 30);
});
