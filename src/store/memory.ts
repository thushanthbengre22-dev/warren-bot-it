import { getRedis } from './redis';
import { emitUpdate } from './events';

const WALLET_KEY = 'warren:wallet';

export interface Trade {
  id: string;
  timestamp: string;
  marketId: string;         // conditionId — for CLOB trading
  marketInternalId: string; // Gamma API internal id — for price lookups
  marketQuestion: string;
  side: 'YES' | 'NO';
  marketPrice: number;
  claudeEstimate: number;
  edge: number;
  amount: number;
  shares: number;
  status: 'open' | 'won' | 'lost' | 'cancelled';
  payout?: number;
  resolvedAt?: string;
  currentPrice?: number;
  lastPriceAt?: string;
}

export interface WalletState {
  balance: number;
  totalDeposited: number;
  totalPnl: number;
  trades: Trade[];
}

const DEFAULT_WALLET: WalletState = {
  balance: 50.00,
  totalDeposited: 50.00,
  totalPnl: 0,
  trades: [],
};

async function loadState(): Promise<WalletState> {
  const raw = await getRedis().get(WALLET_KEY);
  if (!raw) return { ...DEFAULT_WALLET, trades: [] };
  return JSON.parse(raw);
}

async function saveState(state: WalletState): Promise<void> {
  await getRedis().set(WALLET_KEY, JSON.stringify(state));
}

export async function getWalletState(): Promise<WalletState> {
  return loadState();
}

export async function resetWallet(): Promise<void> {
  await saveState({ ...DEFAULT_WALLET, trades: [] });
}

export async function recordTrade(trade: Omit<Trade, 'id' | 'timestamp'>): Promise<Trade> {
  const state = await loadState();
  const newTrade: Trade = {
    id: `trade_${Date.now()}`,
    timestamp: new Date().toISOString(),
    ...trade,
  };
  state.balance -= newTrade.amount;
  state.trades.push(newTrade);
  await saveState(state);
  emitUpdate();
  return newTrade;
}

export async function resolveTrade(id: string, payout: number, status: 'won' | 'lost'): Promise<Trade | null> {
  const state = await loadState();
  const trade = state.trades.find(t => t.id === id);
  if (!trade) return null;
  trade.status = status;
  trade.payout = payout;
  trade.resolvedAt = new Date().toISOString();
  state.balance += payout;
  state.totalPnl += payout - trade.amount;
  await saveState(state);
  emitUpdate();
  return trade;
}

export async function updateTradePrice(id: string, currentPrice: number): Promise<void> {
  const state = await loadState();
  const trade = state.trades.find(t => t.id === id);
  if (!trade) return;
  trade.currentPrice = currentPrice;
  trade.lastPriceAt  = new Date().toISOString();
  await saveState(state);
}

export async function getOpenTrades(): Promise<Trade[]> {
  const state = await loadState();
  return state.trades.filter(t => t.status === 'open');
}

export async function getRecentTrades(limit = 10): Promise<Trade[]> {
  const state = await loadState();
  return state.trades.slice(-limit);
}

export async function getPnlSummary(): Promise<{ balance: number; totalPnl: number; openTrades: number; winRate: string }> {
  const state = await loadState();
  const closed = state.trades.filter(t => t.status === 'won' || t.status === 'lost');
  const wins = closed.filter(t => t.status === 'won').length;
  const winRate = closed.length > 0 ? `${((wins / closed.length) * 100).toFixed(1)}%` : 'N/A';
  return {
    balance: state.balance,
    totalPnl: state.totalPnl,
    openTrades: state.trades.filter(t => t.status === 'open').length,
    winRate,
  };
}