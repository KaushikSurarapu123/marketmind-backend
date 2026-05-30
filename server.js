const express = require('express');
const cors    = require('cors');
const http    = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);

// Cloud-optimized production WebSockets connection layers
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── Constants & Game Modifiers ──────────────────────────────────────────────

const STARTING_CASH = 10000;
const INITIAL_SEED  = 'SEED_TEST_2026';
const MARGIN_INTEREST_RATE = 0.05; 
const MAX_TURNS = 10;

const CHARACTERS = {
  Wolf:  { name: 'Wolf',  emoji: '🐺', style: 'aggressive' },
  Bear:  { name: 'Bear',  emoji: '🐻', style: 'cautious' },
  Bull:  { name: 'Bull',  emoji: '🐂', style: 'optimistic' },
  Sheep: { name: 'Sheep', emoji: '🐑', style: 'beginner' },
};

// Expanded Interactive High-Stakes Events Engine
const MARKET_EVENTS = [
  { text: "AI Breakthrough announced! Technology stocks surge.", sector: "Technology", multiplier: 1.35, type: "boom" },
  { text: "Strict global environmental audits hit fossil fuels. Energy collapses.", sector: "Energy", multiplier: 0.60, type: "bust" },
  { text: "Power grid failure! Utilities plummet, but tech volatility doubles.", sector: "Utilities", multiplier: 0.65, type: "bust" },
  { text: "Healthcare deregulation bill passes. Healthcare sector breaks out.", sector: "Healthcare", multiplier: 1.30, type: "boom" },
  { text: "Black Swan Event! Hyperinflation fears grip global markets.", sector: "All", multiplier: 0.75, type: "crash" },
  { text: "Whale Manipulation! High-volume institutional trades trigger sector anomalies.", sector: "All", multiplier: 1.15, type: "boom" },
  { text: "Regulatory Overhaul Slap! Compliance fees spike trading friction.", sector: "Technology", multiplier: 0.85, type: "bust" },
  { text: "Standard Turn. Normal corporate earnings reporting across indices.", sector: "None", multiplier: 1.00, type: "neutral" }
];

const MOCK_CSV_DATA = [
  { ticker: 'TECH_GEN',  sector: 'Technology', base_price: 150.00, volatility: 0.12, dividend_yield: 0.015 },
  { ticker: 'HC_STABLE', sector: 'Healthcare',  base_price:  85.50, volatility: 0.04, dividend_yield: 0.042 },
  { ticker: 'NRG_SHOCK', sector: 'Energy',      base_price:  62.25, volatility: 0.08, dividend_yield: 0.035 },
  { ticker: 'UTIL_SAFE', sector: 'Utilities',   base_price: 110.00, volatility: 0.03, dividend_yield: 0.051 },
];

// ─── Live State Management ───────────────────────────────────────────────────

let currentTurn    = 1;
let gameStarted    = false;
let internalStocks = [];
let rng            = null;
let currentEvent   = { text: "Market open. Initial listings registered.", sector: "None", multiplier: 1.00, type: "neutral" };
let freezeTicker   = null;
let marketSentiment = 50; // Tracks live room actions (Scale: 0-100 Bullish)

const players      = new Map();

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
  rng         = seededRandom(INITIAL_SEED);
  currentTurn = 1;
  freezeTicker = null;
  marketSentiment = 50;
  currentEvent = { text: "Market open. Initial listings registered.", sector: "None", multiplier: 1.00, type: "neutral" };
}

function applyCharacterBonus(player, updatedStocks) {
  let { cash, portfolio, character } = player;
  const style = CHARACTERS[character]?.style;

  portfolio = portfolio.map(holding => {
    const stock = updatedStocks.find(s => s.ticker === holding.ticker);
    if (!stock) return holding;
    const priceDiff = stock.currentPrice - stock.previousPrice;

    if (holding.shares > 0) {
      // Perks grow 1% more impactful per turn depth
      const scalarModifier = 1 + (currentTurn * 0.01); 
      
      if (style === 'aggressive' && stock.movementDirection === 'up') {
        cash += holding.shares * priceDiff * 0.15 * scalarModifier;
      }
      if (style === 'cautious' && stock.movementDirection === 'down') {
        cash += holding.shares * Math.abs(priceDiff) * 0.50 * scalarModifier;
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
      if (stock && holding.shares > 0) cash += holding.shares * stock.currentPrice * stock.dividendYield * 0.12;
    });
  }

  return { cash, portfolio };
}

function calcNetWorth(player) {
  if (!internalStocks || internalStocks.length === 0) return player.cash;
  const assetValue = player.portfolio.reduce((sum, h) => {
    const stock = internalStocks.find(s => s.ticker === h.ticker);
    if (!stock) return sum;
    return sum + (stock.currentPrice * h.shares);
  }, 0);
  return player.cash + assetValue;
}

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

function broadcastLobby() {
  io.emit('lobby:update', {
    players: Array.from(players.values()).map(p => ({ id: p.id, name: p.name, character: p.character, ready: p.ready })),
  });
}

function broadcastGameState() {
  const leaderboard = getFullLeaderboard();
  for (const [socketId, player] of players.entries()) {
    io.to(socketId).emit('game:update', {
      turn:        currentTurn,
      maxTurns:    MAX_TURNS,
      stocks:      internalStocks,
      cash:        player.cash,
      portfolio:   player.portfolio,
      netWorth:    calcNetWorth(player),
      leaderboard: leaderboard,
      currentEvent: currentEvent,
      marketSentiment: marketSentiment,
      powerUsed:    player.powerUsed || false
    });
  }
}

// ─── HTTP Core Simulation Loops ──────────────────────────────────────────────

app.post('/api/market/advance', (req, res) => {
  if (!gameStarted) return res.status(400).json({ error: 'Game not started.' });

  currentTurn++;

  if (currentTurn > MAX_TURNS) {
    gameStarted = false;
    const finalLeaderboard = getFullLeaderboard();
    io.emit('game:over', { winner: finalLeaderboard[0], leaderboard: finalLeaderboard });
    return res.json({ success: true, gameOver: true });
  }

  const randomIdx = Math.floor(Math.random() * MARKET_EVENTS.length);
  currentEvent = MARKET_EVENTS[randomIdx];

  let activeSqueezeTicker = null;
  for (const [id, player] of players.entries()) {
    if (player.squeezeActiveTurn === currentTurn) activeSqueezeTicker = player.squeezeTicker;
  }

  // Adjust asset calculations using the interactive Market Sentiment Meter
  const sentimentShift = (marketSentiment - 50) / 250; 

  internalStocks = internalStocks.map(stock => {
    if (freezeTicker === stock.ticker) {
      return { ...stock, previousPrice: stock.currentPrice, movementDirection: 'neutral' };
    }

    let changePercent = ((rng() - 0.5) * 2 * stock.volatility) + sentimentShift;
    
    if (currentEvent.sector === stock.sector || currentEvent.sector === "All") {
      changePercent += (currentEvent.multiplier - 1.0);
    }
    if (activeSqueezeTicker === stock.ticker) changePercent += 0.25; 

    const previousPrice = stock.currentPrice;
    const currentPrice  = Math.max(1.00, Number((previousPrice * (1 + changePercent)).toFixed(2)));
    
    let direction = 'neutral';
    if (currentPrice > previousPrice) direction = 'up';
    else if (currentPrice < previousPrice) direction = 'down';

    return { ...stock, previousPrice, currentPrice, movementDirection: direction };
  });

  freezeTicker = null;

  // Process Margin Accounts & Liquidations
  for (const [id, player] of players.entries()) {
    if (player.cash < 0) player.cash += player.cash * MARGIN_INTEREST_RATE;

    const result = applyCharacterBonus(player, internalStocks);
    player.cash      = result.cash;
    player.portfolio = result.portfolio;

    if (calcNetWorth(player) < 1000 && player.cash < 0) {
      player.portfolio = [];
      player.cash = Math.max(0, calcNetWorth(player)); 
      io.to(player.id).emit('trade:error', { message: 'CRITICAL MARGIN CALL: Portfolio automatically liquidated.' });
    }
  }

  // Naturally normalize sentiment closer back to 50 balance threshold over time
  marketSentiment = Math.floor((marketSentiment + 50) / 2);

  broadcastGameState();
  res.json({ success: true, turn: currentTurn, gameOver: false });
});

// ─── Websockets Core Routing Lifecycle ───────────────────────────────────────

io.on('connection', (socket) => {
  players.set(socket.id, { id: socket.id, name: 'Anonymous', character: null, ready: false, cash: STARTING_CASH, portfolio: [] });

  socket.on('lobby:join', ({ name }) => {
    const player = players.get(socket.id) || { id: socket.id, cash: STARTING_CASH, portfolio: [] };
    player.name = name.trim();
    player.character = null;
    player.ready = false;
    players.set(socket.id, player);
    broadcastLobby();
  });

  socket.on('lobby:pick_character', ({ character }) => {
    const player = players.get(socket.id);
    if (player) {
      player.character = character;
      broadcastLobby();
    }
  });

  socket.on('lobby:ready', () => {
    const player = players.get(socket.id);
    if (!player || !player.character) return;
    
    player.ready = !player.ready;
    broadcastLobby();

    const activeGamingPlayers = Array.from(players.values()).filter(p => p.character !== null);
    if (activeGamingPlayers.every(p => p.ready) && activeGamingPlayers.length >= 2 && !gameStarted) {
      gameStarted = true;
      loadInitialMarketData();
      io.emit('game:started');
      broadcastGameState();
    }
  });

  socket.on('power:activate', ({ targetTicker }) => {
    const player = players.get(socket.id);
    if (!player || !gameStarted || player.powerUsed) return;

    if (player.character === 'Wolf') {
      player.powerUsed = true;
      player.squeezeActiveTurn = currentTurn + 1;
      player.squeezeTicker = targetTicker;
      marketSentiment = Math.min(100, marketSentiment + 15);
      socket.emit('power:success', { message: `Short Squeeze ordered on ${targetTicker} for next turn!` });
    } 
    else if (player.character === 'Bear') {
      if (player.cash < 1000) return socket.emit('trade:error', { message: 'Insufficient cash fee ($1,000) for insider leak.' });
      player.cash -= 1000;
      player.powerUsed = true;
      marketSentiment = Math.max(0, marketSentiment - 10);
      const prediction = Math.random() > 0.5 ? "BULLISH BREAKOUT SHIFT" : "BEARISH CRASH DEPRECIATION";
      socket.emit('power:success', { message: `INSIDER LEAK: Macro calculations indicate a ${prediction} phase next turn.` });
    } 
    else if (player.character === 'Bull') {
      player.powerUsed = true;
      freezeTicker = targetTicker;
      marketSentiment = Math.min(100, marketSentiment + 10);
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
    const player = players.get(socket.id);
    if (!player || !gameStarted) return;
    shares = Math.floor(Number(shares)) || 0;
    if (shares <= 0) return;

    const stock = internalStocks.find(s => s.ticker === ticker);
    if (!stock) return;

    player.cash -= (stock.currentPrice * shares);
    const holding = player.portfolio.find(h => h.ticker === ticker);
    if (holding) holding.shares += shares; else player.portfolio.push({ ticker, shares });

    marketSentiment = Math.min(100, marketSentiment + 2); // Heavy buying signals bullish sentiment
    broadcastGameState();
    socket.emit('trade:success', { action: 'buy Long', ticker, shares, price: stock.currentPrice });
  });

  socket.on('trade:sell', ({ ticker, shares }) => {
    const player = players.get(socket.id);
    if (!player || !gameStarted) return;
    shares = Math.floor(Number(shares)) || 0;
    if (shares <= 0) return;

    const stock = internalStocks.find(s => s.ticker === ticker);
    if (!stock) return;

    const holding = player.portfolio.find(h => h.ticker === ticker);
    if ((holding ? holding.shares : 0) - shares < -500) {
      return socket.emit('trade:error', { message: 'Short limit threshold hit. Maximum exposure is -500 units.' });
    }

    if (holding) holding.shares -= shares; else player.portfolio.push({ ticker, shares: -shares });
    player.cash += (stock.currentPrice * shares);

    player.portfolio = player.portfolio.filter(h => h.shares !== 0);
    marketSentiment = Math.max(0, marketSentiment - 2); // Dumping assets pushes down the sentiment bar
    broadcastGameState();
    socket.emit('trade:success', { action: 'sell Short', ticker, shares, price: stock.currentPrice });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    broadcastLobby();
    broadcastGameState();
  });
});

server.listen(PORT, () => {
  console.log(`Production MarketMind instance listening dynamically on Port: ${PORT}`);
});
