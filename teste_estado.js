// teste_estado.js
// Testes do game_state.js. Rode com:  node teste_estado.js

import { readFileSync } from 'node:fs';
import { teste, afirmar, igual, resumo } from './mini_teste.js';
import {
  criarEstado, embaralhar, comprarCarta, destruirMonstro, encontrarSlotVazio,
  verificarVitoria, serializarEstado, carregarEstado, criarCartaEmJogo, criarSlotMonstro,
} from './game_state.js';
import { indexarBanco, montarDeckAleatorio } from './deck_builder.js';

const banco = JSON.parse(readFileSync(new URL('./cards_db.json', import.meta.url), 'utf-8'));
const cartasPorId = indexarBanco(banco);
const carta = (id, dono) => criarCartaEmJogo(cartasPorId[id], dono);

// Cria um estado novo com decks aleatórios válidos (sem iniciar turno).
function novoEstado() {
  const { deckPrincipal, deckExtra } = montarDeckAleatorio(cartasPorId);
  return criarEstado(deckPrincipal, deckExtra, deckPrincipal, deckExtra, cartasPorId);
}

// Coloca um monstro direto num slot do campo.
function noCampo(estado, j, indice, id, posicao = 'ataque') {
  estado.jogadores[j].zona_monstros[indice] = criarSlotMonstro(carta(id, j), posicao);
}

teste('decks montados têm 40 cartas, no máximo 3 cópias de cada, extra até 10', () => {
  const { deckPrincipal, deckExtra } = montarDeckAleatorio(cartasPorId);
  igual(deckPrincipal.length, 40, 'tamanho do deck');
  const contagem = {};
  for (const id of deckPrincipal) contagem[id] = (contagem[id] || 0) + 1;
  afirmar(Object.values(contagem).every((n) => n <= 3), 'alguma carta tem mais de 3 cópias');
  afirmar(deckExtra.length <= 10, 'deck extra passou de 10');
});

teste('cada jogador começa com 5 cartas na mão e 35 no deck, 8000 PV', () => {
  const e = novoEstado();
  for (const j of e.jogadores) {
    igual(j.mao.length, 5, 'cartas na mão');
    igual(j.deck_principal.length, 35, 'cartas no deck');
    igual(j.pontos_vida, 8000, 'pontos de vida');
  }
  igual(e.turno, 1, 'turno inicial');
  igual(e.fase, 'draw', 'fase inicial');
  afirmar(e.jogadorDaVez === 0 || e.jogadorDaVez === 1, 'jogador da vez inválido');
});

teste('cópias da mesma carta têm uid diferente e guardam o dono', () => {
  const a = carta('monstro_lula_comum', 0);
  const b = carta('monstro_lula_comum', 1);
  afirmar(a.uid !== b.uid, 'uids iguais');
  igual(b.dono, 1, 'dono');
});

teste('embaralhar não altera a lista original', () => {
  const original = [1, 2, 3, 4, 5, 6, 7, 8];
  const copia = [...original];
  const resultado = embaralhar(original);
  igual(JSON.stringify(original), JSON.stringify(copia), 'lista original mudou');
  igual(resultado.length, original.length, 'tamanho');
});

teste('comprar com deck vazio dá vitória ao oponente', () => {
  const e = novoEstado();
  e.jogadores[0].deck_principal = [];
  const r = comprarCarta(e, 0);
  igual(r.ok, false, 'ok');
  igual(r.motivo, 'deckout', 'motivo');
  igual(e.vencedor, 1, 'vencedor');
});

teste('comprar carta normal move do deck para a mão', () => {
  const e = novoEstado();
  const r = comprarCarta(e, 0);
  igual(r.ok, true, 'ok');
  igual(e.jogadores[0].mao.length, 6, 'mão');
  igual(e.jogadores[0].deck_principal.length, 34, 'deck');
});

teste('destruirMonstro envia monstro e equipamento ao cemitério', () => {
  const e = novoEstado();
  noCampo(e, 0, 2, 'monstro_aprendiz_de_espada');
  e.jogadores[0].zona_monstros[2].equipamento = carta('equip_espada_de_ferro', 0);
  const r = destruirMonstro(e, 0, 2);
  igual(r.ok, true, 'ok');
  igual(e.jogadores[0].zona_monstros[2], null, 'slot deveria estar vazio');
  igual(e.jogadores[0].cemiterio.length, 2, 'cemitério deveria ter 2 cartas');
});

teste('destruirMonstro em slot vazio retorna ok:false', () => {
  igual(destruirMonstro(novoEstado(), 0, 0).ok, false, 'ok');
});

teste('encontrarSlotVazio acha o primeiro vazio e -1 se cheio', () => {
  const e = novoEstado();
  noCampo(e, 0, 0, 'monstro_aprendiz_de_espada');
  igual(encontrarSlotVazio(e.jogadores[0].zona_monstros), 1, 'primeiro vazio');
  for (let i = 1; i < 5; i++) noCampo(e, 0, i, 'monstro_aprendiz_de_espada');
  igual(encontrarSlotVazio(e.jogadores[0].zona_monstros), -1, 'zona cheia');
});

teste('verificarVitoria: PV 0 de um, de outro e de ambos (empate)', () => {
  let e = novoEstado();
  e.jogadores[0].pontos_vida = 0;
  igual(verificarVitoria(e), 1, 'jogador 0 zerou');
  e = novoEstado();
  e.jogadores[1].pontos_vida = -300;
  igual(verificarVitoria(e), 0, 'jogador 1 zerou');
  e = novoEstado();
  e.jogadores[0].pontos_vida = 0;
  e.jogadores[1].pontos_vida = 0;
  igual(verificarVitoria(e), 'empate', 'empate');
});

teste('serializar e carregar devolvem um estado equivalente', () => {
  const e = novoEstado();
  noCampo(e, 0, 0, 'monstro_lula_comum');
  const texto = serializarEstado(e);
  igual(serializarEstado(carregarEstado(texto)), texto, 'estado diferente após ida e volta');
});

resumo();
