import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecentLedger } from '../src/ledger/recent.ts';

/**
 * ⚖️ THE LEDGER KEEPS THE ALBUM (Peter, 09-05: recent/top ALBUMS on the puck) and
 * enough rows that "most played" is a habit, not a day. Roon's API has no history.
 */
test('the ledger records the album line and keeps two thousand rows', () => {
  const ledger = new RecentLedger(null);
  ledger.observe('z1', 'Study', 'playing', 'Burn', 'Norah Jones', 'k1', '2026-09-05T10:00:00Z', 'Day Breaks');
  ledger.observe('z1', 'Study', 'playing', 'Flipside', 'Norah Jones', 'k1', '2026-09-05T10:04:00Z', 'Day Breaks');
  const rows = ledger.recent(10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'Flipside');
  assert.equal(rows[0].line3, 'Day Breaks');
  ledger.observe('z2', 'Porch', 'playing', 'Old Row', 'Someone', null, '2026-09-05T10:05:00Z');
  assert.equal(ledger.recent(10)[0].line3, '', 'absent is the empty string, never undefined');
  for (let i = 0; i < 2100; i += 1) {
    ledger.observe('z3', 'Kitchen', 'playing', 'Track ' + String(i), 'A', null, '2026-09-05T11:00:00Z');
  }
  assert.equal(ledger.recent(5000).length, 2000);
});
