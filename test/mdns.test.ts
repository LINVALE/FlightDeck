import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerA, buildResponse, parseAnswers, buildQuery, parseQuestions } from '../src/net/dns-wire.ts';

test('a response is parsed back into its A records', () => {
  const message = buildResponse([answerA('flightdeck.local', '192.0.2.10', 120)]);
  const answers = parseAnswers(message);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].name, 'flightdeck.local');
  assert.equal(answers[0].ip, '192.0.2.10');
});

test('our own name echoed back at our own address is NOT a conflict', () => {
  // This is what the host's avahi and multicast loopback both produce, and
  // judging by sender address made every restart rename the responder.
  const mine = new Set(['192.0.2.10']);
  const message = buildResponse([answerA('flightdeck.local', '192.0.2.10', 120)]);
  const conflicting = parseAnswers(message)
    .some((a) => a.name === 'flightdeck.local' && a.ip !== null && !mine.has(a.ip));
  assert.equal(conflicting, false);
});

test('our name at someone ELSE address is a real conflict', () => {
  const mine = new Set(['192.0.2.10']);
  const message = buildResponse([answerA('flightdeck.local', '192.0.2.99', 120)]);
  const conflicting = parseAnswers(message)
    .some((a) => a.name === 'flightdeck.local' && a.ip !== null && !mine.has(a.ip));
  assert.equal(conflicting, true);
});

test('a query round-trips', () => {
  const parsed = parseQuestions(buildQuery('flightdeck.local', 1));
  assert.equal(parsed.questions[0].name, 'flightdeck.local');
  assert.equal(parsed.questions[0].type, 1);
});
