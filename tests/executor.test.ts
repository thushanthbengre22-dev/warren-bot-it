/**
 * executor.test.ts
 *
 * Tests for buildSignal() in src/bot/executor.ts.
 * All external dependencies (Redis, state) are mocked.
 */

jest.mock('../src/store/memory');
jest.mock('../src/store/state');
jest.mock('../src/store/events');

import { buildSignal } from '../src/bot/executor';
import { getOpenTrades, getWalletState } from '../src/store/memory';
import { getState } from '../src/store/state';
import type { Market } from '../src/bot/scanner';
import type { StrategyResult } from '../src/bot/strategist';

const mockGetOpenTrades  = getOpenTrades  as jest.MockedFunction<typeof getOpenTrades>;
const mockGetWalletState = getWalletState as jest.MockedFunction<typeof getWalletState>;
const mockGetState       = getState       as jest.MockedFunction<typeof getState>;

// ─── helpers ────────────────────────────────────────────────────────────────

function makeMarket(overrides: Partial<Market> = {}): Market {
  const endDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48h from now
  return {
    id:          'mkt_001',
    question:    'Will candidate X win?',
    description: 'US election market',
    yesPrice:    0.50,
    noPrice:     0.50,
    yesLabel:    'Yes',
    noLabel:     'No',
    volume:      100000,
    endDate,
    active:      true,
    ...overrides,
  };
}

function makeStrategy(overrides: Partial<StrategyResult> = {}): StrategyResult {
  return {
    probability:    0.65,   // 15% above market price of 0.50
    confidence:     0.80,
    reasoning:      'Strong fundamentals.',
    recommendation: 'BUY_YES',
    ...overrides,
  };
}

// ─── setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetOpenTrades.mockResolvedValue([]);
  mockGetWalletState.mockResolvedValue({
    balance:        50,
    totalDeposited: 50,
    totalPnl:       0,
    trades:         [],
  });
  mockGetState.mockReturnValue({
    cronRunning:              false,
    lastScanAt:               null,
    nextScanAt:               null,
    currentlyScanningMarket:  null,
    pendingApprovals:         [],
    startedAt:                new Date().toISOString(),
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ✅ Signal should be built
// ────────────────────────────────────────────────────────────────────────────

describe('buildSignal — should produce a signal', () => {

  it('should build a BUY_YES signal with sufficient edge and confidence', async () => {
    const market   = makeMarket({ yesPrice: 0.50 });
    const strategy = makeStrategy({ probability: 0.65, confidence: 0.80, recommendation: 'BUY_YES' });

    const signal = await buildSignal(market, strategy);

    expect(signal).not.toBeNull();
    expect(signal!.side).toBe('YES');
    expect(signal!.edge).toBeCloseTo(0.15);
    expect(signal!.amount).toBe(5);  // min(MAX_TRADE_SIZE=5, balance=50)
  });

  it('should build a BUY_NO signal', async () => {
    const market   = makeMarket({ noPrice: 0.40 });
    const strategy = makeStrategy({ probability: 0.25, confidence: 0.80, recommendation: 'BUY_NO' });

    const signal = await buildSignal(market, strategy);

    expect(signal).not.toBeNull();
    expect(signal!.side).toBe('NO');
  });

  it('should cap trade amount at MAX_TRADE_SIZE ($5) even with high balance', async () => {
    mockGetWalletState.mockResolvedValue({ balance: 50, totalDeposited: 50, totalPnl: 0, trades: [] });
    const signal = await buildSignal(makeMarket(), makeStrategy());
    expect(signal!.amount).toBe(5);
  });

  it('should use remaining balance when below MAX_TRADE_SIZE', async () => {
    mockGetWalletState.mockResolvedValue({ balance: 3, totalDeposited: 50, totalPnl: -47, trades: [] });
    const signal = await buildSignal(makeMarket(), makeStrategy());
    expect(signal!.amount).toBe(3);
  });

});

// ────────────────────────────────────────────────────────────────────────────
// ❌ Signal should be null
// ────────────────────────────────────────────────────────────────────────────

describe('buildSignal — should return null', () => {

  it('should return null when recommendation is SKIP', async () => {
    const strategy = makeStrategy({ recommendation: 'SKIP' });
    const signal = await buildSignal(makeMarket(), strategy);
    expect(signal).toBeNull();
  });

  it('should return null when confidence is below MIN_CONFIDENCE (0.70)', async () => {
    const strategy = makeStrategy({ confidence: 0.65 });
    const signal = await buildSignal(makeMarket(), strategy);
    expect(signal).toBeNull();
  });

  it('should return null when edge is below MIN_EDGE (0.10)', async () => {
    // market price 0.50, estimate 0.58 → edge=0.08 < 0.10
    const market   = makeMarket({ yesPrice: 0.50 });
    const strategy = makeStrategy({ probability: 0.58, recommendation: 'BUY_YES' });
    const signal = await buildSignal(market, strategy);
    expect(signal).toBeNull();
  });

  it('should return null when market ends in less than 2 hours', async () => {
    const endDate = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h from now
    const market = makeMarket({ endDate });
    const signal = await buildSignal(market, makeStrategy());
    expect(signal).toBeNull();
  });

  it('should return null when balance is zero', async () => {
    mockGetWalletState.mockResolvedValue({ balance: 0, totalDeposited: 50, totalPnl: -50, trades: [] });
    const signal = await buildSignal(makeMarket(), makeStrategy());
    expect(signal).toBeNull();
  });

  it('should return null when balance is negative', async () => {
    mockGetWalletState.mockResolvedValue({ balance: -1, totalDeposited: 50, totalPnl: -51, trades: [] });
    const signal = await buildSignal(makeMarket(), makeStrategy());
    expect(signal).toBeNull();
  });

  it('should return null when already have an open position in this market', async () => {
    const trade = {
      id: 'trade_existing', timestamp: '', marketId: 'mkt_001',
      marketQuestion: 'Will candidate X win?', side: 'YES' as const,
      marketPrice: 0.5, claudeEstimate: 0.65, edge: 0.15,
      amount: 5, shares: 10, status: 'open' as const,
    };
    mockGetOpenTrades.mockResolvedValue([trade]);

    const signal = await buildSignal(makeMarket({ id: 'mkt_001' }), makeStrategy());
    expect(signal).toBeNull();
  });

  it('should return null when market already has a pending approval', async () => {
    mockGetState.mockReturnValue({
      cronRunning: false, lastScanAt: null, nextScanAt: null,
      currentlyScanningMarket: null, startedAt: new Date().toISOString(),
      pendingApprovals: [{
        id: 'mkt_001',
        marketQuestion: 'Will candidate X win?',
        side: 'YES',
        edge: 0.15,
        amount: 5,
        sentAt: new Date().toISOString(),
      }],
    });

    const signal = await buildSignal(makeMarket({ id: 'mkt_001' }), makeStrategy());
    expect(signal).toBeNull();
  });

});