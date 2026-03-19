# Warren BotIt

A Polymarket AI trading bot running in **paper trading mode** — no real money, no real trades.

Scans live Polymarket prediction markets hourly (8am–11pm), uses Claude Sonnet to estimate probabilities, detects edges against the market price, and alerts via Telegram with Approve/Skip buttons. All trades are simulated against a virtual $50 wallet persisted in Redis.

---

## System Architecture

```mermaid
graph TD
    A[Cron: hourly, 8am-11pm] --> B[Monitor Open Positions]
    B -->|fetch current price| C[Polymarket Gamma API]
    C -->|±25% threshold hit| D[Auto Cashout - no approval needed]
    D -->|update wallet| R[(Upstash Redis)]
    D -->|notify| T[Telegram Bot]

    B --> E[Fetch Live Markets]
    E --> C
    C --> F[For each market]
    F -->|search headlines| G[Tavily News API]
    G --> H{Claude Sonnet}
    H -->|SKIP / low edge| I[Skip - log reason]
    H -->|edge > 10% AND confidence > 70%| J[Build Trade Signal]
    J -->|dedup check| K{Already open or pending?}
    K -->|yes| I
    K -->|no| L[Send Telegram Signal]
    L -->|Approve button| M[Record Paper Trade]
    L -->|Skip button| N[Discard Signal]
    M --> R

    style H fill:#064e3b,stroke:#059669,stroke-width:2px,color:#fff
    style R fill:#1e293b,stroke:#475569,color:#fff
    style L fill:#064e3b,stroke:#059669,stroke-width:2px,color:#fff
    style D fill:#1e293b,stroke:#475569,color:#fff
```

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js + TypeScript | Single process for cron, Telegram, and web server — no coordination overhead |
| Scheduler | `node-cron` | In-process cron, zero infra |
| AI brain | Claude Sonnet (`@anthropic-ai/sdk`) | Best probability reasoning, structured JSON output |
| Market data | Polymarket Gamma API | Public, no auth — real-time prices and market metadata |
| News context | Tavily Search API | Fetches fresh headlines to inform Claude's estimate |
| Notifications | Telegram Bot API (`node-telegram-bot-api`) | Inline keyboard Approve/Skip buttons, instant mobile alerts |
| Storage | Upstash Redis (`ioredis`) | Persistent wallet state survives deploys, works on Railway free tier |
| Dashboard | Express + Vanilla HTML/CSS/JS + SSE | Read-only status screen — no React needed, no build step |
| Deployment | Railway (bot + API) | Persistent process — Vercel can't run cron or Telegram polling |

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your env file
cp .env.example .env.local
# Fill in your API keys (see below)

# 3. Run in dev mode
npm run dev
```

Dashboard available at `http://localhost:3000` once running.

---

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key — [console.anthropic.com](https://console.anthropic.com) |
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/BotFather) on Telegram |
| `TELEGRAM_CHAT_ID` | Your personal Telegram chat ID |
| `TAVILY_API_KEY` | [Tavily](https://tavily.com) news search (optional but recommended) |
| `REDIS_URL` | Upstash Redis URL — `rediss://default:...@...upstash.io:6379` |

---

## Telegram Commands

| Command | Action |
|---|---|
| `/status` | Balance, P&L, open positions, win rate |
| `/report` | Last 10 trades |
| `/positions` | Currently open positions |
| `/resetwallet` | Prompts for confirmation, then wipes all trades and restores $50 |
| `/stop` | Halt the bot process |

Trade entry signals arrive with **✅ Approve** / **❌ Skip** inline buttons. Cashouts (take profit / stop loss) fire automatically with no approval required, capped at ±25%.

Up to 10 pending approvals can be queued at once — new signals are silently dropped once the cap is reached to prevent notification spam.

---

## Safety Config (`src/config.ts`)

```typescript
MAX_BANKROLL:     50.00   // Virtual wallet starting balance
MAX_TRADE_SIZE:    5.00   // Max spend per trade
MIN_EDGE:          0.10   // Claude must beat market price by 10%+
MIN_CONFIDENCE:    0.70   // Claude confidence threshold
REQUIRE_APPROVAL:  true   // Always ask before entering a trade
TAKE_PROFIT:       0.25   // Auto-close at +25% gain
STOP_LOSS:         0.25   // Auto-close at -25% loss
```

---

## Project Structure

```
src/
  index.ts                 — Entry point, cron loop
  config.ts                — All constants, limits, env vars
  bot/
    scanner.ts             — Fetches live Polymarket markets + real-time prices
    strategist.ts          — Claude API call + Tavily news fetch
    executor.ts            — Builds trade signals, dedup checks, simulates trades
    monitor.ts             — Checks open positions, triggers auto cashouts
  integrations/
    telegram.ts            — Bot commands, Approve/Skip callbacks, notifications
    dashboard.ts           — Express server, REST API endpoints, SSE stream
  store/
    memory.ts              — Virtual wallet CRUD (balance, trades, P&L) via Redis
    redis.ts               — ioredis singleton client
    state.ts               — In-memory runtime state (cron status, pending approvals, signal store)
public/
  index.html               — Dashboard UI (vanilla HTML/CSS/JS, live SSE updates)
```

---

## Dashboard API

The Express server exposes these endpoints (consumed by the dashboard and SSE stream):

| Endpoint | Description |
|---|---|
| `GET /api/wallet` | Balance, total deposited, P&L, open trade count, win rate |
| `GET /api/trades` | Full trade history array |
| `GET /api/status` | Runtime cron state, current market being analyzed |
| `GET /api/trends` | Daily aggregated spend / return / net P&L |
| `GET /api/stream` | SSE stream — pushes wallet + status updates every 3 seconds |

---

## Deployment

The bot requires a **persistent process** (cron + Telegram long-polling). It is deployed on **Railway**.

```
Railway (warren-bot-it)
  └── Node.js process
        ├── node-cron        → scans every 5 min
        ├── Telegram polling → listens for Approve/Skip
        └── Express :PORT    → serves dashboard + API
```

The dashboard is surfaced at `bengredev.com/ai-lab/warren-bot-it` via a rewrite rule in the portfolio's `vercel.json` that proxies all requests to the Railway URL.

**Railway environment variables to set:**
`ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TAVILY_API_KEY`, `REDIS_URL`

Railway sets `PORT` automatically — the server binds to `process.env.PORT`.

---

## Running Costs

All services used have a free or low-cost tier. Approximate monthly cost running hourly scans (8am–11pm, 16 cycles/day):

| Service | Usage | Cost |
|---|---|---|
| Claude Sonnet | ~16 cycles/day × 10 markets × ~1,100 tokens | ~$6/month |
| Tavily Search | ~160 searches/day (free tier: 1,000/month) | Free |
| Upstash Redis | Single key, ~160 reads+writes/day | Free |
| Railway | Always-on Node.js process | ~$5/month (Hobby plan) |
| Telegram Bot API | Unlimited | Free |

**Total: ~$11/month**

Increasing `MARKETS_PER_SCAN` or tightening the cron window in `src/config.ts` are the main levers if you want to reduce Claude API spend further.

---

## Technical Decisions

### Why Node.js + Express?

This is a single-user personal tool. Everything runs in one Node.js process — the cron scheduler, the Telegram bot, and the Express dashboard server all share the same runtime. There is no need to coordinate between services.

Express was chosen for the dashboard because it sets up a handful of read-only API endpoints in minimal code. NestJS or Fastify would add abstraction with no benefit at this scale.

### Why vanilla HTML/CSS/JS for the dashboard?

The dashboard is a single read-only status screen. There is no complex interaction, routing, or shared component state. React solves problems that don't exist here — and it would require a separate build pipeline for zero functional gain.

### Why SSE instead of WebSockets?

The dashboard only needs data to flow in one direction: server → browser. Server-Sent Events are native to the browser with no library, work over plain HTTP, and reconnect automatically. WebSockets are the right tool when the browser also sends data — which it doesn't here.

### Why Redis instead of a flat JSON file?

The bot runs on Railway, which has an ephemeral filesystem — any file written to disk is lost on redeploy or restart. Redis (Upstash free tier) provides a persistent, low-latency key-value store that survives restarts. The entire wallet fits in a single JSON key (`warren:wallet`), well within the 10k commands/day free tier.

The `store/` folder abstracts all Redis access behind async functions (`getWalletState`, `resolveTrade`, etc.) — the rest of the codebase has no direct Redis dependency.

---

## Scaling Roadmap

These are the changes that would be made if this were to support multiple users or higher trade volume. Nothing here is necessary for the current use case.

### Process & scheduling

| Now | At scale |
|---|---|
| Single Node.js process | Separate worker, API server, and bot services |
| `node-cron` running in-process | **BullMQ** job queue backed by Redis |
| `isRunning` boolean in memory | **Distributed lock** in Redis |

### Storage

| Now | At scale |
|---|---|
| Single Redis key (JSON blob) | **PostgreSQL** for trades, Redis for hot state |
| In-memory `state.ts` | **Redis pub/sub** for cross-process state |

### Frontend & API

| Now | At scale |
|---|---|
| Vanilla HTML, SSE | **React + Vite**, WebSockets |
| No authentication | JWT or session-based auth |
| Hardcoded `TELEGRAM_CHAT_ID` | Per-user routing |

### Multi-user

The entire design assumes one wallet, one Telegram chat ID, and one set of API keys. To support multiple users: every data model gets a `userId`, config moves from env vars into the database, and the Telegram bot routes incoming messages by chat ID to the correct user session.

---

### Connect

- **Portfolio:** [bengredev.com](https://bengredev.com)
- **LinkedIn:** [Thushanth Bengre](https://www.linkedin.com/in/thushanth-devananda-bengre/)
- **GitHub:** [@thushanthbengre22-dev](https://github.com/thushanthbengre22-dev)