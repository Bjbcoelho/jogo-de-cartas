// teste_historia.js
// Testa o Modo História sem interface: validação do historia.json, avaliação dos objetivos,
// progresso salvo e fases jogadas de ponta a ponta (IA contra IA).  Rode com:  node teste_historia.js

import { readFileSync } from 'node:fs';
import { teste, testeAsync, afirmar, igual, resumo } from './mini_teste.js';
import { criarEstado, comprarCarta } from './game_state.js';
import { comecarPartida } from './turn_system.js';
import { indexarBanco, montarDeckAleatorio, montarDeckPronto } from './deck_builder.js';
import { jogarTurnoIA } from './ai_opponent.js';
import {
  validarHistoria, avaliarObjetivo, avaliarFase, turnosDoJogador, descreverObjetivo,
  lerProgresso, salvarProgresso, faseLiberada, concluirFase, CHAVE_PROGRESSO,
} from './historia.js';

const ler = (f) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), 'utf-8'));
const banco = ler('cards_db.json');
for (const f of ['cards_marte.json', 'cards_humanos.json']) {
  const extra = ler(f);
  for (const cat of Object.keys(banco)) banco[cat] = [...banco[cat], ...(extra[cat] ?? [])];
}
const cartasPorId = indexarBanco(banco);
const decks = Object.fromEntries(ler('decks.json').decks.map((d) => [d.id, d]));
const historia = ler('historia.json');

function estadoVazio() {
  const d = montarDeckAleatorio(cartasPorId);
  const e = criarEstado(d.deckPrincipal, d.deckExtra, d.deckPrincipal, d.deckExtra, cartasPorId);
  comecarPartida(e);
  return e;
}

// ---------- Conteúdo ----------
teste('historia.json é válido: decks existem, dificuldade nunca diminui, toda fase exige vencer', () => {
  const problemas = validarHistoria(historia, ['aleatorio', ...Object.keys(decks)]);
  igual(problemas.length, 0, problemas.join(' | '));
});

teste('a história tem pelo menos 10 fases, níveis de 1 a 5 e objetivos variados', () => {
  afirmar(historia.fases.length >= 10, 'poucas fases');
  const niveis = historia.fases.map((f) => f.oponente.nivel);
  igual(Math.min(...niveis), 1); igual(Math.max(...niveis), 5);
  const tipos = new Set(historia.fases.flatMap((f) => f.objetivos.map((o) => o.tipo)));
  for (const t of ['vencer', 'fusoes', 'sem_dano_direto', 'sem_perder_monstros', 'em_turnos', 'pv_minimo']) afirmar(tipos.has(t), `nenhuma fase usa "${t}"`);
});

teste('validarHistoria acusa erros (deck inexistente, sem vencer, dificuldade caindo)', () => {
  const ruim = { fases: [
    { id: 'a', nome: 'A', historia: 'x', conclusao: 'y', oponente: { deck: 'nao_existe', nivel: 3 }, objetivos: [{ tipo: 'fusoes', valor: 1 }] },
    { id: 'b', nome: 'B', historia: 'x', conclusao: 'y', oponente: { deck: 'aleatorio', nivel: 1 }, objetivos: [{ tipo: 'vencer' }] },
  ] };
  const p = validarHistoria(ruim, ['aleatorio']);
  afirmar(p.some((t) => t.includes('não existe')), 'deck');
  afirmar(p.some((t) => t.includes('vencer')), 'vencer');
  afirmar(p.some((t) => t.includes('diminuiu')), 'dificuldade');
});

// ---------- Objetivos ----------
teste('objetivo "fusões": conta fusões do jogador humano e só falha no fim do duelo', () => {
  const e = estadoVazio();
  const obj = { tipo: 'fusoes', valor: 2 };
  let r = avaliarObjetivo(e, obj);
  igual(r.cumprido, false); igual(r.falhou, false, 'ainda dá tempo');
  e.estatisticas[0].fusoes = 2;
  igual(avaliarObjetivo(e, obj).cumprido, true);
  e.estatisticas[0].fusoes = 1; e.vencedor = 0;
  igual(avaliarObjetivo(e, obj).falhou, true, 'acabou com 1 fusão');
});

teste('objetivo "sem dano direto": falha assim que sofre um ataque direto; cumpre só no fim', () => {
  const e = estadoVazio();
  const obj = { tipo: 'sem_dano_direto' };
  igual(avaliarObjetivo(e, obj).cumprido, false, 'durante o duelo ainda não está garantido');
  e.vencedor = 0;
  igual(avaliarObjetivo(e, obj).cumprido, true);
  e.estatisticas[0].danoDiretoSofrido = 500;
  igual(avaliarObjetivo(e, obj).falhou, true);
});

teste('objetivo "sem perder monstros", "PV mínimo" e "armadilhas"', () => {
  const e = estadoVazio();
  e.vencedor = 0;
  igual(avaliarObjetivo(e, { tipo: 'sem_perder_monstros' }).cumprido, true);
  e.estatisticas[0].monstrosPerdidos = 1;
  igual(avaliarObjetivo(e, { tipo: 'sem_perder_monstros' }).falhou, true);
  e.jogadores[0].pontos_vida = 2999;
  igual(avaliarObjetivo(e, { tipo: 'pv_minimo', valor: 3000 }).cumprido, false);
  e.jogadores[0].pontos_vida = 3000;
  igual(avaliarObjetivo(e, { tipo: 'pv_minimo', valor: 3000 }).cumprido, true);
  e.estatisticas[0].armadilhasAtivadas = 1;
  igual(avaliarObjetivo(e, { tipo: 'armadilhas', valor: 1 }).cumprido, true);
});

teste('objetivo "em turnos": conta os turnos do JOGADOR, não os globais', () => {
  const e = estadoVazio();
  e.jogadorInicial = 0; e.turno = 19; // jogador 0 teve 10 turnos (1,3,...,19)
  igual(turnosDoJogador(e), 10);
  e.jogadorInicial = 1; e.turno = 20; // jogador 0 joga nos turnos pares: 10 turnos
  igual(turnosDoJogador(e), 10);
  e.vencedor = 0;
  igual(avaliarObjetivo(e, { tipo: 'em_turnos', valor: 10 }).cumprido, true);
  e.turno = 22;
  igual(avaliarObjetivo(e, { tipo: 'em_turnos', valor: 10 }).falhou, true);
});

teste('fase concluída exige vitória E todos os objetivos; derrota nunca conclui', () => {
  const fase = historia.fases.find((f) => f.objetivos.length >= 2);
  const e = estadoVazio();
  e.vencedor = 0;
  for (const o of fase.objetivos) if (o.valor && ['fusoes', 'fusoes_especiais', 'armadilhas'].includes(o.tipo)) e.estatisticas[0][{ fusoes: 'fusoes', fusoes_especiais: 'fusoesEspeciais', armadilhas: 'armadilhasAtivadas' }[o.tipo]] = o.valor;
  e.jogadores[0].pontos_vida = 8000; e.turno = 3; e.jogadorInicial = 0;
  igual(avaliarFase(fase, e).concluida, true, avaliarFase(fase, e).objetivos.map((o) => `${o.texto}:${o.cumprido}`).join(', '));
  e.vencedor = 1;
  igual(avaliarFase(fase, e).concluida, false, 'derrota');
  e.vencedor = 0; e.estatisticas[0].danoDiretoSofrido = 100; e.estatisticas[0].monstrosPerdidos = 1;
  const f2 = { objetivos: [{ tipo: 'vencer' }, { tipo: 'sem_dano_direto' }] };
  igual(avaliarFase(f2, e).concluida, false, 'venceu mas sofreu dano direto');
  afirmar(avaliarFase(f2, e).venceu, 'venceu');
});

teste('descreverObjetivo escreve em português para todos os tipos usados', () => {
  for (const f of historia.fases) for (const o of f.objetivos) afirmar(!descreverObjetivo(o).includes('desconhecido'), o.tipo);
});

// ---------- Progresso ----------
function armazenamentoFalso() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

teste('progresso: começa vazio, salva, recarrega e libera a fase seguinte', () => {
  const arm = armazenamentoFalso();
  let p = lerProgresso(arm);
  igual(p.concluidas.length, 0);
  igual(faseLiberada(historia.fases, p, 0), true, 'primeira sempre liberada');
  igual(faseLiberada(historia.fases, p, 1), false, 'segunda bloqueada');
  p = concluirFase(p, historia.fases[0].id);
  p = concluirFase(p, historia.fases[0].id); // não duplica
  igual(p.concluidas.length, 1);
  salvarProgresso(arm, p);
  const p2 = lerProgresso(arm);
  igual(faseLiberada(historia.fases, p2, 1), true, 'segunda liberada');
  igual(faseLiberada(historia.fases, p2, 2), false, 'terceira ainda não');
});

teste('progresso: sem armazenamento ou com texto inválido não quebra', () => {
  igual(lerProgresso(null).concluidas.length, 0);
  const arm = armazenamentoFalso(); arm.setItem(CHAVE_PROGRESSO, '{ isso não é json');
  igual(lerProgresso(arm).concluidas.length, 0);
  salvarProgresso({ setItem() { throw new Error('cheio'); } }, { concluidas: [] }); // não lança
});

// ---------- Fases jogadas de ponta a ponta ----------
function montarDeck(id) {
  return id === 'aleatorio' ? montarDeckAleatorio(cartasPorId) : montarDeckPronto(decks[id]);
}

async function jogarFase(fase, nivelJogador, deckJogador) {
  const d0 = montarDeck(deckJogador), d1 = montarDeck(fase.oponente.deck);
  const e = criarEstado(d0.deckPrincipal, d0.deckExtra, d1.deckPrincipal, d1.deckExtra, cartasPorId);
  e.jogadores[1].pontos_vida = fase.oponente.pv;
  for (let i = 0; i < fase.oponente.cartasExtras; i++) comprarCarta(e, 1);
  comecarPartida(e);
  while (e.vencedor === null && e.turno <= 200) {
    const id = e.jogadorDaVez;
    await jogarTurnoIA(e, id, { nivel: id === 0 ? nivelJogador : fase.oponente.nivel });
  }
  return avaliarFase(fase, e);
}

await testeAsync('todas as fases terminam sem travar quando jogadas pela IA (e objetivos são avaliáveis)', async () => {
  for (const fase of historia.fases) {
    for (const deck of ['aleatorio', 'humanos', 'marciano']) {
      const r = await jogarFase(fase, 4, deck);
      afirmar(r.fim, `${fase.id}: duelo não terminou`);
      igual(r.objetivos.length, fase.objetivos.length);
    }
  }
});

// Informativo: taxa de conclusão de cada fase com um "jogador" IA nível 4 (não é teste de pass/fail rígido).
await testeAsync('cada fase é possível de concluir (pelo menos 1 em 80 duelos, jogador IA nível 4 com deck Humanos)', async () => {
  const resumoFases = [];
  for (const fase of historia.fases) {
    let ok = 0, vit = 0;
    const N = 80;
    for (let i = 0; i < N; i++) {
      const r = await jogarFase(fase, 4, fase.oponente.deck === 'marciano' ? 'marciano' : 'humanos');
      if (r.venceu) vit++;
      if (r.concluida) ok++;
    }
    resumoFases.push(`${fase.id} (${fase.oponente.nivel}★): vence ${Math.round(100 * vit / N)}% · conclui ${Math.round(100 * ok / N)}%`);
    afirmar(ok >= 1, `${fase.id}: nenhuma conclusão em ${N} duelos (${resumoFases.at(-1)})`);
  }
  console.log('   ' + resumoFases.join('\n   '));
});

resumo();
