import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { z } from 'zod';
import { CONFIG } from '../config';
import { Market } from './scanner';
import { getRecentTrades } from '../store/memory';

const client = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });

const StrategyResultSchema = z.object({
  probability:    z.number().min(0).max(1),
  confidence:     z.number().min(0).max(1),
  reasoning:      z.string(),
  recommendation: z.enum(['BUY_YES', 'BUY_NO', 'SKIP']),
});

export type StrategyResult = z.infer<typeof StrategyResultSchema>;

async function fetchNews(query: string): Promise<string> {
  if (!CONFIG.TAVILY_API_KEY) return 'No news API configured.';
  try {
    const res = await axios.post('https://api.tavily.com/search', {
      api_key: CONFIG.TAVILY_API_KEY,
      query,
      search_depth: 'basic',
      max_results: 3,
    }, { timeout: 8_000 });

    return (res.data.results as { title: string; content?: string }[])
      .map(r => `• ${r.title}: ${r.content?.slice(0, 200)}`)
      .join('\n');
  } catch {
    return 'Could not fetch news.';
  }
}

export async function analyzeMarket(market: Market): Promise<StrategyResult> {
  const news = await fetchNews(market.question);
  const recentTrades = await getRecentTrades(5);
  const tradeContext = recentTrades.length > 0
    ? `Recent bot trades:\n${recentTrades.map(t =>
        `- ${t.marketQuestion}: ${t.side} @ ${t.marketPrice} (status: ${t.status})`
      ).join('\n')}`
    : 'No recent trades.';

  const now = new Date().toISOString();
  const prompt = `
Today's date/time (UTC): ${now}
Market: ${market.question}
Description: ${market.description}
YES means: "${market.yesLabel}" | NO means: "${market.noLabel}"
Current YES price: ${market.yesPrice} (implied ${(market.yesPrice * 100).toFixed(1)}% probability)
Current NO price: ${market.noPrice} (implied ${(market.noPrice * 100).toFixed(1)}% probability)
24h Volume: $${market.volume.toFixed(0)}
Market resolution deadline: ${market.endDate} (note: for sports this may be 24-48h after the actual event)

Recent news:
${news}

${tradeContext}

IMPORTANT: If the news or the market question suggests the underlying event has already taken place, return SKIP immediately.
Estimate the true probability that the YES outcome ("${market.yesLabel}") occurs.

You MUST respond with a single JSON object exactly matching this structure — no markdown, no prose, no extra keys:
{
  "probability": 0.72,
  "confidence": 0.80,
  "reasoning": "Recent polls show candidate leading by 8 points with high turnout expected.",
  "recommendation": "BUY_YES"
}

Field rules:
- probability: number 0.0–1.0
- confidence: number 0.0–1.0
- reasoning: one or two sentences, plain text
- recommendation: exactly one of "BUY_YES", "BUY_NO", or "SKIP"
`;

  let message;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        system: `You are a prediction market analyst. You MUST respond with valid JSON only — no prose, no explanation, no markdown, no preamble. Your entire response must be a single JSON object.
Even if the event has already occurred or the market has expired, still return valid JSON with recommendation: "SKIP".
Only recommend a trade if:
- Your probability differs from market price by > ${CONFIG.MIN_EDGE * 100}%
- Your confidence is > ${CONFIG.MIN_CONFIDENCE}
- The news is recent and relevant
When uncertain, set recommendation to SKIP. Capital preservation > chasing signals.`,
        messages: [{ role: 'user', content: prompt }],
      });
      break;
    } catch (err: any) {
      if (attempt === 3 || err?.status !== 529) throw err;
      const delay = attempt * 15_000;
      console.warn(`[Strategist] Overloaded (529), retrying in ${delay / 1000}s... (attempt ${attempt}/3)`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  const text = message!.content[0].type === 'text' ? message!.content[0].text : '';
  return parseClaudeResponse(text);
}

export function parseClaudeResponse(text: string): StrategyResult {
  const match = text.match(/\{[\s\S]*}/);
  if (!match) {
    console.warn(`[Strategist] Non-JSON response from Claude, skipping market. Response: ${text.slice(0, 200)}`);
    return { probability: 0, confidence: 0, reasoning: 'Claude returned non-JSON response', recommendation: 'SKIP' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    console.warn(`[Strategist] JSON.parse failed, skipping market. Raw: ${match[0].slice(0, 200)}`);
    return { probability: 0, confidence: 0, reasoning: 'Claude returned malformed JSON', recommendation: 'SKIP' };
  }

  const result = StrategyResultSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(`[Strategist] Zod validation failed: ${result.error.message}. Raw: ${JSON.stringify(parsed)}`);
    return { probability: 0, confidence: 0, reasoning: 'Claude response failed schema validation', recommendation: 'SKIP' };
  }

  return result.data;
}