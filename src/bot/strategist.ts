import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { CONFIG } from '../config';
import type { Recommendation } from '../config';
import { Market } from './scanner';
import { getRecentTrades } from '../store/memory';

const client = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });

export interface StrategyResult {
  probability: number;
  confidence: number;
  reasoning: string;
  recommendation: Recommendation;
}

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

  const prompt = `
Market: ${market.question}
Description: ${market.description}
YES means: "${market.yesLabel}" | NO means: "${market.noLabel}"
Current YES price: ${market.yesPrice} (implied ${(market.yesPrice * 100).toFixed(1)}% probability)
Current NO price: ${market.noPrice} (implied ${(market.noPrice * 100).toFixed(1)}% probability)
24h Volume: $${market.volume.toFixed(0)}
Closes: ${market.endDate}

Recent news:
${news}

${tradeContext}

Estimate the true probability that the YES outcome ("${market.yesLabel}") occurs.
Return JSON only — no markdown, no explanation outside the JSON:
{
  "probability": <0.0–1.0>,
  "confidence": <0.0–1.0>,
  "reasoning": "<one or two sentences>",
  "recommendation": "<BUY_YES | BUY_NO | SKIP>"
}
`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system: `You are a prediction market analyst. You MUST respond with valid JSON only — no prose, no explanation, no markdown, no preamble. Your entire response must be a single JSON object.
Only recommend a trade if:
- Your probability differs from market price by > ${CONFIG.MIN_EDGE * 100}%
- Your confidence is > ${CONFIG.MIN_CONFIDENCE}
- The news is recent and relevant
When uncertain, set recommendation to SKIP. Capital preservation > chasing signals.`,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found in Claude response: ${text.slice(0, 100)}`);
  const result: StrategyResult = JSON.parse(match[0]);
  return result;
}