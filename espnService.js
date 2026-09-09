const { nflCache, redisClient, americanToDecimal } = require('./cache');

// Baseline fallback touchdown odds based on position and ranking
// Used to realistically estimate ATT lines if ESPN/DraftKings feed does not have individual player prop lines published
function estimateAttOdds(pos, index) {
  const p = (pos || '').toUpperCase();
  if (p === 'RB') {
    if (index === 0) return -125; // RB1
    if (index === 1) return +135; // RB2
    return +275;
  }
  if (p === 'WR') {
    if (index === 0) return +120; // WR1
    if (index === 1) return +175; // WR2
    if (index === 2) return +260; // WR3
    return +400;
  }
  if (p === 'TE') {
    if (index === 0) return +180; // TE1
    return +350;
  }
  if (p === 'QB') {
    return +320; // Rushing TD
  }
  return +300;
}

// Fetch scoreboard to get current week, season, games, and teams
async function fetchCurrentScoreboard(targetWeek) {
  const weekParam = targetWeek ? `?week=${targetWeek}` : '';
  const cacheKey = `nfl_scoreboard_${targetWeek || 'current'}`;
  const cached = nflCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard${weekParam}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch scoreboard: ${res.statusText}`);
  }
  const data = await res.json();
  nflCache.set(cacheKey, data, 300); // 5 min cache
  return data;
}

// Fetch team roster from ESPN
async function fetchTeamRoster(teamId) {
  const cacheKey = `nfl_team_roster_${teamId}`;
  const cached = nflCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`Failed to fetch roster for team ${teamId}: ${res.statusText}`);
    return null;
  }
  const data = await res.json();
  nflCache.set(cacheKey, data, 1800); // 30 min cache
  return data;
}

// Fetch real ATT odds from The Odds API for all current week games
// Returns Map: playerNameLower -> americanOdds (integer)
async function fetchRealAttOdds(espnEvents) {
  const memCacheKey = 'odds_api_att_odds';
  const REDIS_ODDS_KEY = 'undisputed_daddies_odds_api_odds';

  // 1. Check fast in-memory cache first
  const cachedMem = nflCache.get(memCacheKey);
  if (cachedMem) return cachedMem;

  // 2. Check persistent Upstash Redis cache (survives Vercel cold starts)
  if (redisClient) {
    try {
      const cachedRedis = await redisClient.get(REDIS_ODDS_KEY);
      if (cachedRedis && typeof cachedRedis === 'object') {
        const playerOddsMap = new Map(Object.entries(cachedRedis));
        if (playerOddsMap.size > 0) {
          console.log(`[OddsAPI] Loaded ${playerOddsMap.size} players from Upstash Redis cache`);
          nflCache.set(memCacheKey, playerOddsMap, 1800);
          return playerOddsMap;
        }
      }
    } catch (err) {
      console.warn('[OddsAPI] Failed reading from Redis cache, proceeding to fetch:', err.message);
    }
  }

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    console.warn('[OddsAPI] No ODDS_API_KEY set, using estimated odds');
    return new Map();
  }

  try {
    // Get Odds API event list (1 request)
    const eventsRes = await fetch(`https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events?apiKey=${apiKey}`);
    if (!eventsRes.ok) {
      console.warn('[OddsAPI] Events fetch failed:', eventsRes.status);
      return new Map();
    }
    const oddsEvents = await eventsRes.json();

    // Build normalized last-word team name lookup from ESPN events
    const espnTeamPairs = (espnEvents || []).map(e => {
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === 'home')?.team?.displayName || '';
      const away = comp?.competitors?.find(c => c.homeAway === 'away')?.team?.displayName || '';
      return { home: home.toLowerCase(), away: away.toLowerCase() };
    });

    // Match Odds API events to ESPN events by team nickname (last word of team name)
    const matchedOddsEventIds = [];
    for (const oe of oddsEvents) {
      const oeHome = (oe.home_team || '').toLowerCase();
      const oeAway = (oe.away_team || '').toLowerCase();
      const oeHomeNick = oeHome.split(' ').pop();
      const oeAwayNick = oeAway.split(' ').pop();
      const match = espnTeamPairs.find(ep => {
        const epHomeNick = ep.home.split(' ').pop();
        const epAwayNick = ep.away.split(' ').pop();
        return epHomeNick === oeHomeNick && epAwayNick === oeAwayNick;
      });
      if (match) matchedOddsEventIds.push(oe.id);
    }

    console.log(`[OddsAPI] Matched ${matchedOddsEventIds.length} games for ATT odds`);

    // Fetch ATT props for each matched game in parallel (1 request per game)
    const propResults = await Promise.all(
      matchedOddsEventIds.map(async (oddsEventId) => {
        try {
          const url = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/${oddsEventId}/odds?apiKey=${apiKey}&markets=player_anytime_td&bookmakers=draftkings&oddsFormat=american`;
          const res = await fetch(url);
          if (!res.ok) return null;
          return await res.json();
        } catch { return null; }
      })
    );

    // Build playerName -> americanOdds map from DraftKings data
    const playerOddsMap = new Map();
    for (const result of propResults) {
      if (!result?.bookmakers) continue;
      const dk = result.bookmakers.find(b => b.key === 'draftkings');
      if (!dk) continue;
      const market = dk.markets?.find(m => m.key === 'player_anytime_td');
      if (!market) continue;
      for (const outcome of market.outcomes || []) {
        // player name is in description field, name field is always "Yes"
        const name = (outcome.description || outcome.name || '').toLowerCase().trim();
        const price = outcome.price;
        if (name && price !== undefined) playerOddsMap.set(name, price);
      }
    }

    console.log(`[OddsAPI] Loaded real ATT odds for ${playerOddsMap.size} players`);

    // Save to Upstash Redis with 24-hour TTL (86400s) to persist across serverless instances
    if (redisClient && playerOddsMap.size > 0) {
      try {
        const oddsObject = Object.fromEntries(playerOddsMap);
        await redisClient.set(REDIS_ODDS_KEY, oddsObject, { ex: 86400 });
        console.log('[OddsAPI] Saved odds to Upstash Redis (24 hr TTL)');
      } catch (err) {
        console.warn('[OddsAPI] Failed to save odds to Redis:', err.message);
      }
    }

    nflCache.set(memCacheKey, playerOddsMap, 1800); // 30 min cache
    return playerOddsMap;
  } catch (err) {
    console.warn('[OddsAPI] Error fetching ATT odds:', err.message);
    return new Map();
  }
}

// Fetch prop bets for a competition/event
async function fetchEventPropBets(eventId) {
  const cacheKey = `nfl_event_props_${eventId}`;
  const cached = nflCache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${eventId}/competitions/${eventId}/odds/100/propBets?lang=en&region=us&limit=750`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    nflCache.set(cacheKey, data, 900); // 15 min cache
    return data;
  } catch (err) {
    console.warn(`Could not fetch props for event ${eventId}:`, err.message);
    return null;
  }
}

// Build list of all offensive NFL players playing this week with their matchup and ATT odds
async function getWeekPlayers(targetWeek) {
  const cacheKey = `all_week_players_${targetWeek || 'current'}`;
  const cached = nflCache.get(cacheKey);
  if (cached) return cached;

  const scoreboard = await fetchCurrentScoreboard(targetWeek);
  const weekInfo = {
    season: scoreboard.season?.year || 2026,
    week: targetWeek || scoreboard.week?.number || 1
  };

  const matchupsByTeamId = {};
  const teamMeta = {};
  const eventIds = [];

  // Map each team playing this week to their opponent, home/away status, and game time
  for (const event of scoreboard.events || []) {
    eventIds.push(event.id);
    const comp = event.competitions?.[0];
    if (!comp) continue;

    const competitors = comp.competitors || [];
    const homeTeam = competitors.find(c => c.homeAway === 'home');
    const awayTeam = competitors.find(c => c.homeAway === 'away');

    if (homeTeam && awayTeam) {
      matchupsByTeamId[homeTeam.team.id] = {
        matchup: `vs ${awayTeam.team.abbreviation}`,
        opponent: awayTeam.team.displayName,
        opponentAbbrev: awayTeam.team.abbreviation,
        opponentLogo: awayTeam.team.logo,
        isHome: true,
        gameStatus: event.status?.type?.detail || event.status?.type?.description || 'Upcoming',
        gameTime: event.date,
        eventId: event.id
      };
      matchupsByTeamId[awayTeam.team.id] = {
        matchup: `@ ${homeTeam.team.abbreviation}`,
        opponent: homeTeam.team.displayName,
        opponentAbbrev: homeTeam.team.abbreviation,
        opponentLogo: homeTeam.team.logo,
        isHome: false,
        gameStatus: event.status?.type?.detail || event.status?.type?.description || 'Upcoming',
        gameTime: event.date,
        eventId: event.id
      };
      teamMeta[homeTeam.team.id] = homeTeam.team;
      teamMeta[awayTeam.team.id] = awayTeam.team;
    }
  }

  // Fetch team rosters and depth charts for all playing teams in parallel
  const playingTeamIds = Object.keys(matchupsByTeamId);
  const seasonYear = weekInfo.season;

  const rosterPromises = playingTeamIds.map(tId => fetchTeamRoster(tId));
  const depthPromises = playingTeamIds.map(async (tId) => {
    try {
      const res = await fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${seasonYear}/teams/${tId}/depthcharts`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  });

  const [rosters, depthCharts] = await Promise.all([
    Promise.all(rosterPromises),
    Promise.all(depthPromises)
  ]);

  // Build athlete ID -> depth chart rank map (1 = starter / RB1 / WR1 / TE1 / QB1)
  const depthRankMap = {};
  for (const depthData of depthCharts) {
    if (!depthData || !depthData.items) continue;
    for (const item of depthData.items) {
      if (!item.positions) continue;
      for (const pk of Object.keys(item.positions)) {
        const posData = item.positions[pk];
        if (!posData || !Array.isArray(posData.athletes)) continue;
        for (const ath of posData.athletes) {
          const str = JSON.stringify(ath);
          const m = str.match(/athletes\/(\d+)/);
          if (m && m[1]) {
            const athId = m[1];
            const r = ath.rank || 1;
            if (!depthRankMap[athId] || r < depthRankMap[athId]) {
              depthRankMap[athId] = r;
            }
          }
        }
      }
    }
  }

  // Fetch real ATT odds from The Odds API (runs in parallel with roster/depth fetches already done)
  const realOddsMap = await fetchRealAttOdds(scoreboard.events || []);

  const players = [];
  const relevantPositions = ['QB', 'RB', 'WR', 'TE', 'FB'];

  for (let i = 0; i < playingTeamIds.length; i++) {
    const teamId = playingTeamIds[i];
    const roster = rosters[i];
    const matchup = matchupsByTeamId[teamId];
    const team = teamMeta[teamId];

    if (!roster || !roster.athletes) continue;

    const offenseGroup = roster.athletes.find(g => g.position === 'offense');
    if (!offenseGroup || !offenseGroup.items) continue;

    const posCount = {};

    for (const athlete of offenseGroup.items) {
      const pos = athlete.position?.abbreviation || 'OFF';
      if (!relevantPositions.includes(pos)) continue;

      posCount[pos] = (posCount[pos] || 0) + 1;
      const rosterPosIndex = posCount[pos] - 1;

      // Use official depth chart rank (1-indexed) if available, otherwise fall back to roster order
      const depthRank = depthRankMap[athlete.id] || (rosterPosIndex + 1);
      const effectiveIndex = depthRank - 1;

      // Filter out deep bench players (e.g. QB3+, WR7+, RB5+, TE4+) to keep list clean
      if (pos === 'QB' && effectiveIndex > 1) continue;
      if (pos === 'RB' && effectiveIndex > 3) continue;
      if (pos === 'WR' && effectiveIndex > 4) continue;
      if (pos === 'TE' && effectiveIndex > 2) continue;

      const playerFullName = athlete.fullName || athlete.displayName;
      const nameLower = playerFullName.toLowerCase().trim();
      const estimatedOdds = estimateAttOdds(pos, effectiveIndex);
      const realOdds = realOddsMap.get(nameLower);
      const oddsNum = realOdds !== undefined ? realOdds : estimatedOdds;
      const oddsDisplay = oddsNum > 0 ? `+${oddsNum}` : `${oddsNum}`;

      players.push({
        id: athlete.id,
        name: playerFullName,
        shortName: athlete.shortName || playerFullName,
        position: pos,
        positionName: athlete.position?.name || pos,
        jersey: athlete.jersey || '',
        headshot: athlete.headshot?.href || `https://a.espncdn.com/i/headshots/nfl/players/full/${athlete.id}.png`,
        teamId: teamId,
        teamName: team?.displayName || roster.team?.displayName || 'NFL Team',
        teamAbbr: team?.abbreviation || roster.team?.abbreviation || '',
        teamLogo: team?.logo || roster.team?.logo || `https://a.espncdn.com/i/teamlogos/nfl/500/${(team?.abbreviation || '').toLowerCase()}.png`,
        matchup: matchup.matchup,
        opponent: matchup.opponent,
        opponentLogo: matchup.opponentLogo,
        isHome: matchup.isHome,
        gameStatus: matchup.gameStatus,
        gameTime: matchup.gameTime,
        eventId: matchup.eventId,
        draftkingsEventUrl: `https://sportsbook.draftkings.com/event/${matchup.eventId}`,
        odds: oddsDisplay,
        oddsValue: oddsNum,
        decimalOdds: americanToDecimal(oddsNum),
        oddsSource: realOdds !== undefined ? 'draftkings' : 'estimated'
      });
    }
  }

  // Sort players by best anytime touchdown odds / popularity
  players.sort((a, b) => a.oddsValue - b.oddsValue);

  const result = {
    season: weekInfo.season,
    week: weekInfo.week,
    players,
    total: players.length,
    lastUpdated: new Date().toISOString()
  };

  nflCache.set(cacheKey, result, 600); // 10 min cache
  return result;
}

// Check touchdown status for players in current week using live ESPN scoring plays
async function checkPlayerScoringStatus(picks, targetWeek) {
  if (!picks || picks.length === 0) return [];

  const scoreboard = await fetchCurrentScoreboard(targetWeek);
  const eventIds = new Set(scoreboard.events?.map(e => e.id) || []);

  // Fetch summaries for all events playing this week in parallel
  const summaryPromises = Array.from(eventIds).map(async (eventId) => {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  });

  const summaries = await Promise.all(summaryPromises);

  // Extract all touchdown scoring plays
  const tdScorers = [];
  for (const sum of summaries) {
    if (!sum || !sum.scoringPlays) continue;
    for (const play of sum.scoringPlays) {
      const typeText = play.type?.text || '';
      const scoringType = play.scoringType?.name || '';
      const playText = play.text || '';

      const isTD = scoringType.toLowerCase().includes('touchdown') || 
                   typeText.toLowerCase().includes('touchdown') ||
                   playText.toLowerCase().includes('touchdown') ||
                   playText.toLowerCase().includes(' yd run') ||
                   playText.toLowerCase().includes(' yd pass');

      if (isTD) {
        tdScorers.push({
          playText,
          typeText,
          team: play.team?.displayName,
          quarter: play.period?.number,
          clock: play.clock?.displayValue
        });
      }
    }
  }

  // Evaluate each pick
  const evaluatedPicks = picks.map(pick => {
    const playerName = pick.player?.name?.toLowerCase() || '';
    const playerShort = pick.player?.shortName?.toLowerCase() || '';
    const lastName = playerName.split(' ').slice(-1)[0];

    // Check if player appears in any touchdown scoring text
    const matchingTD = tdScorers.find(td => {
      const text = td.playText.toLowerCase();
      // Match full name, or shortName, or check lastName preceded by first initial or word boundary
      if (text.includes(playerName)) return true;
      if (playerShort && text.includes(playerShort)) return true;
      // Also match e.g. "Josh Allen 7 Yd Run" or "Kyle Pitts 12 Yd pass"
      const words = playerName.split(' ');
      if (words.length >= 2) {
        const firstInitial = words[0][0];
        const regex = new RegExp(`\\b(${firstInitial}\\.?\\s*${lastName}|${words[0]}\\s+${lastName})\\b`, 'i');
        if (regex.test(td.playText)) return true;
      }
      return false;
    });

    return {
      ...pick,
      hasScored: !!matchingTD,
      scoringPlay: matchingTD ? matchingTD.playText : null,
      status: matchingTD ? 'scored' : 'pending' // 'scored' | 'pending'
    };
  });

  return evaluatedPicks;
}

module.exports = {
  fetchCurrentScoreboard,
  fetchTeamRoster,
  fetchEventPropBets,
  getWeekPlayers,
  checkPlayerScoringStatus
};
