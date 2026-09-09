const express = require('express');
const cors = require('cors');
const {
  LEAGUE_MEMBERS,
  getEnrichedMembers,
  getCurrentCalculatedWeek,
  getAppState,
  updateAppState,
  calculateParlay
} = require('../cache');
const {
  getWeekPlayers,
  checkPlayerScoringStatus
} = require('../espnService');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/members', async (req, res) => {
  try {
    const members = await getEnrichedMembers();
    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/members/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    const { teamName, image } = req.body;

    const baseMember = LEAGUE_MEMBERS.find(m => m.id === memberId);
    if (!baseMember) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const state = await getAppState();
    state.memberOverrides = state.memberOverrides || {};
    const existing = state.memberOverrides[memberId] || {};

    state.memberOverrides[memberId] = {
      teamName: typeof teamName === 'string' && teamName.trim() ? teamName.trim() : (existing.teamName || baseMember.teamName),
      image: typeof image === 'string' && image.trim() ? image.trim() : (existing.image || baseMember.image)
    };

    await updateAppState(state);

    const updatedMembers = await getEnrichedMembers();
    const updatedMember = updatedMembers.find(m => m.id === memberId);

    res.json({
      success: true,
      message: `Updated team profile for ${updatedMember.name}!`,
      member: updatedMember
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/parlay', async (req, res) => {
  try {
    const state = await getAppState();
    const members = await getEnrichedMembers();

    // Dynamically enrich picks with DraftKings outcome IDs if missing
    let weekPlayersMap = null;
    const enrichedPicks = await Promise.all((state.currentWeekPicks || []).map(async (p) => {
      if (!p.player?.draftkingsOutcomeId) {
        try {
          if (!weekPlayersMap) {
            const weekData = await getWeekPlayers(state.currentWeek);
            weekPlayersMap = new Map((weekData?.players || []).map(wp => [String(wp.id), wp]));
          }
          const wp = weekPlayersMap.get(String(p.player?.id));
          if (wp?.draftkingsOutcomeId) {
            return {
              ...p,
              player: {
                ...p.player,
                draftkingsOutcomeId: wp.draftkingsOutcomeId,
                draftkingsBetUrl: wp.draftkingsBetUrl
              }
            };
          }
        } catch { /* proceed without enrichment */ }
      }
      return p;
    }));

    const parlayCalculation = calculateParlay(enrichedPicks, 10);

    const memberStatuses = members.map(m => {
      const pick = enrichedPicks.find(p => p.memberId === m.id);
      return {
        ...m,
        hasPicked: !!pick,
        pick: pick || null
      };
    });

    const currentBettorMember = members.find(m => m.id === state.currentBettor) || members[1];

    res.json({
      week: state.currentWeek,
      calculatedWeek: getCurrentCalculatedWeek(),
      manualWeekOverride: state.manualWeekOverride || null,
      seasonYear: state.seasonYear,
      bettor: currentBettorMember,
      bettorReason: state.bettorReason || '',
      members: memberStatuses,
      picksCount: enrichedPicks.length,
      totalMembers: members.length,
      parlay: parlayCalculation,
      lastScoringCheck: state.lastScoringCheck
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/players', async (req, res) => {
  try {
    const state = await getAppState();
    const weekData = await getWeekPlayers(state.currentWeek);
    
    const pickedPlayerIds = new Set(state.currentWeekPicks.map(p => String(p.player.id)));
    const availablePlayers = weekData.players.filter(p => !pickedPlayerIds.has(String(p.id)));

    res.json({
      week: state.currentWeek,
      season: weekData.season,
      totalAvailable: availablePlayers.length,
      totalRoster: weekData.players.length,
      pickedCount: pickedPlayerIds.size,
      players: availablePlayers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/picks', async (req, res) => {
  try {
    const { memberId, playerId } = req.body;
    if (!memberId || !playerId) {
      return res.status(400).json({ error: 'memberId and playerId are required.' });
    }

    const member = LEAGUE_MEMBERS.find(m => m.id === memberId);
    if (!member) {
      return res.status(400).json({ error: 'Invalid league member.' });
    }

    const state = await getAppState();

    const existingPick = state.currentWeekPicks.find(p => p.memberId === memberId);
    if (existingPick) {
      return res.status(400).json({ error: `${member.name} has already selected a player for this week (${existingPick.player.name}).` });
    }

    const playerTaken = state.currentWeekPicks.find(p => String(p.player.id) === String(playerId));
    if (playerTaken) {
      return res.status(400).json({ error: `This player has already been chosen by ${playerTaken.memberName}.` });
    }

    const weekData = await getWeekPlayers(state.currentWeek);
    const player = weekData.players.find(p => String(p.id) === String(playerId));
    if (!player) {
      return res.status(404).json({ error: 'Player not found in active week player pool.' });
    }

    const newPick = {
      memberId: member.id,
      memberName: member.name,
      player: {
        id: player.id,
        name: player.name,
        shortName: player.shortName,
        team: player.teamAbbr,
        teamName: player.teamName,
        teamLogo: player.teamLogo,
        position: player.position,
        jersey: player.jersey,
        headshot: player.headshot,
        matchup: player.matchup,
        opponent: player.opponent,
        odds: player.odds,
        oddsValue: player.oddsValue,
        decimalOdds: player.decimalOdds,
        draftkingsOutcomeId: player.draftkingsOutcomeId || null,
        draftkingsBetUrl: player.draftkingsBetUrl || null
      },
      hasScored: false,
      status: 'pending',
      scoringPlay: null,
      pickedAt: new Date().toISOString()
    };

    state.currentWeekPicks.push(newPick);
    await updateAppState(state);

    res.json({
      success: true,
      message: `${member.name} successfully picked ${player.name} (${player.odds})!`,
      pick: newPick,
      parlay: calculateParlay(state.currentWeekPicks, 10)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/picks/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    const state = await getAppState();
    const index = state.currentWeekPicks.findIndex(p => p.memberId === memberId);
    if (index === -1) {
      return res.status(404).json({ error: 'Pick not found for this member.' });
    }
    const removed = state.currentWeekPicks.splice(index, 1)[0];
    await updateAppState(state);
    res.json({
      success: true,
      message: `Removed pick for ${removed.memberName}`,
      parlay: calculateParlay(state.currentWeekPicks, 10)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/parlay/refresh', async (req, res) => {
  try {
    const state = await getAppState();
    if (state.currentWeekPicks.length === 0) {
      return res.json({
        message: 'No picks have been made yet to refresh.',
        picks: [],
        parlayWon: false
      });
    }

    // Rate-limit refresh: if refreshed within last 60 seconds, return current state without writing to Redis
    const now = Date.now();
    const lastCheckMs = state.lastScoringCheck ? new Date(state.lastScoringCheck).getTime() : 0;
    if (now - lastCheckMs < 60000 && lastCheckMs > 0) {
      const scoredCount = state.currentWeekPicks.filter(p => p.hasScored).length;
      return res.json({
        success: true,
        scoredCount,
        totalPicks: state.currentWeekPicks.length,
        allWon: state.currentWeekPicks.length === 10 && scoredCount === 10,
        picks: state.currentWeekPicks,
        parlay: calculateParlay(state.currentWeekPicks, 10),
        lastScoringCheck: state.lastScoringCheck,
        cached: true
      });
    }

    const updatedPicks = await checkPlayerScoringStatus(state.currentWeekPicks, state.currentWeek);
    state.currentWeekPicks = updatedPicks;
    state.lastScoringCheck = new Date().toISOString();
    await updateAppState(state);

    const scoredCount = updatedPicks.filter(p => p.hasScored).length;
    const allWon = updatedPicks.length === 10 && scoredCount === 10;

    res.json({
      success: true,
      scoredCount,
      totalPicks: updatedPicks.length,
      allWon,
      picks: updatedPicks,
      parlay: calculateParlay(updatedPicks, 10),
      lastScoringCheck: state.lastScoringCheck
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/bettor', async (req, res) => {
  try {
    const { bettorId, reason } = req.body;
    const member = LEAGUE_MEMBERS.find(m => m.id === bettorId);
    if (!member) {
      return res.status(400).json({ error: 'Invalid member selected for bettor.' });
    }

    const state = await getAppState();
    state.currentBettor = member.id;
    state.bettorReason = reason || 'Lowest fantasy points scored in previous week';
    await updateAppState(state);

    res.json({
      success: true,
      message: `Updated bettor to ${member.name}`,
      bettor: member,
      bettorReason: state.bettorReason
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/week - Manually override or update current NFL week
app.post('/api/admin/week', async (req, res) => {
  try {
    const { week } = req.body;
    const state = await getAppState();

    if (week === 'auto') {
      state.manualWeekOverride = null;
      const expectedWeek = getCurrentCalculatedWeek();
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
      }
    } else {
      const targetWeek = parseInt(week, 10);
      if (isNaN(targetWeek) || targetWeek < 1 || targetWeek > 18) {
        return res.status(400).json({ error: 'Week must be between 1 and 18, or auto.' });
      }

      if (state.currentWeek !== targetWeek) {
        if (state.currentWeekPicks && state.currentWeekPicks.length > 0) {
          state.history = state.history || {};
          state.history[state.currentWeek] = state.currentWeekPicks.map(p => ({
            memberId: p.memberId,
            memberName: p.memberName,
            player: p.player,
            result: (p.hasScored || p.status === 'scored') ? 'scored' : 'missed'
          }));
        }
        state.currentWeek = statusWeek => state.currentWeekPicks = [];
        state.currentWeekPicks = [];
      }

      state.manualWeekOverride = targetWeek;
      state.currentWeek = targetWeek;
    }

    state.lastScoringCheck = null;
    await updateAppState(state);

    res.json({
      success: true,
      message: `Updated to Week ${state.currentWeek}!`,
      currentWeek: state.currentWeek,
      manualWeekOverride: state.manualWeekOverride
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/simulate-td', async (req, res) => {
  try {
    const { memberId, hasScored, status, scoringPlay } = req.body;
    const state = await getAppState();
    const pick = state.currentWeekPicks.find(p => p.memberId === memberId);
    if (!pick) {
      return res.status(404).json({ error: 'Pick not found' });
    }

    if (status === 'missed') {
      pick.hasScored = false;
      pick.status = 'missed';
      pick.scoringPlay = null;
    } else if (status === 'scored' || hasScored === true) {
      pick.hasScored = true;
      pick.status = 'scored';
      pick.scoringPlay = scoringPlay || `${pick.player.name} 6 Yd touchdown run`;
    } else {
      pick.hasScored = false;
      pick.status = 'pending';
      pick.scoringPlay = null;
    }

    state.lastScoringCheck = new Date().toISOString();
    await updateAppState(state);

    res.json({
      success: true,
      pick
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const state = await getAppState();
    const members = await getEnrichedMembers();
    const statsByMember = {};

    for (const m of members) {
      statsByMember[m.id] = {
        member: m,
        totalPicks: 0,
        tdsScored: 0,
        tdsMissed: 0,
        pending: 0,
        winRate: 0,
        history: []
      };
    }

    for (const [weekNum, weekPicks] of Object.entries(state.history || {})) {
      for (const item of weekPicks) {
        if (statsByMember[item.memberId]) {
          statsByMember[item.memberId].totalPicks += 1;
          if (item.result === 'scored') {
            statsByMember[item.memberId].tdsScored += 1;
          } else if (item.result === 'missed') {
            statsByMember[item.memberId].tdsMissed += 1;
          }
          statsByMember[item.memberId].history.push({
            week: Number(weekNum),
            player: item.player,
            result: item.result
          });
        }
      }
    }

    for (const pick of state.currentWeekPicks) {
      if (statsByMember[pick.memberId]) {
        statsByMember[pick.memberId].totalPicks += 1;
        if (pick.hasScored || pick.status === 'scored') {
          statsByMember[pick.memberId].tdsScored += 1;
        } else if (pick.status === 'missed') {
          statsByMember[pick.memberId].tdsMissed += 1;
        } else {
          statsByMember[pick.memberId].pending += 1;
        }
        statsByMember[pick.memberId].history.push({
          week: state.currentWeek,
          player: pick.player,
          result: pick.hasScored || pick.status === 'scored' ? 'scored' : (pick.status === 'missed' ? 'missed' : 'pending')
        });
      }
    }

    const memberStatsList = Object.values(statsByMember).map(stat => {
      const decidedGames = stat.tdsScored + stat.tdsMissed;
      stat.winRate = decidedGames > 0 ? Math.round((stat.tdsScored / decidedGames) * 100) : 0;
      stat.history.sort((a, b) => b.week - a.week);
      return stat;
    });

    // Sort primarily by best hit % (winRate), then by total TDs scored, then fewest missed
    memberStatsList.sort((a, b) => {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.tdsScored !== a.tdsScored) return b.tdsScored - a.tdsScored;
      return a.tdsMissed - b.tdsMissed;
    });

    res.json({
      leaderboard: memberStatsList,
      history: state.history,
      currentWeek: state.currentWeek
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
