#!/usr/bin/env bun
/**
 * Pure-logic check of `src/utils.ts` (no vscode, no host).
 * Run with `bun tests/units/format_check.ts`.
 */
import assert from 'node:assert';
import { formatBytes, formatByDict, formatTimes } from '../../src/utils';

const section = (name: string): void => console.log(`\n== ${name} ==`);

section('formatBytes: unit selection by magnitude');
assert.deepStrictEqual(formatBytes(0), { data: '0', unit: 'KB' });
assert.deepStrictEqual(formatBytes(1023), { data: '0', unit: 'KB' });
assert.deepStrictEqual(formatBytes(1024), { data: '1', unit: 'KB' });
assert.deepStrictEqual(formatBytes(2048), { data: '2', unit: 'KB' });
assert.deepStrictEqual(formatBytes(1024 * 1024), { data: '1', unit: 'MB' });
assert.deepStrictEqual(formatBytes(5 * 1024 * 1024), { data: '5', unit: 'MB' });
assert.deepStrictEqual(formatBytes(3 * 1024 * 1024 * 1024), { data: '3', unit: 'GB' });
console.log('ok - KB / MB / GB thresholds');

section('formatBytes: fixedNumber is applied');
assert.deepStrictEqual(formatBytes(1536, 2), { data: '1.50', unit: 'KB' });
assert.deepStrictEqual(formatBytes(1024 * 1024 * 1024, 3), { data: '1.000', unit: 'GB' });
console.log('ok - decimals respected');

section('formatBytes: customSize forces the CUSTOM unit');
assert.deepStrictEqual(formatBytes(2 * 1024 * 1024 * 1024, 2, 1024 * 1024 * 1024), {
  data: '2.00',
  unit: 'CUSTOM'
});
assert.deepStrictEqual(formatBytes(1536, 2, 1024), { data: '1.50', unit: 'CUSTOM' });
console.log('ok - custom size for the GB memory display');

section('formatTimes: whole days / hours / minutes');
assert.deepStrictEqual(formatTimes(0), [0, 0, 0]);
assert.deepStrictEqual(formatTimes(59), [0, 0, 0]);
assert.deepStrictEqual(formatTimes(60), [0, 0, 1]);
assert.deepStrictEqual(formatTimes(3600), [0, 1, 0]);
assert.deepStrictEqual(formatTimes(86400), [1, 0, 0]);
assert.deepStrictEqual(formatTimes(90061), [1, 1, 1]); // 1d 1h 1m
console.log('ok - uptime decomposition');

section('formatByDict: substitute, keep unknown placeholders, trim');
assert.strictEqual(formatByDict('$(pulse) ${percent}%', { percent: '42' }), '$(pulse) 42%');
assert.strictEqual(formatByDict('${a}-${b}', { a: 'x', b: 'y' }), 'x-y');
assert.strictEqual(formatByDict('${nope}', {}), '${nope}');
assert.strictEqual(formatByDict('  ${x}  ', { x: 'v' }), 'v');
assert.strictEqual(formatByDict('${x}', { x: 5 }), '5'); // numbers are coerced
console.log('ok - display-format engine');

console.log('\nformat_check: all checks passed');
