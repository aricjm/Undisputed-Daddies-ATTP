const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  LEAGUE_MEMBERS,
  getAppState,
  updateAppState,
  calculateParlay
} = require('./cache');
const {
  getWeekPlayers,
  checkPlayerScoringStatus,
  fetchCurrentScoreboard
} = require('./espnService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/members - list of 10 league guys
app.get('/api/members', (req, res) => {
  res.json({ members: LEAGUE_MEMBERS });
});

// GET /api/parlay - current week parlay status & bettor info
app.get('/api/parlay', async (req, res) => {
  try {
    const state = await getAppState();
    const parlayCalculation = calculateParlay(state.currentWeekPicks, 10);

    // Build status for each of the 10 members
    const memberStatuses = LEAGUE_MEMBERS.map(m => {
      const pick = state.currentWeekPicks.find(p => p.memberId === m.id);
      return {
        ...m,
        hasPicked: !!pick,
        pick: pick || null
      };
    });

    const currentBettorMember = LEAGUE_MEMBERS.find(m => m.id === state.currentBettor) || LEAGUE_MEMBERS[1]; // default Cisco

    res.json({
      week: state.currentWeek,
      seasonYear: state.seasonYear,
      bettor: currentBettorMember,
      bettorReason: state.bettorReason || '',
      members: memberStatuses,
      picksCount: state.currentWeekPicks.length,
      totalMembers: LEAGUE_MEMBERS.length,
      parlay: parlayCalculation,
      lastScoringCheck: state.lastScoringCheck
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/players - available players for current week (excluding already picked)
app.get('/api/players', async (req, res) => {
  try {
    const state = await getAppState();
    const weekData = await getWeekPlayers(state.currentWeek);
    
    // Set of player IDs already picked this week
    const pickedPlayerIds = new Set(state.currentWeekPicks.map(p => String(p.player.id)));

    // Filter out already taken players so no one else can take them!
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

// POST /api/picks - Add a pick for a league member
app.post('/api/picks', async (req, res) => {
  try {
    const { memberId, playerId } = req.body;
    if (!memberId || !playerId) {
      return res.status(400).json({ error: 'memberId and playerId are required.' });
    }

    // Verify member is valid
    const member = LEAGUE_MEMBERS.find(m => m.id === memberId);
    if (!member) {
      return res.status(400).json({ error: 'Invalid league member.' });
    }

    const state = await getAppState();

    // Check if this member has already picked this week (rule: only 1 player for each week)
    const existingPick = state.currentWeekPicks.find(p => p.memberId === memberId);
    if (existingPick) {
      return res.status(400).json({ error: `${member.name} has already selected a player for this week (${existingPick.player.name}).` });
    }

    // Check if the player is already taken by someone else
    const playerTaken = state.currentWeekPicks.find(p => String(p.player.id) === String(playerId));
    if (playerTaken) {
      return res.status(400).json({ error: `This player has already been chosen by ${playerTaken.memberName}.` });
    }

    // Find player in current week's player pool
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
        decimalOdds: player.decimalOdds
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

// DELETE /api/picks/:memberId - Remove a pick (useful for admin or self-correcting)
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

// POST /api/parlay/refresh - Check live ESPN API for any touchdowns scored
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

    // Live evaluate scoring plays from ESPN API
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

// POST /api/admin/bettor - Admin updates who will be making the bet & reason
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

// POST /api/admin/simulate-td - Simulation test route for Admin/Testing: mark a pick as scored or reset
app.post('/api/admin/simulate-td', async (req, res) => {
  try {
    const { memberId, hasScored, scoringPlay } = req.body;
    const state = await getAppState();
    const pick = state.currentWeekPicks.find(p => p.memberId === memberId);
    if (!pick) {
      return res.status(404).json({ error: 'Pick not found' });
    }
    pick.hasScored = hasScored !== false;
    pick.status = pick.hasScored ? 'scored' : 'pending';
    pick.scoringPlay = scoringPlay || `${pick.player.name} 6 Yd touchdown run`;
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

// GET /api/stats - League member records and historical touchdown success
app.get('/api/stats', async (req, res) => {
  try {
    const state = await getAppState();
    const statsByMember = {};

    // Initialize all 10 members
    for (const m of LEAGUE_MEMBERS) {
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

    // Process historical weeks
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

    // Process current week picks
    for (const pick of state.currentWeekPicks) {
      if (statsByMember[pick.memberId]) {
        statsByMember[pick.memberId].totalPicks += 1;
        if (pick.hasScored) {
          statsByMember[pick.memberId].tdsScored += 1;
        } else {
          statsByMember[pick.memberId].pending += 1;
        }
        statsByMember[pick.memberId].history.push({
          week: state.currentWeek,
          player: pick.player,
          result: pick.hasScored ? 'scored' : 'pending'
        });
      }
    }

    // Calculate win rates & rankings
    const memberStatsList = Object.values(statsByMember).map(stat => {
      const decidedGames = stat.tdsScored + stat.tdsMissed;
      stat.winRate = decidedGames > 0 ? Math.round((stat.tdsScored / decidedGames) * 100) : 0;
      // Sort history descending by week
      stat.history.sort((a, b) => b.week - a.week);
      return stat;
    });

    // Sort by win rate / scored
    memberStatsList.sort((a, b) => {
      if (b.tdsScored !== a.tdsScored) return b.tdsScored - a.tdsScored;
      return b.winRate - a.winRate;
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

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Undisputed Daddies ATTP] App running at http://localhost:${PORT}`);
});
