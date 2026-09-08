const express = require('express');
const cors = require('cors');
const {
  LEAGUE_MEMBERS,
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
app.use(express.json());

// Seed mock history if empty
function seedHistoryIfEmpty() {
  const state = getAppState();
  if (!state.history || Object.keys(state.history).length === 0) {
    state.history = {
      17: [
        { memberId: 'aric', memberName: 'Aric', player: { name: 'Christian McCaffrey', team: 'SF', odds: '-130' }, result: 'scored' },
        { memberId: 'cisco', memberName: 'Cisco', player: { name: 'Travis Kelce', team: 'KC', odds: '+125' }, result: 'scored' },
        { memberId: 'wood', memberName: 'Wood', player: { name: 'Amon-Ra St. Brown', team: 'DET', odds: '+140' }, result: 'scored' },
        { memberId: 'jess', memberName: 'Jess', player: { name: 'Derrick Henry', team: 'BAL', odds: '-115' }, result: 'scored' },
        { memberId: 'bubba', memberName: 'Bubba', player: { name: 'CeeDee Lamb', team: 'DAL', odds: '+110' }, result: 'scored' },
        { memberId: 'nate', memberName: 'Nate', player: { name: 'Kyren Williams', team: 'LAR', odds: '-110' }, result: 'scored' },
        { memberId: 'grady', memberName: 'Grady', player: { name: 'Ja\'Marr Chase', team: 'CIN', odds: '+135' }, result: 'missed' },
        { memberId: 'weddick', memberName: 'Weddick', player: { name: 'Saquon Barkley', team: 'PHI', odds: '-105' }, result: 'scored' },
        { memberId: 'swehla', memberName: 'Swehla', player: { name: 'Josh Allen', team: 'BUF', odds: '+150' }, result: 'scored' },
        { memberId: 'svatos', memberName: 'Svatos', player: { name: 'Justin Jefferson', team: 'MIN', odds: '+130' }, result: 'scored' }
      ],
      18: [
        { memberId: 'aric', memberName: 'Aric', player: { name: 'Jahmyr Gibbs', team: 'DET', odds: '+115' }, result: 'scored' },
        { memberId: 'cisco', memberName: 'Cisco', player: { name: 'Breece Hall', team: 'NYJ', odds: '+120' }, result: 'missed' },
        { memberId: 'wood', memberName: 'Wood', player: { name: 'Tyreek Hill', team: 'MIA', odds: '+110' }, result: 'scored' },
        { memberId: 'jess', memberName: 'Jess', player: { name: 'A.J. Brown', team: 'PHI', odds: '+145' }, result: 'scored' },
        { memberId: 'bubba', memberName: 'Bubba', player: { name: 'James Cook', team: 'BUF', odds: '+140' }, result: 'scored' },
        { memberId: 'nate', memberName: 'Nate', player: { name: 'Alvin Kamara', team: 'NO', odds: '+135' }, result: 'missed' },
        { memberId: 'grady', memberName: 'Grady', player: { name: 'Davante Adams', team: 'LV', odds: '+165' }, result: 'scored' },
        { memberId: 'weddick', memberName: 'Weddick', player: { name: 'Joe Mixon', team: 'HOU', odds: '+115' }, result: 'scored' },
        { memberId: 'swehla', memberName: 'Swehla', player: { name: 'George Kittle', team: 'SF', odds: '+170' }, result: 'scored' },
        { memberId: 'svatos', memberName: 'Svatos', player: { name: 'Deebo Samuel', team: 'SF', odds: '+155' }, result: 'missed' }
      ]
    };
    updateAppState(state);
  }
}

seedHistoryIfEmpty();

app.get('/api/members', (req, res) => {
  res.json({ members: LEAGUE_MEMBERS });
});

app.get('/api/parlay', async (req, res) => {
  try {
    const state = getAppState();
    const parlayCalculation = calculateParlay(state.currentWeekPicks, 10);

    const memberStatuses = LEAGUE_MEMBERS.map(m => {
      const pick = state.currentWeekPicks.find(p => p.memberId === m.id);
      return {
        ...m,
        hasPicked: !!pick,
        pick: pick || null
      };
    });

    const currentBettorMember = LEAGUE_MEMBERS.find(m => m.id === state.currentBettor) || LEAGUE_MEMBERS[1];

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

app.get('/api/players', async (req, res) => {
  try {
    const state = getAppState();
    const weekData = await getWeekPlayers();
    
    const pickedPlayerIds = new Set(state.currentWeekPicks.map(p => String(p.player.id)));
    const availablePlayers = weekData.players.filter(p => !pickedPlayerIds.has(String(p.id)));

    res.json({
      week: weekData.week,
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

    const state = getAppState();

    const existingPick = state.currentWeekPicks.find(p => p.memberId === memberId);
    if (existingPick) {
      return res.status(400).json({ error: `${member.name} has already selected a player for this week (${existingPick.player.name}).` });
    }

    const playerTaken = state.currentWeekPicks.find(p => String(p.player.id) === String(playerId));
    if (playerTaken) {
      return res.status(400).json({ error: `This player has already been chosen by ${playerTaken.memberName}.` });
    }

    const weekData = await getWeekPlayers();
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
    updateAppState(state);

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

app.delete('/api/picks/:memberId', (req, res) => {
  try {
    const { memberId } = req.params;
    const state = getAppState();
    const index = state.currentWeekPicks.findIndex(p => p.memberId === memberId);
    if (index === -1) {
      return res.status(404).json({ error: 'Pick not found for this member.' });
    }
    const removed = state.currentWeekPicks.splice(index, 1)[0];
    updateAppState(state);
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
    const state = getAppState();
    if (state.currentWeekPicks.length === 0) {
      return res.json({
        message: 'No picks have been made yet to refresh.',
        picks: [],
        parlayWon: false
      });
    }

    const updatedPicks = await checkPlayerScoringStatus(state.currentWeekPicks);
    state.currentWeekPicks = updatedPicks;
    state.lastScoringCheck = new Date().toISOString();
    updateAppState(state);

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

app.post('/api/admin/bettor', (req, res) => {
  try {
    const { bettorId, reason } = req.body;
    const member = LEAGUE_MEMBERS.find(m => m.id === bettorId);
    if (!member) {
      return res.status(400).json({ error: 'Invalid member selected for bettor.' });
    }

    const state = getAppState();
    state.currentBettor = member.id;
    state.bettorReason = reason || 'Lowest fantasy points scored in previous week';
    updateAppState(state);

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

app.post('/api/admin/simulate-td', (req, res) => {
  try {
    const { memberId, hasScored, scoringPlay } = req.body;
    const state = getAppState();
    const pick = state.currentWeekPicks.find(p => p.memberId === memberId);
    if (!pick) {
      return res.status(404).json({ error: 'Pick not found' });
    }
    pick.hasScored = hasScored !== false;
    pick.status = pick.hasScored ? 'scored' : 'pending';
    pick.scoringPlay = scoringPlay || `${pick.player.name} 6 Yd touchdown run`;
    state.lastScoringCheck = new Date().toISOString();
    updateAppState(state);

    res.json({
      success: true,
      pick
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const state = getAppState();
    const statsByMember = {};

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

    const memberStatsList = Object.values(statsByMember).map(stat => {
      const decidedGames = stat.tdsScored + stat.tdsMissed;
      stat.winRate = decidedGames > 0 ? Math.round((stat.tdsScored / decidedGames) * 100) : 0;
      stat.history.sort((a, b) => b.week - a.week);
      return stat;
    });

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

module.exports = app;
