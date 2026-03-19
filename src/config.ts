import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

export const CONFIG = {
  // Safety limits
  MAX_BANKROLL:     50.00,
  MAX_TRADE_SIZE:    5.00,
  MIN_EDGE:          0.10,
  MIN_CONFIDENCE:    0.70,
  REQUIRE_APPROVAL:  true,

  // Cron schedule (hourly, 8am–11pm)
  CRON_SCHEDULE: '0 8-23 * * *',

  // How many markets to scan per cycle
  MARKETS_PER_SCAN: 10,

  // API keys
  ANTHROPIC_API_KEY:   process.env.ANTHROPIC_API_KEY   ?? '',
  TELEGRAM_BOT_TOKEN:  process.env.TELEGRAM_BOT_TOKEN  ?? '',
  TELEGRAM_CHAT_ID:    process.env.TELEGRAM_CHAT_ID    ?? '',
  TAVILY_API_KEY:      process.env.TAVILY_API_KEY       ?? '',
  REDIS_URL:           process.env.REDIS_URL            ?? 'redis://localhost:6379',
};

export type Recommendation = 'BUY_YES' | 'BUY_NO' | 'SKIP';