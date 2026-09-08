const { nflCache, americanToDecimal } = require('./cache');

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

  // Fetch all team rosters playing this week in parallel batches
  const playingTeamIds = Object.keys(matchupsByTeamId);
  const rosterPromises = playingTeamIds.map(tId => fetchTeamRoster(tId));
  const rosters = await Promise.all(rosterPromises);

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
      const posIndex = posCount[pos] - 1;

      // Filter out deep bench players (e.g. QB3, WR7+, RB6+) to keep list clean, high quality and fast
      if (pos === 'QB' && posIndex > 1) continue;
      if (pos === 'RB' && posIndex > 4) continue;
      if (pos === 'WR' && posIndex > 5) continue;
      if (pos === 'TE' && posIndex > 3) continue;

      const defaultOddsNum = estimateAttOdds(pos, posIndex);
      const oddsDisplay = defaultOddsNum > 0 ? `+${defaultOddsNum}` : `${defaultOddsNum}`;

      players.push({
        id: athlete.id,
        name: athlete.fullName || athlete.displayName,
        shortName: athlete.shortName || athlete.fullName,
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
        odds: oddsDisplay,
        oddsValue: defaultOddsNum,
        decimalOdds: americanToDecimal(defaultOddsNum)
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
