/**
 * strategist.test.ts
 *
 * Tests for parseClaudeResponse() in src/bot/strategist.ts.
 * Tests the JSON extraction, JSON.parse safety, and Zod schema validation
 * without making any real API calls.
 */

import { parseClaudeResponse } from '../src/bot/strategist';

describe('parseClaudeResponse — valid JSON', () => {

  it('should parse a clean valid JSON response', () => {
    const text = JSON.stringify({
      probability:    0.72,
      confidence:     0.80,
      reasoning:      'Recent polling shows a clear lead.',
      recommendation: 'BUY_YES',
    });

    const result = parseClaudeResponse(text);

    expect(result.probability).toBe(0.72);
    expect(result.confidence).toBe(0.80);
    expect(result.reasoning).toBe('Recent polling shows a clear lead.');
    expect(result.recommendation).toBe('BUY_YES');
  });

  it('should parse BUY_NO recommendation', () => {
    const text = JSON.stringify({
      probability:    0.25,
      confidence:     0.75,
      reasoning:      'Market is overestimating the probability.',
      recommendation: 'BUY_NO',
    });

    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('BUY_NO');
  });

  it('should parse SKIP recommendation', () => {
    const text = JSON.stringify({
      probability:    0.50,
      confidence:     0.55,
      reasoning:      'Insufficient edge and confidence.',
      recommendation: 'SKIP',
    });

    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
    expect(result.probability).toBe(0.50);
  });

  it('should extract JSON when it is embedded in surrounding prose', () => {
    // Claude sometimes outputs text before/after the JSON despite instructions
    const text = `Here is my analysis:
{
  "probability": 0.65,
  "confidence": 0.78,
  "reasoning": "Strong fundamentals suggest YES.",
  "recommendation": "BUY_YES"
}
Let me know if you need more detail.`;

    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('BUY_YES');
    expect(result.probability).toBe(0.65);
  });

  it('should parse boundary probability values (0 and 1)', () => {
    const textZero = JSON.stringify({ probability: 0, confidence: 0, reasoning: 'No chance', recommendation: 'SKIP' });
    const textOne  = JSON.stringify({ probability: 1, confidence: 1, reasoning: 'Certain', recommendation: 'BUY_YES' });

    expect(parseClaudeResponse(textZero).probability).toBe(0);
    expect(parseClaudeResponse(textOne).probability).toBe(1);
  });

});

describe('parseClaudeResponse — non-JSON response', () => {

  it('should return SKIP when Claude returns plain prose (no JSON)', () => {
    const text = 'I notice the recent bot trades show a NO trade at 0.755 that has status "lost" — this is significant because it suggests the market moved against you. I would recommend reviewing your position sizing strategy.';

    const result = parseClaudeResponse(text);

    expect(result.recommendation).toBe('SKIP');
    expect(result.probability).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('should return SKIP when response is empty', () => {
    const result = parseClaudeResponse('');
    expect(result.recommendation).toBe('SKIP');
  });

  it('should return SKIP when response is only whitespace', () => {
    const result = parseClaudeResponse('   \n\t  ');
    expect(result.recommendation).toBe('SKIP');
  });

});

describe('parseClaudeResponse — malformed JSON', () => {

  it('should return SKIP when JSON is missing closing brace (no match found)', () => {
    // No closing brace → regex finds no {…} block → "non-JSON response" path
    const text = '{ "probability": 0.72, "confidence": 0.80, "reasoning": "ok", "recommendation": "BUY_YES"';
    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
    expect(result.reasoning).toBe('Claude returned non-JSON response');
  });

  it('should return SKIP when JSON has trailing comma (invalid JSON)', () => {
    const text = '{ "probability": 0.72, "confidence": 0.80, "reasoning": "ok", "recommendation": "BUY_YES", }';
    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
  });

  it('should return SKIP when JSON has unquoted string values', () => {
    const text = '{ "probability": 0.72, "confidence": 0.80, "reasoning": ok, "recommendation": BUY_YES }';
    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
  });

});

describe('parseClaudeResponse — Zod schema validation', () => {

  it('should return SKIP when probability is above 1.0', () => {
    const text = JSON.stringify({ probability: 1.5, confidence: 0.8, reasoning: 'test', recommendation: 'BUY_YES' });
    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
    expect(result.reasoning).toBe('Claude response failed schema validation');
  });

  it('should return SKIP when probability is below 0', () => {
    const text = JSON.stringify({ probability: -0.1, confidence: 0.8, reasoning: 'test', recommendation: 'BUY_YES' });
    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
  });

  it('should return SKIP when confidence is above 1.0', () => {
    const text = JSON.stringify({ probability: 0.7, confidence: 1.1, reasoning: 'test', recommendation: 'BUY_YES' });
    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
  });

  it('should return SKIP when recommendation is not a valid enum value', () => {
    const text = JSON.stringify({ probability: 0.7, confidence: 0.8, reasoning: 'test', recommendation: 'BUY' });
    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
    expect(result.reasoning).toBe('Claude response failed schema validation');
  });

  it('should return SKIP when recommendation is lowercase', () => {
    const text = JSON.stringify({ probability: 0.7, confidence: 0.8, reasoning: 'test', recommendation: 'buy_yes' });
    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
  });

  it('should return SKIP when probability field is missing', () => {
    const text = JSON.stringify({ confidence: 0.8, reasoning: 'test', recommendation: 'BUY_YES' });
    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
  });

  it('should return SKIP when probability is a string instead of number', () => {
    const text = JSON.stringify({ probability: '0.7', confidence: 0.8, reasoning: 'test', recommendation: 'BUY_YES' });
    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
  });

  it('should return SKIP when reasoning field is missing', () => {
    const text = JSON.stringify({ probability: 0.7, confidence: 0.8, recommendation: 'BUY_YES' });
    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
  });

  it('should return SKIP when extra/only unknown keys are present (no required fields)', () => {
    const text = JSON.stringify({ action: 'BUY_YES', score: 0.9 });
    const result = parseClaudeResponse(text);
    expect(result.recommendation).toBe('SKIP');
  });

});