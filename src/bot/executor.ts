import { CONFIG } from '../config';
import { Market } from './scanner';
import { StrategyResult } from './strategist';
import { recordTrade, getWalletState, getOpenTrades, Trade } from '../store/memory';
import { getState } from '../store/state';

export interface TradeSignal {
  market: Market;
  strategy: StrategyResult;
  side: 'YES' | 'NO';
  marketPrice: number;
  edge: number;
  amount: number;
}

export async function buildSignal(market: Market, strategy: StrategyResult): Promise<TradeSignal | null> {
  const skip = (reason: string) => { console.log(`  ↳ no signal: ${reason}`); return null; };

  if (strategy.recommendation === 'SKIP') return null;
  if (strategy.confidence < CONFIG.MIN_CONFIDENCE)
    return skip(`confidence ${(strategy.confidence * 100).toFixed(0)}% < ${CONFIG.MIN_CONFIDENCE * 100}%`);

  const side = strategy.recommendation === 'BUY_YES' ? 'YES' : 'NO';
  const marketPrice = side === 'YES' ? market.yesPrice : market.noPrice;
  const edge = Math.abs(strategy.probability - marketPrice);

  if (edge < CONFIG.MIN_EDGE)
    return skip(`edge ${(edge * 100).toFixed(1)}% < ${CONFIG.MIN_EDGE * 100}% (market ${(marketPrice * 100).toFixed(1)}% vs estimate ${(strategy.probability * 100).toFixed(1)}%)`);

  const openTrades = await getOpenTrades();
  if (openTrades.some(t => t.marketId === market.id))
    return skip('already have open position');

  if (getState().pendingApprovals.some(a => a.id === market.id))
    return skip('already pending approval');

  const wallet = await getWalletState();
  if (wallet.balance <= 0) return skip('balance depleted');

  const amount = Math.min(CONFIG.MAX_TRADE_SIZE, wallet.balance);
  return { market, strategy, side, marketPrice, edge, amount };
}

export async function simulateTrade(signal: TradeSignal): Promise<Trade> {
  const shares = signal.amount / signal.marketPrice;

  const trade = await recordTrade({
    marketId:       signal.market.id,
    marketQuestion: signal.market.question,
    side:           signal.side,
    marketPrice:    signal.marketPrice,
    claudeEstimate: signal.strategy.probability,
    edge:           signal.edge,
    amount:         signal.amount,
    shares,
    status:         'open',
  });

  console.log(`[PAPER TRADE] ${trade.side} ${trade.shares.toFixed(2)} shares @ ${trade.marketPrice} — $${trade.amount} — ${trade.marketQuestion}`);
  return trade;
}