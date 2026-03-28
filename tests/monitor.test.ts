/**
 * monitor.test.ts
 *
 * Tests for monitorPositions() in src/bot/monitor.ts.
 *
 * THE BUG (open trades auto-closing with 100% loss):
 *   When prices.endDate is empty string (falsy), the guard
 *   `if (endDate && endDate > new Date())` evaluates to false because
 *   endDate is null. The code falls through and auto-resolves the trade
 *   as 100% loss. Two tests below document this — they FAIL before the
 *   fix and PASS after.
 */

jest.mock('../src/bot/scanner');
jest.mock('../src/store/memory');
jest.mock('../src/integrations/telegram');

import { monitorPositions } from '../src/bot/monitor';
import { fetchMarketPrice } from '../src/bot/scanner';
import { getOpenTrades, resolveTrade } from '../src/store/memory';
import type { Trade } from '../src/store/memory';
import type { MarketPrice } from '../src/bot/scanner';

const mockFetchMarketPrice = fetchMarketPrice as jest.MockedFunction<typeof fetchMarketPrice>;
const mockGetOpenTrades    = getOpenTrades    as jest.MockedFunction<typeof getOpenTrades>;
const mockResolveTrade     = resolveTrade     as jest.MockedFunction<typeof resolveTrade>;

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id:                'trade_001',
    timestamp:         '2026-03-01T10:00:00.000Z',
    marketId:          '0xabc123',
    marketInternalId:  '987654',
    marketQuestion:    'Will candidate X win the election?',
    side:            'YES',
    marketPrice:     0.755,
    claudeEstimate:  0.85,
    edge:            0.095,
    amount:          5,
    shares:          6.62,
    status:          'open',
    ...overrides,
  };
}

function makePrice(overrides: Partial<MarketPrice> = {}): MarketPrice {
  return {
    yesPrice:  0.5,
    noPrice:   0.5,
    yesLabel:  'Yes',
    noLabel:   'No',
    closed:    false,
    inactive:  false,
    endDate:   '2026-12-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockResolveTrade.mockResolvedValue(makeTrade({ status: 'lost' }));
});

// ────────────────────────────────────────────────────────────────────────────
// ⚠️  BUG TESTS — these FAIL before the fix, PASS after
// ────────────────────────────────────────────────────────────────────────────

describe('BUG: auto-close with 100% loss when endDate is missing', () => {

  it('should NOT close trade when closed=true but endDate is empty string', async () => {
    // This simulates what Polymarket returns when a market closes for trading
    // but endDate is not set in the API response (stored as empty string).
    // The trade's YES price is 0.01 — looks like it "lost" but the market
    // hasn't actually been resolved on-chain.
    mockGetOpenTrades.mockResolvedValue([makeTrade()]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({
      yesPrice: 0.01,
      noPrice:  0.99,
      closed:   true,
      endDate:  '',   // ← empty string is falsy → endDate becomes null → guard skipped
    }));

    await monitorPositions();

    // BUG: resolveTrade IS called with payout=0 (100% loss)
    // EXPECTED after fix: resolveTrade should NOT be called
    expect(mockResolveTrade).not.toHaveBeenCalled();
  });

  it('should NOT close trade when closed=true but endDate is whitespace', async () => {
    mockGetOpenTrades.mockResolvedValue([makeTrade()]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({
      yesPrice: 0.01,
      noPrice:  0.99,
      closed:   true,
      endDate:  '   ',  // ← whitespace is also falsy-ish via new Date('   ')
    }));

    await monitorPositions();

    expect(mockResolveTrade).not.toHaveBeenCalled();
  });

});

// ────────────────────────────────────────────────────────────────────────────
// ✅ PASSING TESTS — correct behavior, should pass before and after fix
// ────────────────────────────────────────────────────────────────────────────

describe('market closed flag handling', () => {

  it('should skip trade when market is inactive but not closed', async () => {
    mockGetOpenTrades.mockResolvedValue([makeTrade()]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({ inactive: true, closed: false }));

    await monitorPositions();

    expect(mockResolveTrade).not.toHaveBeenCalled();
  });

  it('should skip trade when closed=true but endDate just passed (within 2h settlement buffer)', async () => {
    // endDate is 30 min ago — trading just closed but not yet settled on-chain
    mockGetOpenTrades.mockResolvedValue([makeTrade()]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({
      yesPrice: 0.01,
      noPrice:  0.99,
      closed:   true,
      endDate:  new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
    }));

    await monitorPositions();

    expect(mockResolveTrade).not.toHaveBeenCalled();
  });

  it('should skip trade when closed=true but endDate is in the future', async () => {
    mockGetOpenTrades.mockResolvedValue([makeTrade()]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({
      yesPrice: 0.01,
      noPrice:  0.99,
      closed:   true,
      endDate:  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
    }));

    await monitorPositions();

    expect(mockResolveTrade).not.toHaveBeenCalled();
  });

  it('should skip trade when closed=true but price is ambiguous (not 0 or 1)', async () => {
    mockGetOpenTrades.mockResolvedValue([makeTrade()]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({
      yesPrice: 0.45,
      noPrice:  0.55,
      closed:   true,
      endDate:  '2026-01-01T00:00:00.000Z', // past date
    }));

    await monitorPositions();

    expect(mockResolveTrade).not.toHaveBeenCalled();
  });

  it('should resolve as WON when closed, past endDate, YES price=0.99', async () => {
    const trade = makeTrade({ side: 'YES', shares: 6.62, amount: 5 });
    mockGetOpenTrades.mockResolvedValue([trade]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({
      yesPrice: 0.99,
      noPrice:  0.01,
      closed:   true,
      endDate:  '2026-01-01T00:00:00.000Z',
    }));

    await monitorPositions();

    expect(mockResolveTrade).toHaveBeenCalledWith(
      trade.id,
      trade.shares,  // each winning share settles at $1
      'won',
    );
  });

  it('should resolve as LOST when closed, past endDate, YES price=0.01', async () => {
    const trade = makeTrade({ side: 'YES', shares: 6.62, amount: 5 });
    mockGetOpenTrades.mockResolvedValue([trade]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({
      yesPrice: 0.01,
      noPrice:  0.99,
      closed:   true,
      endDate:  '2026-01-01T00:00:00.000Z',
    }));

    await monitorPositions();

    expect(mockResolveTrade).toHaveBeenCalledWith(trade.id, 0, 'lost');
  });

  it('should resolve NO-side trade as WON when closed, NO price=0.99', async () => {
    const trade = makeTrade({ side: 'NO', shares: 6.62, amount: 5 });
    mockGetOpenTrades.mockResolvedValue([trade]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({
      yesPrice: 0.01,
      noPrice:  0.99,
      closed:   true,
      endDate:  '2026-01-01T00:00:00.000Z',
    }));

    await monitorPositions();

    expect(mockResolveTrade).toHaveBeenCalledWith(trade.id, trade.shares, 'won');
  });

});

describe('stop-loss and take-profit logic', () => {

  it('should trigger stop-loss when return drops to -25%', async () => {
    // shares=10, amount=5 → breakeven at price=0.5
    // stop-loss at 25% loss → price=0.375 → return=-25%
    const trade = makeTrade({ side: 'YES', marketPrice: 0.5, shares: 10, amount: 5 });
    mockGetOpenTrades.mockResolvedValue([trade]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({
      yesPrice: 0.375,
      closed:   false,
      endDate:  new Date(Date.now() + 86400000).toISOString(),
    }));

    await monitorPositions();

    expect(mockResolveTrade).toHaveBeenCalledWith(
      trade.id,
      trade.shares * 0.375,
      'lost',
    );
  });

  it('should trigger take-profit when return reaches +25%', async () => {
    // shares=10, amount=5 → take-profit price=0.625 → return=+25%
    const trade = makeTrade({ side: 'YES', marketPrice: 0.5, shares: 10, amount: 5 });
    mockGetOpenTrades.mockResolvedValue([trade]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({
      yesPrice: 0.625,
      closed:   false,
      endDate:  new Date(Date.now() + 86400000).toISOString(),
    }));

    await monitorPositions();

    expect(mockResolveTrade).toHaveBeenCalledWith(
      trade.id,
      trade.shares * 0.625,
      'won',
    );
  });

  it('should hold trade when return is within -25% to +25% range', async () => {
    const trade = makeTrade({ side: 'YES', marketPrice: 0.5, shares: 10, amount: 5 });
    mockGetOpenTrades.mockResolvedValue([trade]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({
      yesPrice: 0.55,  // +10% return — within bounds
      closed:   false,
    }));

    await monitorPositions();

    expect(mockResolveTrade).not.toHaveBeenCalled();
  });

});

describe('zero price guard', () => {

  it('should skip trade when both prices are 0 (stale/corrupt API data)', async () => {
    // This is the exact scenario that caused the Iran market 100% loss:
    // Polymarket returned yesPrice=0, noPrice=0, endDate=2020-11-04 (5 years ago)
    // finalPrice=0 satisfied <=0.01 → isDefinitivelyResolved=true → payout=0
    mockGetOpenTrades.mockResolvedValue([makeTrade({ side: 'NO' })]);
    mockFetchMarketPrice.mockResolvedValue(makePrice({
      yesPrice: 0,
      noPrice:  0,
      closed:   true,
      endDate:  '2020-11-04T00:00:00.000Z', // bogus stale endDate from API
    }));

    await monitorPositions();

    expect(mockResolveTrade).not.toHaveBeenCalled();
  });

});

describe('edge cases', () => {

  it('should do nothing when there are no open trades', async () => {
    mockGetOpenTrades.mockResolvedValue([]);

    await monitorPositions();

    expect(mockFetchMarketPrice).not.toHaveBeenCalled();
    expect(mockResolveTrade).not.toHaveBeenCalled();
  });

  it('should skip trade gracefully when fetchMarketPrice returns null', async () => {
    mockGetOpenTrades.mockResolvedValue([makeTrade()]);
    mockFetchMarketPrice.mockResolvedValue(null);

    await monitorPositions();

    expect(mockResolveTrade).not.toHaveBeenCalled();
  });

  it('should continue processing other trades when one fetch fails', async () => {
    const trade1 = makeTrade({ id: 'trade_001', marketId: '0xaaa' });
    // trade2 set up so price 0.65 → return = (10*0.65-5)/5 = +30% → take profit
    const trade2 = makeTrade({ id: 'trade_002', marketId: '0xbbb', marketPrice: 0.5, shares: 10, amount: 5 });
    mockGetOpenTrades.mockResolvedValue([trade1, trade2]);

    // First trade fetch throws, second returns price in take-profit zone
    mockFetchMarketPrice
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(makePrice({
        yesPrice: 0.65,   // +30% return → take profit
        closed:   false,
      }));

    await monitorPositions();

    // trade1 errored — skipped. trade2 hit take-profit.
    expect(mockResolveTrade).toHaveBeenCalledTimes(1);
    expect(mockResolveTrade).toHaveBeenCalledWith(trade2.id, expect.any(Number), 'won');
  });

});