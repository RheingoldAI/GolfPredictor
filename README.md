# PGA Fantasy Golf Draft Optimizer

A Monte Carlo simulation engine built in Google Apps Script that optimizes fantasy golf draft picks for PGA Tour events. Designed for snake drafts with 10 teams, 8 rounds, and 80 total players.

## How It Works

The optimizer runs thousands of simulated drafts and tournaments to find the combinations of players that give you the best chance of winning. It considers:

- **Course Fit** — Each tournament venue favors different skill sets (approach play, scrambling, distance, etc.). The optimizer weights player strengths against course demands.
- **Opponent Modeling** — Most opponents draft by Vegas odds. The simulator models this behavior (with some "emotional drafters" who overdraft popular names), then finds value gaps they miss.
- **Cut Safety** — You need at least 4 players to make the cut to qualify for the main prize pool (70%). The optimizer balances upside with reliability.
- **Outright Winner Upside** — 30% of the prize pool goes to the team that drafted the tournament winner. The optimizer factors in each player's win probability.

## Scoring

| Pool | Weight | How to Win |
|------|--------|-----------|
| Top-4 Score | 70% | Lowest combined score from your 4 best cut-makers |
| Outright Winner | 30% | One of your 8 players wins the tournament |

## Setup

1. Create a new Google Sheet (or open an existing one)
2. Go to **Extensions > Apps Script**
3. Delete any existing code, paste the contents of `DraftOptimizer.gs`
4. Replace `YOUR_ODDS_API_KEY` with your key from [The Odds API](https://the-odds-api.com) (free tier: 500 requests/month)
5. Save, close the Apps Script tab
6. Refresh the Google Sheet — a **"Golf Draft Optimizer"** menu will appear
7. In the **MyDraft** sheet, set your draft position and tournament name
8. Click **Golf Draft Optimizer > Full Run**

## Tournament Names

Use these exact names in the MyDraft sheet:

- `The Players`
- `Masters`
- `PGA Championship`
- `US Open`
- `Open Championship`

## Output Sheets

| Sheet | Description |
|-------|------------|
| **Players** | Full field with ADP, value metrics, course fit, and win probabilities |
| **DraftSim** | Top 10 optimal draft sets, player rankings, round-by-round targets, and strategy notes |
| **MyDraft** | Your draft position and tournament selection (input) |
| **How To Interpret Results** | Plain-English guide explaining every metric for non-stats-savvy users |

## Simulation Parameters

- **300 draft simulations** (opponent randomness)
- **80 tournament simulations** per draft (score randomness)
- **24,000 total scenarios** evaluated per run (~90 seconds)

## Course-Fit Profiles

Each tournament has a unique weighting of strokes gained categories:

| Tournament | SG:Approach | SG:Around Green | SG:T2G | SG:OTT | SG:Putting | Course History |
|-----------|------------|----------------|--------|--------|-----------|---------------|
| The Players (TPC Sawgrass) | 35% | 25% | 20% | 10% | 5% | 5% |
| Masters (Augusta) | 25% | 20% | 20% | 15% | 10% | 10% |
| PGA Championship | 30% | 15% | 20% | 15% | 10% | 10% |
| US Open | 30% | 20% | 25% | 10% | 10% | 5% |
| Open Championship | 25% | 25% | 20% | 15% | 10% | 5% |

## Re-Running for a New Tournament

Just change the **Tournament** cell in MyDraft and run again. Course-fit weights auto-adjust per venue. Update the seed data in `getSeedData()` with the confirmed field and latest odds.

## API

The script integrates with [The Odds API](https://the-odds-api.com) for live win probability data. If no API key is provided or the API is unavailable, it falls back to built-in seed data.

## License

MIT
