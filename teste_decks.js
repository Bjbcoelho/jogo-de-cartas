// teste_decks.js
// Confere os decks prontos (Marciano e Humanos): contagens, fusões possíveis, bônus do equipamento
// com dois efeitos e partidas completas IA vs IA usando esses decks.  Rode com:  node teste_decks.js

import { readFileSync } from 'node:fs';
import { teste, afirmar, igual, resumo } from './mini_teste.js';
import { criarEstado, criarCartaEmJogo, criarSlotMonstro } from './game_state.js';
import { comecarPartida } from './turn_system.js';
import { indexarBanco, montarDeckPronto, montarDeckAleatorio } from './deck_builder.js';
import { podeEvoluir, evoluir, calcularStatsEfetivos } from './rules_engine.js';
import { jogarTurnoIA } from './ai_opponent.js';

const ler = (f) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), 'utf-8'));
const banco = ler('cards_db.json');
for (const f of ['cards_marte.json', 'cards_humanos.json']) {
  const extra = ler(f);
  for (const cat of Object.keys(banco)) banco[cat] = [...banco[cat], ...(extra[cat] ?? [])];
}
const cartasPorId = indexarBanco(banco);
const decks = ler('decks.json').decks;

// Faz a condição especial de uma fusão ficar verdadeira no estado de teste.
function satisfazer(e, id, cond) {
  if (!cond) return;
  const j = e.jogadores[id];
  switch (cond.tipo) {
    case 'pv_maximo': case 'pv_minimo': j.pontos_vida = cond.valor; break;
    case 'pv_menor_que_oponente': j.pontos_vida = 3000; break;
    case 'cemiterio_minimo': for (let i = 0; i < cond.valor; i++) j.cemiterio.push(criarCartaEmJogo(cartasPorId.monstro_lula_comum, id)); break;
    case 'campo_ativo': e.cartaCampo = criarCartaEmJogo(cartasPorId[cond.id], id); break;
    case 'turno_minimo': e.turno = Math.max(e.turno, cond.valor); break;
    default: break;
  }
}

function novoEstado(def0, def1) {
  const a = montarDeckPronto(def0), b = montarDeckPronto(def1);
  const e = criarEstado(a.deckPrincipal, a.deckExtra, b.deckPrincipal, b.deckExtra, cartasPorId);
  comecarPartida(e);
  return e;
}

for (const def of decks) {
  teste(`${def.nome}: 40 cartas principais, 10 fusões, ids existentes`, () => {
    const d = montarDeckPronto(def);
    igual(d.deckPrincipal.length, 40);
    igual(d.deckExtra.length, 10);
    for (const id of [...d.deckPrincipal, ...d.deckExtra]) afirmar(cartasPorId[id], `id ${id} não existe`);
  });

  teste(`${def.nome}: todas as fusões podem ser feitas com os materiais do próprio deck`, () => {
    for (const idFusao of def.extra) {
      const e = novoEstado(def, def);
      e.jogadorDaVez = 0; e.fase = 'main'; e.vencedor = null;
      const j = e.jogadores[0];
      j.zona_monstros.fill(null); j.mao.length = 0;
      let slot = 0;
      for (const req of cartasPorId[idFusao].requisitos_fusao) {
        const c = criarCartaEmJogo(cartasPorId[req.id], 0);
        if (req.local === 'campo') j.zona_monstros[slot++] = criarSlotMonstro(c, 'ataque');
        else j.mao.push(c);
      }
      satisfazer(e, 0, cartasPorId[idFusao].condicao_especial);
      afirmar(podeEvoluir(e, 0, idFusao).ok, `${idFusao}: ${podeEvoluir(e, 0, idFusao).motivo}`);
      const r = evoluir(e, 0, idFusao);
      afirmar(r.ok, `${idFusao}: ${r.motivo}`);
      igual(j.zona_monstros.filter(Boolean).some((s) => s.carta.id === idFusao), true, 'a fusão devia estar em campo');
    }
  });
}

teste('Carapaça de Ferro Oxidado dá +300 ATK e +300 DEF (efeito secundário)', () => {
  const e = novoEstado(decks[0], decks[1]);
  const rover = criarCartaEmJogo(cartasPorId.monstro_rover_de_prospeccao, 0);
  e.jogadores[0].zona_monstros[0] = criarSlotMonstro(rover, 'ataque');
  const antes = calcularStatsEfetivos(e, 0, 0);
  e.jogadores[0].zona_monstros[0].equipamento = criarCartaEmJogo(cartasPorId.equip_carapaca_de_ferro_oxidado, 0);
  const depois = calcularStatsEfetivos(e, 0, 0);
  igual(depois.atk - antes.atk, 300);
  igual(depois.def - antes.def, 300);
});

teste('o sorteio de deck aleatório não usa cartas dos decks temáticos', () => {
  for (let i = 0; i < 20; i++) {
    const d = montarDeckAleatorio(cartasPorId);
    for (const id of [...d.deckPrincipal, ...d.deckExtra]) afirmar(!cartasPorId[id].deck, `${id} é de deck temático`);
  }
});

// Partidas completas: Marciano vs Humanos (nos dois lugares), com contagem de fusões feitas.
const fusoesFeitas = {};
let travou = 0;
for (let n = 0; n < 40; n++) {
  const [d0, d1] = n % 2 ? [decks[0], decks[1]] : [decks[1], decks[0]];
  const e = novoEstado(d0, d1);
  while (e.vencedor === null && e.turno <= 200) {
    const antes = e.turno;
    await jogarTurnoIA(e, e.jogadorDaVez, { aoEvoluir: async (c) => { fusoesFeitas[c.deck] = (fusoesFeitas[c.deck] ?? 0) + 1; } });
    if (e.vencedor === null && e.turno === antes) { travou++; break; }
  }
  if (e.vencedor === null && e.turno > 200) travou++;
}
teste('40 partidas Marciano x Humanos terminam sem travar', () => igual(travou, 0, 'partidas travadas'));
console.log('Fusões feitas pela IA nas 40 partidas:', fusoesFeitas);
teste('a IA consegue fazer fusões de cada deck', () => {
  afirmar((fusoesFeitas.marciano ?? 0) > 0, 'nenhuma fusão marciana');
  afirmar((fusoesFeitas.humanos ?? 0) > 0, 'nenhuma fusão humana');
});
resumo();
