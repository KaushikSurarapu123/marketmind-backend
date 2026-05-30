const express = require('express');
const cors    = require('cors');
const http    = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// CONFIG: Reads the dynamic cloud port layer assigned by Render
const PORT   = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── Room Code Generation ─────────────────────────────────────────────────────

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const ROOM_CODE = generateRoomCode();
console.log(`\n┌─────────────────────────────┐`);
console.log(`│   ROOM CODE:  ${ROOM_CODE}        │`);
console.log(`│   Share this with players   │`);
console.log(`└─────────────────────────────┘\n`);

// ─── Constants ────────────────────────────────────────────────────────────────

const STARTING_CASH = 10000;
const INITIAL_SEED  = 'SEED_TEST_2026';
const MARGIN_INTEREST_RATE = 0.05; 
const MAX_TURNS = 10; // Game finishes after 10 full turns

const CHARACTERS = {
  Wolf:  { name: 'Wolf',  emoji: '🐺', description: 'Aggressive trader. High risk, high reward.',       bonus: 'Gains +15% on any stock that moves up this turn.', style: 'aggressive', color: '#7C3AED' },
  Bear:  { name: 'Bear',  emoji: '🐻', description: 'Cautious investor. Prefers safe, steady returns.', bonus: 'Loses 50% less on any stock that moves down.',       style: 'cautious',   color: '#B45309' },
  Bull:  { name: 'Bull',  emoji: '🐂', description: 'Optimistic player. Bets on market surges.',        bonus: 'Earns +10% extra dividends each turn.',              style: 'optimistic', color: '#047857' },
  Sheep: { name: 'Sheep', emoji: '🐑', description: 'Beginner-friendly. Protected from worst crashes.', bonus: 'Max loss per turn capped at 5% of holding value.',   style: 'beginner',   color: '#0369A1' },
};

const MARKET_EVENTS = [
  { text: "AI Breakthrough announced! Technology stocks surge.", sector: "Technology", multiplier: 1.30, type: "boom" },
  { text: "Strict global environmental audits hit fossil fuels. Energy collapses.", sector: "Energy", multiplier: 0.65, type: "bust" },
  { text: "Power grid failure! Utilities plummet, but tech volatility doubles.", sector: "Utilities", multiplier: 0.70, type: "bust" },
  { text: "Healthcare deregulation bill passes. Healthcare sector breaks out.", sector: "Healthcare", multiplier: 1.25, type: "boom" },
  { text: "Black Swan Event! Hyperinflation fears grip global markets.", sector: "All", multiplier: 0.80, type: "crash" },
  { text: "Standard Turn. Normal corporate earnings reporting across indices.", sector: "None", multiplier: 1.00, type: "neutral" }
];

const MOCK_CSV_DATA = [
  { ticker: 'TECH_GEN',  sector: 'Technology', base_price: 150.00, volatility: 0.10, dividend_yield: 0.015 },
  { ticker: 'HC_STABLE', sector: 'Healthcare',  base_price:  85.50, volatility: 0.03, dividend_yield: 0.042 },
  { ticker: 'NRG_SHOCK', sector: 'Energy',      base_price:  62.25, volatility: 0.06, dividend_yield: 0.035 },
  { ticker: 'UTIL_SAFE', sector: 'Utilities',   base_price: 110.00, volatility: 0.02, dividend_yield: 0.051 },
];

// ─── State ────────────────────────────────────────────────────────────────────

let currentTurn    = 1;
let gameStarted    = false;
let internalStocks = [];
let rng            = null;
let currentEvent   = { text: "Market open. Initial listings registered.", sector: "None", multiplier: 1.00, type: "neutral" };
let freezeTicker   = null;

const players      = new Map();

// ─── Seeded RNG ───────────────────────────────────────────────────────────────

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

// ─── Market Init ──────────────────────────────────────────────────────────────

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
  rng         = seededRandom(INITIAL_SEED);
  currentTurn = 1;
  freezeTicker = null;
  currentEvent = { text: "Market open. Initial listings registered.", sector: "None", multiplier: 1.00, type: "neutral" };
}

// ─── Character Bonuses ────────────────────────────────────────────────────────

function applyCharacterBonus(player, updatedStocks) {
  let { cash, portfolio, character } = player;
  const style = CHARACTERS[character]?.style;

  portfolio = portfolio.map(holding => {
    const stock = updatedStocks.find(s => s.ticker === holding.ticker);
    if (!stock) return holding;
    const priceDiff = stock.currentPrice - stock.previousPrice;

    if (holding.shares > 0) {
      if (style === 'aggressive' && stock.movementDirection === 'up') {
        cash += holding.shares * priceDiff * 0.15;
      }
      if (style === 'cautious' && stock.movementDirection === 'down') {
        cash += holding.shares * Math.abs(priceDiff) * 0.50;
      }
      if (style === 'beginner' && stock.movementDirection === 'down') {
        const maxLoss    = holding.shares * stock.previousPrice * 0.05;
        const actualLoss = holding.shares * Math.abs(priceDiff);
        if (actualLoss > maxLoss) cash += (actualLoss - maxLoss);
      }
    }
    return holding;
  });

  if (style === 'optimistic') {
    portfolio.forEach(holding => {
      const stock = updatedStocks.find(s => s.ticker === holding.ticker);
      if (stock && holding.shares > 0) cash += holding.shares * stock.currentPrice * stock.dividendYield * 0.10;
    });
  }

  return { cash, portfolio };
}

// ─── Net Worth ────────────────────────────────────────────────────────────────

function calcNetWorth(player) {
  if (!internalStocks || internalStocks.length === 0) return player.cash;
  
  const assetValue = player.portfolio.reduce((sum, h) => {
    const stock = internalStocks.find(s => s.ticker === h.ticker);
    if (!stock) return sum;
    return sum + (stock.currentPrice * h.shares);
  }, 0);

  return player.cash + assetValue;
}

// ─── Complete Leaderboard Array Utility ──────────────────────────────────────

function getFullLeaderboard() {
  const charEmojis = { Wolf: '🐺', Bear: '🐻', Bull: '🐂', Sheep: '🐑' };
  return Array.from(players.values())
    .filter(p => p.name !== '_HOST_DUMMY_INIT_')
    .map(p => ({
      name:      p.name,
      character: p.character,
      emoji:     charEmojis[p.character] || '👤',
      netWorth:  calcNetWorth(p),
    }))
    .sort((a, b) => b.netWorth - a.netWorth);
}

// ─── Broadcast ────────────────────────────────────────────────────────────────

function broadcastLobby() {
  io.emit('lobby:update', {
    players: Array.from(players.values()).map(p => ({ id: p.id, name: p.name, character: p.character, ready: p.ready })),
    roomCode: ROOM_CODE
  });
}

function broadcastGameState() {
  const leaderboard = getFullLeaderboard();

  for (const [socketId, player] of players.entries()) {
    const pWorth = calcNetWorth(player);
    io.to(socketId).emit('game:update', {
      turn:        currentTurn,
      maxTurns:    MAX_TURNS,
      stocks:      internalStocks,
      cash:        player.cash,
      portfolio:   player.portfolio,
      netWorth:    pWorth,
      leaderboard: leaderboard,
      currentEvent: currentEvent,
      powerUsed:    player.powerUsed || false
    });
  }
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

app.post('/api/market/advance', (req, res) => {
  if (!gameStarted) return res.status(400).json({ error: 'Game not started.' });

  currentTurn++;

  // CHECK WIN CONDITIONS: Terminate when max limits hit threshold
  if (currentTurn > MAX_TURNS) {
    gameStarted = false;
    const finalLeaderboard = getFullLeaderboard();
    io.emit('game:over', {
      winner: finalLeaderboard[0],
      leaderboard: finalLeaderboard
    });
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
    if (player.cash < 0) {
      player.cash += player.cash * MARGIN_INTEREST_RATE;
    }

    const result = applyCharacterBonus(player, internalStocks);
    player.cash      = result.cash;
    player.portfolio = result.portfolio;

    const totalWorth = calcNetWorth(player);
    if (totalWorth < 1000 && player.cash < 0) {
      player.portfolio = [];
      player.cash = Math.max(0, totalWorth); 
      io.to(player.id).emit('trade:error', { message: 'CRITICAL MARGIN CALL: Portfolio automatically liquidated.' });
    }
  }

  broadcastGameState();
  res.json({ success: true, turn: currentTurn, gameOver: false });
});

// ─── Sockets ──────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[SOCKET] Connected: ${socket.id}`);

  socket.emit('room:code', { roomCode: ROOM_CODE });

  socket.on('lobby:join', ({ name, roomCode }) => {
    if (roomCode !== ROOM_CODE) {
      socket.emit('lobby:error', { message: 'Invalid Room Code.' });
      return;
    }

    if (name === '_HOST_DUMMY_INIT_') {
      broadcastLobby();
      return;
    }

    players.set(socket.id, {
      id:        socket.id,
      name:      name.trim(),
      character: null,
      ready:     false,
      cash:      STARTING_CASH,
      portfolio: [],
      powerUsed: false
    });
    
    console.log(`[LOBBY] ${name} joined the room`);
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
    
    if (allReady && activeGamingPlayers.length >= 2 && !gameStarted) {
      gameStarted = true;
      loadInitialMarketData();
      io.emit('game:started');
      broadcastGameState();
    }
  });

  socket.on('power:activate', ({ targetTicker }) => {
    const player = players.get(socket.id);
    if (!player || !gameStarted || player.powerUsed) return;

    const stock = internalStocks.find(s => s.ticker === targetTicker);
    if (!stock && player.character !== 'Bear') return;

    if (player.character === 'Wolf') {
      player.powerUsed = true;
      player.squeezeActiveTurn = currentTurn + 1;
      player.squeezeTicker = targetTicker;
      socket.emit('power:success', { message: `Short Squeeze ordered on ${targetTicker} for next turn!` });
    } 
    else if (player.character === 'Bear') {
      if (player.cash < 1000) {
        socket.emit('trade:error', { message: 'Insufficient cash fee ($1,000) for insider leak.' });
        return;
      }
      player.cash -= 1000;
      player.powerUsed = true;
      const mockRngVal = Math.random();
      const prediction = mockRngVal > 0.5 ? "BULLISH BREAKOUT SHIFT" : "BEARISH CRASH DEPRECIATION";
      socket.emit('power:success', { message: `INSIDER LEAK: Macro calculations indicate a ${prediction} phase next turn.` });
    } 
    else if (player.character === 'Bull') {
      player.powerUsed = true;
      freezeTicker = targetTicker;
      socket.emit('power:success', { message: `Hostile Takeover! Pricing variance frozen for ${targetTicker} until next turn.` });
    } 
    else if (player.character === 'Sheep') {
      player.cash += 2500;
      player.powerUsed = true;
      socket.emit('power:success', { message: 'Safety Net deployed! $2,500 emergency cash credited to balance sheet.' });
    }

    broadcastGameState();
  });

  socket.on('trade:buy', ({ ticker, shares }) => {
    const player  = players.get(socket.id);
    if (!player || !gameStarted) return;
    shares = Math.floor(Number(shares));
    if (!shares || shares <= 0) return;

    const stock   = internalStocks.find(s => s.ticker === ticker);
    if (!stock) return;
    const cost    = stock.currentPrice * shares;

    const projectedWorth = calcNetWorth(player);
    if (projectedWorth < 500) {
      socket.emit('trade:error', { message: 'Margin Limit Exceeded. Action denied by clearing broker.' });
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
    socket.emit('trade:success', { action: 'buy / close short', ticker, shares, price: stock.currentPrice });
  });

  socket.on('trade:sell', ({ ticker, shares }) => {
    const player  = players.get(socket.id);
    if (!player || !gameStarted) return;
    shares = Math.floor(Number(shares));
    if (!shares || shares <= 0) return;

    const stock   = internalStocks.find(s => s.ticker === ticker);
    if (!stock) return;

    const holding = player.portfolio.find(h => h.ticker === ticker);
    const currentlyOwned = holding ? holding.shares : 0;

    if (currentlyOwned - shares < -500) {
      socket.emit('trade:error', { message: 'Short limit threshold hit. Maximum allowable short exposure is -500 shares.' });
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
    socket.emit('trade:success', { action: 'sell / open short', ticker, shares, price: stock.currentPrice });
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      players.delete(socket.id);
      console.log(`[SOCKET] ${player.name} disconnected`);
      broadcastLobby();
      if (gameStarted) broadcastGameState();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
