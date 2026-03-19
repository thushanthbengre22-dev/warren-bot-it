import express from 'express';
import path from 'path';
import { getWalletState, getPnlSummary } from '../store/memory';
import { getState } from '../store/state';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || origin === 'https://www.bengredev.com' || origin === 'https://bengredev.com') {
    res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  next();
});

app.use(express.static(path.resolve(__dirname, '../../public')));

app.get('/api/wallet', async (_req, res) => {
  const [summary, wallet] = await Promise.all([getPnlSummary(), getWalletState()]);
  res.json({
    balance:        wallet.balance,
    totalDeposited: wallet.totalDeposited,
    totalPnl:       wallet.totalPnl,
    openTrades:     summary.openTrades,
    winRate:        summary.winRate,
  });
});

app.get('/api/trades', async (_req, res) => {
  const wallet = await getWalletState();
  res.json(wallet.trades);
});

app.get('/api/status', (_req, res) => {
  res.json(getState());
});

app.get('/api/trends', async (_req, res) => {
  const wallet = await getWalletState();
  const byDay: Record<string, { spent: number; returned: number; trades: number }> = {};

  for (const trade of wallet.trades) {
    const day = trade.timestamp.slice(0, 10);
    if (!byDay[day]) byDay[day] = { spent: 0, returned: 0, trades: 0 };
    byDay[day].spent  += trade.amount;
    byDay[day].trades += 1;
    if (trade.status === 'won' && trade.payout) byDay[day].returned += trade.payout;
  }

  const trends = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      spent:    parseFloat(d.spent.toFixed(2)),
      returned: parseFloat(d.returned.toFixed(2)),
      net:      parseFloat((d.returned - d.spent).toFixed(2)),
      trades:   d.trades,
    }));

  res.json(trends);
});

// SSE — push live updates every 3 seconds
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = async () => {
    const [wallet, status] = await Promise.all([getPnlSummary(), Promise.resolve(getState())]);
    res.write(`data: ${JSON.stringify({ wallet, status })}\n\n`);
  };

  send();
  const interval = setInterval(send, 3000);
  req.on('close', () => clearInterval(interval));
});

export function startDashboard(): void {
  app.listen(PORT, () => {
    console.log(`[Dashboard] Running at http://localhost:${PORT}`);
  });
}