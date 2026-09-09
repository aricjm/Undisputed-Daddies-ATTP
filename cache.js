require('dotenv').config();
const { Redis } = require('@upstash/redis');
const NodeCache = require('node-cache');

// In-memory cache with TTLs for live NFL data (scoreboard & rosters)
const nflCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
// Short in-memory cache for app state (20 seconds) to cut down redundant Redis reads on warm serverless instances
const APP_STATE_MEM_TTL = 20;
const localAppStateCache = new NodeCache({ stdTTL: APP_STATE_MEM_TTL, checkperiod: 30 });

// Initialize Upstash Redis client if credentials exist in environment
let redisClient = null;
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (redisUrl && redisToken) {
  try {
    redisClient = new Redis({
      url: redisUrl,
      token: redisToken
    });
    console.log('[Storage] Connected to Upstash Redis for persistent league state.');
  } catch (err) {
    console.warn('[Storage] Failed to initialize Upstash Redis, falling back to in-memory:', err.message);
  }
} else {
  console.log('[Storage] No Upstash Redis credentials found. Using local in-memory state.');
}

const REDIS_STATE_KEY = 'undisputed_daddies_app_state';

const LEAGUE_MEMBERS = [
  { id: 'aric', name: 'Aric', fullName: 'Aric Myers', teamName: 'Future Father of 3 FC', isAdmin: true, image: '/images/aric.png' },
  { id: 'cisco', name: 'Cisco', fullName: 'Andrew Cisco', teamName: 'The 29ers', isAdmin: true, image: '/images/cisco.png' },
  { id: 'wood', name: 'Wood', fullName: 'Nick Wood', teamName: 'The Replacements', isAdmin: false, image: '/images/wood.png' },
  { id: 'jess', name: 'Jess', fullName: 'Austin Jess', teamName: 'Better Call Pearsall', isAdmin: false, image: '/images/jess.png' },
  { id: 'bubba', name: 'Bubba', fullName: 'Bubba Maske', teamName: 'What is Love?', isAdmin: false, image: '/images/bubba.png' },
  { id: 'nate', name: 'Nate', fullName: 'Nate Winegarden', teamName: "Poepsel's Posse", isAdmin: false, image: '/images/nate.png' },
  { id: 'grady', name: 'Grady', fullName: 'Danny Grady', teamName: 'Our comissioner is a dictator', isAdmin: false, image: '/images/grady.png' },
  { id: 'weddick', name: 'Weddick', fullName: 'Danny Weddick', teamName: 'Real Champ', isAdmin: false, image: '/images/weddick.png' },
  { id: 'swehla', name: 'Swehla', fullName: 'Zach Swehla', teamName: 'Unsolicited Dak Pics', isAdmin: false, image: '/images/swehla.png' },
  { id: 'svatos', name: 'Svatos', fullName: 'Austin Svatos', teamName: 'Pardon My Snake', isAdmin: false, image: '/images/svatos.png' }
];

// Calculate current NFL week based on Tuesday 2:00 AM CST rollover
// Week 1 starts Tuesday 09/08/2026 at 2:00 AM CST
// Week 2 starts Tuesday 09/15/2026 at 2:00 AM CST, etc.
function getCurrentCalculatedWeek(date = new Date()) {
  const week1StartUtc = Date.UTC(2026, 8, 8, 7, 0, 0); // 02:00 CST = 07:00 UTC
  const nowMs = date.getTime();
  const diffMs = nowMs - week1StartUtc;
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  if (diffMs < 0) {
    return 1;
  }
  const weekNum = 1 + Math.floor(diffMs / ONE_WEEK_MS);
  return Math.min(Math.max(weekNum, 1), 18);
}

function getInitialState() {
  return {
    currentWeek: getCurrentCalculatedWeek(),
    seasonYear: 2026,
    currentBettor: 'cisco',
    bettorReason: 'Scored least fantasy points in previous week (64.2 pts)',
    currentWeekPicks: [],
    history: {},
    lastScoringCheck: null,
    memberOverrides: {} // memberId -> { teamName, image }
  };
}

// Fetch app state with 20s in-memory caching to minimize Upstash Redis reads
async function getAppState(forceFresh = false) {
  // 1. Check in-memory cache first if not forcing fresh fetch
  if (!forceFresh) {
    const cachedMem = localAppStateCache.get('app_state');
    if (cachedMem) return cachedMem;
  }

  let state = null;

  if (redisClient) {
    try {
      state = await redisClient.get(REDIS_STATE_KEY);
      if (typeof state === 'string') {
        state = JSON.parse(state);
      }
    } catch (err) {
      console.warn('[Redis] Error fetching state, checking in-memory fallback:', err.message);
    }
  }

  if (!state) {
    if (!localAppStateCache.has('app_state')) {
      localAppStateCache.set('app_state', getInitialState(), APP_STATE_MEM_TTL);
    }
    state = localAppStateCache.get('app_state');
  }

  state.memberOverrides = state.memberOverrides || {};

  // Check if calendar has crossed Tuesday 2:00 AM CST into a new week (or manual override is active)
  const calculatedWeek = getCurrentCalculatedWeek();
  const expectedWeek = state.manualWeekOverride ? state.manualWeekOverride : calculatedWeek;

  if (state.currentWeek !== expectedWeek) {
    if (state.currentWeekPicks && state.currentWeekPicks.length > 0) {
      state.history = state.history || {};
      state.history[state.currentWeek] = state.currentWeekPicks.map(p => ({
        memberId: p.memberId,
        memberName: p.memberName,
        player: p.player,
        result: (p.hasScored || p.status === 'scored') ? 'scored' : 'missed'
      }));
    }

    state.currentWeek = expectedWeek;
    state.currentWeekPicks = [];
    state.lastScoringCheck = null;

    await saveAppState(state);
  } else {
    localAppStateCache.set('app_state', state, APP_STATE_MEM_TTL);
  }

  return state;
}

// Get members enriched with any dynamic user overrides
async function getEnrichedMembers(passedState = null) {
  const state = passedState || await getAppState();
  const overrides = state.memberOverrides || {};
  return LEAGUE_MEMBERS.map(m => {
    const override = overrides[m.id] || {};
    return {
      ...m,
      teamName: override.teamName || m.teamName,
      image: override.image || m.image
    };
  });
}

// Persist app state to Upstash Redis and in-memory cache
async function saveAppState(state) {
  localAppStateCache.set('app_state', state, APP_STATE_MEM_TTL);

  if (redisClient) {
    try {
      await redisClient.set(REDIS_STATE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('[Redis] Error saving state to Upstash:', err.message);
    }
  }

  return state;
}

// Update helper function - always reads fresh before mutating to prevent race conditions
async function updateAppState(updater) {
  const state = await getAppState(true);
  const newState = typeof updater === 'function' ? updater(state) : { ...state, ...updater };
  await saveAppState(newState);
  return newState;
}

// Convert American odds to Decimal odds for parlay calculation
// e.g., +150 -> 2.50; -150 -> 1.667
function americanToDecimal(american) {
  const num = typeof american === 'number' ? american : parseInt(american, 10);
  if (isNaN(num)) return 2.0;
  if (num > 0) {
    return (num / 100) + 1;
  } else if (num < 0) {
    return (100 / Math.abs(num)) + 1;
  }
  return 2.0;
}

// Format decimal back to American display
function decimalToAmerican(decimal) {
  if (decimal >= 2.0) {
    return '+' + Math.round((decimal - 1) * 100);
  } else {
    return '-' + Math.round(100 / (decimal - 1));
  }
}

// Calculate Parlay odds and payout for $10 wager
function calculateParlay(picks, wager = 10) {
  if (!picks || picks.length === 0) {
    return {
      totalOddsAmerican: '+0',
      totalDecimal: 1.0,
      payout: wager.toFixed(2),
      profit: '0.00',
      legsCount: 0,
      draftkingsParlayUrl: 'https://sportsbook.draftkings.com/leagues/football/nfl?category=td-scorers',
      outcomeCount: 0
    };
  }

  let totalDecimal = 1.0;
  for (const pick of picks) {
    const dec = pick.player?.decimalOdds || americanToDecimal(pick.player?.odds || '+150');
    totalDecimal *= dec;
  }

  const payout = wager * totalDecimal;
  const profit = payout - wager;
  const totalOddsAmerican = decimalToAmerican(totalDecimal);

  // Extract DraftKings outcome IDs to construct one-click bet slip URL
  const outcomeIds = picks
    .map(p => p.player?.draftkingsOutcomeId)
    .filter(Boolean);

  const draftkingsParlayUrl = outcomeIds.length > 0
    ? `https://sportsbook.draftkings.com/?outcomes=${outcomeIds.join('+')}`
    : 'https://sportsbook.draftkings.com/leagues/football/nfl?category=td-scorers';

  return {
    totalOddsAmerican,
    totalDecimal: parseFloat(totalDecimal.toFixed(4)),
    payout: payout.toFixed(2),
    profit: profit.toFixed(2),
    legsCount: picks.length,
    draftkingsParlayUrl,
    outcomeCount: outcomeIds.length
  };
}

module.exports = {
  nflCache,
  redisClient,
  LEAGUE_MEMBERS,
  getEnrichedMembers,
  getCurrentCalculatedWeek,
  getAppState,
  saveAppState,
  updateAppState,
  americanToDecimal,
  decimalToAmerican,
  calculateParlay
};
