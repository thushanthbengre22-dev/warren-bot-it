/**
 * jtml.test.ts
 *
 * Pre-integration tests for @jtml/core.
 *
 * These tests establish the contract that must hold BEFORE and AFTER
 * JTML is integrated into strategist.ts. If any test here fails after
 * integration, the integration broke something.
 *
 * Contract:
 *  1. Round-trip fidelity  — encode → decode produces identical data
 *  2. Token reduction      — JTML output is smaller than JSON for arrays
 *  3. parseClaudeResponse  — unaffected by JTML (Claude output side unchanged)
 */

import { encode, decode, compareTokens } from '@jtml/core';
import { parseClaudeResponse } from '../src/bot/strategist';

// ─── sample data matching what strategist.ts will encode ────────────────────

const sampleTrades = [
  { marketQuestion: 'Will candidate X win the election?', side: 'YES', marketPrice: 0.65, status: 'open' },
  { marketQuestion: 'Will the Fed cut rates in Q2?',      side: 'NO',  marketPrice: 0.40, status: 'lost' },
  { marketQuestion: 'Will BTC hit $100k by June?',        side: 'YES', marketPrice: 0.55, status: 'won'  },
];

const sampleNews = [
  {
    title:   'Iran tensions rise as US moves carrier group to Gulf',
    content: 'US military has positioned a carrier strike group in the Persian Gulf amid rising tensions with Iran over nuclear programme negotiations.',
  },
  {
    title:   'White House declines to comment on Iran military options',
    content: 'Press secretary said all options remain on the table but declined to elaborate on specific contingency planning.',
  },
  {
    title:   'Iran foreign minister signals openness to talks',
    content: 'In a statement broadcast on state media, Iran\'s foreign minister indicated willingness to resume indirect negotiations.',
  },
];

// ─── round-trip fidelity ─────────────────────────────────────────────────────

describe('@jtml/core — round-trip fidelity', () => {

  it('should encode and decode recent trades back to identical data', () => {
    const encoded = encode(sampleTrades);
    const decoded = decode(encoded);
    expect(decoded).toEqual(sampleTrades);
  });

  it('should encode and decode news results back to identical data', () => {
    const encoded = encode(sampleNews);
    const decoded = decode(encoded);
    expect(decoded).toEqual(sampleNews);
  });

  it('should preserve float precision on marketPrice', () => {
    const data = [{ marketPrice: 0.755, side: 'NO', status: 'open' }];
    const decoded = decode(encode(data)) as typeof data;
    expect(decoded[0].marketPrice).toBe(0.755);
  });

  it('should preserve all status values (open, won, lost)', () => {
    const data = [
      { status: 'open' },
      { status: 'won'  },
      { status: 'lost' },
    ];
    const decoded = decode(encode(data)) as typeof data;
    expect(decoded.map(d => d.status)).toEqual(['open', 'won', 'lost']);
  });

  it('should throw on empty arrays — integration must guard against this', () => {
    // encode([]) throws — the integration must skip encoding when the array is empty
    // (no news fetched, or no recent trades) and fall back to plain text instead.
    expect(() => encode([])).toThrow();
  });

  it('should handle a single-item array', () => {
    const data = [{ marketQuestion: 'Single?', side: 'YES', marketPrice: 0.5, status: 'open' }];
    const decoded = decode(encode(data));
    expect(decoded).toEqual(data);
  });

  it('should handle news content with special characters', () => {
    const data = [{ title: 'Test | pipe', content: 'Line one\nLine two' }];
    const decoded = decode(encode(data)) as typeof data;
    expect(decoded[0].title).toBe('Test | pipe');
  });

});

// ─── token reduction ─────────────────────────────────────────────────────────

describe('@jtml/core — token reduction', () => {

  it('should produce fewer tokens than JSON for recent trades array', () => {
    const encoded = encode(sampleTrades);
    const stats   = compareTokens(JSON.stringify(sampleTrades), encoded);
    expect(stats.jtmlTokens).toBeLessThan(stats.jsonTokens);
  });

  it('should produce fewer tokens than JSON for news array', () => {
    const encoded = encode(sampleNews);
    const stats   = compareTokens(JSON.stringify(sampleNews), encoded);
    expect(stats.jtmlTokens).toBeLessThan(stats.jsonTokens);
  });

  it('should report a positive savings percentage', () => {
    const encoded = encode(sampleTrades);
    const stats   = compareTokens(JSON.stringify(sampleTrades), encoded);
    expect(stats.savingsPercent).toBeGreaterThan(0);
  });

});

// ─── parseClaudeResponse is unaffected ───────────────────────────────────────

describe('parseClaudeResponse — unaffected by JTML integration', () => {

  it('should still parse a valid Claude response correctly after JTML is added to prompt', () => {
    // Claude's OUTPUT is always plain JSON — JTML only changes the INPUT (prompt).
    // This test confirms parseClaudeResponse behaviour is unchanged.
    const response = JSON.stringify({
      probability:    0.72,
      confidence:     0.80,
      reasoning:      'Strong evidence from recent news.',
      recommendation: 'BUY_YES',
    });

    const result = parseClaudeResponse(response);

    expect(result.recommendation).toBe('BUY_YES');
    expect(result.probability).toBe(0.72);
    expect(result.confidence).toBe(0.80);
  });

  it('should still return SKIP for a non-JSON Claude response', () => {
    const result = parseClaudeResponse('I cannot determine the outcome of this market.');
    expect(result.recommendation).toBe('SKIP');
  });

});