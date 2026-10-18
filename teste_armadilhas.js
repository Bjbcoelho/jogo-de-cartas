// teste_armadilhas.js — ativação automática de armadilhas.  Rode com:  node teste_armadilhas.js
import { readFileSync } from 'node:fs';
import { teste, afirmar, igual, resumo } from './mini_teste.js';
import { criarEstado, criarCartaEmJogo, criarSlotMonstro } from './game_state.js';
import { comecarPartida } from './turn_system.js';
import { invocarNormal, posicionarCarta } from './turn_system.js';
import { declararAtaque, descreverAtaque } from './rules_engine.js';
import { indexarBanco, montarDeckAleatorio } from './deck_builder.js';

const banco = JSON.parse(readFileSync(new URL('./cards_db.json', import.meta.url), 'utf-8'));
const porId = indexarBanco(banco);

// Cenário: turno 5, J0 (atacante) com um monstro em ataque; J1 (dono das armadilhas) com a armadilha baixada no turno 2.
function cenario(idArmadilha, { turnoBaixada = 2, monstroJ1 = true } = {}) {
  const d = montarDeckAleatorio(porId);
  const e = criarEstado(d.deckPrincipal, d.deckExtra, d.deckPrincipal, d.deckExtra, porId);
  comecarPartida(e);
  e.turno = 5; e.jogadorDaVez = 0; e.fase = 'main'; e.vencedor = null;
  for (const j of e.jogadores) { j.zona_monstros.fill(null); j.zona_magias_armadilhas.fill(null); j.mao.length = 0; j.pontos_vida = 8000; j.flags.invocouNormalNoTurno = false; }
  e.jogadores[0].zona_monstros[0] = criarSlotMonstro(criarCartaEmJogo(porId.monstro_guerreiro_veterano, 0), 'ataque');
  e.jogadores[0].zona_monstros[0].invocadoNesteTurno = false;
  if (monstroJ1) e.jogadores[1].zona_monstros[0] = criarSlotMonstro(criarCartaEmJogo(porId.monstro_arqueira_da_vila, 1), 'ataque');
  e.jogadores[1].zona_magias_armadilhas[0] = { carta: criarCartaEmJogo(porId[idArmadilha], 1), viradaParaBaixo: true, turnoBaixada };
  return e;
}

teste('Fosso de Areia destrói o atacante e anula o ataque', () => {
  const e = cenario('armadilha_fosso_de_areia');
  e.fase = 'battle';
  const log = declararAtaque(e, 0, 0, 0);
  igual(log.ok, true);
  igual(log.tipoResultado, 'ataque_anulado');
  igual(e.jogadores[0].zona_monstros[0], null, 'o atacante devia ter sido destruído');
  igual(e.jogadores[1].zona_magias_armadilhas[0], null, 'a armadilha devia ter saído da zona');
  igual(e.jogadores[1].cemiterio.some((c) => c.id === 'armadilha_fosso_de_areia'), true);
  afirmar(descreverAtaque(log).includes('Fosso de Areia'), 'o texto devia citar a armadilha');
  igual(e.jogadores[1].pontos_vida, 8000, 'sem dano ao defensor');
});

teste('armadilha baixada neste mesmo turno ainda não ativa', () => {
  const e = cenario('armadilha_fosso_de_areia', { turnoBaixada: 5 });
  e.fase = 'battle';
  const log = declararAtaque(e, 0, 0, 0);
  afirmar(log.tipoResultado !== 'ataque_anulado');
  igual(e.jogadores[1].zona_magias_armadilhas[0] !== null, true, 'a armadilha devia continuar armada');
});

teste('Chuva de Espinhos causa 600 de dano quando o oponente invoca', () => {
  const e = cenario('armadilha_chuva_de_espinhos');
  const j0 = e.jogadores[0];
  j0.mao.push(criarCartaEmJogo(porId.monstro_arqueira_da_vila, 0));
  const r = invocarNormal(e, 0, 'ataque', []);
  igual(r.ok, true);
  igual(r.armadilhas.length, 1);
  igual(j0.pontos_vida, 7400);
  igual(e.jogadores[1].zona_magias_armadilhas[0], null);
});

teste('Maré Curativa cura 800 quando o dono sofre dano de batalha', () => {
  const e = cenario('armadilha_mare_curativa', { monstroJ1: false });
  e.fase = 'battle';
  const log = declararAtaque(e, 0, 0, null); // ataque direto
  igual(log.ok, true);
  const atk = log.danoCausado;
  igual(e.jogadores[1].pontos_vida, 8000 - atk + 800);
  igual(e.jogadores[1].zona_magias_armadilhas[0], null);
});

teste('armadilha de ataque não ativa com a condição errada (invocação)', () => {
  const e = cenario('armadilha_fosso_de_areia');
  e.jogadores[0].mao.push(criarCartaEmJogo(porId.monstro_arqueira_da_vila, 0));
  const r = invocarNormal(e, 0, 'ataque', []);
  igual(r.armadilhas.length, 0);
  igual(e.jogadores[1].zona_magias_armadilhas[0] !== null, true);
});

teste('armadilha baixada pelo jogo recebe o turno em que foi baixada', () => {
  const e = cenario('armadilha_fosso_de_areia');
  e.jogadores[1].zona_magias_armadilhas[1] = null;
  e.jogadorDaVez = 1;
  e.jogadores[1].mao.push(criarCartaEmJogo(porId.armadilha_mare_curativa, 1));
  const r = posicionarCarta(e, 0);
  igual(r.ok, true);
  igual(e.jogadores[1].zona_magias_armadilhas[r.indiceSlot].turnoBaixada, 5);
});
resumo();
