// Shared runtime state — updated by the bot, read by the dashboard
import { TradeSignal } from '../bot/executor';

export interface PendingApproval {
  id: string;
  marketQuestion: string;
  side: 'YES' | 'NO';
  edge: number;
  amount: number;
  sentAt: string;
}

interface BotState {
  cronRunning: boolean;
  lastScanAt: string | null;
  nextScanAt: string | null;
  currentlyScanningMarket: string | null;
  pendingApprovals: PendingApproval[];
  startedAt: string;
}

const state: BotState = {
  cronRunning: false,
  lastScanAt: null,
  nextScanAt: null,
  currentlyScanningMarket: null,
  pendingApprovals: [],
  startedAt: new Date().toISOString(),
};

// Signal store — keyed by short ID, looked up on Telegram callback
const signalStore = new Map<string, TradeSignal>();

export function storeSignal(id: string, signal: TradeSignal): void {
  signalStore.set(id, signal);
}

export function popSignal(id: string): TradeSignal | undefined {
  const signal = signalStore.get(id);
  signalStore.delete(id);
  return signal;
}

export function getState(): Readonly<BotState> {
  return state;
}

export function setCronRunning(running: boolean): void {
  state.cronRunning = running;
}

export function setLastScan(last: string, next: string): void {
  state.lastScanAt = last;
  state.nextScanAt = next;
}

export function setCurrentMarket(question: string | null): void {
  state.currentlyScanningMarket = question;
}

export function addPendingApproval(approval: PendingApproval): void {
  state.pendingApprovals.push(approval);
}

export function removePendingApproval(id: string): void {
  const idx = state.pendingApprovals.findIndex(a => a.id === id);
  if (idx !== -1) state.pendingApprovals.splice(idx, 1);
}