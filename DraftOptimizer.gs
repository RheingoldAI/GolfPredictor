// ═══════════════════════════════════════════════════════════════════════════════
// PGA FANTASY GOLF DRAFT OPTIMIZER — Monte Carlo Simulation Engine
// ═══════════════════════════════════════════════════════════════════════════════
//
// SETUP:
//   1. Create a new Google Sheet (or open your existing one)
//   2. Go to Extensions > Apps Script
//   3. Delete any existing code, paste this entire script
//   4. Replace YOUR_ODDS_API_KEY below with your key from https://the-odds-api.com
//   5. Save (Ctrl+S), close the Apps Script tab
//   6. Refresh the Google Sheet — a "Golf Draft Optimizer" menu will appear
//   7. In the "MyDraft" sheet, set your draft position and tournament
//   8. Click Golf Draft Optimizer > Full Run (Populate + Simulate)
//
// TOURNAMENT NAMES (use exactly):
//   "The Players", "Masters", "PGA Championship", "US Open", "Open Championship"
//
// RE-RUNNING FOR A NEW TOURNAMENT:
//   Just change the Tournament cell in MyDraft and re-run. Course-fit weights
//   auto-adjust per tournament via the COURSE_PROFILES config.
//
// ═══════════════════════════════════════════════════════════════════════════════


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  CONFIGURATION — Edit these values                                      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

var CONFIG = {
  // API Keys
  ODDS_API_KEY: 'YOUR_ODDS_API_KEY',  // Free tier: 500 requests/mo at the-odds-api.com

  // League Settings
  NUM_TEAMS: 10,
  ROUNDS: 8,
  TOTAL_DRAFTED: 80,
  CUT_NEEDED: 4,           // Min cut-makers to qualify for 70% pool
  DEFAULT_POSITION: 4,     // Your default draft position

  // Prize Pool Weights
  TOP4_WEIGHT: 0.70,       // 70% for lowest top-4 cumulative score
  WINNER_WEIGHT: 0.30,     // 30% for outright tournament winner

  // Simulation Settings
  NUM_DRAFT_SIMS: 300,     // Draft simulations (opponent randomness)
  NUM_TOURNEY_SIMS: 80,    // Tournament sims per draft (score randomness)
  EMOTIONAL_BOOST: 8,      // How many spots emotional drafters overdraft big names

  // Course (auto-set per tournament)
  PAR_TOTAL: 288            // 72 × 4 rounds (default, adjust per tournament)
};


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  COURSE PROFILES — SG weight profiles per tournament venue              ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

var COURSE_PROFILES = {
  'The Players': {
    par: 288,
    // TPC Sawgrass: SG:Approach is king, putting least predictive
    sgApproach: 0.35,    // 8/9 winners +4.0 SGA, most important stat
    sgAroundGreen: 0.25, // 7/8 winners +1.5 or more, small greens
    sgTeeToGreen: 0.20,  // 16 winners since 2004 top-10
    sgOffTee: 0.10,      // Accuracy > distance, water on 17/18 holes
    sgPutting: 0.05,     // Least predictive at Sawgrass per DataGolf
    courseHistory: 0.05   // Less predictive here than almost anywhere
  },
  'Masters': {
    par: 288,
    sgApproach: 0.25,
    sgAroundGreen: 0.20,
    sgTeeToGreen: 0.20,
    sgOffTee: 0.15,      // Length matters at Augusta
    sgPutting: 0.10,     // Undulating greens reward good putters
    courseHistory: 0.10   // Augusta rewards experience significantly
  },
  'PGA Championship': {
    par: 288,
    sgApproach: 0.30,
    sgAroundGreen: 0.15,
    sgTeeToGreen: 0.20,
    sgOffTee: 0.15,
    sgPutting: 0.10,
    courseHistory: 0.10
  },
  'US Open': {
    par: 288,
    sgApproach: 0.30,
    sgAroundGreen: 0.20,
    sgTeeToGreen: 0.25,  // Ball-striking paramount at US Open setups
    sgOffTee: 0.10,      // Accuracy off tee in rough is crucial
    sgPutting: 0.10,
    courseHistory: 0.05
  },
  'Open Championship': {
    par: 288,
    sgApproach: 0.25,
    sgAroundGreen: 0.25, // Links scrambling is critical
    sgTeeToGreen: 0.20,
    sgOffTee: 0.15,      // Wind management
    sgPutting: 0.10,
    courseHistory: 0.05
  }
};


// Odds API sport keys per tournament
var ODDS_SPORT_KEYS = {
  'The Players': 'golf_pga_championship_winner',  // Adjust if Odds API has specific key
  'Masters': 'golf_masters_tournament_winner',
  'PGA Championship': 'golf_pga_championship_winner',
  'US Open': 'golf_us_open_winner',
  'Open Championship': 'golf_the_open_championship_winner'
};


// "Big name" players that emotional drafters overdraft
// PGA-eligible big names that emotional drafters overdraft relative to current form/odds
var BIG_NAMES = [
  'Jordan Spieth', 'Rickie Fowler', 'Justin Thomas', 'Jason Day',
  'Adam Scott', 'Will Zalatoris', 'Max Homa', 'Viktor Hovland'
];


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  MENU & SHEET SETUP                                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Golf Draft Optimizer')
    .addItem('Populate Players (Data Only)', 'menuPopulatePlayers')
    .addItem('Run Draft Simulation', 'menuRunSimulation')
    .addSeparator()
    .addItem('Full Run (Populate + Simulate)', 'menuFullRun')
    .addSeparator()
    .addItem('How To Interpret Results', 'menuWriteHelp')
    .addToUi();
}

function ensureSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss.getSheetByName('Players')) {
    var ps = ss.insertSheet('Players');
    ps.getRange('A1:I1').setValues([[
      'PlayerName', 'ADP', 'MakeCutProb', 'ExpScore', 'ScoreSD',
      'WinProb', 'CourseFit', 'SGTotal', 'RecentForm'
    ]]);
    ps.getRange('A1:I1').setFontWeight('bold');
    ps.setFrozenRows(1);
  }

  if (!ss.getSheetByName('DraftSim')) {
    var ds = ss.insertSheet('DraftSim');
    ds.getRange('A1').setValue('Draft Simulation Results');
    ds.getRange('A1').setFontWeight('bold').setFontSize(14);
  }

  if (!ss.getSheetByName('MyDraft')) {
    var md = ss.insertSheet('MyDraft');
    md.getRange('A1:B2').setValues([
      ['Draft Position', CONFIG.DEFAULT_POSITION],
      ['Tournament', 'The Players']
    ]);
    md.getRange('A1:A2').setFontWeight('bold');
    md.setColumnWidth(1, 150);
    md.setColumnWidth(2, 200);
  }
}

function readMyDraft() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var md = ss.getSheetByName('MyDraft');
  if (!md) return { position: CONFIG.DEFAULT_POSITION, tournament: 'The Players' };

  var pos = md.getRange('B1').getValue();
  var tourney = md.getRange('B2').getValue();

  pos = parseInt(pos) || CONFIG.DEFAULT_POSITION;
  if (pos < 1 || pos > CONFIG.NUM_TEAMS) pos = CONFIG.DEFAULT_POSITION;

  if (!COURSE_PROFILES[tourney]) tourney = 'The Players';

  return { position: pos, tournament: tourney };
}


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  MENU HANDLERS                                                          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function menuPopulatePlayers() {
  ensureSheets();
  var settings = readMyDraft();
  populatePlayers(settings.tournament);
  SpreadsheetApp.getActiveSpreadsheet().toast('Players sheet populated!', 'Done', 5);
}

function menuRunSimulation() {
  ensureSheets();
  var settings = readMyDraft();
  var players = readPlayersSheet();
  if (players.length < 80) {
    SpreadsheetApp.getUi().alert('Players sheet has fewer than 80 players. Run "Populate Players" first.');
    return;
  }
  runDraftOptimizer(settings.position, settings.tournament, players);
}

function menuFullRun() {
  ensureSheets();
  var settings = readMyDraft();
  SpreadsheetApp.getActiveSpreadsheet().toast('Populating player data...', 'Step 1/3', 10);
  populatePlayers(settings.tournament);
  var players = readPlayersSheet();
  SpreadsheetApp.getActiveSpreadsheet().toast('Running Monte Carlo simulations...', 'Step 2/3', 120);
  runDraftOptimizer(settings.position, settings.tournament, players);
  SpreadsheetApp.getActiveSpreadsheet().toast('Writing help guide...', 'Step 3/3', 5);
  writeHelpSheet();
}

function menuWriteHelp() {
  writeHelpSheet();
  SpreadsheetApp.getActiveSpreadsheet().toast('Help sheet created!', 'Done', 5);
}


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  DATA POPULATION                                                        ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function populatePlayers(tournament) {
  var players = getSeedData(tournament);

  // Try The Odds API to update WinProb with live odds
  try {
    var oddsData = fetchOddsAPI(tournament);
    if (oddsData && Object.keys(oddsData).length > 0) {
      players.forEach(function(p) {
        if (oddsData[p.name]) {
          p.winProb = oddsData[p.name];
        }
      });
      SpreadsheetApp.getActiveSpreadsheet().toast(
        'Updated ' + Object.keys(oddsData).length + ' players with live odds', 'Odds API', 3
      );
    }
  } catch (e) {
    Logger.log('Odds API failed (using seed data): ' + e.message);
  }

  // Recalculate ADP based on current WinProb (mirrors how opponents think)
  players.sort(function(a, b) { return b.winProb - a.winProb; });
  players.forEach(function(p, i) { p.adp = i + 1; });

  // Recalculate CourseFit based on tournament profile
  var profile = COURSE_PROFILES[tournament] || COURSE_PROFILES['The Players'];
  players.forEach(function(p) {
    if (p.sgBreakdown) {
      var raw = p.sgBreakdown.approach * profile.sgApproach
              + p.sgBreakdown.aroundGreen * profile.sgAroundGreen
              + p.sgBreakdown.teeToGreen * profile.sgTeeToGreen
              + p.sgBreakdown.offTee * profile.sgOffTee
              + p.sgBreakdown.putting * profile.sgPutting
              + p.sgBreakdown.courseHist * profile.courseHistory;
      // Raw is already 1-10 scale (sgBreakdown values are 1-10, weights sum to 1.0)
      p.courseFit = Math.max(1, Math.min(10, Math.round(raw)));
    }
  });

  // Write to Players sheet
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Players');
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, 9).clearContent();

  var rows = players.map(function(p) {
    return [
      p.name, p.adp, round4(p.makeCutProb), round2(p.expScore),
      round2(p.scoreSD), round6(p.winProb), p.courseFit,
      round2(p.sgTotal), round2(p.recentForm)
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 9).setValues(rows);
  }

  return players;
}


function fetchOddsAPI(tournament) {
  if (CONFIG.ODDS_API_KEY === 'YOUR_ODDS_API_KEY') return null;

  var sportKey = ODDS_SPORT_KEYS[tournament];
  if (!sportKey) return null;

  var url = 'https://api.the-odds-api.com/v4/sports/' + sportKey + '/odds'
          + '?apiKey=' + CONFIG.ODDS_API_KEY
          + '&regions=us&markets=outrights&oddsFormat=american';

  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      Logger.log('Odds API returned ' + response.getResponseCode());
      return null;
    }

    var data = JSON.parse(response.getContentText());
    var oddsMap = {};

    if (data && data.length > 0 && data[0].bookmakers) {
      // Use first available bookmaker
      var bookmaker = data[0].bookmakers[0];
      if (bookmaker && bookmaker.markets && bookmaker.markets[0]) {
        var outcomes = bookmaker.markets[0].outcomes;
        var totalImpliedProb = 0;

        // First pass: calculate total implied probability (for vig adjustment)
        outcomes.forEach(function(o) {
          totalImpliedProb += americanToProb(o.price);
        });

        var vigMultiplier = totalImpliedProb > 0 ? 1.0 / totalImpliedProb : 1.0;

        // Second pass: calculate vig-adjusted probabilities
        outcomes.forEach(function(o) {
          var rawProb = americanToProb(o.price);
          oddsMap[o.name] = rawProb * vigMultiplier;
        });
      }
    }

    return oddsMap;
  } catch (e) {
    Logger.log('Odds API fetch error: ' + e.message);
    return null;
  }
}


function americanToProb(american) {
  if (american > 0) {
    return 100 / (american + 100);
  } else {
    return Math.abs(american) / (Math.abs(american) + 100);
  }
}


function readPlayersSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Players');
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var players = [];

  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    players.push({
      name: String(data[i][0]),
      adp: Number(data[i][1]) || i,
      makeCutProb: Number(data[i][2]) || 0.5,
      expScore: Number(data[i][3]) || 286,
      scoreSD: Number(data[i][4]) || 7,
      winProb: Number(data[i][5]) || 0.001,
      courseFit: Number(data[i][6]) || 5,
      sgTotal: Number(data[i][7]) || 0,
      recentForm: Number(data[i][8]) || 50
    });
  }

  return players;
}


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  VALUE METRIC — Our edge over odds-only drafters                        ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function computeStaticValue(player) {
  var scoreBenefit = CONFIG.PAR_TOTAL - player.expScore;  // Strokes under par expected
  var cutSafety = player.makeCutProb * player.makeCutProb; // Squared to penalize risk
  var winUpside = player.winProb * 200;
  var fitBonus = player.courseFit * 3;

  return cutSafety * scoreBenefit + winUpside + fitBonus;
}


function dynamicPickValue(player, myTeam, roundsRemaining) {
  var safePicks = 0;
  for (var i = 0; i < myTeam.length; i++) {
    if (myTeam[i].makeCutProb >= 0.70) safePicks++;
  }

  var needMore = CONFIG.CUT_NEEDED + 1 - safePicks; // Want 5 safe for buffer
  var scoreBenefit = CONFIG.PAR_TOTAL - player.expScore;
  var cutSafety = player.makeCutProb * player.makeCutProb;
  var winUpside = player.winProb * 200;
  var fitBonus = player.courseFit * 3;

  var baseValue;

  // Late rounds: if still need safe picks, prioritize safety heavily
  if (needMore > 0 && roundsRemaining <= needMore + 1) {
    baseValue = cutSafety * scoreBenefit * 2.5 + winUpside * 0.3 + player.makeCutProb * 30;
  }
  // Early/mid rounds: balanced approach with course-fit edge
  else if (roundsRemaining >= 5) {
    baseValue = cutSafety * scoreBenefit + winUpside * 1.5 + fitBonus;
  }
  // Mid-late: slight safety lean
  else {
    baseValue = cutSafety * scoreBenefit * 1.3 + winUpside + fitBonus + player.makeCutProb * 10;
  }

  // Add small noise (5% of value) so close-value players can swap between sims.
  // Models our own decision uncertainty — when two players are close, either is fine.
  return baseValue + normalRandom(0, Math.abs(baseValue) * 0.05);
}


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  MONTE CARLO DRAFT SIMULATION                                           ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function runDraftOptimizer(myPosition, tournament, players) {
  var profile = COURSE_PROFILES[tournament] || COURSE_PROFILES['The Players'];
  CONFIG.PAR_TOTAL = profile.par || 288;

  // Pre-compute static values for all players
  players.forEach(function(p) {
    p.staticValue = computeStaticValue(p);
  });

  // Identify "big name" indices for emotional drafters
  var bigNameSet = {};
  BIG_NAMES.forEach(function(n) { bigNameSet[n] = true; });

  var allResults = [];
  var playerDraftFreq = {};  // Track how often each player is drafted by us
  var roundPicks = {};       // Track picks per round: { round: { playerName: count } }
  for (var r = 0; r < CONFIG.ROUNDS; r++) roundPicks[r] = {};

  // === MAIN SIMULATION LOOP ===
  for (var sim = 0; sim < CONFIG.NUM_DRAFT_SIMS; sim++) {
    if (sim % 50 === 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        'Draft sim ' + (sim + 1) + ' / ' + CONFIG.NUM_DRAFT_SIMS,
        'Simulating...', 3
      );
    }

    // Randomize which 2 opponents are emotional EACH sim (not fixed across all sims)
    var emotionalTeams = {};
    var emotionalSlots = shuffle([0,1,2,3,4,5,6,7,8,9].filter(function(t) {
      return t !== myPosition - 1;
    }));
    emotionalTeams[emotionalSlots[0]] = true;
    emotionalTeams[emotionalSlots[1]] = true;

    // Run one draft simulation
    var teams = simulateSnakeDraft(myPosition, players, bigNameSet, emotionalTeams);
    var myTeam = teams[myPosition - 1];

    // Run tournament simulations for this draft
    var top4Wins = 0;
    var outrightWins = 0;
    var totalTop4Score = 0;
    var qualifiedCount = 0;

    for (var t = 0; t < CONFIG.NUM_TOURNEY_SIMS; t++) {
      var result = simulateTournament(teams, players);

      if (result.top4Winner === myPosition - 1) top4Wins++;
      if (result.outrightWinnerTeam === myPosition - 1) outrightWins++;
      if (result.teamScores[myPosition - 1].qualified) {
        totalTop4Score += result.teamScores[myPosition - 1].top4Score;
        qualifiedCount++;
      }
    }

    var pctTop4 = top4Wins / CONFIG.NUM_TOURNEY_SIMS;
    var pctOutright = outrightWins / CONFIG.NUM_TOURNEY_SIMS;
    var overallWin = pctTop4 * CONFIG.TOP4_WEIGHT + pctOutright * CONFIG.WINNER_WEIGHT;

    var teamNames = myTeam.map(function(p) { return p.name; });

    allResults.push({
      players: teamNames,
      pctWinTop4: pctTop4,
      pctWinOutright: pctOutright,
      overallWin: overallWin,
      expTop4Score: qualifiedCount > 0 ? totalTop4Score / qualifiedCount : 999,
      qualifyRate: qualifiedCount / CONFIG.NUM_TOURNEY_SIMS
    });

    // Track frequencies
    teamNames.forEach(function(name, idx) {
      if (!playerDraftFreq[name]) playerDraftFreq[name] = 0;
      playerDraftFreq[name]++;
      if (!roundPicks[idx][name]) roundPicks[idx][name] = 0;
      roundPicks[idx][name]++;
    });
  }

  // Sort by overall win probability
  allResults.sort(function(a, b) { return b.overallWin - a.overallWin; });

  // Deduplicate: keep the best result for each unique team composition
  var seen = {};
  var uniqueResults = [];
  allResults.forEach(function(r) {
    var key = r.players.slice().sort().join('|');
    if (!seen[key]) {
      seen[key] = true;
      uniqueResults.push(r);
    }
  });

  var top10 = uniqueResults.slice(0, 10);

  // Write results to DraftSim sheet
  outputResults(top10, allResults, players, playerDraftFreq, roundPicks, myPosition, tournament);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Done! Check the DraftSim sheet for results.', 'Simulation Complete', 10
  );
}


function simulateSnakeDraft(myPosition, players, bigNameSet, emotionalTeams) {
  var numTeams = CONFIG.NUM_TEAMS;
  var numRounds = CONFIG.ROUNDS;
  var totalPicks = numTeams * numRounds;

  var teams = [];
  for (var i = 0; i < numTeams; i++) teams.push([]);

  var taken = {};  // playerIndex -> true

  // Build per-opponent ADP rankings — each opponent gets their OWN independent
  // noisy view of the draft board. This is the key variance driver: 9 different
  // rankings means 9 different pick orders, creating realistic draft chaos.
  var opponentAdp = {};
  for (var oi = 0; oi < numTeams; oi++) {
    if (oi === myPosition - 1) continue; // skip our team
    opponentAdp[oi] = [];
    for (var pi = 0; pi < players.length; pi++) {
      if (emotionalTeams[oi] && bigNameSet[players[pi].name]) {
        // Emotional drafter: big names get boosted (lower ADP = picked sooner)
        opponentAdp[oi].push(players[pi].adp - CONFIG.EMOTIONAL_BOOST + normalRandom(0, 2));
      } else {
        opponentAdp[oi].push(players[pi].adp + adpNoise(players[pi].adp));
      }
    }
  }

  for (var pick = 1; pick <= totalPicks; pick++) {
    var round = Math.floor((pick - 1) / numTeams);
    var posInRound = (pick - 1) % numTeams;
    var team = round % 2 === 0 ? posInRound : numTeams - 1 - posInRound;

    var bestIdx = -1;

    if (team === myPosition - 1) {
      // MY PICK: use dynamic value function
      var bestValue = -Infinity;
      var roundsLeft = numRounds - teams[team].length;
      for (var j = 0; j < players.length; j++) {
        if (taken[j]) continue;
        var v = dynamicPickValue(players[j], teams[team], roundsLeft);
        if (v > bestValue) {
          bestValue = v;
          bestIdx = j;
        }
      }
    } else {
      // OPPONENT PICK: use their personalized ADP ranking
      // (emotional vs rational behavior is already baked into opponentAdp[team])
      var bestAdpO = Infinity;
      for (var k = 0; k < players.length; k++) {
        if (taken[k]) continue;
        if (opponentAdp[team][k] < bestAdpO) {
          bestAdpO = opponentAdp[team][k];
          bestIdx = k;
        }
      }
    }

    if (bestIdx >= 0) {
      taken[bestIdx] = true;
      teams[team].push({
        name: players[bestIdx].name,
        playerIdx: bestIdx,
        makeCutProb: players[bestIdx].makeCutProb,
        expScore: players[bestIdx].expScore,
        scoreSD: players[bestIdx].scoreSD,
        winProb: players[bestIdx].winProb,
        courseFit: players[bestIdx].courseFit
      });
    }
  }

  return teams;
}


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  TOURNAMENT OUTCOME SIMULATION                                          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function simulateTournament(teams, allPlayers) {
  // Simulate every player in the field (not just drafted 80)
  var scores = [];
  for (var i = 0; i < allPlayers.length; i++) {
    var madeCut = Math.random() < allPlayers[i].makeCutProb;
    var score = madeCut ? normalRandom(allPlayers[i].expScore, allPlayers[i].scoreSD) : Infinity;
    scores.push({ playerIdx: i, score: score, madeCut: madeCut });
  }

  // Find outright tournament winner (lowest score in entire field)
  var winnerIdx = -1;
  var winnerScore = Infinity;
  for (var w = 0; w < scores.length; w++) {
    if (scores[w].score < winnerScore) {
      winnerScore = scores[w].score;
      winnerIdx = scores[w].playerIdx;
    }
  }

  // Calculate top-4 score for each team
  var teamScores = [];
  for (var ti = 0; ti < teams.length; ti++) {
    var cutMakers = [];
    for (var pi = 0; pi < teams[ti].length; pi++) {
      var idx = teams[ti][pi].playerIdx;
      if (scores[idx].madeCut) {
        cutMakers.push(scores[idx].score);
      }
    }
    cutMakers.sort(function(a, b) { return a - b; });

    if (cutMakers.length >= CONFIG.CUT_NEEDED) {
      var top4Sum = 0;
      for (var s = 0; s < 4; s++) top4Sum += cutMakers[s];
      teamScores.push({ top4Score: top4Sum, qualified: true, cutMakers: cutMakers.length });
    } else {
      teamScores.push({ top4Score: Infinity, qualified: false, cutMakers: cutMakers.length });
    }
  }

  // Determine top-4 winner (lowest sum)
  var top4Winner = -1;
  var bestTop4 = Infinity;
  for (var x = 0; x < teamScores.length; x++) {
    if (teamScores[x].top4Score < bestTop4) {
      bestTop4 = teamScores[x].top4Score;
      top4Winner = x;
    }
  }

  // Determine which team drafted the outright winner
  var outrightWinnerTeam = -1;
  for (var ot = 0; ot < teams.length; ot++) {
    for (var op = 0; op < teams[ot].length; op++) {
      if (teams[ot][op].playerIdx === winnerIdx) {
        outrightWinnerTeam = ot;
        break;
      }
    }
    if (outrightWinnerTeam >= 0) break;
  }

  return {
    top4Winner: top4Winner,
    outrightWinnerTeam: outrightWinnerTeam,
    teamScores: teamScores,
    bestTop4Score: bestTop4
  };
}


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  RESULTS OUTPUT                                                         ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function outputResults(top10, allResults, players, draftFreq, roundPicks, position, tournament) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('DraftSim');
  sheet.clear();

  var row = 1;

  // === HEADER ===
  sheet.getRange(row, 1).setValue('DRAFT OPTIMIZER RESULTS').setFontWeight('bold').setFontSize(14);
  row++;
  sheet.getRange(row, 1).setValue('Tournament: ' + tournament + '  |  Pick: ' + position +
    '  |  Sims: ' + CONFIG.NUM_DRAFT_SIMS + '×' + CONFIG.NUM_TOURNEY_SIMS +
    '  |  ' + new Date().toLocaleDateString());
  row += 2;

  // === TOP 10 RECOMMENDED TEAMS ===
  sheet.getRange(row, 1).setValue('TOP 10 RECOMMENDED DRAFT SETS').setFontWeight('bold').setFontSize(12);
  row++;

  var headers = ['Rank', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8',
                 '%WinTop4', '%WinOutright', '%WinOverall', 'ExpTop4Score', 'QualifyRate', 'Why This Set Wins'];
  sheet.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.getRange(row, 1, 1, headers.length).setBackground('#d9ead3');
  row++;

  for (var i = 0; i < top10.length; i++) {
    var r = top10[i];
    var rowData = [i + 1];
    for (var p = 0; p < 8; p++) {
      rowData.push(r.players[p] || '');
    }
    rowData.push(pct(r.pctWinTop4));
    rowData.push(pct(r.pctWinOutright));
    rowData.push(pct(r.overallWin));
    rowData.push(round2(r.expTop4Score));
    rowData.push(pct(r.qualifyRate));
    rowData.push(generateSetExplanation(r, players));
    sheet.getRange(row, 1, 1, rowData.length).setValues([rowData]);
    sheet.getRange(row, 15, 1, 1).setWrap(true);  // Wrap the explanation column
    if (i === 0) sheet.getRange(row, 1, 1, rowData.length).setBackground('#b6d7a8');
    row++;
  }

  row += 2;

  // === AGGREGATE STATS ===
  var avgWin = 0;
  allResults.forEach(function(r) { avgWin += r.overallWin; });
  avgWin /= allResults.length;
  sheet.getRange(row, 1).setValue('Average Overall Win%: ' + pct(avgWin) +
    '  |  Best: ' + pct(top10[0].overallWin) +
    '  |  Baseline (random): ' + pct(1 / CONFIG.NUM_TEAMS));
  row += 2;

  // === PLAYER VALUE RANKINGS ===
  sheet.getRange(row, 1).setValue('PLAYER VALUE RANKINGS (Top 40)').setFontWeight('bold').setFontSize(12);
  row++;

  var valHeaders = ['Rank', 'Player', 'ADP', 'Value', 'MakeCut%', 'ExpScore',
                    'WinProb', 'CourseFit', 'DraftFreq%', 'VORP'];
  sheet.getRange(row, 1, 1, valHeaders.length).setValues([valHeaders]).setFontWeight('bold');
  sheet.getRange(row, 1, 1, valHeaders.length).setBackground('#cfe2f3');
  row++;

  // Calculate VORP (value over 80th ranked player)
  var sortedByValue = players.slice().map(function(p) {
    return { name: p.name, adp: p.adp, value: computeStaticValue(p), player: p };
  });
  sortedByValue.sort(function(a, b) { return b.value - a.value; });
  var replacementValue = sortedByValue.length >= 80 ? sortedByValue[79].value : 0;

  var top40 = sortedByValue.slice(0, 40);
  for (var vi = 0; vi < top40.length; vi++) {
    var pv = top40[vi];
    var freq = draftFreq[pv.name] || 0;
    var freqPct = freq / CONFIG.NUM_DRAFT_SIMS;
    sheet.getRange(row, 1, 1, 10).setValues([[
      vi + 1,
      pv.name,
      pv.player.adp,
      round2(pv.value),
      pct(pv.player.makeCutProb),
      round2(pv.player.expScore),
      pct6(pv.player.winProb),
      pv.player.courseFit,
      pct(freqPct),
      round2(pv.value - replacementValue)
    ]]);
    // Highlight high-VORP sleepers (value rank much better than ADP)
    if (vi + 1 < pv.player.adp - 10) {
      sheet.getRange(row, 2).setBackground('#fff2cc'); // Yellow = sleeper
    }
    row++;
  }

  row += 2;

  // === ROUND-BY-ROUND TARGETS ===
  sheet.getRange(row, 1).setValue('ROUND-BY-ROUND TARGETS').setFontWeight('bold').setFontSize(12);
  row++;

  var rtHeaders = ['Round', 'Top Target (Freq%)', '2nd Target', '3rd Target', '4th Target'];
  sheet.getRange(row, 1, 1, rtHeaders.length).setValues([rtHeaders]).setFontWeight('bold');
  sheet.getRange(row, 1, 1, rtHeaders.length).setBackground('#d9d2e9');
  row++;

  for (var rd = 0; rd < CONFIG.ROUNDS; rd++) {
    var picks = roundPicks[rd];
    var sorted = Object.keys(picks).map(function(name) {
      return { name: name, count: picks[name], pct: picks[name] / CONFIG.NUM_DRAFT_SIMS };
    });
    sorted.sort(function(a, b) { return b.count - a.count; });

    var rdRow = ['R' + (rd + 1)];
    for (var si = 0; si < 4; si++) {
      if (sorted[si]) {
        rdRow.push(sorted[si].name + ' (' + pct(sorted[si].pct) + ')');
      } else {
        rdRow.push('');
      }
    }
    sheet.getRange(row, 1, 1, rdRow.length).setValues([rdRow]);
    row++;
  }

  row += 2;

  // === STRATEGY NOTES ===
  sheet.getRange(row, 1).setValue('STRATEGY NOTES').setFontWeight('bold').setFontSize(12);
  row++;

  // Identify sleepers: players whose value rank is much better than ADP
  var sleepers = sortedByValue.filter(function(p) {
    var valueRank = sortedByValue.indexOf(p) + 1;
    return p.player.adp - valueRank >= 10 && p.player.adp <= 80;
  }).slice(0, 5);

  if (sleepers.length > 0) {
    sheet.getRange(row, 1).setValue('Sleepers (Value >> ADP):');
    sheet.getRange(row, 1).setFontWeight('bold');
    row++;
    sleepers.forEach(function(s) {
      var vRank = sortedByValue.indexOf(s) + 1;
      sheet.getRange(row, 1).setValue(
        '  ' + s.name + ' — ADP ' + s.player.adp + ', Value Rank ' + vRank +
        ', CourseFit ' + s.player.courseFit + ', MakeCut ' + pct(s.player.makeCutProb)
      );
      row++;
    });
  }

  row++;

  // Players to avoid: high ADP but low value (opponents will overpay)
  var avoids = sortedByValue.filter(function(p) {
    var valueRank = sortedByValue.indexOf(p) + 1;
    return valueRank - p.player.adp >= 10 && p.player.adp <= 50;
  }).slice(0, 5);

  if (avoids.length > 0) {
    sheet.getRange(row, 1).setValue('Avoid / Let Opponents Overpay:');
    sheet.getRange(row, 1).setFontWeight('bold');
    row++;
    avoids.forEach(function(a) {
      var vRank = sortedByValue.indexOf(a) + 1;
      sheet.getRange(row, 1).setValue(
        '  ' + a.name + ' — ADP ' + a.player.adp + ', Value Rank ' + vRank +
        ', CourseFit ' + a.player.courseFit
      );
      row++;
    });
  }

  // Auto-fit columns
  for (var c = 1; c <= 15; c++) {
    sheet.autoResizeColumn(c);
  }
  // Set explanation column to a readable width
  sheet.setColumnWidth(15, 400);
}


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  UTILITY FUNCTIONS                                                      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function normalRandom(mean, sd) {
  var u1 = Math.random();
  var u2 = Math.random();
  // Box-Muller transform
  var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}

// ADP-dependent noise: consensus is tight at the top, loose in later rounds.
// ADP 1-3: virtually zero noise (everyone knows who #1-3 are)
// ADP 4-10: real disagreements (2-4 spot swaps common)
// ADP 11-25: significant variance (5-7 spot swaps happen often)
// ADP 26-50: wide open, players can move 8-10 spots
// ADP 51+: anyone's guess, big variance
function adpNoise(adp) {
  if (adp <= 3)  return normalRandom(0, 0.3);
  if (adp <= 10) return normalRandom(0, 2.0);
  if (adp <= 25) return normalRandom(0, 3.5);
  if (adp <= 50) return normalRandom(0, 5.0);
  return normalRandom(0, 6.0);
}

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }
function round6(n) { return Math.round(n * 1000000) / 1000000; }
function pct(n) { return (n * 100).toFixed(1) + '%'; }
function pct6(n) { return (n * 100).toFixed(3) + '%'; }


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  "HOW TO INTERPRET RESULTS" HELP SHEET                                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function writeHelpSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = 'How To Interpret Results';
  var sheet = ss.getSheetByName(sheetName);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(sheetName);
  }

  var row = 1;

  // Title
  sheet.getRange(row, 1).setValue('HOW TO READ YOUR DRAFT RESULTS')
    .setFontWeight('bold').setFontSize(16);
  row += 2;

  sheet.getRange(row, 1).setValue('This guide explains what everything means in plain English. No stats degree required.')
    .setFontStyle('italic');
  row += 2;

  // Section 1: The Big Picture
  sheet.getRange(row, 1).setValue('THE BIG PICTURE').setFontWeight('bold').setFontSize(13)
    .setBackground('#d9ead3');
  sheet.getRange(row, 1, 1, 5).setBackground('#d9ead3');
  row++;

  var bigPicture = [
    ['What we did:', 'We simulated your draft thousands of times with different scenarios — other teams picking slightly differently each time — and then played out the entire tournament thousands more times to see which groups of 8 players give you the best shot at winning.'],
    ['Why it matters:', 'Instead of guessing who to pick, you can see which combinations of players actually win most often across all those simulations. Think of it like test-driving every possible team before draft day.'],
    ['How to use it:', 'Look at the Top 10 Draft Sets on the DraftSim sheet. These are the 10 best combinations of 8 players for your draft position. The "Round-by-Round Targets" section tells you who to aim for in each round.']
  ];
  for (var i = 0; i < bigPicture.length; i++) {
    sheet.getRange(row, 1).setValue(bigPicture[i][0]).setFontWeight('bold');
    sheet.getRange(row, 2, 1, 4).merge().setValue(bigPicture[i][1]).setWrap(true);
    row++;
  }

  row += 2;

  // Section 2: Top 10 Teams Table
  sheet.getRange(row, 1).setValue('TOP 10 DRAFT SETS — WHAT THE COLUMNS MEAN').setFontWeight('bold').setFontSize(13)
    .setBackground('#cfe2f3');
  sheet.getRange(row, 1, 1, 5).setBackground('#cfe2f3');
  row++;

  var teamCols = [
    ['R1 through R8', 'The player you should draft in each round. R1 is your first pick, R8 is your last. These are listed in the order you would pick them.'],
    ['%WinTop4', 'Your chance of winning the main prize (70% of the pot). This is the biggest pool. To win it, your 4 best players who make the cut need to have the lowest combined score. Higher % = better.'],
    ['%WinOutright', 'Your chance of winning the bonus prize (30% of the pot). You win this if one of YOUR 8 players wins the entire tournament outright. Even 2-5% is solid since there are 10 teams competing.'],
    ['%WinOverall', 'Your combined chance of winning money — it blends %WinTop4 (weighted 70%) and %WinOutright (weighted 30%) into one number. This is the main number to compare draft sets.'],
    ['ExpTop4Score', 'The average combined score of your 4 best players when they all make the cut. Lower is better — think of it as "how low does my team typically shoot?" A score of 1120 means your top 4 averaged 280 each (about -8 per player).'],
    ['QualifyRate', 'How often at least 4 of your 8 players make the cut. If this is below 90%, the team is risky — you might not even qualify for the main prize. Look for 95%+ to be safe.'],
    ['Why This Set Wins', 'A plain-English explanation of what makes this particular combination of players strong. Helps you understand the strategy behind each set.']
  ];
  for (var j = 0; j < teamCols.length; j++) {
    sheet.getRange(row, 1).setValue(teamCols[j][0]).setFontWeight('bold');
    sheet.getRange(row, 2, 1, 4).merge().setValue(teamCols[j][1]).setWrap(true);
    row++;
  }

  row += 2;

  // Section 3: Player Rankings
  sheet.getRange(row, 1).setValue('PLAYER VALUE RANKINGS — WHAT THE COLUMNS MEAN').setFontWeight('bold').setFontSize(13)
    .setBackground('#d9d2e9');
  sheet.getRange(row, 1, 1, 5).setBackground('#d9d2e9');
  row++;

  var playerCols = [
    ['ADP', '"Average Draft Position" — where other teams will likely pick this player. ADP 1 = first player taken, ADP 50 = usually goes in round 5. Other teams mostly draft by Vegas odds, so ADP follows the betting favorites.'],
    ['Value', 'Our custom score that rates each player by combining their scoring ability, chance of making the cut, course fit, and chance of winning outright. Higher = better. This is where WE are smarter than teams who just follow odds.'],
    ['MakeCut%', 'How likely this player is to play all 4 rounds. 90%+ is very safe. Below 70% is risky — if too many of your players miss the cut, you won\'t have 4 scorers and can\'t win the main prize.'],
    ['ExpScore', 'The score this player is expected to shoot over 4 rounds if they make the cut. Lower is better. Par is 288 (72 per round). An ExpScore of 275 means they\'re expected to shoot about -13.'],
    ['WinProb', 'How likely this player is to win the whole tournament (based on odds + our adjustments). Even 5% is strong — there are 123 players in the field.'],
    ['CourseFit', 'How well this player\'s strengths match THIS specific golf course (1-10 scale). At TPC Sawgrass, players who are great with their irons and around the greens score higher. A player rated 9 is built for this course. A 4 means their game doesn\'t match up well here.'],
    ['DraftFreq%', 'How often our simulator drafted this player on your team across all simulations. If a player shows 80%, that means they were on your team in 80% of the winning scenarios — a strong signal they\'re a must-pick.'],
    ['VORP', '"Value Over Replacement Player." How much better this player is compared to the 80th-best player (the last one to get drafted). Higher VORP = more valuable. If two players are available, pick the one with higher VORP.'],
    ['Yellow highlight', 'Players highlighted yellow are SLEEPERS — they\'re undervalued by other teams. Their Value ranking is much better than their ADP. These are the players other teams will overlook, so you can grab them later than expected.']
  ];
  for (var k = 0; k < playerCols.length; k++) {
    sheet.getRange(row, 1).setValue(playerCols[k][0]).setFontWeight('bold');
    sheet.getRange(row, 2, 1, 4).merge().setValue(playerCols[k][1]).setWrap(true);
    row++;
  }

  row += 2;

  // Section 4: Strategy Section
  sheet.getRange(row, 1).setValue('STRATEGY NOTES — QUICK TIPS').setFontWeight('bold').setFontSize(13)
    .setBackground('#fff2cc');
  sheet.getRange(row, 1, 1, 5).setBackground('#fff2cc');
  row++;

  var tips = [
    ['Round-by-Round Targets', 'Shows who you should aim for in each round, with how often that player was the optimal pick. If a player shows 60%+ in a round, they\'re your primary target. Have a backup (2nd/3rd Target) in case they\'re taken.'],
    ['Sleepers', 'Players that other teams will undervalue. They\'re better than their draft position suggests — usually because they fit this particular course well or have high make-cut safety that others overlook.'],
    ['Players to Avoid', 'Players that other teams will overdraft. They\'re popular names but their actual value doesn\'t match where they\'ll be picked. Let other teams waste a pick on them.'],
    ['Key rule:', 'You NEED at least 4 players to make the cut to compete for the main prize (70% of the pot). Don\'t load up on 8 risky longshots. Build a safe core first, then swing for upside.']
  ];
  for (var t = 0; t < tips.length; t++) {
    sheet.getRange(row, 1).setValue(tips[t][0]).setFontWeight('bold');
    sheet.getRange(row, 2, 1, 4).merge().setValue(tips[t][1]).setWrap(true);
    row++;
  }

  row += 2;

  // Section 5: Quick Reference
  sheet.getRange(row, 1).setValue('QUICK REFERENCE').setFontWeight('bold').setFontSize(13)
    .setBackground('#f4cccc');
  sheet.getRange(row, 1, 1, 5).setBackground('#f4cccc');
  row++;

  var qr = [
    ['Want the safest team?', 'Pick the set with the highest QualifyRate and %WinTop4.'],
    ['Want a boom-or-bust team?', 'Pick the set with the highest %WinOutright (but check QualifyRate stays above 90%).'],
    ['Best overall team?', 'Pick the set with the highest %WinOverall — it balances everything.'],
    ['Not sure who to pick?', 'Just follow the Round-by-Round Targets. If your top target is taken, go to the next one.']
  ];
  for (var q = 0; q < qr.length; q++) {
    sheet.getRange(row, 1).setValue(qr[q][0]).setFontWeight('bold');
    sheet.getRange(row, 2, 1, 4).merge().setValue(qr[q][1]).setWrap(true);
    row++;
  }

  // Formatting
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 200);
  sheet.setColumnWidth(5, 200);
}


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  SET EXPLANATION — Layman-language "why this team wins"                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function generateSetExplanation(teamResult, allPlayers) {
  var names = teamResult.players;

  // Look up full player data for each team member
  var playerMap = {};
  allPlayers.forEach(function(p) { playerMap[p.name] = p; });

  var team = names.map(function(n) { return playerMap[n] || null; }).filter(function(p) { return p; });

  // Analyze team characteristics
  var eliteCount = 0;      // Top-15 ADP (big names)
  var highCourseFit = 0;   // CourseFit >= 8
  var safePicks = 0;       // MakeCutProb >= 0.78
  var winContenders = 0;   // WinProb >= 0.015
  var lowScorers = 0;      // ExpScore <= 278
  var totalCourseFit = 0;
  var totalWinProb = 0;
  var bestPlayer = team[0] ? team[0].name : '';
  var bestWinProb = 0;

  team.forEach(function(p) {
    if (p.adp <= 15) eliteCount++;
    if (p.courseFit >= 8) highCourseFit++;
    if (p.makeCutProb >= 0.78) safePicks++;
    if (p.winProb >= 0.015) winContenders++;
    if (p.expScore <= 278) lowScorers++;
    totalCourseFit += p.courseFit;
    totalWinProb += p.winProb;
    if (p.winProb > bestWinProb) {
      bestWinProb = p.winProb;
      bestPlayer = p.name;
    }
  });

  var avgFit = team.length > 0 ? totalCourseFit / team.length : 5;

  // Build explanation parts
  var parts = [];

  // Lead with the anchor player
  if (bestPlayer) {
    parts.push(bestPlayer + ' anchors this team as your top player');
  }

  // Course fit edge
  if (highCourseFit >= 3) {
    parts.push(highCourseFit + ' players are great fits for this course, giving you an edge others miss');
  } else if (avgFit >= 7) {
    parts.push('strong overall course fit across the roster');
  }

  // Safety floor
  if (safePicks >= 6) {
    parts.push(safePicks + ' of 8 players are very likely to make the cut, so you almost always qualify');
  } else if (safePicks >= 5) {
    parts.push('solid cut-making safety with ' + safePicks + ' reliable players');
  }

  // Upside
  if (winContenders >= 3) {
    parts.push(winContenders + ' players with a real shot at winning outright gives you strong bonus-prize upside');
  } else if (winContenders >= 2) {
    parts.push('good outright winner upside from ' + winContenders + ' contenders');
  }

  // Low scoring
  if (lowScorers >= 5) {
    parts.push('deep with low scorers — ' + lowScorers + ' players expected to finish well under par');
  }

  // Qualify rate callout
  if (teamResult.qualifyRate >= 0.97) {
    parts.push('nearly guaranteed to qualify for the main prize');
  }

  // Combine into readable string
  if (parts.length === 0) {
    return 'Balanced team with a mix of safety and upside.';
  }

  // Capitalize first part, join with periods
  var explanation = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  for (var i = 1; i < parts.length; i++) {
    explanation += '. ' + parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
  }
  explanation += '.';

  return explanation;
}


// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  SEED DATA — The Players Championship 2026 (TPC Sawgrass)               ║
// ║  OFFICIAL 123-PLAYER FIELD (verified from theplayers.com 3/9/2026)      ║
// ║                                                                         ║
// ║  [name, makeCutProb, expScore, scoreSD, winProb, sgTotal, recentForm,   ║
// ║   sgBreakdown: {approach, aroundGreen, teeToGreen, offTee,              ║
// ║                 putting, courseHist}  (each 1-10 scale)]                ║
// ║  CourseFit and ADP are computed dynamically from these inputs.          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function getSeedData(tournament) {
  // Official 123-player field for The Players 2026.
  // WinProb = normalized implied probability from FanDuel / DraftKings / CBS odds (3/9/2026).
  // For other tournaments, CourseFit recalculates from COURSE_PROFILES weights.

  var raw = [
    // === TIER 1: Favorites (top 10 by FanDuel/DraftKings odds, 3/9/2026) ===
    // WinProb = normalized implied probability from American odds
    ['Scottie Scheffler',   0.92, 271, 5.5, 0.143, 2.80, 3.0,  {approach:10, aroundGreen:9, teeToGreen:10, offTee:9, putting:6, courseHist:10}],
    ['Rory McIlroy',        0.85, 274, 6.0, 0.049, 2.10, 6.0,  {approach:8, aroundGreen:7, teeToGreen:9, offTee:9, putting:7, courseHist:9}],
    ['Collin Morikawa',     0.88, 273, 5.5, 0.049, 2.20, 3.0,  {approach:10, aroundGreen:7, teeToGreen:9, offTee:7, putting:6, courseHist:7}],
    ['Si Woo Kim',          0.86, 275, 6.0, 0.040, 1.60, 3.0,  {approach:8, aroundGreen:8, teeToGreen:8, offTee:6, putting:7, courseHist:10}],
    ['Ludvig Aberg',        0.85, 274, 6.2, 0.036, 1.90, 3.5,  {approach:9, aroundGreen:7, teeToGreen:9, offTee:8, putting:6, courseHist:6}],
    ['Russell Henley',      0.85, 276, 6.0, 0.032, 1.20, 5.0,  {approach:8, aroundGreen:7, teeToGreen:7, offTee:6, putting:7, courseHist:7}],
    ['Xander Schauffele',   0.87, 274, 5.8, 0.030, 2.00, 4.5,  {approach:9, aroundGreen:8, teeToGreen:9, offTee:8, putting:7, courseHist:7}],
    ['Tommy Fleetwood',     0.83, 275, 5.8, 0.030, 1.80, 4.0,  {approach:9, aroundGreen:8, teeToGreen:8, offTee:7, putting:7, courseHist:8}],
    ['Matt Fitzpatrick',    0.84, 276, 6.2, 0.024, 0.80, 9.0,  {approach:8, aroundGreen:7, teeToGreen:7, offTee:5, putting:6, courseHist:6}],
    ['Cameron Young',       0.75, 277, 7.0, 0.024, 1.40, 6.0,  {approach:7, aroundGreen:6, teeToGreen:8, offTee:8, putting:5, courseHist:5}],

    // === TIER 2: Strong contenders (ADP 11-25 by odds) ===
    ['Hideki Matsuyama',    0.84, 275, 6.0, 0.024, 1.90, 4.0,  {approach:9, aroundGreen:8, teeToGreen:9, offTee:7, putting:5, courseHist:8}],
    ['Min Woo Lee',         0.80, 277, 6.5, 0.023, 1.30, 4.0,  {approach:7, aroundGreen:7, teeToGreen:7, offTee:7, putting:7, courseHist:7}],
    ['Viktor Hovland',      0.82, 277, 6.0, 0.023, 1.40, 8.0,  {approach:8, aroundGreen:4, teeToGreen:8, offTee:8, putting:5, courseHist:6}],
    ['Sepp Straka',         0.79, 279, 6.2, 0.020, 1.00, 6.0,  {approach:7, aroundGreen:7, teeToGreen:7, offTee:7, putting:6, courseHist:5}],
    ['Jake Knapp',          0.76, 278, 7.0, 0.020, 1.20, 5.0,  {approach:7, aroundGreen:6, teeToGreen:7, offTee:9, putting:5, courseHist:6}],
    ['Akshay Bhatia',       0.82, 275, 6.5, 0.020, 1.70, 2.5,  {approach:8, aroundGreen:7, teeToGreen:8, offTee:7, putting:7, courseHist:7}],
    ['Chris Gotterup',      0.82, 277, 6.5, 0.018, 1.60, 5.0,  {approach:8, aroundGreen:7, teeToGreen:8, offTee:8, putting:6, courseHist:4}],
    ['Rickie Fowler',       0.76, 280, 7.5, 0.018, 0.45, 15.0, {approach:6, aroundGreen:6, teeToGreen:6, offTee:6, putting:6, courseHist:6}],
    ['Robert MacIntyre',    0.78, 278, 6.5, 0.018, 1.10, 5.0,  {approach:7, aroundGreen:7, teeToGreen:7, offTee:7, putting:6, courseHist:6}],
    ['Daniel Berger',       0.78, 279, 6.8, 0.016, 1.00, 8.0,  {approach:8, aroundGreen:7, teeToGreen:8, offTee:7, putting:6, courseHist:6}],
    ['Maverick McNealy',    0.76, 280, 6.5, 0.015, 0.60, 8.0,  {approach:6, aroundGreen:7, teeToGreen:6, offTee:6, putting:7, courseHist:5}],
    ['Shane Lowry',         0.80, 278, 6.0, 0.013, 1.10, 8.0,  {approach:7, aroundGreen:8, teeToGreen:7, offTee:6, putting:7, courseHist:6}],
    ['Harris English',      0.74, 280, 6.5, 0.013, 0.55, 9.0,  {approach:6, aroundGreen:7, teeToGreen:6, offTee:6, putting:6, courseHist:5}],
    ['Patrick Cantlay',     0.83, 277, 5.8, 0.013, 1.30, 7.0,  {approach:8, aroundGreen:7, teeToGreen:8, offTee:6, putting:7, courseHist:6}],
    ['Kurt Kitayama',       0.74, 281, 7.0, 0.013, 0.50, 10.0, {approach:6, aroundGreen:6, teeToGreen:6, offTee:7, putting:5, courseHist:5}],

    // === TIER 3: Solid mid-round picks (ADP 26-50 by odds) ===
    ['Ryan Gerard',         0.72, 281, 8.0, 0.013, 0.55, 10.0, {approach:6, aroundGreen:6, teeToGreen:6, offTee:6, putting:6, courseHist:3}],
    ['Jacob Bridgeman',     0.72, 281, 8.0, 0.013, 0.55, 10.0, {approach:6, aroundGreen:6, teeToGreen:6, offTee:6, putting:6, courseHist:3}],
    ['Brooks Koepka',       0.72, 281, 7.5, 0.012, 0.50, 15.0, {approach:7, aroundGreen:5, teeToGreen:7, offTee:7, putting:4, courseHist:5}],
    ['Tony Finau',          0.79, 278, 6.2, 0.012, 1.10, 8.0,  {approach:7, aroundGreen:6, teeToGreen:8, offTee:8, putting:5, courseHist:5}],
    ['Alex Noren',          0.72, 283, 6.5, 0.011, 0.50, 10.0, {approach:7, aroundGreen:7, teeToGreen:6, offTee:5, putting:5, courseHist:5}],
    ['Jordan Spieth',       0.62, 285, 7.5, 0.011, 0.40, 18.0, {approach:5, aroundGreen:7, teeToGreen:5, offTee:4, putting:8, courseHist:7}],
    ['Corey Conners',       0.80, 280, 5.8, 0.011, 0.90, 7.0,  {approach:9, aroundGreen:6, teeToGreen:7, offTee:6, putting:4, courseHist:6}],
    ['Adam Scott',          0.74, 282, 6.5, 0.011, 0.60, 10.0, {approach:7, aroundGreen:6, teeToGreen:7, offTee:7, putting:5, courseHist:7}],
    ['Ben Griffin',         0.72, 282, 7.0, 0.011, 0.45, 8.0,  {approach:6, aroundGreen:6, teeToGreen:6, offTee:6, putting:5, courseHist:3}],
    ['Justin Rose',         0.77, 279, 6.5, 0.010, 0.90, 8.0,  {approach:8, aroundGreen:7, teeToGreen:7, offTee:6, putting:6, courseHist:7}],
    ['Sam Burns',           0.79, 278, 6.5, 0.010, 1.10, 7.0,  {approach:7, aroundGreen:7, teeToGreen:7, offTee:7, putting:7, courseHist:6}],
    ['Nicolai Hojgaard',    0.72, 282, 7.0, 0.010, 0.40, 9.0,  {approach:6, aroundGreen:6, teeToGreen:6, offTee:6, putting:5, courseHist:3}],
    ['Sahith Theegala',     0.82, 276, 6.2, 0.010, 1.50, 3.5,  {approach:8, aroundGreen:7, teeToGreen:8, offTee:7, putting:6, courseHist:7}],
    ['J.J. Spaun',          0.70, 283, 7.2, 0.010, 0.35, 12.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:6, putting:5, courseHist:4}],
    ['Justin Thomas',       0.78, 278, 6.5, 0.010, 1.20, 10.0, {approach:8, aroundGreen:7, teeToGreen:8, offTee:7, putting:7, courseHist:7}],
    ['Aaron Rai',           0.75, 282, 6.0, 0.010, 0.65, 7.0,  {approach:7, aroundGreen:6, teeToGreen:7, offTee:5, putting:6, courseHist:4}],
    ['Tom Hoge',            0.80, 279, 6.0, 0.010, 0.90, 6.0,  {approach:8, aroundGreen:7, teeToGreen:7, offTee:6, putting:6, courseHist:6}],
    ['Keegan Bradley',      0.76, 281, 6.5, 0.008, 0.80, 8.0,  {approach:7, aroundGreen:6, teeToGreen:7, offTee:7, putting:6, courseHist:6}],
    ['Taylor Pendrith',     0.68, 284, 7.0, 0.008, 0.50, 10.0, {approach:6, aroundGreen:5, teeToGreen:6, offTee:8, putting:4, courseHist:3}],
    ['Pierceson Coody',     0.62, 284, 7.5, 0.008, 0.35, 10.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:6, putting:5, courseHist:2}],
    ['Nico Echavarria',     0.68, 284, 7.0, 0.008, 0.45, 10.0, {approach:6, aroundGreen:5, teeToGreen:6, offTee:6, putting:5, courseHist:3}],
    ['Michael Thorbjornsen',0.65, 284, 7.5, 0.008, 0.38, 8.0,  {approach:5, aroundGreen:5, teeToGreen:5, offTee:6, putting:5, courseHist:2}],
    ['Christiaan Bezuidenhout', 0.76, 282, 6.0, 0.008, 0.65, 7.0, {approach:7, aroundGreen:7, teeToGreen:7, offTee:5, putting:6, courseHist:4}],
    ['Jason Day',           0.72, 283, 6.8, 0.008, 0.55, 12.0, {approach:6, aroundGreen:7, teeToGreen:6, offTee:6, putting:7, courseHist:7}],
    ['Davis Thompson',      0.70, 283, 6.8, 0.008, 0.55, 8.0,  {approach:6, aroundGreen:6, teeToGreen:6, offTee:7, putting:5, courseHist:3}],
    ['Ricky Castillo',      0.58, 285, 8.0, 0.008, 0.28, 10.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Harry Hall',          0.65, 285, 7.0, 0.008, 0.42, 8.0,  {approach:6, aroundGreen:6, teeToGreen:6, offTee:6, putting:5, courseHist:3}],
    ['Rasmus Hojgaard',     0.65, 284, 7.2, 0.008, 0.38, 10.0, {approach:6, aroundGreen:5, teeToGreen:6, offTee:6, putting:5, courseHist:3}],
    ['Keith Mitchell',      0.68, 284, 7.0, 0.008, 0.50, 10.0, {approach:6, aroundGreen:5, teeToGreen:6, offTee:8, putting:5, courseHist:4}],
    ['Max Greyserman',      0.70, 283, 6.8, 0.008, 0.55, 7.0,  {approach:6, aroundGreen:6, teeToGreen:6, offTee:7, putting:5, courseHist:3}],
    ['Wyndham Clark',       0.78, 278, 6.5, 0.008, 1.20, 7.0,  {approach:7, aroundGreen:6, teeToGreen:8, offTee:8, putting:6, courseHist:5}],
    ['Thorbjorn Olesen',    0.63, 286, 7.2, 0.008, 0.38, 10.0, {approach:6, aroundGreen:6, teeToGreen:6, offTee:5, putting:5, courseHist:4}],

    // === TIER 4: Late-round targets (ADP 51-80 by odds) ===
    ['Cam Davis',           0.70, 284, 6.8, 0.006, 0.50, 10.0, {approach:6, aroundGreen:6, teeToGreen:6, offTee:7, putting:5, courseHist:4}],
    ['Max Homa',            0.68, 284, 7.0, 0.006, 0.50, 12.0, {approach:7, aroundGreen:6, teeToGreen:6, offTee:6, putting:5, courseHist:5}],
    ['Sungjae Im',          0.82, 278, 5.8, 0.006, 1.10, 6.0,  {approach:7, aroundGreen:7, teeToGreen:7, offTee:6, putting:7, courseHist:7}],
    ['Ryan Fox',            0.63, 286, 7.5, 0.006, 0.40, 12.0, {approach:6, aroundGreen:5, teeToGreen:6, offTee:7, putting:4, courseHist:3}],
    ['Brian Harman',        0.78, 281, 5.8, 0.005, 0.75, 8.0,  {approach:7, aroundGreen:8, teeToGreen:7, offTee:5, putting:7, courseHist:6}],
    ['Denny McCarthy',      0.78, 281, 6.0, 0.005, 0.70, 7.0,  {approach:6, aroundGreen:7, teeToGreen:6, offTee:5, putting:9, courseHist:5}],
    ['Mackenzie Hughes',    0.70, 284, 6.8, 0.005, 0.45, 9.0,  {approach:7, aroundGreen:6, teeToGreen:6, offTee:5, putting:6, courseHist:5}],
    ['Rico Hoey',           0.58, 286, 7.8, 0.005, 0.28, 10.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Bud Cauley',          0.58, 287, 7.5, 0.005, 0.28, 12.0, {approach:6, aroundGreen:5, teeToGreen:5, offTee:5, putting:5, courseHist:3}],
    ['Mac Meissner',        0.62, 286, 7.5, 0.005, 0.35, 10.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:6, putting:5, courseHist:2}],
    ['Eric Cole',           0.75, 281, 6.5, 0.005, 0.75, 7.0,  {approach:7, aroundGreen:6, teeToGreen:7, offTee:7, putting:5, courseHist:4}],
    ['Chris Kirk',          0.76, 281, 6.5, 0.005, 0.70, 8.0,  {approach:7, aroundGreen:7, teeToGreen:7, offTee:6, putting:6, courseHist:5}],
    ['Lucas Glover',        0.72, 283, 6.5, 0.005, 0.45, 12.0, {approach:7, aroundGreen:6, teeToGreen:6, offTee:5, putting:6, courseHist:6}],
    ['Patrick Rodgers',     0.62, 286, 7.2, 0.005, 0.35, 10.0, {approach:6, aroundGreen:5, teeToGreen:5, offTee:6, putting:5, courseHist:3}],
    ['Ryo Hisatsune',       0.63, 286, 7.2, 0.005, 0.38, 10.0, {approach:6, aroundGreen:5, teeToGreen:6, offTee:6, putting:5, courseHist:2}],
    ['J.T. Poston',         0.76, 281, 6.0, 0.005, 0.65, 8.0,  {approach:7, aroundGreen:6, teeToGreen:6, offTee:6, putting:7, courseHist:5}],
    ['Nick Taylor',         0.68, 284, 7.0, 0.004, 0.45, 10.0, {approach:6, aroundGreen:6, teeToGreen:6, offTee:5, putting:6, courseHist:4}],
    ['Alex Smalley',        0.68, 284, 7.0, 0.004, 0.45, 8.0,  {approach:6, aroundGreen:6, teeToGreen:6, offTee:5, putting:6, courseHist:3}],
    ['Stephan Jaeger',      0.70, 284, 6.8, 0.004, 0.45, 8.0,  {approach:6, aroundGreen:6, teeToGreen:6, offTee:6, putting:6, courseHist:3}],
    ['Garrick Higgo',       0.60, 287, 7.5, 0.004, 0.32, 10.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:6, putting:5, courseHist:2}],
    ['Matthieu Pavon',      0.72, 283, 6.5, 0.003, 0.55, 7.0,  {approach:7, aroundGreen:6, teeToGreen:7, offTee:6, putting:5, courseHist:3}],
    ['Seamus Power',        0.72, 283, 6.5, 0.003, 0.55, 8.0,  {approach:7, aroundGreen:6, teeToGreen:6, offTee:6, putting:6, courseHist:4}],
    ['Emiliano Grillo',     0.70, 284, 6.8, 0.003, 0.45, 8.0,  {approach:7, aroundGreen:6, teeToGreen:6, offTee:5, putting:5, courseHist:4}],
    ['Davis Riley',         0.74, 282, 6.5, 0.003, 0.70, 7.0,  {approach:7, aroundGreen:6, teeToGreen:7, offTee:7, putting:5, courseHist:4}],
    ['Kevin Yu',            0.62, 286, 7.2, 0.003, 0.35, 9.0,  {approach:6, aroundGreen:5, teeToGreen:6, offTee:6, putting:5, courseHist:2}],
    ['Vince Whaley',        0.55, 288, 8.0, 0.003, 0.25, 10.0, {approach:5, aroundGreen:4, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Michael Brennan',     0.58, 287, 7.5, 0.003, 0.28, 8.0,  {approach:5, aroundGreen:5, teeToGreen:5, offTee:6, putting:5, courseHist:2}],
    ['Matt McCarty',        0.64, 285, 7.2, 0.003, 0.42, 8.0,  {approach:6, aroundGreen:5, teeToGreen:6, offTee:6, putting:5, courseHist:2}],
    ['Taylor Moore',        0.73, 282, 6.8, 0.003, 0.65, 8.0,  {approach:6, aroundGreen:6, teeToGreen:6, offTee:7, putting:6, courseHist:4}],

    // === TIER 5: Deep field (ADP 81-123, mostly undrafted) ===
    ['Andrew Novak',        0.66, 285, 7.0, 0.002, 0.40, 10.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:6, putting:5, courseHist:3}],
    ['Steven Fisk',         0.58, 287, 7.5, 0.002, 0.25, 8.0,  {approach:5, aroundGreen:5, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Sami Valimaki',       0.58, 287, 7.5, 0.002, 0.30, 10.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:6, putting:5, courseHist:2}],
    ['S.H. Kim',            0.62, 286, 7.2, 0.002, 0.35, 10.0, {approach:6, aroundGreen:5, teeToGreen:5, offTee:5, putting:6, courseHist:3}],
    ['Chad Ramey',          0.58, 287, 7.5, 0.002, 0.28, 10.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:6, putting:5, courseHist:3}],
    ['Haotong Li',          0.58, 287, 7.5, 0.002, 0.30, 12.0, {approach:6, aroundGreen:5, teeToGreen:5, offTee:6, putting:5, courseHist:3}],
    ['Aldrich Potgieter',   0.55, 288, 7.8, 0.002, 0.28, 8.0,  {approach:5, aroundGreen:5, teeToGreen:5, offTee:7, putting:4, courseHist:2}],
    ['Sam Stevens',         0.58, 287, 7.5, 0.002, 0.28, 10.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Max McGreevy',        0.52, 289, 8.0, 0.002, 0.22, 10.0, {approach:5, aroundGreen:4, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Adam Schenk',         0.63, 286, 7.0, 0.002, 0.35, 10.0, {approach:6, aroundGreen:5, teeToGreen:5, offTee:5, putting:5, courseHist:3}],
    ['Takumi Kanaya',       0.62, 286, 7.2, 0.002, 0.35, 10.0, {approach:6, aroundGreen:5, teeToGreen:6, offTee:5, putting:5, courseHist:2}],
    ['Matti Schmid',        0.56, 288, 7.5, 0.002, 0.25, 10.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Jordan Smith',        0.58, 287, 7.5, 0.002, 0.28, 10.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Lee Hodges',          0.68, 284, 7.0, 0.002, 0.45, 9.0,  {approach:6, aroundGreen:6, teeToGreen:6, offTee:6, putting:5, courseHist:3}],
    ['Austin Smotherman',   0.55, 288, 7.8, 0.002, 0.25, 10.0, {approach:5, aroundGreen:4, teeToGreen:5, offTee:6, putting:5, courseHist:2}],
    ['Gary Woodland',       0.58, 287, 7.5, 0.002, 0.30, 15.0, {approach:6, aroundGreen:5, teeToGreen:6, offTee:7, putting:5, courseHist:5}],
    ['Jhonattan Vegas',     0.60, 287, 7.5, 0.001, 0.30, 12.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:6, putting:5, courseHist:3}],
    ['Mark Hubbard',        0.65, 285, 7.2, 0.001, 0.35, 10.0, {approach:5, aroundGreen:5, teeToGreen:5, offTee:6, putting:6, courseHist:3}],
    ['Joel Dahmen',         0.58, 287, 7.2, 0.001, 0.25, 12.0, {approach:5, aroundGreen:6, teeToGreen:5, offTee:4, putting:6, courseHist:4}],
    ['Erik van Rooyen',     0.65, 285, 7.2, 0.001, 0.40, 10.0, {approach:6, aroundGreen:6, teeToGreen:6, offTee:6, putting:5, courseHist:3}],
    ['Michael Kim',         0.52, 289, 8.0, 0.001, 0.22, 12.0, {approach:4, aroundGreen:4, teeToGreen:4, offTee:5, putting:5, courseHist:3}],
    ['Kristoffer Reitan',   0.52, 289, 8.0, 0.001, 0.22, 10.0, {approach:5, aroundGreen:4, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Patton Kizzire',      0.64, 285, 7.0, 0.001, 0.40, 10.0, {approach:6, aroundGreen:6, teeToGreen:5, offTee:5, putting:6, courseHist:4}],
    ['Andrew Putnam',       0.65, 285, 7.0, 0.001, 0.40, 10.0, {approach:6, aroundGreen:5, teeToGreen:6, offTee:5, putting:6, courseHist:3}],
    ['Chandler Phillips',   0.54, 289, 8.0, 0.001, 0.22, 12.0, {approach:4, aroundGreen:4, teeToGreen:4, offTee:5, putting:5, courseHist:2}],
    ['Karl Vilips',         0.52, 289, 8.0, 0.001, 0.22, 8.0,  {approach:5, aroundGreen:4, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Sudarshan Yellamaraju', 0.48, 291, 8.5, 0.001, 0.20, 8.0, {approach:4, aroundGreen:4, teeToGreen:4, offTee:4, putting:4, courseHist:2}],
    ['Joe Highsmith',       0.55, 288, 7.8, 0.001, 0.25, 10.0, {approach:5, aroundGreen:4, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Zecheng Dou',         0.52, 289, 8.0, 0.001, 0.22, 12.0, {approach:5, aroundGreen:4, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Marco Penge',         0.52, 289, 8.0, 0.001, 0.22, 10.0, {approach:5, aroundGreen:4, teeToGreen:5, offTee:5, putting:5, courseHist:2}],
    ['Brian Campbell',      0.50, 290, 8.0, 0.001, 0.20, 10.0, {approach:4, aroundGreen:4, teeToGreen:4, offTee:5, putting:5, courseHist:2}],
    ['A.J. Ewart',          0.50, 290, 8.0, 0.001, 0.20, 10.0, {approach:4, aroundGreen:4, teeToGreen:4, offTee:5, putting:5, courseHist:2}],
    ['William Mouw',        0.50, 290, 8.0, 0.001, 0.20, 8.0,  {approach:4, aroundGreen:4, teeToGreen:4, offTee:5, putting:5, courseHist:2}],
    ['Kevin Roy',           0.50, 290, 8.0, 0.001, 0.20, 10.0, {approach:4, aroundGreen:4, teeToGreen:4, offTee:5, putting:5, courseHist:2}],
    ['Danny Walker',        0.50, 290, 8.0, 0.001, 0.20, 10.0, {approach:4, aroundGreen:4, teeToGreen:4, offTee:5, putting:5, courseHist:2}],
    ['Zach Bauchou',        0.48, 290, 8.0, 0.001, 0.20, 10.0, {approach:4, aroundGreen:4, teeToGreen:4, offTee:5, putting:5, courseHist:2}],
    ['Johnny Keefer',       0.50, 290, 8.0, 0.001, 0.20, 10.0, {approach:4, aroundGreen:4, teeToGreen:4, offTee:5, putting:5, courseHist:2}]
  ];

  var players = raw.map(function(r) {
    return {
      name: r[0],
      makeCutProb: r[1],
      expScore: r[2],
      scoreSD: r[3],
      winProb: r[4],
      sgTotal: r[5],
      recentForm: r[6],
      sgBreakdown: r[7],
      adp: 0,
      courseFit: 5
    };
  });

  if (players.length !== 123) {
    Logger.log('WARNING: Seed data has ' + players.length + ' players (expected 123)');
  }

  return players;
}
