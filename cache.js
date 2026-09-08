const NodeCache = require('node-cache');

// In-memory cache with TTLs
// NFL data cache: 15 minutes TTL
const nflCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
// League app state cache: No expiration (persists in memory while server runs)
const appStateCache = new NodeCache({ stdTTL: 0, checkperiod: 0 });

const LEAGUE_MEMBERS = [
  { id: 'aric', name: 'Aric', isAdmin: true },
  { id: 'cisco', name: 'Cisco', isAdmin: false },
  { id: 'wood', name: 'Wood', isAdmin: false },
  { id: 'jess', name: 'Jess', isAdmin: false },
  { id: 'bubba', name: 'Bubba', isAdmin: false },
  { id: 'nate', name: 'Nate', isAdmin: false },
  { id: 'grady', name: 'Grady', isAdmin: false },
  { id: 'weddick', name: 'Weddick', isAdmin: false },
  { id: 'swehla', name: 'Swehla', isAdmin: false },
  { id: 'svatos', name: 'Svatos', isAdmin: false }
];

// Initialize app state in memory cache
function initAppState() {
  if (!appStateCache.has('app_state')) {
    const initialState = {
      currentWeek: 1,
      seasonYear: 2026,
      currentBettor: 'cisco', // Default bettor (lowest fantasy points previous week)
      bettorReason: 'Scored least fantasy points in previous week (64.2 pts)',
      // Picks for current week: array of { memberId, memberName, player: { id, name, team, position, headshot, matchup, odds, decimalOdds, oddsValue }, pickedAt }
      currentWeekPicks: [],
      // Historical weeks stats: weekNumber -> array of picks with status: 'pending' | 'scored' | 'missed'
      history: {
        // We can pre-populate an example past week so the stats page is immediately rich & testable
      },
      lastScoringCheck: null
    };
    appStateCache.set('app_state', initialState);
  }
}

initAppState();

function getAppState() {
  initAppState();
  return appStateCache.get('app_state');
}

function updateAppState(updater) {
  const state = getAppState();
  const newState = typeof updater === 'function' ? updater(state) : { ...state, ...updater };
  appStateCache.set('app_state', newState);
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
      legsCount: 0
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

  return {
    totalOddsAmerican,
    totalDecimal: parseFloat(totalDecimal.toFixed(4)),
    payout: payout.toFixed(2),
    profit: profit.toFixed(2),
    legsCount: picks.length
  };
}

module.exports = {
  nflCache,
  appStateCache,
  LEAGUE_MEMBERS,
  getAppState,
  updateAppState,
  americanToDecimal,
  decimalToAmerican,
  calculateParlay
};
