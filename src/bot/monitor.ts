import { getOpenTrades, resolveTrade, updateTradePrice, Trade } from '../store/memory';
import { fetchMarketPrice } from './scanner';
import { notify } from '../integrations/telegram';

const TAKE_PROFIT = 0.25;
const STOP_LOSS   = 0.25;

function currentReturn(trade: Trade, currentPrice: number): number {
  return (trade.shares * currentPrice - trade.amount) / trade.amount;
}

export async function monitorPositions(): Promise<void> {
  const openTrades = await getOpenTrades();
  if (openTrades.length === 0) return;

  console.log(`[Monitor] Checking ${openTrades.length} open position(s)...`);

  for (const trade of openTrades) {
    try {
      const prices = await fetchMarketPrice(trade.marketId);
      if (!prices) {
        console.warn(`[Monitor] Could not fetch price for ${trade.marketId}`);
        continue;
      }

      if (prices.inactive && !prices.closed) {
        console.log(`[Monitor] Market inactive (trading paused) — skipping: ${trade.marketQuestion.slice(0, 50)}`);
        continue;
      }

      if (prices.closed) {
        const endDate = prices.endDate?.trim() ? new Date(prices.endDate.trim()) : null;
        if (!endDate || endDate > new Date()) {
          console.warn(`[Monitor] Market closed but endDate unknown or future (${prices.endDate || 'none'}) — skipping: ${trade.marketQuestion.slice(0, 50)}`);
          continue;
        }
        const finalPrice = trade.side === 'YES' ? prices.yesPrice : prices.noPrice;
        const won = finalPrice >= 0.99;
        const isDefinitivelyResolved = finalPrice >= 0.99 || finalPrice <= 0.01;
        if (!isDefinitivelyResolved) {
          console.warn(`[Monitor] Market closed but price ambiguous (${finalPrice.toFixed(2)}) — skipping: ${trade.marketQuestion.slice(0, 50)}`);
          continue;
        }
        const payout = won ? trade.shares : 0; // each winning share settles at $1 on Polymarket
        await resolveTrade(trade.id, payout, won ? 'won' : 'lost');
        if (won) {
          const profit = payout - trade.amount;
          console.log(`[Monitor] RESOLVED WON — +$${profit.toFixed(2)} on ${trade.marketQuestion.slice(0, 40)}`);
          notify(`✅ *Market Resolved — Won*\n${trade.marketQuestion}\nSide: ${trade.side}\nBought: $${trade.amount} → Payout: $${payout.toFixed(2)} (+$${profit.toFixed(2)})`);
        } else {
          console.log(`[Monitor] RESOLVED LOST — -$${trade.amount.toFixed(2)} on ${trade.marketQuestion.slice(0, 40)}`);
          notify(`❌ *Market Resolved — Lost*\n${trade.marketQuestion}\nSide: ${trade.side}\nBought: $${trade.amount} → Payout: $0.00 (-$${trade.amount.toFixed(2)})`);
        }
        continue;
      }

      const currentPrice = trade.side === 'YES' ? prices.yesPrice : prices.noPrice;
      await updateTradePrice(trade.id, currentPrice);
      const ret = currentReturn(trade, currentPrice);
      const payout = trade.shares * currentPrice;

      console.log(`[Monitor] ${trade.side} ${trade.marketQuestion.slice(0, 50)} | return: ${(ret * 100).toFixed(1)}%`);

      if (ret >= TAKE_PROFIT) {
        await resolveTrade(trade.id, payout, 'won');
        const profit = payout - trade.amount;
        console.log(`[Monitor] TAKE PROFIT — +$${profit.toFixed(2)} on ${trade.marketQuestion.slice(0, 40)}`);
        notify(`💰 *Take Profit*\n${trade.marketQuestion}\nSide: ${trade.side} | Return: +${(ret * 100).toFixed(1)}%\nBought: $${trade.amount} → Sold: $${payout.toFixed(2)} (+$${profit.toFixed(2)})`);
      } else if (ret <= -STOP_LOSS) {
        await resolveTrade(trade.id, payout, 'lost');
        const loss = trade.amount - payout;
        console.log(`[Monitor] STOP LOSS — -$${loss.toFixed(2)} on ${trade.marketQuestion.slice(0, 40)}`);
        notify(`🛑 *Stop Loss*\n${trade.marketQuestion}\nSide: ${trade.side} | Return: ${(ret * 100).toFixed(1)}%\nBought: $${trade.amount} → Sold: $${payout.toFixed(2)} (-$${loss.toFixed(2)})`);
      }

      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`[Monitor] Error checking trade ${trade.id}:`, err);
    }
  }
}