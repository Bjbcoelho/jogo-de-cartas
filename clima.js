// clima.js — CLIMA DO CAMPO (partículas, vento, brilho do sol e profundidade)
// ---------------------------------------------------------------
// Dá vida ao fundo panorâmico de cada cenário:
//   • Duas camadas de partículas desenhadas num <canvas>: uma ATRÁS do tabuleiro e outra
//     NA FRENTE dele (bem fraquinha, só para dar profundidade).
//   • Poeira de Marte, neve de Europa, vaga-lumes da floresta, brasas do sol, folhas, etc.
//   • Rajadas de vento: forcaVento() devolve a força do vento agora (0 a 1). A poeira usa isso
//     para acelerar, e o ambiente.js usa para o som do vento acompanhar.
//   • Brilho e reflexos de lente no ponto do sol (nos cenários que têm sol).
//   • Parallax: o fundo e o tabuleiro se mexem um pouquinho com o mouse (efeito de profundidade).
//   • Qualidade Alta/Média/Baixa controla quantas partículas existem.
// Tudo respeita "reduzir movimento" do sistema (aí o clima fica parado).
// ---------------------------------------------------------------

const QUALIDADES = { alta: 1, media: 0.55, baixa: 0.22 };

// Posição do sol/astro na imagem de fundo (fração da largura e da altura), igual ao gerar_fundos.py.
const SOL = {
  marte: [0.80, 0.17], terra: [0.22, 0.15], floresta: [0.80, 0.19], cidade: [0.24, 0.17], solar: [0.50, 0.25],
};

// Cada cenário é uma lista de "camadas" de partículas. t = tipo; n = quantidade; cor = [r,g,b];
// v = velocidade [x,y] em px/s; r = raio; a = opacidade; vento = quanto a rajada afeta (0 a 1).
const CLIMAS = {
  padrao: {
    fundo: [{ t: 'ponto', n: 60, cor: [160, 210, 255], v: [3, -9], r: [1, 2.8], a: [0.25, 0.8], pisca: 0.6 }],
    frente: [],
  },
  marte: {
    fundo: [
      { t: 'risco', n: 120, cor: [255, 196, 140], v: [300, 24], c: [26, 110], r: [0.7, 1.9], a: [0.12, 0.5], vento: 1 },
      { t: 'ponto', n: 45, cor: [255, 214, 170], v: [70, 4], r: [0.8, 1.9], a: [0.2, 0.5], vento: 0.7 },
    ],
    frente: [{ t: 'nevoa', n: 7, cor: [235, 120, 60], v: [38, 0], r: [170, 330], a: [0.04, 0.10], vento: 0.9 }],
  },
  terra: {
    fundo: [{ t: 'ponto', n: 30, cor: [255, 255, 230], v: [10, -4], r: [0.8, 1.8], a: [0.15, 0.5], pisca: 0.8 }],
    frente: [{ t: 'nevoa', n: 5, cor: [255, 255, 255], v: [16, 0], r: [200, 380], a: [0.035, 0.08], vento: 0.3 }],
  },
  europa: {
    fundo: [
      { t: 'neve', n: 130, cor: [235, 250, 255], v: [-8, 40], r: [0.8, 2.4], a: [0.3, 0.85], vento: 0.5 },
      { t: 'ponto', n: 26, cor: [190, 240, 255], v: [0, 0], r: [1, 2.4], a: [0.2, 0.9], pisca: 1.6 },
    ],
    frente: [{ t: 'neve', n: 14, cor: [240, 252, 255], v: [-14, 74], r: [2.6, 4.4], a: [0.18, 0.4], vento: 0.6 }],
  },
  floresta: {
    fundo: [
      { t: 'vagalume', n: 40, cor: [215, 255, 120], v: [10, 10], r: [2.6, 5.2], a: [0.4, 1], pisca: 0.9 },
      { t: 'folha', n: 22, cor: [150, 190, 70], v: [22, 34], r: [3, 6], a: [0.4, 0.8], vento: 0.6 },
    ],
    frente: [{ t: 'nevoa', n: 5, cor: [200, 235, 140], v: [14, 0], r: [200, 360], a: [0.03, 0.07], vento: 0.2 }],
  },
  cidade: {
    fundo: [
      { t: 'risco', n: 50, cor: [255, 225, 160], v: [170, 10], c: [14, 56], r: [0.6, 1.5], a: [0.1, 0.35], vento: 1 },
      { t: 'ponto', n: 50, cor: [255, 226, 160], v: [14, -12], r: [0.8, 2.2], a: [0.2, 0.6], pisca: 0.5 },
    ],
    frente: [{ t: 'nevoa', n: 5, cor: [255, 190, 100], v: [24, 0], r: [180, 340], a: [0.035, 0.08], vento: 0.7 }],
  },
  solar: {
    fundo: [
      { t: 'brasa', n: 100, cor: [255, 170, 60], v: [8, -62], r: [1, 3], a: [0.4, 1] },
      { t: 'ponto', n: 20, cor: [255, 240, 170], v: [0, -14], r: [1.4, 3], a: [0.2, 0.6], pisca: 1.2 },
    ],
    frente: [{ t: 'nevoa', n: 6, cor: [255, 140, 40], v: [18, -6], r: [200, 380], a: [0.04, 0.10], vento: 0.4 }],
  },
};

const rand = (a, b) => a + Math.random() * (b - a);

// ---------- Vento ----------
// Soma de ondas lentas: dá rajadas que sobem e descem de forma irregular (sempre entre 0 e 1).
export function forcaVento(agora = performance.now() / 1000) {
  const v = 0.5 + 0.28 * Math.sin(agora * 0.37) + 0.17 * Math.sin(agora * 0.91 + 1.3) + 0.12 * Math.sin(agora * 0.13 + 4);
  return Math.min(1, Math.max(0, v));
}

// ---------- Estado do módulo ----------
let mesa = null, cFundo = null, cFrente = null, xFundo = null, xFrente = null;
let cenario = 'padrao';
let qualidade = 'alta';
let particulas = { fundo: [], frente: [] };
let rodando = false, quadro = 0, ultimo = 0, fade = 1, alvoFade = 1;
let proximoCenario = null;
let largura = 0, altura = 0, escalaTela = 1;
let paralaxeAlvo = [0, 0], paralaxe = [0, 0];
let custoMedio = 0; // custo (ms) de desenhar um quadro, para os testes
const sprites = new Map();
const reduzirMovimento = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Bolinha de brilho pré-desenhada (desenhar a imagem é bem mais barato do que um degradê a cada partícula).
function sprite(cor, forma = 'brilho') {
  const chave = `${forma}-${cor.join(',')}`;
  if (sprites.has(chave)) return sprites.get(chave);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  const [r, gr, b] = cor;
  if (forma === 'nevoa') {
    g.addColorStop(0, `rgba(${r},${gr},${b},0.9)`);
    g.addColorStop(0.5, `rgba(${r},${gr},${b},0.35)`);
    g.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  } else {
    g.addColorStop(0, `rgba(${r},${gr},${b},1)`);
    g.addColorStop(0.25, `rgba(${r},${gr},${b},0.55)`);
    g.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  }
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  sprites.set(chave, c);
  return c;
}

function criarParticula(camada, inicial) {
  const p = {
    c: camada,
    x: Math.random() * largura, y: Math.random() * altura,
    r: rand(camada.r[0], camada.r[1]), a: rand(camada.a[0], camada.a[1]),
    fase: Math.random() * 6.28, vida: Math.random(),
    vx: camada.v[0] * rand(0.6, 1.4), vy: camada.v[1] * rand(0.6, 1.4),
    comp: camada.c ? rand(camada.c[0], camada.c[1]) : 0,
    ang: Math.random() * 6.28, giro: rand(-2, 2),
  };
  if (!inicial) {
    if (camada.t === 'risco' || camada.t === 'nevoa') p.x = -p.comp - (camada.r?.[1] ?? 0);
    if (camada.t === 'neve' || camada.t === 'folha') p.y = -10;
    if (camada.t === 'brasa') p.y = altura + 10;
  }
  return p;
}

function montarParticulas() {
  const fator = QUALIDADES[qualidade] ?? 1;
  const cfg = CLIMAS[cenario] ?? CLIMAS.padrao;
  const monta = (camadas) => camadas.flatMap((c) => Array.from({ length: Math.round(c.n * fator * (c.t === 'nevoa' ? Math.max(0.5, fator) : 1)) }, () => criarParticula(c, true)));
  particulas = { fundo: monta(cfg.fundo), frente: qualidade === 'baixa' ? [] : monta(cfg.frente) };
}

// ---------- Desenho ----------
function atualizarEDesenhar(ctx, lista, dt, t, vento) {
  for (const p of lista) {
    const c = p.c;
    const v = c.vento ? 1 + vento * 2.2 * c.vento : 1;
    p.x += p.vx * v * dt;
    p.y += p.vy * dt;
    let alfa = p.a * fade;
    switch (c.t) {
      case 'risco': {
        // Risco de poeira soprada: uma linha curta no sentido do vento.
        const dir = Math.hypot(p.vx, p.vy) || 1;
        const comp = p.comp * (0.6 + vento * 0.8);
        ctx.globalAlpha = alfa * (0.55 + vento * 0.6);
        ctx.strokeStyle = `rgb(${c.cor})`;
        ctx.lineWidth = p.r;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - (p.vx / dir) * comp, p.y - (p.vy / dir) * comp);
        ctx.stroke();
        if (p.x - comp > largura) { p.x = -comp; p.y = Math.random() * altura; }
        if (p.y > altura + 20) p.y = -10;
        break;
      }
      case 'neve': {
        p.x += Math.sin(t * 0.9 + p.fase) * 14 * dt;
        ctx.globalAlpha = alfa;
        ctx.drawImage(sprite(c.cor), p.x - p.r * 2, p.y - p.r * 2, p.r * 4, p.r * 4);
        if (p.y > altura + 10) { p.y = -10; p.x = Math.random() * largura; }
        if (p.x < -10) p.x = largura + 10; else if (p.x > largura + 10) p.x = -10;
        break;
      }
      case 'ponto': {
        const pisca = c.pisca ? 0.5 + 0.5 * Math.sin(t * c.pisca * 2.4 + p.fase) : 1;
        ctx.globalAlpha = alfa * (0.25 + 0.75 * pisca);
        ctx.drawImage(sprite(c.cor), p.x - p.r * 3, p.y - p.r * 3, p.r * 6, p.r * 6);
        if (p.x > largura + 10) p.x = -10; else if (p.x < -10) p.x = largura + 10;
        if (p.y < -10) p.y = altura + 10; else if (p.y > altura + 10) p.y = -10;
        break;
      }
      case 'vagalume': {
        // Voa de forma errante e acende/apaga devagar.
        p.ang += rand(-1, 1) * 2.2 * dt;
        p.x += Math.cos(p.ang) * 16 * dt;
        p.y += Math.sin(p.ang) * 12 * dt;
        const brilho = Math.max(0, Math.sin(t * c.pisca * 1.6 + p.fase)) ** 2;
        ctx.globalAlpha = alfa * brilho;
        ctx.drawImage(sprite(c.cor), p.x - p.r * 4, p.y - p.r * 4, p.r * 8, p.r * 8);
        if (p.x < -20) p.x = largura + 20; else if (p.x > largura + 20) p.x = -20;
        if (p.y < -20) p.y = altura + 20; else if (p.y > altura + 20) p.y = -20;
        break;
      }
      case 'folha': {
        p.ang += p.giro * dt;
        p.x += Math.sin(t * 1.3 + p.fase) * 18 * dt;
        ctx.globalAlpha = alfa;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.ang);
        ctx.fillStyle = `rgb(${c.cor})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.45, 0, 0, 6.28);
        ctx.fill();
        ctx.restore();
        if (p.y > altura + 10) { p.y = -10; p.x = Math.random() * largura; }
        if (p.x > largura + 10) p.x = -10;
        break;
      }
      case 'brasa': {
        p.vida += dt * 0.25;
        p.x += Math.sin(t * 2 + p.fase) * 12 * dt;
        const cintila = 0.6 + 0.4 * Math.sin(t * 9 + p.fase * 3);
        ctx.globalAlpha = alfa * cintila * Math.max(0, 1 - p.y / altura * 0.6);
        ctx.drawImage(sprite(c.cor), p.x - p.r * 2.5, p.y - p.r * 2.5, p.r * 5, p.r * 5);
        if (p.y < -10) { p.y = altura + 10; p.x = Math.random() * largura; }
        break;
      }
      case 'nevoa': {
        const pulsa = 0.7 + 0.3 * Math.sin(t * 0.4 + p.fase);
        ctx.globalAlpha = alfa * pulsa;
        const tam = p.r * 2;
        ctx.drawImage(sprite(c.cor, 'nevoa'), p.x - p.r, p.y - p.r, tam, tam * 0.55);
        if (p.x - p.r > largura) { p.x = -p.r * 2; p.y = Math.random() * altura; }
        if (p.x + p.r < -p.r * 2) p.x = largura + p.r;
        break;
      }
      default:
    }
  }
  ctx.globalAlpha = 1;
}

// Brilho do sol + reflexos de lente (fantasmas ao longo da linha sol → centro da tela).
function desenharSol(ctx, t) {
  const sol = SOL[cenario];
  if (!sol || fade < 0.05) return;
  const s = Math.max(largura / 1920, altura / 1080);          // mesmo "cover" do CSS
  const imgW = 1920 * s, imgH = 1080 * s;
  const sx = (largura - imgW) / 2 + sol[0] * imgW + paralaxe[0] * -10;
  const sy = altura - imgH + sol[1] * imgH + paralaxe[1] * -6;
  const pulso = 0.85 + 0.15 * Math.sin(t * 0.8);
  ctx.globalCompositeOperation = 'lighter';
  const grande = Math.max(largura, altura) * 0.5;
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, grande);
  g.addColorStop(0, `rgba(255,235,190,${0.34 * pulso * fade})`);
  g.addColorStop(0.18, `rgba(255,190,110,${0.14 * pulso * fade})`);
  g.addColorStop(1, 'rgba(255,160,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, largura, altura);
  // fantasmas da lente
  const cx = largura / 2, cy = altura / 2;
  for (const [k, raio, alfa] of [[0.55, 0.05, 0.10], [1.05, 0.09, 0.06], [1.45, 0.035, 0.09], [1.9, 0.12, 0.04]]) {
    const gx = sx + (cx - sx) * k, gy = sy + (cy - sy) * k;
    const r = Math.min(largura, altura) * raio;
    const gg = ctx.createRadialGradient(gx, gy, r * 0.5, gx, gy, r);
    gg.addColorStop(0, 'rgba(255,220,160,0)');
    gg.addColorStop(0.8, `rgba(255,210,150,${alfa * fade})`);
    gg.addColorStop(1, 'rgba(255,210,150,0)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, 6.28);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function desenharQuadro(agora, dt) {
  const t0 = performance.now();
  const t = agora / 1000;
  const vento = forcaVento(t);
  xFundo.clearRect(0, 0, largura, altura);
  xFrente.clearRect(0, 0, largura, altura);
  atualizarEDesenhar(xFundo, particulas.fundo, dt, t, vento);
  if (qualidade !== 'baixa') {
    atualizarEDesenhar(xFrente, particulas.frente, dt, t, vento);
    desenharSol(xFrente, t);
  }
  custoMedio = custoMedio * 0.9 + (performance.now() - t0) * 0.1;
}

function laco(agora) {
  if (!rodando) return;
  requestAnimationFrame(laco);
  if (document.hidden || !mesa || mesa.offsetParent === null) { ultimo = agora; return; }
  // Qualidade baixa: 30 quadros por segundo.
  quadro += 1;
  if (qualidade === 'baixa' && quadro % 2) return;
  const dt = Math.min(0.1, (agora - ultimo) / 1000 || 0.016);
  ultimo = agora;

  // Transição entre cenários: o clima atual some, troca, e o novo aparece.
  if (proximoCenario !== null) {
    fade = Math.max(0, fade - dt * 2.5);
    if (fade === 0) { cenario = proximoCenario; proximoCenario = null; montarParticulas(); alvoFade = 1; }
  } else if (fade < alvoFade) {
    fade = Math.min(alvoFade, fade + dt * 1.2);
  }

  // Parallax suave (só mexe quando o mouse mexeu).
  paralaxe[0] += (paralaxeAlvo[0] - paralaxe[0]) * Math.min(1, dt * 4);
  paralaxe[1] += (paralaxeAlvo[1] - paralaxe[1]) * Math.min(1, dt * 4);
  if (Math.abs(paralaxeAlvo[0] - paralaxe[0]) + Math.abs(paralaxeAlvo[1] - paralaxe[1]) > 0.0008) aplicarParalaxe();
  desenharQuadro(agora, dt);
}

function aplicarParalaxe() {
  const [px, py] = paralaxe;
  const camadas = document.getElementById('cenarios');
  if (camadas) camadas.style.translate = `${(px * -16).toFixed(2)}px ${(py * -9).toFixed(2)}px`;
  const tab = document.getElementById('tabuleiro');
  if (tab) tab.style.setProperty('--incl-x', `${(py * -0.9).toFixed(3)}deg`), tab.style.setProperty('--incl-y', `${(px * 1.4).toFixed(3)}deg`);
}

function ajustarTamanho() {
  if (!mesa) return;
  const r = mesa.getBoundingClientRect();
  if (r.width === 0) return;
  escalaTela = Math.min(window.devicePixelRatio || 1, 1.5);
  largura = Math.round(r.width);
  altura = Math.round(r.height);
  for (const c of [cFundo, cFrente]) {
    c.width = Math.round(largura * escalaTela);
    c.height = Math.round(altura * escalaTela);
    c.getContext('2d').setTransform(escalaTela, 0, 0, escalaTela, 0, 0);
  }
  montarParticulas();
}

// ---------- API ----------
export function iniciarClima(elementoMesa) {
  if (mesa) return;
  mesa = elementoMesa;
  const criar = (id, z) => {
    const c = document.createElement('canvas');
    c.id = id;
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${z};`;
    mesa.appendChild(c);
    return c;
  };
  cFundo = criar('clima-fundo', 0);
  cFrente = criar('clima-frente', 6);
  xFundo = cFundo.getContext('2d');
  xFrente = cFrente.getContext('2d');
  // O fundo fica depois das camadas de cenário/atmosfera, mas antes do tabuleiro.
  mesa.insertBefore(cFundo, document.getElementById('palco'));
  ajustarTamanho();
  window.addEventListener('resize', ajustarTamanho);
  mesa.addEventListener('mousemove', (ev) => {
    const r = mesa.getBoundingClientRect();
    paralaxeAlvo = [((ev.clientX - r.left) / r.width - 0.5) * 2, ((ev.clientY - r.top) / r.height - 0.5) * 2];
  });
  mesa.addEventListener('mouseleave', () => { paralaxeAlvo = [0, 0]; });
  if (!reduzirMovimento) { rodando = true; ultimo = performance.now(); requestAnimationFrame(laco); }
}

export function definirCenarioClima(nome) {
  if (!CLIMAS[nome]) nome = 'padrao';
  if (nome === cenario && proximoCenario === null) return;
  if (!mesa || reduzirMovimento) { cenario = nome; if (mesa) montarParticulas(); return; }
  proximoCenario = nome;
}

export function definirQualidade(q) {
  qualidade = QUALIDADES[q] ? q : 'alta';
  if (mesa) montarParticulas();
}

export function infoClima() {
  return { cenario, qualidade, particulas: particulas.fundo.length + particulas.frente.length, custoMs: custoMedio, rodando };
}

// Para testes: desenha N quadros seguidos e devolve o custo médio em milissegundos.
export function medirCustoClima(quadros = 60) {
  if (!mesa) return null;
  ajustarTamanho();
  const ini = performance.now();
  for (let i = 0; i < quadros; i++) desenharQuadro(ini + i * 16, 0.016);
  return (performance.now() - ini) / quadros;
}
