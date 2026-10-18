// teste_ia.js
// Simula 50 partidas IA vs IA com decks aleatórios válidos.
// Garante que nenhuma entra em loop infinito (limite de 200 turnos) e que a IA
// nunca faz uma jogada inválida inesperada. Rode com:  node teste_ia.js

import { readFileSync } from 'node:fs';
import { criarEstado } from './game_state.js';
import { comecarPartida } from './turn_system.js';
import { indexarBanco, montarDeckAleatorio } from './deck_builder.js';
import { jogarTurnoIA } from './ai_opponent.js';

const banco = JSON.parse(readFileSync(new URL('./cards_db.json', import.meta.url), 'utf-8'));
const cartasPorId = indexarBanco(banco);

const PARTIDAS = 50;
const LIMITE_TURNOS = 200;

const resultado = { por_pv: 0, por_deckout: 0, empates: 0, limite_de_turnos: 0 };
let somaTurnos = 0;
let totalAcoes = 0;
let problemas = 0;

for (let n = 1; n <= PARTIDAS; n++) {
  const d0 = montarDeckAleatorio(cartasPorId);
  const d1 = montarDeckAleatorio(cartasPorId);
  const estado = criarEstado(d0.deckPrincipal, d0.deckExtra, d1.deckPrincipal, d1.deckExtra, cartasPorId);
  comecarPartida(estado);

  while (estado.vencedor === null && estado.turno <= LIMITE_TURNOS) {
    const turnoAntes = estado.turno;
    const vezAntes = estado.jogadorDaVez;
    const acoes = await jogarTurnoIA(estado, vezAntes, { atrasoMs: 0 });
    totalAcoes += acoes.length;
    // Se o turno não avançou e ninguém venceu, a IA travou: isso seria um loop infinito.
    if (estado.vencedor === null && estado.turno === turnoAntes) {
      console.log(`PROBLEMA na partida ${n}: a IA não conseguiu terminar o turno ${turnoAntes}. Última ação:`, acoes.at(-1));
      problemas += 1;
      break;
    }
  }

  somaTurnos += estado.turno;
  if (estado.vencedor === 'empate') resultado.empates += 1;
  else if (estado.vencedor === null) resultado.limite_de_turnos += 1;
  else {
    // Se o perdedor ainda tem PV, a derrota veio de deckout (compra com deck vazio).
    const perdedor = estado.jogadores[1 - estado.vencedor];
    if (perdedor.pontos_vida <= 0) resultado.por_pv += 1;
    else resultado.por_deckout += 1;
  }
}

console.log(`=== ${PARTIDAS} partidas IA vs IA ===`);
console.log(`Terminaram por PV 0:        ${resultado.por_pv}`);
console.log(`Terminaram por deckout:     ${resultado.por_deckout}`);
console.log(`Empates (PV dos dois em 0): ${resultado.empates}`);
console.log(`Limite de ${LIMITE_TURNOS} turnos:        ${resultado.limite_de_turnos}`);
console.log(`Média de turnos por partida: ${(somaTurnos / PARTIDAS).toFixed(1)}`);
console.log(`Média de ações da IA por partida: ${(totalAcoes / PARTIDAS).toFixed(1)}`);

if (problemas > 0 || resultado.limite_de_turnos > 0) {
  console.log(`\nFALHOU: ${problemas} travamento(s) e ${resultado.limite_de_turnos} partida(s) estouraram o limite de turnos.`);
  process.exitCode = 1;
} else {
  console.log('\nOK: nenhuma partida travou nem estourou o limite de turnos.');
}
