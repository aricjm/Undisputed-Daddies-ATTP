# Undisputed Daddies 10-Leg Anytime TD Parlay (ATTP)

A responsive mobile-first web app built for the 10-team **Undisputed Daddies** fantasy football league to build their weekly 10-leg Anytime Touchdown (ATT) parlay.

---

### League Members
1. **Aric** *(Admin)*
2. **Cisco**
3. **Wood**
4. **Jess**
5. **Bubba**
6. **Nate**
7. **Grady**
8. **Weddick**
9. **Swehla**
10. **Svatos**

---

### Key Features
1. **Public ESPN API Integration**
   - Automatically queries the ESPN scoreboard for current NFL week matchups, teams, game dates, and statuses.
   - Fetches full offensive team rosters (RB, WR, TE, QB) with athlete headshot photos, team logos, and matchup details.
   - Integrates anytime touchdown scoring probabilities and American/Decimal odds.

2. **Parlay Tab (10-Leg Parlay Tracker)**
   - Displays all 10 league members and their current pick status (picked vs. unpicked).
   - Once an NFL player is selected, they are **immediately locked and removed** from the available player pool so no one else can take them.
   - Each league member can only make **1 pick per week**.
   - **Refresh Scores Button**: Interrogates ESPN's live NFL scoring play feed to detect if any of the 10 chosen players scored a touchdown, immediately awarding the winning leg badge (`TD SCORED!`).
   - **$10 Parlay Payout Calculator**: Computes cumulative parlay odds, net profit, and total payout for a $10 wager in real-time.
   - **Designated Bettor Banner**: Shows who places this week's bet (the person who scored the least fantasy points the previous week). Aric (Admin) can update the bettor and score notes at any time.

3. **Player List Tab**
   - Live roster of NFL players for the current week.
   - Instant search by player name, NFL team, or opponent.
   - Quick position filter pills (`ALL`, `RB`, `WR`, `TE`, `QB`).
   - Shows player headshot, team logo, matchup, anytime touchdown odds, and **+ Add Pick** button.

4. **Stats Tab**
   - Keeps track of historical records for all 10 guys week-over-week.
   - Leaderboard displaying hit rate percentage, total picks, TDs hit vs. missed, and a chronological history chip of past player picks.

5. **Cache Architecture (No Database)**
   - Built with high-efficiency in-memory caching (`node-cache`) ensuring sub-second response times without overloading the ESPN public endpoints.

---

### Quick Start
```bash
# Install dependencies
npm install

# Start the server
npm start
```
Then open `http://localhost:3000` in your browser (or on your phone on the local Wi-Fi network).
