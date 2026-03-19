import TelegramBot from 'node-telegram-bot-api';
import { CONFIG } from '../config';
import { TradeSignal, simulateTrade } from '../bot/executor';
import { getPnlSummary, getRecentTrades, resetWallet } from '../store/memory';
import { addPendingApproval, removePendingApproval, storeSignal, popSignal, getState } from '../store/state';

let bot: TelegramBot | null = null;

// Track chats waiting for /resetwallet confirmation
const pendingResets = new Set<string>();

export function initTelegram(): void {
  if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    console.warn('[Telegram] No bot token configured — Telegram disabled.');
    return;
  }
  bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: true });
  registerCommands();
  console.log('[Telegram] Bot started.');
}

function send(text: string, options?: TelegramBot.SendMessageOptions): void {
  if (!bot || !CONFIG.TELEGRAM_CHAT_ID) return;
  bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, text, options).catch(console.error);
}

function registerCommands(): void {
  if (!bot) return;

  bot.onText(/\/status/, async () => {
    const s = await getPnlSummary();
    send(
      `📊 *Bot Status*\n` +
      `Balance: $${s.balance.toFixed(2)}\n` +
      `P&L: $${s.totalPnl.toFixed(2)}\n` +
      `Open trades: ${s.openTrades}\n` +
      `Win rate: ${s.winRate}`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/report/, async () => {
    const trades = await getRecentTrades(10);
    if (trades.length === 0) { send('No trades yet.'); return; }
    const lines = trades.map(t =>
      `• ${t.side} $${t.amount} — ${t.marketQuestion.slice(0, 50)} [${t.status}]`
    ).join('\n');
    send(`📋 *Last ${trades.length} trades:*\n${lines}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/positions/, async () => {
    const trades = (await getRecentTrades(20)).filter(t => t.status === 'open');
    if (trades.length === 0) { send('No open positions.'); return; }
    const lines = trades.map(t =>
      `• ${t.side} $${t.amount} @ ${t.marketPrice} — ${t.marketQuestion.slice(0, 50)}`
    ).join('\n');
    send(`📌 *Open positions:*\n${lines}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/stop/, () => {
    send('🛑 Stop command received. Exiting...');
    setTimeout(() => process.exit(0), 1000);
  });

  bot.onText(/\/resetwallet/, (msg) => {
    const chatId = String(msg.chat.id);
    pendingResets.add(chatId);
    send(
      '⚠️ *Are you sure you want to reset the wallet?*\n' +
      'This will wipe all trades and restore the $50 virtual balance.\n\n' +
      'Reply `/resetwallet confirm` to proceed.',
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/resetwallet confirm/, async (msg) => {
    const chatId = String(msg.chat.id);
    if (!pendingResets.has(chatId)) {
      send('No pending reset. Send `/resetwallet` first.', { parse_mode: 'Markdown' });
      return;
    }
    pendingResets.delete(chatId);
    await resetWallet();
    send('✅ Wallet reset. Balance restored to $50.00. All trades cleared.');
  });

  // Handle Approve/Skip callback buttons
  bot.on('callback_query', async (query) => {
    if (!bot || !query.data) return;
    await bot.answerCallbackQuery(query.id);
    const [action, signalId] = query.data.split('::');
    if (!signalId) return;

    const signal = popSignal(signalId);
    if (!signal) { send('⚠️ Signal expired or already handled.'); return; }

    removePendingApproval(signal.market.id);

    if (action === 'approve') {
      const trade = await simulateTrade(signal);
      const wallet = await getPnlSummary();
      send(
        `✅ *Trade executed (paper)*\n` +
        `${trade.side} ${trade.shares.toFixed(2)} shares @ ${trade.marketPrice}\n` +
        `Cost: $${trade.amount}\n` +
        `Remaining balance: $${wallet.balance.toFixed(2)}`,
        { parse_mode: 'Markdown' }
      );
    } else {
      send(`❌ Trade skipped.`);
    }
  });
}

const MAX_PENDING = 10;

export function sendSignal(signal: TradeSignal): void {
  if (!bot) {
    if (!CONFIG.REQUIRE_APPROVAL) simulateTrade(signal);
    return;
  }

  if (getState().pendingApprovals.length >= MAX_PENDING) {
    console.log(`[Telegram] Pending cap reached (${MAX_PENDING}) — signal queued silently: ${signal.market.question.slice(0, 50)}`);
    return;
  }

  const { market, strategy, side, marketPrice, edge, amount } = signal;
  const signalId = `sig_${Date.now()}`;
  storeSignal(signalId, signal);

  const text =
    `🔔 *Trade Signal*\n` +
    `Market: ${market.question}\n` +
    `Side: *${side}*\n` +
    `Market price: ${(marketPrice * 100).toFixed(1)}%\n` +
    `Claude estimate: ${(strategy.probability * 100).toFixed(1)}%\n` +
    `Edge: +${(edge * 100).toFixed(1)}%\n` +
    `Confidence: ${(strategy.confidence * 100).toFixed(0)}%\n` +
    `Amount: $${amount}\n\n` +
    `_${strategy.reasoning}_`;

  addPendingApproval({
    id:              market.id,
    marketQuestion:  market.question,
    side,
    edge,
    amount,
    sentAt:          new Date().toISOString(),
  });

  send(text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: `approve::${signalId}` },
        { text: '❌ Skip',    callback_data: `skip::${signalId}` },
      ]],
    },
  });
}

export function notify(message: string): void {
  send(message);
}