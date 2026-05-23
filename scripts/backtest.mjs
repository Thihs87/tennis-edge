// Backtest: simula o modelo Barnett-Clarke + Monte Carlo em partidas históricas
// Para cada partida testada, usa APENAS dados anteriores à data da partida.
//
// Uso: node scripts/backtest.mjs

import axios from 'axios';
import Papa from 'papaparse';

const TML_BASE = 'https://stats.tennismylife.org/data';
const N_SIMULATIONS = 5000;

// ─── Download + parse ────────────────────────────────────────────────────────

async function loadAllMatches() {
  console.log('Baixando CSVs históricos...');
  const years = ['2024', '2025', '2026'];
  const all = [];
  for (const y of years) {
    try {
      const res = await axios.get(`${TML_BASE}/${y}.csv`, {
        responseType: 'text', timeout: 30_000,
      });
      const parsed = Papa.parse(res.data, { header: true, skipEmptyLines: true });
      all.push(...parsed.data);
      console.log(`  ${y}: ${parsed.data.length} partidas`);
    } catch (e) {
      console.warn(`  ${y}: falhou (${e.message})`);
    }
  }
  return all
    .filter(r => r.winner_name && r.loser_name && r.tourney_date && r.surface)
    .map(r => ({
      winner: r.winner_name,
      loser:  r.loser_name,
      surface: r.surface,
      tourney: r.tourney_name,
      date:   r.tourney_date,
      best_of: parseInt(r.best_of) || 3,
      score:  r.score || '',
      // Service stats
      w_svpt: +r.w_svpt || 0,
      w_1stIn: +r.w_1stIn || 0,
      w_1stWon: +r.w_1stWon || 0,
      w_2ndWon: +r.w_2ndWon || 0,
      w_ace: +r.w_ace || 0,
      w_df: +r.w_df || 0,
      w_SvGms: +r.w_SvGms || 0,
      l_svpt: +r.l_svpt || 0,
      l_1stIn: +r.l_1stIn || 0,
      l_1stWon: +r.l_1stWon || 0,
      l_2ndWon: +r.l_2ndWon || 0,
      l_ace: +r.l_ace || 0,
      l_df: +r.l_df || 0,
      l_SvGms: +r.l_SvGms || 0,
    }));
}

// ─── Cálculo de total de games a partir do score ──────────────────────────────

function totalGames(score) {
  if (!score) return 0;
  return score.split(' ').reduce((sum, set) => {
    const clean = set.replace(/\([^)]*\)/g, '');
    const [a, b] = clean.split('-').map(Number);
    return sum + (a || 0) + (b || 0);
  }, 0);
}

function totalSetsPlayed(score) {
  if (!score) return 0;
  return score.split(' ').filter(s => s.includes('-')).length;
}

// ─── Player stats com filtro temporal (apenas dados ANTES da data) ───────────

function getStatsBefore(playerName, surface, beforeDate, allMatches) {
  // Filtra: partidas do jogador ANTES de beforeDate (qualquer superfície primeiro)
  const playerMatches = allMatches.filter(m =>
    m.date < beforeDate && (m.winner === playerName || m.loser === playerName)
  );

  // Tenta apenas mesma superfície
  let sample = playerMatches.filter(m => m.surface === surface);
  let fallback = false;
  if (sample.length < 10) {
    sample = playerMatches;
    fallback = true;
  }

  if (sample.length === 0) return null;

  // Computa SPW, RPW, taxa de aces, taxa de DFs
  let spt = 0, sptWon = 0, rpt = 0, rptWon = 0;
  let aces = 0, dfs = 0, svGms = 0;

  for (const m of sample) {
    const isWinner = m.winner === playerName;
    const wSvpt = m.w_svpt, lSvpt = m.l_svpt;
    if (!wSvpt || !lSvpt) continue;

    if (isWinner) {
      const own1stWon = m.w_1stWon, own2ndWon = m.w_2ndWon, own1stIn = m.w_1stIn;
      const own2ndPts = wSvpt - own1stIn;
      spt += wSvpt;
      sptWon += own1stWon + own2ndWon;
      // Retorno do jogador: pontos perdidos pelo adversário no saque dele
      const oppSvLost = lSvpt - (m.l_1stWon + m.l_2ndWon);
      rpt += lSvpt;
      rptWon += oppSvLost;
      aces += m.w_ace;
      dfs += m.w_df;
      svGms += m.w_SvGms;
    } else {
      spt += lSvpt;
      sptWon += m.l_1stWon + m.l_2ndWon;
      const oppSvLost = wSvpt - (m.w_1stWon + m.w_2ndWon);
      rpt += wSvpt;
      rptWon += oppSvLost;
      aces += m.l_ace;
      dfs += m.l_df;
      svGms += m.l_SvGms;
    }
  }

  if (spt === 0 || rpt === 0) return null;

  return {
    name: playerName,
    matches: sample.length,
    fallback,
    spw: sptWon / spt,        // % pontos ganhos no saque
    rpw: rptWon / rpt,        // % pontos ganhos no retorno
    acesPerSvGm: svGms > 0 ? aces / svGms : 0,
    dfsPerSvGm: svGms > 0 ? dfs / svGms : 0,
  };
}

// ─── Baselines do tour por superfície ────────────────────────────────────────

function computeTourBaselines(matches, surface) {
  const sub = matches.filter(m => m.surface === surface && m.w_svpt > 0 && m.l_svpt > 0);
  let spt = 0, sptWon = 0;
  for (const m of sub) {
    spt += m.w_svpt + m.l_svpt;
    sptWon += m.w_1stWon + m.w_2ndWon + m.l_1stWon + m.l_2ndWon;
  }
  return { avgSPW: spt > 0 ? sptWon / spt : 0.62 };
}

// ─── Cálculo de p_A e p_B (a "fundação" do modelo) ───────────────────────────

function pointWinProbability(serverStats, returnerStats, baseline) {
  // Modelo aditivo Sackmann/538:
  // p = avgSPW + (SPW_server - avgSPW) - (RPW_returner - (1 - avgSPW))
  const avgSPW = baseline.avgSPW;
  const avgRPW = 1 - avgSPW;
  const serverEdge = serverStats.spw - avgSPW;
  const returnerEdge = returnerStats.rpw - avgRPW;
  let p = avgSPW + serverEdge - returnerEdge;
  // Clamp para evitar valores absurdos
  if (p < 0.40) p = 0.40;
  if (p > 0.85) p = 0.85;
  return p;
}

// ─── Simulação Monte Carlo: ponto → game → set → partida ─────────────────────

function simulateGame(pServer) {
  // Joga pontos até alguém ganhar (4 pontos + 2 de vantagem)
  let svr = 0, ret = 0;
  while (true) {
    if (Math.random() < pServer) svr++; else ret++;
    if (svr >= 4 && svr - ret >= 2) return { won: true, points: svr + ret };
    if (ret >= 4 && ret - svr >= 2) return { won: false, points: svr + ret };
  }
}

function simulateSet(pA, pB, serverStartsA = true) {
  // Retorna [gamesA, gamesB, tieBreak?]
  let gA = 0, gB = 0;
  let aServes = serverStartsA;
  while (true) {
    const p = aServes ? pA : pB;
    const result = simulateGame(p);
    if (aServes) { if (result.won) gA++; else gB++; }
    else         { if (result.won) gB++; else gA++; }
    aServes = !aServes;

    // Tiebreak em 6-6
    if (gA === 6 && gB === 6) {
      // Tiebreak: primeiro a 7 com 2 de vantagem; aproximação simples
      const tbA = Math.random() < (pA / (pA + pB));
      if (tbA) gA = 7; else gB = 7;
      return [gA, gB, true];
    }
    // Vitória normal de set
    if (gA >= 6 && gA - gB >= 2) return [gA, gB, false];
    if (gB >= 6 && gB - gA >= 2) return [gA, gB, false];
  }
}

function simulateMatch(pA, pB, bestOf) {
  const setsToWin = bestOf === 5 ? 3 : 2;
  let setsA = 0, setsB = 0, gamesA = 0, gamesB = 0;
  let serverStartsA = Math.random() < 0.5;
  while (setsA < setsToWin && setsB < setsToWin) {
    const [gA, gB] = simulateSet(pA, pB, serverStartsA);
    gamesA += gA; gamesB += gB;
    if (gA > gB) setsA++; else setsB++;
    serverStartsA = !serverStartsA;
  }
  return {
    winnerA: setsA > setsB,
    gamesA, gamesB,
    totalGames: gamesA + gamesB,
    setsA, setsB,
  };
}

function runSimulations(pA, pB, bestOf, n = N_SIMULATIONS) {
  const results = [];
  for (let i = 0; i < n; i++) results.push(simulateMatch(pA, pB, bestOf));
  return results;
}

// ─── Agregadores de mercado ──────────────────────────────────────────────────

function aggregate(sims) {
  const wins = sims.filter(s => s.winnerA).length;
  const totals = sims.map(s => s.totalGames);
  const avgTotal = totals.reduce((a, b) => a + b, 0) / sims.length;
  return {
    pWinA: wins / sims.length,
    avgTotalGames: avgTotal,
    pOver: (line) => sims.filter(s => s.totalGames > line).length / sims.length,
  };
}

// ─── Backtest principal ──────────────────────────────────────────────────────

async function main() {
  const all = await loadAllMatches();
  console.log(`\nTotal de partidas carregadas: ${all.length}\n`);

  // Critérios: partidas recentes (2025+), com stats completos, jogadores conhecidos
  const candidates = all.filter(m =>
    m.date >= '20250101' &&
    m.w_svpt > 0 && m.l_svpt > 0 &&
    m.w_ace >= 0 && m.l_ace >= 0 &&
    (m.tourney || '').toLowerCase().match(/wimbledon|roland|us open|australian|miami|indian wells|madrid|rome|paris|monte/i)
  );

  console.log(`Candidatos (grandes torneios 2025+ com stats): ${candidates.length}\n`);

  // Pega 4 partidas amostradas
  const picks = [];
  const seen = new Set();
  for (const m of candidates) {
    const key = `${[m.winner, m.loser].sort().join('|')}-${m.tourney}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(m);
    if (picks.length >= 4) break;
  }

  console.log('='.repeat(80));
  console.log('BACKTEST DO MODELO');
  console.log('='.repeat(80));

  let acertos = 0;
  let totalTests = 0;

  for (const match of picks) {
    console.log(`\n📍 ${match.tourney} (${match.date}) — ${match.surface}`);
    console.log(`   ${match.winner} vs ${match.loser}`);
    console.log(`   Resultado REAL: ${match.winner} venceu ${match.score} (BO${match.best_of})`);
    console.log(`   Total games real: ${totalGames(match.score)}`);
    console.log(`   Aces reais: ${match.winner.split(' ').pop()} ${match.w_ace} | ${match.loser.split(' ').pop()} ${match.l_ace}`);

    // Calcula stats usando apenas dados ANTERIORES à partida
    const statsW = getStatsBefore(match.winner, match.surface, match.date, all);
    const statsL = getStatsBefore(match.loser, match.surface, match.date, all);

    if (!statsW || !statsL) {
      console.log(`   ⚠️ Dados insuficientes para um dos jogadores — pulando.`);
      continue;
    }

    const baseline = computeTourBaselines(
      all.filter(m => m.date < match.date),
      match.surface
    );

    console.log(`\n   📊 Dados ANTES da partida:`);
    console.log(`      ${match.winner}: ${statsW.matches} partidas, SPW=${(statsW.spw*100).toFixed(1)}%, RPW=${(statsW.rpw*100).toFixed(1)}%${statsW.fallback ? ' [fallback]' : ''}`);
    console.log(`      ${match.loser}:  ${statsL.matches} partidas, SPW=${(statsL.spw*100).toFixed(1)}%, RPW=${(statsL.rpw*100).toFixed(1)}%${statsL.fallback ? ' [fallback]' : ''}`);
    console.log(`      Tour avg SPW (${match.surface}): ${(baseline.avgSPW*100).toFixed(1)}%`);

    // Aqui "A" será o WINNER apenas para facilitar conferência (não vaza dado, é só rotulagem)
    const pA = pointWinProbability(statsW, statsL, baseline);
    const pB = pointWinProbability(statsL, statsW, baseline);

    console.log(`\n   🧮 Probabilidades de ponto no saque:`);
    console.log(`      p_${match.winner.split(' ').pop()} = ${(pA*100).toFixed(1)}% | p_${match.loser.split(' ').pop()} = ${(pB*100).toFixed(1)}%`);

    const sims = runSimulations(pA, pB, match.best_of, N_SIMULATIONS);
    const agg = aggregate(sims);

    // — Mercado 1: Vencedor
    console.log(`\n   🎯 PREVISÕES (${N_SIMULATIONS} simulações):`);
    console.log(`      [Vencedor] ${match.winner.split(' ').pop()} ganha em ${(agg.pWinA*100).toFixed(1)}% das sims`);
    const acerto1 = agg.pWinA > 0.5;
    console.log(`      → Modelo previu: ${acerto1 ? match.winner : match.loser} | Real: ${match.winner} | ${acerto1 ? '✅ ACERTOU' : '❌ ERROU'}`);
    if (acerto1) acertos++;
    totalTests++;

    // — Mercado 2: Total Games O/U (usa linha 22.5 para BO3, 38.5 para BO5)
    const line = match.best_of === 5 ? 38.5 : 22.5;
    const realTotal = totalGames(match.score);
    const pOver = agg.pOver(line);
    const previuOver = pOver > 0.5;
    const realFoiOver = realTotal > line;
    const acerto2 = previuOver === realFoiOver;
    console.log(`      [Total Games O/U ${line}] Média prevista: ${agg.avgTotalGames.toFixed(1)} games | P(Over) = ${(pOver*100).toFixed(1)}%`);
    console.log(`      → Modelo previu: ${previuOver ? 'Over' : 'Under'} ${line} | Real: ${realTotal} (${realFoiOver ? 'Over' : 'Under'}) | ${acerto2 ? '✅ ACERTOU' : '❌ ERROU'}`);
    if (acerto2) acertos++;
    totalTests++;

    // — Mercado 3: Total Aces partida (linha estimada pela média de aces dos dois)
    const expectedAces = (statsW.acesPerSvGm + statsL.acesPerSvGm) *
      (sims.reduce((s, x) => s + x.totalGames, 0) / sims.length) / 2;
    const realAces = match.w_ace + match.l_ace;
    const acesLine = Math.round(expectedAces);
    const previuOverAces = expectedAces > acesLine - 0.5;
    const realFoiOverAces = realAces > acesLine - 0.5;
    const acerto3 = previuOverAces === realFoiOverAces;
    console.log(`      [Total Aces partida] Esperado: ${expectedAces.toFixed(1)} aces`);
    console.log(`      → Real: ${realAces} aces | ${acerto3 ? '✅ ACERTOU direção' : '❌ ERROU direção'}`);
    if (acerto3) acertos++;
    totalTests++;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`RESUMO: ${acertos} / ${totalTests} previsões corretas (${(acertos/totalTests*100).toFixed(0)}%)`);
  console.log('='.repeat(80));
}

main().catch(console.error);
