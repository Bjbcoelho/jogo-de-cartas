// historia.js
// ---------------------------------------------------------------
// Regras do Modo História (PvE), SEM interface: dá para testar no Node.
//
//   * Uma "fase" tem um oponente (deck, nível da IA, PV inicial, cartas extras) e uma lista de OBJETIVOS.
//   * A fase só conta como concluída se o jogador VENCER e cumprir TODOS os objetivos.
//   * Os objetivos olham as estatísticas que o motor guarda em estado.estatisticas[0] (o jogador humano).
//
// Tipos de objetivo (campo "tipo"):
//   vencer               -> ganhar o duelo
//   fusoes               -> fazer pelo menos "valor" fusões
//   fusoes_especiais     -> fazer pelo menos "valor" fusões que têm condição especial
//   sem_dano_direto      -> nunca sofrer dano de ataque direto
//   sem_perder_monstros  -> nenhum monstro seu pode ser destruído
//   em_turnos            -> vencer em até "valor" turnos SEUS
//   pv_minimo            -> terminar com pelo menos "valor" PV
//   armadilhas           -> ativar pelo menos "valor" armadilhas
// ---------------------------------------------------------------

export const JOGADOR = 0; // o humano é sempre o jogador 0

// Quantos turnos o jogador já teve (o contador do estado conta os dois jogadores).
export function turnosDoJogador(estado, id = JOGADOR) {
  const t = estado.turno;
  return estado.jogadorInicial === id ? Math.ceil(t / 2) : Math.floor(t / 2);
}

function stats(estado, id = JOGADOR) {
  return estado.estatisticas?.[id] ?? {};
}

// Texto do objetivo, como aparece na tela.
export function descreverObjetivo(obj) {
  switch (obj.tipo) {
    case 'vencer': return 'Vencer o duelo';
    case 'fusoes': return `Fazer ${obj.valor} ${obj.valor === 1 ? 'fusão' : 'fusões'}`;
    case 'fusoes_especiais': return `Fazer ${obj.valor} fusão(ões) especial(is)`;
    case 'sem_dano_direto': return 'Não sofrer nenhum ataque direto';
    case 'sem_perder_monstros': return 'Não perder nenhum monstro';
    case 'em_turnos': return `Vencer em até ${obj.valor} turnos seus`;
    case 'pv_minimo': return `Terminar com pelo menos ${obj.valor} PV`;
    case 'armadilhas': return `Ativar ${obj.valor} armadilha(s)`;
    default: return `Objetivo desconhecido (${obj.tipo})`;
  }
}

// Avalia UM objetivo no estado atual. Devolve:
//   cumprido: já está garantido agora        falhou: não tem mais como cumprir
//   progresso: texto curto para o HUD (ex.: "1/2")
// "fim" = o duelo já terminou (alguns objetivos só valem no final).
export function avaliarObjetivo(estado, obj, fim = estado.vencedor !== null) {
  const s = stats(estado);
  const venceu = estado.vencedor === JOGADOR;
  const pv = estado.jogadores[JOGADOR].pontos_vida;
  const contagem = (campo) => {
    const n = s[campo] ?? 0;
    return { cumprido: n >= obj.valor, falhou: fim && n < obj.valor, progresso: `${Math.min(n, obj.valor)}/${obj.valor}` };
  };
  switch (obj.tipo) {
    case 'vencer':
      return { cumprido: venceu, falhou: fim && !venceu, progresso: venceu ? 'ok' : '' };
    case 'fusoes': return contagem('fusoes');
    case 'fusoes_especiais': return contagem('fusoesEspeciais');
    case 'armadilhas': return contagem('armadilhasAtivadas');
    case 'sem_dano_direto': {
      const dano = s.danoDiretoSofrido ?? 0;
      return { cumprido: fim && dano === 0, falhou: dano > 0, progresso: dano > 0 ? `${dano} de dano` : 'ok' };
    }
    case 'sem_perder_monstros': {
      const n = s.monstrosPerdidos ?? 0;
      return { cumprido: fim && n === 0, falhou: n > 0, progresso: n > 0 ? `${n} perdido(s)` : 'ok' };
    }
    case 'em_turnos': {
      const t = turnosDoJogador(estado);
      return { cumprido: venceu && t <= obj.valor, falhou: t > obj.valor || (fim && !venceu), progresso: `turno ${Math.min(t, obj.valor)}/${obj.valor}` };
    }
    case 'pv_minimo':
      return { cumprido: fim && venceu && pv >= obj.valor, falhou: pv < obj.valor, progresso: `${pv} PV` };
    default:
      return { cumprido: false, falhou: true, progresso: '?' };
  }
}

// Avalia a fase inteira. "concluida" só é true se o jogador venceu e TODOS os objetivos foram cumpridos.
export function avaliarFase(fase, estado) {
  const fim = estado.vencedor !== null;
  const objetivos = fase.objetivos.map((obj) => ({ obj, texto: descreverObjetivo(obj), ...avaliarObjetivo(estado, obj, fim) }));
  const venceu = estado.vencedor === JOGADOR;
  return {
    fim,
    venceu,
    objetivos,
    concluida: fim && venceu && objetivos.every((o) => o.cumprido),
  };
}

// ---------------- Progresso salvo ----------------
// "armazenamento" é qualquer objeto com getItem/setItem (localStorage no navegador, um falso nos testes).
export const CHAVE_PROGRESSO = 'rbc_historia_v1';

export function lerProgresso(armazenamento) {
  try {
    const texto = armazenamento?.getItem(CHAVE_PROGRESSO);
    if (texto) {
      const p = JSON.parse(texto);
      if (Array.isArray(p.concluidas)) return { concluidas: p.concluidas };
    }
  } catch (erro) {
    // sem armazenamento ou texto inválido: começa do zero
  }
  return { concluidas: [] };
}

export function salvarProgresso(armazenamento, progresso) {
  try {
    armazenamento?.setItem(CHAVE_PROGRESSO, JSON.stringify(progresso));
  } catch (erro) {
    // não conseguiu salvar: o jogo segue, mas o progresso vale só nesta sessão
  }
}

// A primeira fase está sempre liberada; cada fase seguinte libera quando a anterior foi concluída.
export function faseLiberada(fases, progresso, indice) {
  return indice === 0 || progresso.concluidas.includes(fases[indice - 1].id);
}

// Marca uma fase como concluída (sem duplicar) e devolve o progresso novo.
export function concluirFase(progresso, idFase) {
  return progresso.concluidas.includes(idFase) ? progresso : { concluidas: [...progresso.concluidas, idFase] };
}

// Valida o conteúdo do historia.json (usado nos testes). Devolve a lista de problemas.
export function validarHistoria(historia, idsDecks = ['aleatorio']) {
  const erros = [];
  const tiposValidos = ['vencer', 'fusoes', 'fusoes_especiais', 'sem_dano_direto', 'sem_perder_monstros', 'em_turnos', 'pv_minimo', 'armadilhas'];
  const ids = new Set();
  let nivelAnterior = 0;
  for (const f of historia.fases) {
    if (ids.has(f.id)) erros.push(`${f.id}: id repetido`);
    ids.add(f.id);
    if (!f.nome || !f.historia || !f.conclusao) erros.push(`${f.id}: falta nome, historia ou conclusao`);
    if (!idsDecks.includes(f.oponente?.deck)) erros.push(`${f.id}: deck "${f.oponente?.deck}" não existe`);
    const nivel = f.oponente?.nivel;
    if (!(nivel >= 1 && nivel <= 5)) erros.push(`${f.id}: nível da IA fora de 1 a 5`);
    if (nivel < nivelAnterior) erros.push(`${f.id}: a dificuldade diminuiu (nível ${nivel} depois de ${nivelAnterior})`);
    nivelAnterior = nivel ?? nivelAnterior;
    if (!f.objetivos?.some((o) => o.tipo === 'vencer')) erros.push(`${f.id}: todo objetivo precisa incluir "vencer"`);
    for (const o of f.objetivos ?? []) {
      if (!tiposValidos.includes(o.tipo)) erros.push(`${f.id}: tipo de objetivo "${o.tipo}" inválido`);
      if (['fusoes', 'fusoes_especiais', 'em_turnos', 'pv_minimo', 'armadilhas'].includes(o.tipo) && !(o.valor > 0)) erros.push(`${f.id}: objetivo "${o.tipo}" precisa de "valor"`);
    }
  }
  return erros;
}
