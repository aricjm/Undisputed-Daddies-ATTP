const NodeCache = require('node-cache');

// In-memory cache with TTLs
// NFL data cache: 15 minutes TTL
const nflCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
// League app state cache: No expiration (persists in memory while server runs)
const appStateCache = new NodeCache({ stdTTL: 0, checkperiod: 0 });

const LEAGUE_MEMBERS = [
  { id: 'aric', name: 'Aric', fullName: 'Aric Myers', teamName: 'Future Father of 3 FC', isAdmin: true, image: '/images/aric.png' },
  { id: 'cisco', name: 'Cisco', fullName: 'Andrew Cisco', teamName: 'The 29ers', isAdmin: true, image: '/images/cisco.png' },
  { id: 'wood', name: 'Wood', fullName: 'Nick Wood', teamName: 'The Replacements', isAdmin: false, image: '/images/wood.png' },
  { id: 'jess', name: 'Jess', fullName: 'Austin Jess', teamName: 'Better Call Pearsall', isAdmin: false, image: '/images/jess.png' },
  { id: 'bubba', name: 'Bubba', fullName: 'Bubba Maske', teamName: 'What is Love?', isAdmin: false, image: '/images/bubba.png' },
  { id: 'nate', name: 'Nate', fullName: 'Nate Winegarden', teamName: "Poepsel's Posse", isAdmin: false, image: '/images/nate.png' },
  { id: 'grady', name: 'Grady', fullName: 'Danny Grady', teamName: 'Our comissioner is a dictator', isAdmin: false, image: '/images/grady.png' },
  { id: 'weddick', name: 'Weddick', fullName: 'Danny Weddick', teamName: 'Real Champ', isAdmin: false, image: '/images/weddick.png' },
  { id: 'swehla', name: 'Swehla', fullName: 'Zach Swehla', teamName: 'Champ', isAdmin: false, image: '/images/swehla.png' },
  { id: 'svatos', name: 'Svatos', fullName: 'Austin Svatos', teamName: 'Pardon My Snake', isAdmin: false, image: '/images/svatos.png' }
];

// Calculate current NFL week based on Tuesday 2:00 AM CST rollover
// Week 1 starts Tuesday 09/08/2026 at 2:00 AM CST
// Week 2 starts Tuesday 09/15/2026 at 2:00 AM CST, etc.
function getCurrentCalculatedWeek(date = new Date()) {
  // Tuesday Sep 8, 2026 02:00 CST = 07:00 UTC
  const week1StartUtc = Date.UTC(2026, 8, 8, 7, 0, 0);
  const nowMs = date.getTime();
  const diffMs = nowMs - week1StartUtc;
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  if (diffMs < 0) {
    return 1;
  }
  const weekNum = 1 + Math.floor(diffMs / ONE_WEEK_MS);
  return Math.min(Math.max(weekNum, 1), 18);
}

// Initialize app state in memory cache
function initAppState() {
  if (!appStateCache.has('app_state')) {
    const currentWeek = getCurrentCalculatedWeek();
    const initialState = {
      currentWeek,
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
  const state = appStateCache.get('app_state');

  // Check if calendar has crossed Tuesday 2am CST into a new week
  const expectedWeek = getCurrentCalculatedWeek();
  if (state.currentWeek !== expectedWeek) {
    // Archive previous week picks into history if not already archived
    if (state.currentWeekPicks && state.currentWeekPicks.length > 0) {
      state.history = state.history || {};
      state.history[state.currentWeek] = state.currentWeekPicks.map(p => ({
        memberId: p.memberId,
        memberName: p.memberName,
        player: p.player,
        result: p.hasScored ? 'scored' : 'missed'
      }));
    }

    // Advance to new week and reset current week picks
    state.currentWeek = expectedWeek;
    state.currentWeekPicks = [];
    state.lastScoringCheck = null;
    appStateCache.set('app_state', state);
  }

  return state;
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
  getCurrentCalculatedWeek,
  getAppState,
  updateAppState,
  americanToDecimal,
  decimalToAmerican,
  calculateParlay
};
