import cron from 'node-cron';
import { CONFIG } from './config';
import { fetchMarkets } from './bot/scanner';
import { analyzeMarket } from './bot/strategist';
import { buildSignal } from './bot/executor';
import { monitorPositions } from './bot/monitor';
import { sendSignal, notify, initTelegram } from './integrations/telegram';
import { getWalletState } from './store/memory';
import { setCronRunning, setLastScan, setCurrentMarket } from './store/state';
import { startDashboard } from './integrations/dashboard';

let isRunning = false;

function nextCronTime(): string {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  // If next hour is outside 8–23 window, jump to 08:00 next day
  if (next.getHours() < 8 || next.getHours() > 23) {
    next.setDate(next.getDate() + (next.getHours() < 8 ? 0 : 1));
    next.setHours(8, 0, 0, 0);
  }
  return next.toISOString();
}

async function scanCycle(): Promise<void> {
  if (isRunning) {
    console.log('[Cron] Previous scan still running, skipping cycle.');
    return;
  }
  isRunning = true;
  setCronRunning(true);

  const wallet = await getWalletState();
  if (wallet.balance <= 0) {
    console.log('[Bot] Balance depleted. Stopping.');
    notify('🛑 Virtual balance depleted. Bot stopped.');
    process.exit(0);
  }

  console.log(`\n[Scan] Starting cycle — balance: $${wallet.balance.toFixed(2)}`);

  try {
    const markets = await fetchMarkets(CONFIG.MARKETS_PER_SCAN);
    console.log(`[Scan] Fetched ${markets.length} markets`);

    for (const market of markets) {
      try {
        setCurrentMarket(market.question);
        console.log(`[Analyze] ${market.question.slice(0, 60)}...`);
        const strategy = await analyzeMarket(market);
        console.log(`  → ${strategy.recommendation} | estimate: ${(strategy.probability * 100).toFixed(1)}% | confidence: ${(strategy.confidence * 100).toFixed(0)}%`);

        const signal = await buildSignal(market, strategy);
        if (signal) {
          console.log(`  ✔ Signal found! Edge: +${(signal.edge * 100).toFixed(1)}%`);
          sendSignal(signal);
        }

        await new Promise(r => setTimeout(r, 3000));
      } catch (err) {
        console.error(`[Analyze] Error on market ${market.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[Scan] Fatal error in cycle:', err);
    notify('⚠️ Scan cycle error — check logs.');
  } finally {
    isRunning = false;
    setCronRunning(false);
    setCurrentMarket(null);
    setLastScan(new Date().toISOString(), nextCronTime());
    console.log('[Scan] Cycle complete.');
  }
}

async function main(): Promise<void> {
  console.log('🤖 Warren Bot starting...');
  const startWallet = await getWalletState();
  console.log(`   Virtual balance: $${startWallet.balance.toFixed(2)}`);
  console.log(`   Min edge: ${CONFIG.MIN_EDGE * 100}% | Min confidence: ${CONFIG.MIN_CONFIDENCE * 100}%`);
  console.log(`   Cron: ${CONFIG.CRON_SCHEDULE}`);

  startDashboard();
  initTelegram();

  await scanCycle();

  cron.schedule(CONFIG.CRON_SCHEDULE, scanCycle, { timezone: 'America/New_York' });
  cron.schedule(CONFIG.MONITOR_SCHEDULE, monitorPositions, { timezone: 'America/New_York' });
  console.log('[Cron] Scheduled. Market scan: hourly | Position monitor: every 15 min. Bot is live.');
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});