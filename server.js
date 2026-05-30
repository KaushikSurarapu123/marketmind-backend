const express = require('express');
const cors    = require('cors');
const http    = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

const PORT   = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── GAME ARCHITECTURE CONFIGURATION ──────────────────────────────────────────
const STARTING_CASH         = 10000;
const INITIAL_SEED           = 'SEED_TEST_2026';
const MARGIN_INTEREST_RATE   = 0.04; // Charged on negative balances
const TOTAL_GAME_TURNS       = 15;   // Hard limit for game sessions

const CHARACTERS = {
  Wolf:  { name: 'Wolf',  style: 'aggressive', description: 'Aggressive short seller. No margin interest penalty.' },
  Bear:  { name: 'Bear',  style: 'cautious',   description: 'Strategic operator. Can sabotage sector values.' },
  Bull:  { name: 'Bull',  style: 'optimistic', description: 'Optimistic driver. Gains enhanced asset leverage limits.' },
  Sheep: { name: 'Sheep', style: 'beginner',   description: 'Defensive positioner. Capped down-turn structural exposure.' },
};

const MARKET_EVENTS = [
  { text: "AI Breakthrough announced! Technology stocks surge.", sector: "Technology", multiplier: 1.35, type: "boom" },
  { text: "Strict global environmental audits hit fossil fuels. Energy collapses.", sector: "Energy", multiplier: 0.60, type: "bust" },
  { text: "Power grid failure! Utilities plummet across regional nodes.", sector: "Utilities", multiplier: 0.65, type: "bust" },
  { text: "Healthcare deregulation bill passes. Healthcare sector breaks out.", sector: "Healthcare", multiplier: 1.25, type: "boom" },
  { text: "Black Swan Event! Liquidity crisis grips global clearing networks.", sector: "All", multiplier: 0.75, type: "bust" },
  { text: "Standard Turn. Corporate earnings match consensus data expectations.", sector: "None", multiplier: 1.00, type: "neutral" }
];

const PRIVATE_LEAKS_POOL = [
  "Rumor: Regulators looking closely at TECH_GEN corporate tax structure...",
  "Insider Source: HC_STABLE about to clear phase-3 trial authorization.",
  "Whispers: NRG_SHOCK preparing an unexpected cash dividend bump.",
  "Data Leak: UTIL_SAFE infrastructure metrics showing severe strain.",
  "Macro Signal: Institutional desks are quietly accumulating Tech assets.",
  "Analyst Note: Energy sector supply channels look completely bottlenecked."
];

const MOCK_CSV_DATA = [
  { ticker: 'TECH_GEN',  sector: 'Technology', base_price: 150.00, volatility: 0.12, dividend_yield: 0.015 },
  { ticker: 'HC_STABLE', sector: 'Healthcare',  base_price:  85.50, volatility: 0.04, dividend_yield: 0.045 },
  { ticker: 'NRG_SHOCK', sector: 'Energy',      base_price:  62.25, volatility: 0.08, dividend_yield: 0.035 },
  { ticker: 'UTIL_SAFE', sector: 'Utilities',   base_price: 110.00, volatility: 0.02, dividend_yield: 0.055 },
];

// ─── SERVER STATE MANAGEMENT ──────────────────────────────────────────────────
let currentTurn     = 1;
let gameStarted     = false;
let gameOver        = false;
let internalStocks  = [];
let rng             = null;
let currentEvent    = { text: "Market open. Initial listings registered.", sector: "None", multiplier: 1.00, type: "neutral" };
let freezeTicker    = null;
let hostSocketId    = null;

const players       = new Map();
const ROOM_CODE     = Math.floor(100000 + Math.random() * 900000).toString();

console.log(`\n┌──────────────────────────────────────────────┐`);
console.log(`│   MARKETMIND ROOM ENGINE CODE:  ${ROOM_CODE}       │`);
console.log(`└──────────────────────────────────────────────┘\n`);

function seededRandom(seedString) {
  let h = 1779033703 ^ seedString.length;
  for (let i = 0; i < seedString.length; i++) {
    h = Math.imul(h ^ seedString.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function loadInitialMarketData() {
  internalStocks = MOCK_CSV_DATA.map(s => ({
    ticker:            s.ticker,
    sector:            s.sector,
    currentPrice:      s.base_price,
    previousPrice:     s.base_price,
    volatility:        s.volatility,
    dividendYield:     s.dividend_yield,
    movementDirection: 'neutral',
  }));
  rng          = seededRandom(INITIAL_SEED);
  currentTurn  = 1;
  freezeTicker = null;
  gameOver     = false;
  currentEvent = { text: "Market open. Initial listings registered.", sector: "None", multiplier: 1.00, type: "neutral" };
}

function calcNetWorth(player) {
  const assetValue = player.portfolio.reduce((sum, h) => {
    const stock = internalStocks.find(s => s.ticker === h.ticker);
    if (!stock) return sum;
    return sum + (stock.currentPrice * h.shares);
  }, 0);
  return player.cash + assetValue;
}

function generateDeterministicLeaks(turnNum, count) {
  let list = [];
  for(let i=0; i<count; i++) {
    let index = Math.abs(Math.sin(turnNum + i)) * PRIVATE_LEAKS_POOL.length;
    list.push(PRIVATE_LEAKS_POOL[Math.floor(index) % PRIVATE_LEAKS_POOL.length]);
  }
  return list;
}

function applyCharacterBonus(player, updatedStocks) {
  let { cash, portfolio, character } = player;
  const style = CHARACTERS[character]?.style;

  portfolio = portfolio.map(holding => {
    const stock = updatedStocks.find(s => s.ticker === holding.ticker);
    if (!stock) return holding;
    const priceDiff = stock.currentPrice - stock.previousPrice;

    if (holding.shares > 0) {
      if (style === 'aggressive' && stock.movementDirection === 'up') {
        cash += holding.shares * priceDiff * 0.15; // Wolf extra capture
      }
      if (style === 'cautious' && stock.movementDirection === 'down') {
        cash += holding.shares * Math.abs(priceDiff) * 0.50; // Bear defensive hedge
      }
      if (style === 'beginner' && stock.movementDirection === 'down') {
        const maxLoss    = holding.shares * stock.previousPrice * 0.05;
        const actualLoss = holding.shares * Math.abs(priceDiff);
        if (actualLoss > maxLoss) cash += (actualLoss - maxLoss); // Sheep floor protection
      }
    }
    return holding;
  });

  // Bull structural compounding dividend yield bonus
  if (style === 'optimistic') {
    portfolio.forEach(holding => {
      const stock = updatedStocks.find(s => s.ticker === holding.ticker);
      if (stock && holding.shares > 0) cash += holding.shares * stock.currentPrice * stock.dividendYield * 0.20;
    });
  }

  return { cash, portfolio };
}

function broadcastLobby() {
  io.emit('lobby:update', {
    players: Array.from(players.values()).map(p => ({ id: p.id, name: p.name, character: p.character, ready: p.ready, isHost: p.id === hostSocketId })),
    roomCode: ROOM_CODE
  });
}

function broadcastGameState() {
  const leaderboard = Array.from(players.values())
    .filter(p => p.id !== hostSocketId || p.character !== null)
    .map(p => ({
      name:      p.name,
      character: p.character,
      netWorth:  calcNetWorth(p),
    })).sort((a, b) => b.netWorth - a.netWorth);

  const turnLeaks = generateDeterministicLeaks(currentTurn, players.size + 2);
  let leakIdx = 0;

  for (const [socketId, player] of players.entries()) {
    const pWorth = calcNetWorth(player);
    const assignedLeak = turnLeaks[leakIdx % turnLeaks.length];
    leakIdx++;

    io.to(socketId).emit('game:update', {
      turn:         currentTurn,
      maxTurns:     TOTAL_GAME_TURNS,
      stocks:       internalStocks,
      cash:         player.cash,
      portfolio:    player.portfolio,
      netWorth:     pWorth,
      leaderboard:  leaderboard,
      currentEvent: currentEvent,
      powerUsed:    player.powerUsed || false,
      privateLeak:  assignedLeak,
      isHost:       socketId === hostSocketId,
      gameOver:     gameOver
    });
  }
}

function executeFinalLiquidation() {
  gameOver = true;
  for (const [id, player] of players.entries()) {
    let finalLiquidationValue = calcNetWorth(player);
    player.cash = finalLiquidationValue;
    player.portfolio = [];
  }
}

// ─── ADMIN CONTROL ROUTE ──────────────────────────────────────────────────────
app.post('/api/market/advance', (req, res) => {
  if (!gameStarted || gameOver) return res.status(400).json({ error: 'Action unavailable.' });

  if (currentTurn >= TOTAL_GAME_TURNS) {
    executeFinalLiquidation();
    broadcastGameState();
    return res.json({ success: true, gameOver: true });
  }

  const randomIdx = Math.floor(Math.random() * MARKET_EVENTS.length);
  currentEvent = MARKET_EVENTS[randomIdx];

  let activeSqueezeTicker = null;
  for (const [id, player] of players.entries()) {
    if (player.squeezeActiveTurn === currentTurn) {
      activeSqueezeTicker = player.squeezeTicker;
    }
  }

  internalStocks = internalStocks.map(stock => {
    if (freezeTicker === stock.ticker) {
      return { ...stock, previousPrice: stock.currentPrice, movementDirection: 'neutral' };
    }

    let changePercent = (rng() - 0.5) * 2 * stock.volatility;
    if (currentEvent.sector === stock.sector || currentEvent.sector === "All") {
      changePercent += (currentEvent.multiplier - 1.0);
    }
    if (activeSqueezeTicker === stock.ticker) {
      changePercent += 0.25; 
    }

    const previousPrice = stock.currentPrice;
    const currentPrice  = Math.max(1.00, Number((previousPrice * (1 + changePercent)).toFixed(2)));
    
    let direction = 'neutral';
    if (currentPrice > previousPrice) direction = 'up';
    else if (currentPrice < previousPrice) direction = 'down';

    return { ...stock, previousPrice, currentPrice, movementDirection: direction };
  });

  freezeTicker = null;

  for (const [id, player] of players.entries()) {
    // Wolf passive feature: immune to negative account balance debt interest penalties
    if (player.cash < 0 && player.character !== 'Wolf') {
      player.cash += player.cash * MARGIN_INTEREST_RATE;
    }

    const result = applyCharacterBonus(player, internalStocks);
    player.cash      = result.cash;
    player.portfolio = result.portfolio;

    // Automatic Liquidation Threshold Protection
    if (calcNetWorth(player) < 800 && player.cash < 0) {
      player.portfolio = [];
      player.cash = Math.max(0, calcNetWorth(player)); 
      io.to(player.id).emit('trade:error', { message: 'MARGIN DISASTER: Your account risk breached security limits and was liquidated.' });
    }
  }

  currentTurn++;
  broadcastGameState();
  res.json({ success: true, turn: currentTurn });
});

// ─── SOCKET CORE LISTENER LAYER ───────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('room:code', { roomCode: ROOM_CODE });

  socket.on('lobby:join', ({ name, roomCode }) => {
    if (roomCode !== ROOM_CODE) {
      socket.emit('lobby:error', { message: 'Invalid Room Code.' });
      return;
    }

    if (!hostSocketId && (players.size === 0 || name.includes('_HOST_'))) {
      hostSocketId = socket.id;
    }

    players.set(socket.id, {
      id:        socket.id,
      name:      name.replace('_HOST_', '').trim(),
      character: null,
      ready:     false,
      cash:      STARTING_CASH,
      portfolio: [],
      powerUsed: false
    });
    
    broadcastLobby();
  });

  socket.on('lobby:pick_character', ({ character }) => {
    const player = players.get(socket.id);
    if (!player || !CHARACTERS[character]) return;
    player.character = character;
    broadcastLobby();
  });

  socket.on('lobby:ready', () => {
    const player = players.get(socket.id);
    if (!player || !player.character) return;
    
    player.ready = !player.ready;
    broadcastLobby();

    const allPlayers = Array.from(players.values());
    const activeGamingPlayers = allPlayers.filter(p => p.character !== null);
    const allReady = activeGamingPlayers.every(p => p.ready);
    
    if (allReady && activeGamingPlayers.length >= 1 && !gameStarted) {
      gameStarted = true;
      loadInitialMarketData();
      io.emit('game:started');
      broadcastGameState();
    }
  });

  socket.on('power:activate', ({ targetTicker, targetSector }) => {
    const player = players.get(socket.id);
    if (!player || !gameStarted || player.powerUsed || gameOver) return;

    if (player.character === 'Wolf') {
      if (!targetTicker) return;
      player.powerUsed = true;
      player.squeezeActiveTurn = currentTurn + 1;
      player.squeezeTicker = targetTicker;
      socket.emit('power:success', { message: `Squeeze configuration successful. Engineering buy walls on ${targetTicker}.` });
    } 
    else if (player.character === 'Bear') {
      if (!targetSector) return;
      player.powerUsed = true;
      currentEvent = { text: `Bear Sabotage! Targeted short campaign hitting ${targetSector}.`, sector: targetSector, multiplier: 0.70, type: "bust" };
      socket.emit('power:success', { message: `Sabotage execution packet injected into ${targetSector} lines.` });
    } 
    else if (player.character === 'Bull') {
      if (!targetTicker) return;
      player.powerUsed = true;
      freezeTicker = targetTicker;
      socket.emit('power:success', { message: `Takeover locked. Pricing variance on ${targetTicker} frozen until next loop.` });
    } 
    else if (player.character === 'Sheep') {
      player.cash += 3000;
      player.powerUsed = true;
      socket.emit('power:success', { message: 'Emergency safety reserve injection: $3,000 credited.' });
    }

    broadcastGameState();
  });

  socket.on('trade:buy', ({ ticker, shares }) => {
    const player = players.get(socket.id);
    if (!player || !gameStarted || gameOver) return;
    shares = Math.floor(Number(shares));
    if (!shares || shares <= 0) return;

    const stock = internalStocks.find(s => s.ticker === ticker);
    if (!stock) return;
    const cost = stock.currentPrice * shares;

    // Bull character archetype unlocks 2.5x deep margin access profile
    const marginThreshold = (player.character === 'Bull') ? -15000 : -5000;
    if (player.cash - cost < marginThreshold) {
      socket.emit('trade:error', { message: 'Clearing Failure: Insufficient capital/margin capacity to route order.' });
      return;
    }

    const holding = player.portfolio.find(h => h.ticker === ticker);
    if (holding) {
      holding.shares += shares;
    } else {
      player.portfolio.push({ ticker, shares });
    }

    player.cash -= cost;
    player.portfolio = player.portfolio.filter(h => h.shares !== 0);
    broadcastGameState();
    socket.emit('trade:success', { action: 'BUY', ticker, shares, price: stock.currentPrice });
  });

  socket.on('trade:sell', ({ ticker, shares }) => {
    const player = players.get(socket.id);
    if (!player || !gameStarted || gameOver) return;
    shares = Math.floor(Number(shares));
    if (!shares || shares <= 0) return;

    const stock = internalStocks.find(s => s.ticker === ticker);
    if (!stock) return;

    const holding = player.portfolio.find(h => h.ticker === ticker);
    const currentlyOwned = holding ? holding.shares : 0;

    if (currentlyOwned - shares < -600) {
      socket.emit('trade:error', { message: 'Exchange Rule: Order execution blocks layout. Short cap rule limit is -600 units.' });
      return;
    }

    if (holding) {
      holding.shares -= shares;
    } else {
      player.portfolio.push({ ticker, shares: -shares });
    }

    player.cash += stock.currentPrice * shares;
    player.portfolio = player.portfolio.filter(h => h.shares !== 0);
    broadcastGameState();
    socket.emit('trade:success', { action: 'SHORT', ticker, shares, price: stock.currentPrice });
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      players.delete(socket.id);
      if (socket.id === hostSocketId) hostSocketId = null;
      broadcastLobby();
      if (gameStarted) broadcastGameState();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Core application operating on port: ${PORT}`);
});
