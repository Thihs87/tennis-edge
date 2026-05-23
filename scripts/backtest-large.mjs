// Backtest expandido: amostra maior + métricas rigorosas (Brier Score)
import axios from 'axios';
import Papa from 'papaparse';

const TML_BASE = 'https://stats.tennismylife.org/data';
const N_SIMULATIONS = 3000;
const N_TEST_MATCHES = 20;

async function loadAllMatches() {
  console.log('Baixando CSVs...');
  const years = ['2024', '2025', '2026'];
  const all = [];
  for (const y of years) {
    try {
      const res = await axios.get(`${TML_BASE}/${y}.csv`, { responseType: 'text', timeout: 30_000 });
      const parsed = Papa.parse(res.data, { header: true, skipEmptyLines: true });
      all.push(...parsed.data);
    } catch {}
  }
  return all.filter(r => r.winner_name && r.loser_name && r.tourney_date && r.surface).map(r => ({
    winner: r.winner_name, loser: r.loser_name,
    surface: r.surface, tourney: r.tourney_name, date: r.tourney_date,
    best_of: parseInt(r.best_of) || 3, score: r.score || '',
    w_svpt: +r.w_svpt || 0, w_1stIn: +r.w_1stIn || 0, w_1stWon: +r.w_1stWon || 0,
    w_2ndWon: +r.w_2ndWon || 0, w_ace: +r.w_ace || 0, w_df: +r.w_df || 0, w_SvGms: +r.w_SvGms || 0,
    l_svpt: +r.l_svpt || 0, l_1stIn: +r.l_1stIn || 0, l_1stWon: +r.l_1stWon || 0,
    l_2ndWon: +r.l_2ndWon || 0, l_ace: +r.l_ace || 0, l_df: +r.l_df || 0, l_SvGms: +r.l_SvGms || 0,
  }));
}

function totalGames(score) {
  if (!score) return 0;
  return score.split(' ').reduce((s, set) => {
    const [a, b] = set.replace(/\([^)]*\)/g, '').split('-').map(Number);
    return s + (a || 0) + (b || 0);
  }, 0);
}

function getStatsBefore(name, surface, beforeDate, all) {
  const playerMatches = all.filter(m => m.date < beforeDate && (m.winner === name || m.loser === name));
  let sample = playerMatches.filter(m => m.surface === surface);
  let fallback = false;
  if (sample.length < 8) { sample = playerMatches; fallback = true; }
  if (sample.length < 5) return null;

  let spt = 0, sptWon = 0, rpt = 0, rptWon = 0, aces = 0, dfs = 0, svGms = 0, valid = 0;
  for (const m of sample) {
    const isW = m.winner === name;
    const wSvpt = m.w_svpt, lSvpt = m.l_svpt;
    if (!wSvpt || !lSvpt) continue;
    valid++;
    if (isW) {
      spt += wSvpt; sptWon += m.w_1stWon + m.w_2ndWon;
      rpt += lSvpt; rptWon += lSvpt - (m.l_1stWon + m.l_2ndWon);
      aces += m.w_ace; dfs += m.w_df; svGms += m.w_SvGms;
    } else {
      spt += lSvpt; sptWon += m.l_1stWon + m.l_2ndWon;
      rpt += wSvpt; rptWon += wSvpt - (m.w_1stWon + m.w_2ndWon);
      aces += m.l_ace; dfs += m.l_df; svGms += m.l_SvGms;
    }
  }
  if (valid < 5 || spt === 0 || rpt === 0) return null;
  return {
    name, matches: sample.length, fallback,
    spw: sptWon / spt, rpw: rptWon / rpt,
    acesPerSvGm: svGms > 0 ? aces / svGms : 0,
  };
}

function tourBaseline(matches, surface) {
  const sub = matches.filter(m => m.surface === surface && m.w_svpt > 0 && m.l_svpt > 0);
  let spt = 0, won = 0;
  for (const m of sub) {
    spt += m.w_svpt + m.l_svpt;
    won += m.w_1stWon + m.w_2ndWon + m.l_1stWon + m.l_2ndWon;
  }
  return spt > 0 ? won / spt : 0.62;
}

function pointProb(server, returner, avgSPW) {
  const p = avgSPW + (server.spw - avgSPW) - (returner.rpw - (1 - avgSPW));
  return Math.max(0.40, Math.min(0.85, p));
}

function simGame(p) {
  let s = 0, r = 0;
  while (true) {
    if (Math.random() < p) s++; else r++;
    if (s >= 4 && s - r >= 2) return true;
    if (r >= 4 && r - s >= 2) return false;
  }
}

function simSet(pA, pB, aServes) {
  let gA = 0, gB = 0;
  while (true) {
    const p = aServes ? pA : pB;
    const won = simGame(p);
    if (aServes) { if (won) gA++; else gB++; } else { if (won) gB++; else gA++; }
    aServes = !aServes;
    if (gA === 6 && gB === 6) {
      if (Math.random() < pA / (pA + pB)) gA = 7; else gB = 7;
      return [gA, gB];
    }
    if (gA >= 6 && gA - gB >= 2) return [gA, gB];
    if (gB >= 6 && gB - gA >= 2) return [gA, gB];
  }
}

function simMatch(pA, pB, bestOf) {
  const need = bestOf === 5 ? 3 : 2;
  let sA = 0, sB = 0, gA = 0, gB = 0, server = Math.random() < 0.5;
  while (sA < need && sB < need) {
    const [a, b] = simSet(pA, pB, server);
    gA += a; gB += b;
    if (a > b) sA++; else sB++;
    server = !server;
  }
  return { winnerA: sA > sB, totalGames: gA + gB };
}

function runSims(pA, pB, bestOf, n = N_SIMULATIONS) {
  let wins = 0, totals = [];
  for (let i = 0; i < n; i++) {
    const r = simMatch(pA, pB, bestOf);
    if (r.winnerA) wins++;
    totals.push(r.totalGames);
  }
  return {
    pWinA: wins / n,
    avgTotal: totals.reduce((a, b) => a + b, 0) / n,
    pOver: (line) => totals.filter(t => t > line).length / n,
  };
}

async function main() {
  const all = await loadAllMatches();
  console.log(`Carregadas ${all.length} partidas\n`);

  // Filtra candidatos: 2025+, com stats, mix de torneios
  const cand = all.filter(m =>
    m.date >= '20250301' && m.date <= '20250930' &&
    m.w_svpt > 30 && m.l_svpt > 30 && m.w_SvGms > 0
  );

  // Amostragem espaçada para diversidade
  const step = Math.floor(cand.length / (N_TEST_MATCHES * 4));
  const picks = [];
  for (let i = 0; i < cand.length && picks.length < N_TEST_MATCHES; i += step) {
    picks.push(cand[i]);
  }

  console.log(`Testando ${picks.length} partidas...\n`);
  console.log('='.repeat(100));
  console.log('Detalhe das previsões:');
  console.log('='.repeat(100));

  let winCorrect = 0, winTotal = 0;
  let gamesCorrect = 0, gamesTotal = 0;
  let acesCorrect = 0, acesTotal = 0;
  let brierWin = 0, brierGames = 0;
  let processed = 0;

  for (const m of picks) {
    const sW = getStatsBefore(m.winner, m.surface, m.date, all);
    const sL = getStatsBefore(m.loser, m.surface, m.date, all);
    if (!sW || !sL) continue;

    const avgSPW = tourBaseline(all.filter(x => x.date < m.date), m.surface);
    const pW = pointProb(sW, sL, avgSPW);
    const pL = pointProb(sL, sW, avgSPW);
    const sims = runSims(pW, pL, m.best_of);

    processed++;
    const realTotal = totalGames(m.score);
    const line = m.best_of === 5 ? 38.5 : 22.5;
    const realOver = realTotal > line;
    const previuVencedor = sims.pWinA > 0.5 ? m.winner : m.loser;
    const previuOver = sims.pOver(line) > 0.5;

    // Aces
    const totalSvGms = sims.avgTotal; // aproximação: cada game = 1 service game (×2 jogadores compartilham)
    const expectedAces = (sW.acesPerSvGm + sL.acesPerSvGm) * totalSvGms / 2;
    const realAces = m.w_ace + m.l_ace;
    const acesLine = Math.max(8, Math.round(expectedAces));
    const previuOverAces = expectedAces > acesLine - 0.5;
    const realOverAces = realAces > acesLine - 0.5;

    const acW = previuVencedor === m.winner;
    const acG = previuOver === realOver;
    const acA = previuOverAces === realOverAces;

    if (acW) winCorrect++;
    if (acG) gamesCorrect++;
    if (acA) acesCorrect++;
    winTotal++; gamesTotal++; acesTotal++;

    // Brier Score (mede calibração)
    brierWin += Math.pow(sims.pWinA - 1, 2); // 1 = winner sempre venceu
    brierGames += Math.pow(sims.pOver(line) - (realOver ? 1 : 0), 2);

    console.log(`\n${processed}. ${m.tourney} (${m.date}) BO${m.best_of} ${m.surface}`);
    console.log(`   ${m.winner.padEnd(28)} vs ${m.loser}`);
    console.log(`   Vencedor : modelo deu ${(sims.pWinA*100).toFixed(0)}% p/ ${m.winner.split(' ').pop()} | real=${m.winner.split(' ').pop()} ${acW?'✅':'❌'}`);
    console.log(`   Games ${line}: previsto ${sims.avgTotal.toFixed(1)} P(Over)=${(sims.pOver(line)*100).toFixed(0)}% | real=${realTotal} ${acG?'✅':'❌'}`);
    console.log(`   Aces (~${acesLine}): previsto ${expectedAces.toFixed(1)} | real=${realAces} ${acA?'✅':'❌'}`);
  }

  console.log('\n' + '='.repeat(100));
  console.log(`RESULTADO FINAL (${processed} partidas válidas)`);
  console.log('='.repeat(100));
  console.log(`\n📊 Acurácia por mercado:`);
  console.log(`   Vencedor          : ${winCorrect}/${winTotal} = ${(winCorrect/winTotal*100).toFixed(1)}%`);
  console.log(`   Total games O/U   : ${gamesCorrect}/${gamesTotal} = ${(gamesCorrect/gamesTotal*100).toFixed(1)}%`);
  console.log(`   Total aces (dir.) : ${acesCorrect}/${acesTotal} = ${(acesCorrect/acesTotal*100).toFixed(1)}%`);
  console.log(`\n📐 Brier Score (menor=melhor, 0=perfeito, 0.25=aleatório):`);
  console.log(`   Vencedor          : ${(brierWin/winTotal).toFixed(3)}`);
  console.log(`   Total games       : ${(brierGames/gamesTotal).toFixed(3)}`);
  console.log(`\n🎯 Benchmarks da literatura acadêmica:`);
  console.log(`   - Modelos top tier (Elo, Sackmann): ~70% acurácia em vencedor`);
  console.log(`   - Casas de apostas: ~72% acurácia em vencedor`);
  console.log(`   - Brier Score < 0.20 = bom; < 0.18 = excelente`);
}

main().catch(console.error);
