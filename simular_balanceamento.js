// simular_balanceamento.js
// ---------------------------------------------------------------
// Joga muitas partidas IA x IA e mostra números para ajustar o balanceamento:
//   * taxa de vitória de cada deck (e vantagem de quem começa);
//   * duração média (em turnos);
//   * quanto cada fusão aparece e quanto ganha quando aparece.
// Rode com:  node simular_balanceamento.js [partidas]     (padrão: 400 por confronto)
// ---------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { criarEstado } from './game_state.js';
import { comecarPartida } from './turn_system.js';
import { indexarBanco, montarDeckAleatorio, montarDeckPronto } from './deck_builder.js';
import { jogarTurnoIA } from './ai_opponent.js';

const ler = (f) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), 'utf-8'));
const banco = ler('cards_db.json');
for (const f of ['cards_marte.json', 'cards_humanos.json']) {
  const extra = ler(f);
  for (const cat of Object.keys(banco)) banco[cat] = [...banco[cat], ...(extra[cat] ?? [])];
}
const cartasPorId = indexarBanco(banco);
// Experimento: ESCALA_FUSAO=0.85 multiplica ATK/DEF de todas as fusões (para testar ajustes sem mexer nos JSON).
const escala = Number(process.env.ESCALA_FUSAO ?? 1);
if (escala !== 1) for (const c of Object.values(cartasPorId)) if (c.tipo === 'fusao') { c.atk = Math.round(c.atk * escala / 50) * 50; c.def = Math.round(c.def * escala / 50) * 50; }
const decks = Object.fromEntries(ler('decks.json').decks.map((d) => [d.id, d]));
const N = Number(process.argv[2] ?? 400);

async function partida(fabrica0, fabrica1, nivel0 = 3, nivel1 = 3) {
  const d0 = fabrica0(), d1 = fabrica1();
  const estado = criarEstado(d0.deckPrincipal, d0.deckExtra, d1.deckPrincipal, d1.deckExtra, cartasPorId);
  comecarPartida(estado);
  const fusoes = [[], []];
  while (estado.vencedor === null && estado.turno <= 200) {
    const id = estado.jogadorDaVez;
    await jogarTurnoIA(estado, id, { nivel: id === 0 ? nivel0 : nivel1, aoEvoluir: (c) => fusoes[id].push(c.id) });
  }
  return { vencedor: estado.vencedor, turnos: estado.turno, inicial: estado.jogadorInicial, fusoes, pv: estado.jogadores.map((j) => j.pontos_vida) };
}

const pronto = (id) => () => montarDeckPronto(decks[id]);
const aleatorio = () => montarDeckAleatorio(cartasPorId);

async function confronto(nome, f0, f1, n = N, niveis = [3, 3]) {
  let soUmFundiu = 0, soUmGanhou = 0, vit = [0, 0], emp = 0, turnos = 0, inicialGanha = 0, comFusao = 0, semVencedor = 0;
  const porFusao = {};
  for (let i = 0; i < n; i++) {
    const r = await partida(f0, f1, niveis[0], niveis[1]);
    turnos += r.turnos;
    if (r.vencedor === 'empate' || r.vencedor === null) { emp++; if (r.vencedor === null) semVencedor++; continue; }
    vit[r.vencedor]++;
    if (r.vencedor === r.inicial) inicialGanha++;
    for (const j of [0, 1]) {
      for (const f of new Set(r.fusoes[j])) {
        porFusao[f] ??= { jogos: 0, vitorias: 0 };
        porFusao[f].jogos++;
        if (r.vencedor === j) porFusao[f].vitorias++;
      }
    }
    if (r.fusoes[0].length + r.fusoes[1].length > 0) comFusao++;
    if ((r.fusoes[0].length > 0) !== (r.fusoes[1].length > 0)) { soUmFundiu++; if (r.fusoes[r.vencedor].length > 0) soUmGanhou++; }
  }
  const decididas = vit[0] + vit[1];
  console.log(`\n=== ${nome} (${n} partidas) ===`);
  console.log(`vitórias J1: ${(100 * vit[0] / n).toFixed(1)}%  J2: ${(100 * vit[1] / n).toFixed(1)}%  empates/limite: ${emp}`);
  console.log(`quem começa vence: ${(100 * inicialGanha / Math.max(1, decididas)).toFixed(1)}%   turnos médios: ${(turnos / n).toFixed(1)}   partidas com fusão: ${(100 * comFusao / n).toFixed(0)}%`);
  if (soUmFundiu) console.log(`quando SÓ UM lado fez fusão (${soUmFundiu} partidas), esse lado venceu: ${(100 * soUmGanhou / soUmFundiu).toFixed(0)}%`);
  return { porFusao, vit, n };
}

const todas = {};
const acumular = (r) => { for (const [k, v] of Object.entries(r.porFusao)) { todas[k] ??= { jogos: 0, vitorias: 0 }; todas[k].jogos += v.jogos; todas[k].vitorias += v.vitorias; } };

acumular(await confronto('Marciano (J1) x Humanos (J2)', pronto('marciano'), pronto('humanos')));
acumular(await confronto('Humanos (J1) x Marciano (J2)', pronto('humanos'), pronto('marciano')));
acumular(await confronto('Marciano x Marciano', pronto('marciano'), pronto('marciano'), Math.floor(N / 2)));
acumular(await confronto('Humanos x Humanos', pronto('humanos'), pronto('humanos'), Math.floor(N / 2)));
acumular(await confronto('Aleatório x Aleatório', aleatorio, aleatorio));
await confronto('Níveis da IA: nível 1 (J1) x nível 5 (J2), decks aleatórios', aleatorio, aleatorio, Math.floor(N / 2), [1, 5]);
await confronto('Níveis da IA: nível 3 (J1) x nível 5 (J2), Humanos x Humanos', pronto('humanos'), pronto('humanos'), Math.floor(N / 2), [3, 5]);

console.log('\n=== Fusões: quantas vezes aparecem e taxa de vitória de quem as faz ===');
const linhas = Object.entries(todas).sort((a, b) => b[1].jogos - a[1].jogos);
for (const [id, v] of linhas) {
  const c = cartasPorId[id];
  const esp = c.condicao_especial ? ' *especial*' : '';
  console.log(`${id.padEnd(44)} lv${c.nivel} ${String(c.atk).padStart(4)}/${String(c.def).padEnd(4)} jogos ${String(v.jogos).padStart(4)}  vitória ${(100 * v.vitorias / v.jogos).toFixed(0)}%${esp}`);
}
