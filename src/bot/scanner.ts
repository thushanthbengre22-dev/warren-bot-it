import axios from 'axios';

export interface Market {
  id: string;
  question: string;
  description: string;
  yesPrice: number;   // 0–1 implied probability
  noPrice: number;
  yesLabel: string;   // e.g. "Yes", "Gen.G", "Trump"
  noLabel: string;    // e.g. "No", "LYON", "Harris"
  volume: number;
  endDate: string;
  active: boolean;
}

const POLYMARKET_API = 'https://gamma-api.polymarket.com';

function parsePrices(m: any): { yesPrice: number; noPrice: number; yesLabel: string; noLabel: string } | null {
  try {
    const outcomes: string[] = JSON.parse(m.outcomes ?? '[]');
    const prices: string[]   = JSON.parse(m.outcomePrices ?? '[]');
    if (outcomes.length < 2 || prices.length < 2) return null;

    // Prefer canonical Yes/No positions
    const yesIdx = outcomes.findIndex((o: string) => o.toLowerCase() === 'yes');
    const noIdx  = outcomes.findIndex((o: string) => o.toLowerCase() === 'no');

    // Fall back to first/second outcome for team or pointer markets
    const resolvedYesIdx = yesIdx !== -1 ? yesIdx : 0;
    const resolvedNoIdx  = noIdx  !== -1 ? noIdx  : 1;

    return {
      yesPrice: parseFloat(prices[resolvedYesIdx]),
      noPrice:  parseFloat(prices[resolvedNoIdx]),
      yesLabel: outcomes[resolvedYesIdx],
      noLabel:  outcomes[resolvedNoIdx],
    };
  } catch {
    return null;
  }
}

export interface MarketPrice {
  yesPrice: number;
  noPrice: number;
  yesLabel: string;
  noLabel: string;
  closed: boolean;    // truly resolved by Polymarket (m.closed)
  inactive: boolean;  // trading paused/halted but not yet resolved
}

export async function fetchMarketPrice(marketId: string): Promise<MarketPrice | null> {
  try {
    const response = await axios.get(`${POLYMARKET_API}/markets`, {
      params: { conditionIds: marketId, limit: 1 },
      timeout: 8_000,
    });
    const markets = response.data as any[];
    if (!markets?.length) return null;
    const m = markets[0];
    const prices = parsePrices(m);
    if (!prices) return null;
    return { ...prices, closed: !!m.closed, inactive: !m.active };
  } catch {
    return null;
  }
}

export async function fetchMarkets(limit = 10): Promise<Market[]> {
  const response = await axios.get(`${POLYMARKET_API}/markets`, {
    params: {
      closed: false,
      limit,
      order: 'volume24hr',
      ascending: false,
    },
    timeout: 10_000,
  });

  const raw = response.data as any[];
  return raw
    .filter(m => m.active && !m.closed)
    .flatMap(m => {
      const prices = parsePrices(m);
      if (!prices) return [];   // skip non-Yes/No markets (sports, team names, etc.)
      return [{
        id:          m.conditionId ?? m.id,
        question:    m.question,
        description: m.description ?? '',
        yesPrice:    prices.yesPrice,
        noPrice:     prices.noPrice,
        yesLabel:    prices.yesLabel,
        noLabel:     prices.noLabel,
        volume:      parseFloat(m.volume ?? '0'),
        endDate:     m.endDate ?? '',
        active:      m.active,
      } satisfies Market];
    });
}