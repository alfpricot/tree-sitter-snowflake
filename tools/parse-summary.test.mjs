import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSummaryFromXml } from './parse-summary.mjs';

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
    </source>
    test.sql\tParse: 0.40 ms 44 bytes/ms (MISSING identifier [0, 6] - [0, 6]) (MISSING ";" [0, 6] - [0, 6])
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

test('parseSummaryFromXml does not flag fake error patterns in SQL comments or literals', () => {
  const xml = `
    <program srow="0" scol="0" erow="0" ecol="40">
      <comment srow="0" scol="0" erow="0" ecol="30">-- (MISSING ";" [0, 0] - [0, 5])</comment>
      <statement srow="0" scol="31" erow="0" ecol="39">
        <select srow="0" scol="31" erow="0" ecol="39">
          <keyword_select srow="0" scol="31" erow="0" ecol="37">SELECT</keyword_select>
        </select>
      </statement>
      ;
    </program>
    </source>
  `;
  const starts = [0];
  const { statements, errors } = parseSummaryFromXml(xml, starts);

  assert.equal(errors.length, 0);
  assert.equal(statements.length, 1);
  assert.equal(statements[0].kind, 'select');
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

test('parseSummaryFromXml names a WITH statement by what follows the clause', () => {
  const xml = `
    <program srow="0" scol="0" erow="0" ecol="50">
      <statement srow="0" scol="0" erow="0" ecol="50">
        <keyword_with srow="0" scol="0" erow="0" ecol="4">WITH</keyword_with>
        <keyword_recursive srow="0" scol="5" erow="0" ecol="14">RECURSIVE</keyword_recursive>
        <cte srow="0" scol="15" erow="0" ecol="30">
          <identifier srow="0" scol="15" erow="0" ecol="16">c</identifier>
        </cte>
        <insert_statement srow="0" scol="31" erow="0" ecol="50">
          <keyword_insert srow="0" scol="31" erow="0" ecol="37">INSERT</keyword_insert>
        </insert_statement>
      </statement>
    </program>
  `;
  const { statements } = parseSummaryFromXml(xml, [0]);

  assert.deepEqual(statements, [{ kind: 'insert_statement', start: 0, end: 50 }]);
});
