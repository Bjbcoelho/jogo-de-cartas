// teste_efeitos.js
// Testes dos efeitos novos: gatilhos de monstro, magias novas, armadilhas que negam,
// fusões especiais (condições únicas) e as estatísticas usadas pelo Modo História.
// Rode com:  node teste_efeitos.js

import { readFileSync } from 'node:fs';
import { teste, afirmar, igual, resumo } from './mini_teste.js';
import { criarEstado, criarCartaEmJogo, criarSlotMonstro, encontrarSlotVazio } from './game_state.js';
import { indexarBanco, montarDeckAleatorio } from './deck_builder.js';
import { comecarPartida, invocarNormal, posicionarCarta } from './turn_system.js';
import {
  calcularStatsEfetivos, podeEvoluir, evoluir, ativarMagia, declararAtaque, descreverAtaque,
  verificarCondicaoEspecial, TIPOS_CONDICAO,
} from './rules_engine.js';

const ler = (f) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), 'utf-8'));
const banco = ler('cards_db.json');
for (const f of ['cards_marte.json', 'cards_humanos.json']) {
  const extra = ler(f);
  for (const cat of Object.keys(banco)) banco[cat] = [...banco[cat], ...(extra[cat] ?? [])];
}
const cartasPorId = indexarBanco(banco);
const carta = (id, dono) => criarCartaEmJogo(cartasPorId[id], dono);

function cenario() {
  const { deckPrincipal } = montarDeckAleatorio(cartasPorId);
  const e = criarEstado(deckPrincipal, [], deckPrincipal, [], cartasPorId);
  comecarPartida(e);
  e.turno = 4; e.jogadorDaVez = 0; e.fase = 'main'; e.cartaCampo = null;
  for (const j of e.jogadores) {
    j.deck_extra = Object.values(cartasPorId).filter((c) => c.tipo === 'fusao').map((c) => carta(c.id, j.id));
    j.mao = []; j.cemiterio = [];
    j.zona_monstros = Array(5).fill(null);
    j.zona_magias_armadilhas = Array(5).fill(null);
    j.pontos_vida = 8000;
  }
  return e;
}
function colocar(e, id, idCarta, posicao = 'ataque') {
  const zona = e.jogadores[id].zona_monstros;
  const i = encontrarSlotVazio(zona);
  const slot = criarSlotMonstro(carta(idCarta, id), posicao);
  slot.invocadoNesteTurno = false;
  zona[i] = slot;
  return i;
}
function armadilha(e, id, idCarta) {
  e.jogadores[id].zona_magias_armadilhas[0] = { carta: carta(idCarta, id), viradaParaBaixo: true, turnoBaixada: 1 };
}

// ---------- Gatilhos de monstros ----------
teste('ao_invocar: Atirador de Elite causa 300 de dano ao ser invocado em ataque', () => {
  const e = cenario();
  e.jogadores[0].mao = [carta('monstro_atirador_de_elite', 0)];
  const r = invocarNormal(e, 0, 'ataque');
  igual(r.ok, true, 'invocou');
  igual(e.jogadores[1].pontos_vida, 7700, 'PV do oponente');
  afirmar(r.efeitos.length === 1, 'o efeito deveria aparecer no registro');
});

teste('ao_invocar: monstro invocado em DEFESA (virado para baixo) não ativa o efeito', () => {
  const e = cenario();
  e.jogadores[0].mao = [carta('monstro_atirador_de_elite', 0)];
  invocarNormal(e, 0, 'defesa');
  igual(e.jogadores[1].pontos_vida, 8000, 'PV do oponente');
});

teste('ao_invocar: Engenheiro de Campo compra 1 carta', () => {
  const e = cenario();
  e.jogadores[0].mao = [carta('monstro_engenheiro_de_campo', 0)];
  invocarNormal(e, 0, 'ataque');
  igual(e.jogadores[0].mao.length, 1, 'comprou 1');
});

teste('ao_invocar: Titã de Saturno destrói o monstro mais forte do oponente', () => {
  const e = cenario();
  colocar(e, 0, 'monstro_lula_comum'); colocar(e, 0, 'monstro_sonda_orbital');
  colocar(e, 1, 'monstro_lula_comum'); const forte = colocar(e, 1, 'monstro_peixe_espada');
  e.jogadores[0].mao = [carta('monstro_titan_de_saturno', 0)];
  const r = invocarNormal(e, 0, 'ataque', [0, 1]);
  igual(r.ok, true, 'invocou com 2 tributos');
  igual(e.jogadores[1].zona_monstros[forte], null, 'o mais forte foi destruído');
});

teste('ao_destruir_oponente: Vespa Caçadora causa 400 de dano após destruir um monstro', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_vespa_cacadora'); // 2200
  const b = colocar(e, 1, 'monstro_aprendiz_de_espada'); // 1200
  e.fase = 'battle';
  const log = declararAtaque(e, 0, a, b);
  igual(log.tipoResultado, 'atacante_venceu');
  igual(e.jogadores[1].pontos_vida, 8000 - 1000 - 400, 'dano de batalha + efeito');
  afirmar(descreverAtaque(log).includes('400'), 'a frase deveria citar o efeito');
});

teste('continuo (aura): Cavaleiro Lendário tira 200 de ATK dos monstros do oponente', () => {
  const e = cenario();
  colocar(e, 0, 'monstro_cavaleiro_lendario');
  const i = colocar(e, 1, 'monstro_lula_comum');
  igual(calcularStatsEfetivos(e, 1, i).atk, 800, 'ATK reduzido');
  e.jogadores[0].zona_monstros[0].viradaParaBaixo = true;
  igual(calcularStatsEfetivos(e, 1, i).atk, 1000, 'virado para baixo: sem aura');
});

teste('continuo: Rainha Formiga dá +200 ATK a insetos, mas não a outros biomas', () => {
  const e = cenario();
  colocar(e, 0, 'monstro_rainha_formiga');
  const inseto = colocar(e, 0, 'monstro_lagarta_da_seda');
  const marinho = colocar(e, 0, 'monstro_lula_comum');
  igual(calcularStatsEfetivos(e, 0, inseto).atk, 800);
  igual(calcularStatsEfetivos(e, 0, marinho).atk, 1000);
});

teste('ao_ser_destruido: Besouro Blindado cura 300 PV ao ser destruído em batalha', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_vespa_cacadora');
  const b = colocar(e, 1, 'monstro_besouro_blindado');
  e.jogadores[1].pontos_vida = 5000;
  e.fase = 'battle';
  declararAtaque(e, 0, a, b);
  // dano de batalha 700 + 400 da Vespa, cura 300 do Besouro
  igual(e.jogadores[1].pontos_vida, 5000 - 700 - 400 + 300);
});

// ---------- Magias novas ----------
teste('Chamado do Cemitério revive o monstro comum mais forte do cemitério', () => {
  const e = cenario();
  const j = e.jogadores[0];
  j.cemiterio = [carta('monstro_lula_comum', 0), carta('monstro_peixe_espada', 0), carta('fusao_mariposa_da_seda', 0)];
  j.mao = [carta('magia_chamado_do_cemiterio', 0)];
  const r = ativarMagia(e, 0, 0);
  igual(r.ok, true);
  igual(j.zona_monstros.find(Boolean).carta.id, 'monstro_peixe_espada', 'o mais forte volta (fusões não)');
  igual(j.cemiterio.length, 3, 'saiu 1 do cemitério, entrou a magia');
});

teste('Chamado do Cemitério sem alvo falha e a carta continua na mão', () => {
  const e = cenario();
  e.jogadores[0].mao = [carta('magia_chamado_do_cemiterio', 0)];
  igual(ativarMagia(e, 0, 0).ok, false);
  igual(e.jogadores[0].mao.length, 1);
});

teste('Vento Gélido faz o oponente descartar 1 carta; sem cartas na mão não pode ser usada', () => {
  const e = cenario();
  e.jogadores[0].mao = [carta('magia_vento_gelado', 0)];
  igual(ativarMagia(e, 0, 0).ok, false, 'mão do oponente vazia');
  e.jogadores[1].mao = [carta('monstro_lula_comum', 1), carta('monstro_lula_comum', 1)];
  igual(ativarMagia(e, 0, 0).ok, true);
  igual(e.jogadores[1].mao.length, 1);
  igual(e.jogadores[1].cemiterio.length, 1);
});

teste('Névoa Enfraquecedora reduz o ATK de todos os monstros do oponente', () => {
  const e = cenario();
  const i = colocar(e, 1, 'monstro_peixe_espada');
  const k = colocar(e, 1, 'monstro_lula_comum');
  e.jogadores[0].mao = [carta('magia_nevoa_enfraquecedora', 0)];
  igual(ativarMagia(e, 0, 0).ok, true);
  igual(calcularStatsEfetivos(e, 1, i).atk, 1300);
  igual(calcularStatsEfetivos(e, 1, k).atk, 600);
});

teste('Terremoto Global destrói monstros dos dois lados', () => {
  const e = cenario();
  colocar(e, 0, 'monstro_lula_comum'); colocar(e, 1, 'monstro_lula_comum'); colocar(e, 1, 'monstro_peixe_espada');
  e.jogadores[0].mao = [carta('magia_terremoto_global', 0)];
  igual(ativarMagia(e, 0, 0).ok, true);
  igual(e.jogadores[0].zona_monstros.filter(Boolean).length + e.jogadores[1].zona_monstros.filter(Boolean).length, 0);
});

teste('Grito de Guerra dá +300 ATK a todos os seus monstros', () => {
  const e = cenario();
  const i = colocar(e, 0, 'monstro_lula_comum');
  e.jogadores[0].mao = [carta('magia_grito_de_guerra', 0)];
  ativarMagia(e, 0, 0);
  igual(calcularStatsEfetivos(e, 0, i).atk, 1300);
});

// ---------- Armadilhas novas ----------
teste('Muralha de Espelhos anula o ataque: sem dano, sem destruição, atacante não ataca de novo', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_vespa_cacadora');
  armadilha(e, 1, 'armadilha_muralha_de_espelhos');
  e.fase = 'battle';
  const log = declararAtaque(e, 0, a, null);
  igual(log.ok, true);
  igual(log.tipoResultado, 'ataque_negado');
  igual(e.jogadores[1].pontos_vida, 8000, 'sem dano');
  igual(e.jogadores[0].zona_monstros[a].jaAtacou, true, 'o ataque foi gasto');
  igual(e.jogadores[1].cemiterio.length, 1, 'armadilha foi ao cemitério');
  igual(e.estatisticas[1].armadilhasAtivadas, 1, 'estatística');
});

teste('Névoa Sombria enfraquece o atacante ANTES da batalha (o dano usa o ATK novo)', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_vespa_cacadora'); // 2200 -> 1700
  armadilha(e, 1, 'armadilha_nevoa_sombria');
  e.fase = 'battle';
  const log = declararAtaque(e, 0, a, null);
  igual(log.danoCausado, 1700);
});

teste('Selo Arcano nega a magia: ela é gasta sem efeito', () => {
  const e = cenario();
  armadilha(e, 1, 'armadilha_selo_arcano');
  e.jogadores[0].pontos_vida = 5000;
  e.jogadores[0].mao = [carta('magia_pocao_de_cura', 0)];
  const r = ativarMagia(e, 0, 0);
  igual(r.ok, true);
  igual(r.negada, true, 'negada');
  igual(e.jogadores[0].pontos_vida, 5000, 'não curou');
  igual(e.jogadores[0].cemiterio.length, 1, 'magia no cemitério');
});

teste('Selo Arcano NÃO dispara se a magia não teria efeito (a carta fica na mão)', () => {
  const e = cenario();
  armadilha(e, 1, 'armadilha_selo_arcano');
  e.jogadores[0].mao = [carta('magia_erupcao_de_luz', 0)]; // oponente sem monstros
  igual(ativarMagia(e, 0, 0).ok, false);
  igual(e.jogadores[1].zona_magias_armadilhas[0] !== null, true, 'armadilha continua armada');
});

teste('Laço de Captura destrói a fusão recém-criada', () => {
  const e = cenario();
  colocar(e, 0, 'monstro_rover_de_marte'); colocar(e, 0, 'monstro_sonda_orbital');
  armadilha(e, 1, 'armadilha_laco_de_captura');
  const r = evoluir(e, 0, 'fusao_colosso_orbital');
  igual(r.ok, true);
  igual(r.armadilhas.length, 1);
  igual(e.jogadores[0].zona_monstros.filter(Boolean).length, 0, 'a fusão foi destruída');
  igual(e.estatisticas[0].fusoes, 1, 'a fusão contou mesmo assim');
  igual(e.jogadores[1].pontos_vida, 7500, 'o Colosso causou 500 de dano ao ser destruído (efeito dele)');
});

// ---------- Fusões especiais ----------
const ESPECIAIS = Object.values(cartasPorId).filter((c) => c.condicao_especial);

teste('existem fusões especiais cobrindo vários tipos de condição', () => {
  afirmar(ESPECIAIS.length >= 7, `só ${ESPECIAIS.length} fusões especiais`);
  const tipos = new Set(ESPECIAIS.map((c) => c.condicao_especial.tipo));
  afirmar(tipos.size >= 5, `só ${tipos.size} tipos de condição diferentes`);
  for (const t of tipos) afirmar(TIPOS_CONDICAO.includes(t), `tipo desconhecido ${t}`);
});

teste('cada fusão especial: falha com a condição falsa e funciona com a condição verdadeira', () => {
  for (const f of ESPECIAIS) {
    const cond = f.condicao_especial;
    const montar = (verdadeira) => {
      const e = cenario();
      const j = e.jogadores[0];
      const op = e.jogadores[1];
      for (const req of f.requisitos_fusao) {
        const c = carta(req.id, 0);
        if (req.local === 'campo') j.zona_monstros[encontrarSlotVazio(j.zona_monstros)] = criarSlotMonstro(c, 'ataque');
        else j.mao.push(c);
      }
      // ponto de partida FALSO para cada tipo
      e.turno = 4; j.pontos_vida = 5000; op.pontos_vida = 5000; j.cemiterio = []; e.cartaCampo = null;
      if (cond.tipo === 'pv_maximo') j.pontos_vida = cond.valor + 1000;
      if (cond.tipo === 'pv_minimo') j.pontos_vida = cond.valor - 1000;
      if (cond.tipo === 'turno_minimo') e.turno = cond.valor - 2;
      if (cond.tipo === 'pv_menor_que_oponente') { j.pontos_vida = 6000; op.pontos_vida = 5000; }
      if (cond.tipo === 'campo_ativo') e.cartaCampo = carta('campo_cidade_antiga', 0);
      if (cond.tipo === 'monstros_minimo') { /* nada */ }
      if (verdadeira) {
        if (cond.tipo === 'pv_maximo' || cond.tipo === 'pv_minimo') j.pontos_vida = cond.valor;
        if (cond.tipo === 'turno_minimo') e.turno = cond.valor;
        if (cond.tipo === 'pv_menor_que_oponente') { j.pontos_vida = 3000; op.pontos_vida = 5000; }
        if (cond.tipo === 'cemiterio_minimo') for (let i = 0; i < cond.valor; i++) j.cemiterio.push(carta('monstro_lula_comum', 0));
        if (cond.tipo === 'campo_ativo') e.cartaCampo = carta(cond.id, 0);
      }
      return e;
    };
    if (cond.tipo !== 'monstros_minimo') {
      const falso = podeEvoluir(montar(false), 0, f.id);
      afirmar(!falso.ok, `${f.id}: deveria falhar com a condição falsa`);
      afirmar(falso.motivo.includes('Condição especial'), `${f.id}: o motivo deveria citar a condição (${falso.motivo})`);
    }
    const e = montar(true);
    const r = evoluir(e, 0, f.id);
    afirmar(r.ok, `${f.id}: ${r.motivo}`);
    igual(e.estatisticas[0].fusoesEspeciais, 1, `${f.id}: estatística de fusão especial`);
  }
});

teste('verificarCondicaoEspecial: sem condição sempre vale', () => {
  igual(verificarCondicaoEspecial(cenario(), 0, undefined).ok, true);
});

// ---------- Estatísticas ----------
teste('estatísticas: ataque direto soma dano sofrido; destruir monstro soma perdas; fusão comum não é especial', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_vespa_cacadora');
  e.fase = 'battle';
  declararAtaque(e, 0, a, null);
  igual(e.estatisticas[1].danoDiretoSofrido, 2200);
  igual(e.estatisticas[0].danoDiretoSofrido, 0);

  const f = cenario();
  const x = colocar(f, 0, 'monstro_rover_de_marte'); colocar(f, 0, 'monstro_sonda_orbital');
  igual(evoluir(f, 0, 'fusao_colosso_orbital').ok, true);
  igual(f.estatisticas[0].fusoes, 1);
  igual(f.estatisticas[0].fusoesEspeciais, 0);

  const g = cenario();
  const p = colocar(g, 0, 'monstro_lula_comum');
  const q = colocar(g, 1, 'monstro_vespa_cacadora');
  g.jogadorDaVez = 1; g.fase = 'battle';
  declararAtaque(g, 1, q, p);
  igual(g.estatisticas[0].monstrosPerdidos, 1);
});

resumo();
