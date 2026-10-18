// teste_turnos.js
// Testes do turn_system.js. Rode com:  node teste_turnos.js

import { readFileSync } from 'node:fs';
import { teste, afirmar, igual, resumo } from './mini_teste.js';
import { criarEstado, criarCartaEmJogo, criarSlotMonstro } from './game_state.js';
import { indexarBanco, montarDeckAleatorio } from './deck_builder.js';
import {
  comecarPartida, avancarFase, invocarNormal, posicionarCarta, mudarPosicao,
  finalizarTurno, resolverStandby,
} from './turn_system.js';

const banco = JSON.parse(readFileSync(new URL('./cards_db.json', import.meta.url), 'utf-8'));
const cartasPorId = indexarBanco(banco);

// Cria uma partida já na Main Phase do turno 1.
function novaPartida() {
  const { deckPrincipal, deckExtra } = montarDeckAleatorio(cartasPorId);
  const e = criarEstado(deckPrincipal, deckExtra, deckPrincipal, deckExtra, cartasPorId);
  comecarPartida(e);
  return e;
}
const carta = (id, dono) => criarCartaEmJogo(cartasPorId[id], dono);

teste('o jogador que começa não compra no turno 1', () => {
  const e = novaPartida();
  const j = e.jogadores[e.jogadorDaVez];
  igual(j.mao.length, 5, 'mão do jogador inicial');
  igual(j.deck_principal.length, 35, 'deck do jogador inicial');
  igual(e.fase, 'main', 'fase');
});

teste('o segundo jogador compra no turno 2 (mão com 6)', () => {
  const e = novaPartida();
  const segundo = 1 - e.jogadorDaVez;
  const r = finalizarTurno(e);
  igual(r.ok, true);
  igual(e.turno, 2, 'turno');
  igual(e.jogadorDaVez, segundo, 'vez');
  igual(e.jogadores[segundo].mao.length, 6, 'mão');
  igual(e.fase, 'main', 'fase');
});

teste('segunda invocação normal no mesmo turno falha', () => {
  const e = novaPartida();
  const v = e.jogadorDaVez;
  e.jogadores[v].mao = [carta('monstro_lula_comum', v), carta('monstro_arqueira_da_vila', v)];
  igual(invocarNormal(e, 0, 'ataque').ok, true, 'primeira invocação');
  const r = invocarNormal(e, 0, 'ataque');
  igual(r.ok, false, 'segunda deveria falhar');
});

teste('monstro nível 6 sem tributo falha; com 1 tributo funciona', () => {
  const e = novaPartida();
  const v = e.jogadorDaVez;
  const j = e.jogadores[v];
  j.mao = [carta('monstro_tubarao_martelo', v)];
  j.zona_monstros[0] = criarSlotMonstro(carta('monstro_arqueira_da_vila', v));
  igual(invocarNormal(e, 0, 'ataque', []).ok, false, 'sem tributo');
  const r = invocarNormal(e, 0, 'ataque', [0]);
  igual(r.ok, true, 'com tributo');
  igual(j.zona_monstros[0].carta.id, 'monstro_tubarao_martelo', 'novo monstro no slot');
  igual(j.cemiterio.length, 1, 'tributo no cemitério');
});

teste('monstro nível 8 exige 2 tributos', () => {
  const e = novaPartida();
  const v = e.jogadorDaVez;
  const j = e.jogadores[v];
  j.mao = [carta('monstro_cavaleiro_lendario', v)];
  j.zona_monstros[0] = criarSlotMonstro(carta('monstro_arqueira_da_vila', v));
  j.zona_monstros[1] = criarSlotMonstro(carta('monstro_aprendiz_de_espada', v));
  igual(invocarNormal(e, 0, 'ataque', [0]).ok, false, '1 tributo não basta');
  igual(invocarNormal(e, 0, 'ataque', [0, 1]).ok, true, '2 tributos');
});

teste('invocar em defesa deixa o monstro virado para baixo', () => {
  const e = novaPartida();
  const v = e.jogadorDaVez;
  e.jogadores[v].mao = [carta('monstro_lula_comum', v)];
  const r = invocarNormal(e, 0, 'defesa');
  igual(r.ok, true);
  const slot = e.jogadores[v].zona_monstros[r.indiceSlot];
  igual(slot.viradaParaBaixo, true, 'virada para baixo');
  igual(slot.posicao, 'defesa', 'posição');
});

teste('mudar posição de monstro recém-invocado falha; no turno seguinte funciona', () => {
  const e = novaPartida();
  const v = e.jogadorDaVez;
  e.jogadores[v].mao = [carta('monstro_lula_comum', v)];
  const inv = invocarNormal(e, 0, 'ataque');
  igual(mudarPosicao(e, inv.indiceSlot).ok, false, 'recém-invocado');
  e.jogadores[v].zona_monstros[inv.indiceSlot].invocadoNesteTurno = false; // simula passar o turno
  const r = mudarPosicao(e, inv.indiceSlot);
  igual(r.ok, true, 'depois de um turno');
  igual(r.posicao, 'defesa', 'nova posição');
  igual(mudarPosicao(e, inv.indiceSlot).ok, false, 'só 1 vez por turno');
});

teste('mão com 8 cartas fica com 6 ao finalizar o turno', () => {
  const e = novaPartida();
  const v = e.jogadorDaVez;
  const j = e.jogadores[v];
  while (j.mao.length < 8) j.mao.push(carta('monstro_lula_comum', v));
  const r = finalizarTurno(e);
  igual(r.ok, true);
  igual(r.descartadas, 2, 'descartadas');
  igual(j.mao.length, 6, 'mão');
  igual(j.cemiterio.length, 2, 'cemitério');
});

teste('ações fora da Main Phase falham com motivo', () => {
  const e = novaPartida();
  const v = e.jogadorDaVez;
  e.jogadores[v].mao = [carta('monstro_lula_comum', v)];
  avancarFase(e); // battle
  const r = invocarNormal(e, 0, 'ataque');
  igual(r.ok, false);
  afirmar(r.motivo.includes('Main'), 'motivo deveria citar a Main Phase');
});

teste('no turno 1, ir para a Battle Phase avisa que ataques estão bloqueados', () => {
  const e = novaPartida();
  const r = avancarFase(e);
  igual(r.ok, true);
  afirmar(typeof r.aviso === 'string', 'deveria ter aviso');
});

teste('avancarFase: main -> battle -> end, e depois não avança mais', () => {
  const e = novaPartida();
  igual(avancarFase(e).ok, true);
  igual(e.fase, 'battle');
  igual(avancarFase(e).ok, true);
  igual(e.fase, 'end');
  igual(avancarFase(e).ok, false, 'depois do end');
});

teste('posicionar armadilha: fica virada para baixo; magia fica virada para cima', () => {
  const e = novaPartida();
  const v = e.jogadorDaVez;
  e.jogadores[v].mao = [carta('armadilha_fosso_de_areia', v), carta('magia_pocao_de_cura', v)];
  const a = posicionarCarta(e, 0);
  igual(a.ok, true);
  igual(e.jogadores[v].zona_magias_armadilhas[a.indiceSlot].viradaParaBaixo, true, 'armadilha');
  const m = posicionarCarta(e, 0);
  igual(e.jogadores[v].zona_magias_armadilhas[m.indiceSlot].viradaParaBaixo, false, 'magia');
});

teste('carta de campo nova substitui a antiga (antiga vai ao cemitério do dono)', () => {
  const e = novaPartida();
  const v = e.jogadorDaVez;
  const velho = carta('campo_mar_de_europa', v);
  e.cartaCampo = velho;
  e.jogadores[v].mao = [carta('campo_cidade_antiga', v)];
  igual(posicionarCarta(e, 0).ok, true);
  igual(e.cartaCampo.id, 'campo_cidade_antiga', 'campo atual');
  igual(e.jogadores[v].cemiterio[0].id, 'campo_mar_de_europa', 'campo antigo');
});

teste('Standby: Mariposa-da-seda recupera 200 PV no início do turno', () => {
  const e = novaPartida();
  const v = e.jogadorDaVez;
  const j = e.jogadores[v];
  j.zona_monstros[0] = criarSlotMonstro(carta('fusao_mariposa_da_seda', v));
  j.pontos_vida = 7000;
  e.fase = 'standby';
  igual(resolverStandby(e).ok, true);
  igual(j.pontos_vida, 7200, 'PV');
  igual(e.fase, 'main', 'fase');
});

teste('depois do fim do jogo nenhuma ação é aceita', () => {
  const e = novaPartida();
  e.vencedor = 0;
  igual(finalizarTurno(e).ok, false);
  igual(avancarFase(e).ok, false);
  igual(invocarNormal(e, 0, 'ataque').ok, false);
});

resumo();
