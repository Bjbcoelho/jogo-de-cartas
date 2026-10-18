// fusao_animacoes.js
// ---------------------------------------------------------------
// Animação de fusão no estilo Yu-Gi-Oh! Forbidden Memories (PS1):
//   1) os materiais entram na tela e giram em órbita ao redor do centro, cada vez mais rápido;
//   2) um redemoinho de energia puxa as cartas para o meio;
//   3) elas colidem num clarão;
//   4) a carta evoluída surge girando e dá o zoom final, com o nome em destaque.
//
// Cada deck tem a sua "pele" (o que é desenhado no fundo): marciano = poeira/ferrugem em vórtice;
// humanos = blueprint azul, engrenagens e solda elétrica. A coreografia das cartas é a mesma.
//
// Este módulo NÃO mexe no estado do jogo: a ui.js chama tocarAnimacaoFusao() depois que a regra já
// foi aplicada e espera a Promise terminar. Clique ou qualquer tecla pula a animação.
// Modos: "completa" | "muda" (sem som) | "desligada".
// ---------------------------------------------------------------
import { audio, ruido, tom, sonsAtivos } from './sons.js';


const PX = 4; // cada "pixel" do canvas vale 4 pixels da tela

// Linha do tempo (milissegundos).
const T = {
  entrada: 1100,   // fim da entrada dos materiais
  convergir: 3500, // começa a puxar as cartas para o centro
  choque: 3800,    // clarão: os materiais colidem e a fusão aparece
  nome: 4300,      // faixa com o nome
  saida: 5800,     // começa a sumir
  total: 6400,
};

const TEMAS = { marciano: true, humanos: true };

// ---------- Utilidades ----------
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
const suave = (u) => u * u * (3 - 2 * u);
const sair = (u) => 1 - (1 - u) ** 3; // ease-out

// ---------- Estilos (injetados uma vez) ----------
let estiloInjetado = false;
function injetarEstilo() {
  if (estiloInjetado) return;
  estiloInjetado = true;
  const css = `
  #anim-fusao { position: fixed; inset: 0; z-index: 90; overflow: hidden; cursor: pointer; }
  #anim-fusao canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
  #anim-fusao .carta-anim { position: absolute; left: 50%; top: 50%; pointer-events: none; will-change: transform, opacity; }
  #anim-fusao .carta-anim .carta { margin: 0; }
  #anim-fusao .holo::after { /* linhas de varredura do holograma */
    content: ''; position: absolute; inset: 0; pointer-events: none; mix-blend-mode: overlay;
    background: repeating-linear-gradient(0deg, rgba(255,255,255,.3) 0 2px, rgba(0,0,0,0) 2px 5px);
  }
  #anim-fusao .nome {
    position: absolute; left: 0; right: 0; top: 74%; text-align: center; pointer-events: none;
    font: 900 clamp(22px, 4vw, 54px)/1 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #fff;
    transform: skewX(-12deg); opacity: 0; text-shadow: 0 0 18px var(--anim-brilho), 3px 3px 0 var(--anim-brilho);
  }
  #anim-fusao .nome small { display: block; font-size: .32em; letter-spacing: .3em; margin-bottom: .5em; color: var(--anim-brilho); }
  #anim-fusao .pular { position: absolute; right: 16px; bottom: 12px; color: rgba(255,255,255,.55); font: 12px system-ui, sans-serif; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { #anim-fusao .holo::after { display: none; } }
  `;
  const tag = document.createElement('style');
  tag.textContent = css;
  document.head.appendChild(tag);
}

// ---------- Som: os "tijolos" (audio, ruido, tom) ficam em sons.js, compartilhados com a ui.js ----------

// Os sons foram pensados para durar ~1,3 s e terminar no clarão. Como a animação agora é mais longa,
// eles começam mais tarde (o "atraso") para que o impacto caia exatamente em T.choque.

// Ignição térmica: ronco grave + subida de motor + "ting" metálico no clarão.
function somMarciano(ac, atraso) {
  const t0 = ac.currentTime + atraso;
  ruido(ac, t0, 1.2, 'lowpass', 300, 0.5, 1800);
  tom(ac, t0, 1.1, 'sawtooth', 70, 420, 0.12);
  tom(ac, t0 + 1.05, 0.9, 'sine', 880, 870, 0.18);
  tom(ac, t0 + 1.05, 0.9, 'sine', 1320, 1300, 0.1);
  tom(ac, t0 + 1.05, 0.5, 'square', 220, 55, 0.12);
  ruido(ac, t0 + 1.05, 0.5, 'bandpass', 2500, 0.25);
}

// Encaixe industrial: "clacks", engrenagem girando e solda elétrica.
function somHumanos(ac, atraso) {
  const t0 = ac.currentTime + atraso;
  [0.25, 0.65, 1.05].forEach((dt) => {
    ruido(ac, t0 + dt, 0.07, 'bandpass', 2200, 0.5);
    tom(ac, t0 + dt, 0.12, 'square', 320, 140, 0.15);
  });
  tom(ac, t0 + 0.2, 1.1, 'sawtooth', 90, 260, 0.06);
  ruido(ac, t0 + 1.35, 0.45, 'highpass', 3500, 0.35);
  tom(ac, t0 + 1.35, 0.4, 'sawtooth', 2000, 5000, 0.07);
  tom(ac, t0 + 1.35, 0.3, 'square', 120, 60, 0.12);
}

// ---------- Desenho em pixels ----------
function circuloPixel(ctx, cx, cy, r, cor, espessura = 1) {
  ctx.fillStyle = cor;
  const passos = Math.max(16, Math.floor(r * 6));
  for (let i = 0; i < passos; i++) {
    const a = (i / passos) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), espessura, espessura);
  }
}

function engrenagem(ctx, cx, cy, r, dentes, angulo, cor) {
  if (r < 1) return;
  circuloPixel(ctx, cx, cy, r, cor, 1);
  circuloPixel(ctx, cx, cy, r * 0.45, cor, 1);
  ctx.fillStyle = cor;
  for (let i = 0; i < dentes; i++) {
    const a = angulo + (i / dentes) * Math.PI * 2;
    for (let k = 0; k < 3; k++) ctx.fillRect(Math.round(cx + Math.cos(a) * (r + k)), Math.round(cy + Math.sin(a) * (r + k)), 2, 2);
  }
}

// Brilho central: um disco que cresce enquanto as cartas se aproximam.
function brilhoCentral(ctx, cx, cy, raio, rgb, alfa) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, raio));
  g.addColorStop(0, `rgba(${rgb},${alfa})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

// Faíscas em cruz (brilhos de estrela) ao redor da carta nova.
function estrelas(ctx, cx, cy, t, cor, W, H) {
  const u0 = t - T.choque;
  if (u0 < 0 || t > T.saida) return;
  for (let i = 0; i < 26; i++) {
    const a = i * 2.399963; // ângulo áureo: espalha sem repetir
    const r = (0.12 + ((i * 37) % 100) / 100 * 0.38) * Math.min(W, H);
    const piscar = Math.sin(u0 / 140 + i * 1.7);
    if (piscar < 0.2) continue;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r * 0.8);
    const s = 1 + (piscar > 0.8 ? 2 : 1);
    ctx.fillStyle = cor;
    ctx.fillRect(x - s, y, s * 2 + 1, 1);
    ctx.fillRect(x, y - s, 1, s * 2 + 1);
  }
}

// ---------- Temas (só o fundo; as cartas são comuns aos dois) ----------

function temaMarciano(W, H) {
  const cores = ['#ff7a3d', '#c1440e', '#8b2e0b', '#ffcf99', '#e8a56b', '#6b2208'];
  const maxR = Math.hypot(W, H) / 2;
  const poeira = Array.from({ length: 300 }, () => ({
    a0: Math.random() * Math.PI * 2, r0: maxR * (0.12 + Math.random() * 0.85),
    giros: 0.7 + Math.random() * 0.8, cor: cores[(Math.random() * cores.length) | 0], tam: 1 + ((Math.random() * 3) | 0),
    sai: Math.random() * Math.PI * 2, veloc: 0.05 + Math.random() * 0.2,
  }));
  return {
    brilho: '#ff7a3d', brilhoCarta: 'drop-shadow(0 0 26px #ff7a3d)', estrela: '#ffcf99',
    fundo(ctx, t) {
      // Névoa ferrugem que vai escurecendo e esquentando até o clarão.
      const sobe = limitar(t / T.choque, 0, 1);
      let alfa = 0.1 + 0.3 * suave(sobe);
      if (t > T.saida) alfa *= limitar((T.total - t) / (T.total - T.saida), 0, 1);
      if (t > T.choque) alfa = Math.max(alfa * 0.6, 0);
      ctx.fillStyle = `rgba(120,40,10,${alfa.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      // Brilho de ignição no centro.
      if (t < T.choque) brilhoCentral(ctx, W / 2, H / 2, maxR * 0.45 * suave(sobe), '255,122,61', 0.55 * suave(sobe));
    },
    efeitos(ctx, t) {
      const cx = W / 2, cy = H / 2;
      if (t < T.choque) {
        // Vórtice: a poeira gira em espiral e é sugada para o centro.
        const u = limitar((t - 300) / (T.choque - 300), 0, 1);
        for (const p of poeira) {
          const e = suave(u) ** 1.2;
          const r = p.r0 * (1 - 0.97 * e);
          const a = p.a0 + p.giros * Math.PI * 2 * 3 * e;
          ctx.fillStyle = p.cor;
          ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.7), p.tam, p.tam);
          ctx.globalAlpha = 0.35; // rastro
          const e2 = suave(Math.max(0, u - 0.025)) ** 1.2;
          const r2 = p.r0 * (1 - 0.97 * e2), a2 = p.a0 + p.giros * Math.PI * 2 * 3 * e2;
          ctx.fillRect(Math.round(cx + Math.cos(a2) * r2), Math.round(cy + Math.sin(a2) * r2 * 0.7), p.tam, p.tam);
          ctx.globalAlpha = 1;
        }
      } else {
        // Explosão: poeira e brasas voam para fora; ondas de choque.
        const u = (t - T.choque) / 1500;
        if (u < 1) {
          ctx.globalAlpha = 1 - u;
          for (const p of poeira) {
            const d = p.veloc * (t - T.choque) * 1.2;
            ctx.fillStyle = p.cor;
            ctx.fillRect(Math.round(cx + Math.cos(p.sai) * d), Math.round(cy + Math.sin(p.sai) * d * 0.75), p.tam, p.tam);
          }
          ctx.globalAlpha = 1;
        }
        const uo = (t - T.choque) / 800;
        if (uo < 1) {
          ctx.globalAlpha = 1 - uo;
          circuloPixel(ctx, cx, cy, uo * maxR * 0.8, '#ffcf99', 2);
          circuloPixel(ctx, cx, cy, uo * maxR * 0.6, '#ff7a3d', 2);
          ctx.globalAlpha = 1;
        }
        estrelas(ctx, cx, cy, t, '#ffcf99', W, H);
      }
      // Clarão ferrugem no impacto.
      const f = t - T.choque;
      if (f >= -80 && f < 600) {
        const alfa = f < 0 ? (80 + f) / 80 : 1 - f / 600;
        ctx.fillStyle = `rgba(255,190,130,${(0.95 * alfa).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
    },
  };
}

function temaHumanos(W, H, cartaPx) {
  const maxR = Math.hypot(W, H) / 2;
  const faiscas = Array.from({ length: 110 }, () => ({
    a: Math.random() * Math.PI * 2, v: 0.04 + Math.random() * 0.2,
    cor: ['#ffffff', '#cfe8ff', '#ffe27a', '#6fc3ff'][(Math.random() * 4) | 0], g: 0.00005 + Math.random() * 0.0001,
  }));
  // Moldura de projeto: acompanha a carta final (zoom 2.0), em pixels do canvas.
  const larg = (cartaPx.w * 2.0 * 1.15) / PX, alt = (cartaPx.h * 2.0 * 1.1) / PX;
  return {
    brilho: '#3fa7ff', brilhoCarta: 'drop-shadow(0 0 24px #7fd0ff)', estrela: '#cfe8ff',
    fundo(ctx, t) {
      const f = t < 400 ? t / 400 : t > T.saida ? limitar((T.total - t) / (T.total - T.saida), 0, 1) : 1;
      ctx.fillStyle = `rgba(6,28,70,${(0.6 * f).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      // Grade de blueprint revelada do centro para fora.
      const raio = limitar((t - 100) / 1600, 0, 1) * maxR;
      ctx.fillStyle = 'rgba(80,170,255,0.3)';
      const cx = W / 2, cy = H / 2;
      for (let x = 0; x < W; x += 10) for (let y = 0; y < H; y += 2) if (Math.hypot(x - cx, y - cy) < raio) ctx.fillRect(x, y, 1, 1);
      for (let y = 0; y < H; y += 10) for (let x = 0; x < W; x += 2) if (Math.hypot(x - cx, y - cy) < raio) ctx.fillRect(x, y, 1, 1);
      if (t < T.choque) brilhoCentral(ctx, cx, cy, maxR * 0.4 * suave(t / T.choque), '90,190,255', 0.45 * suave(t / T.choque));
    },
    efeitos(ctx, t) {
      const cx = W / 2, cy = H / 2;

      // Moldura com cotas, traçada aos poucos.
      const prog = limitar((t - 500) / 1800, 0, 1);
      if (prog > 0) {
        ctx.fillStyle = '#7fd0ff';
        const x0 = Math.round(cx - larg / 2), y0 = Math.round(cy - alt / 2);
        const lados = [[x0, y0, 1, 0, larg], [x0 + larg, y0, 0, 1, alt], [x0 + larg, y0 + alt, -1, 0, larg], [x0, y0 + alt, 0, -1, alt]];
        let resto = prog * 2 * (larg + alt);
        for (const [sx, sy, dx, dy, len] of lados) {
          const n = Math.min(len, resto);
          for (let i = 0; i < n; i++) ctx.fillRect(Math.round(sx + dx * i), Math.round(sy + dy * i), 1, 1);
          resto -= n;
          if (resto <= 0) break;
        }
        if (prog > 0.9) {
          for (let i = 0; i < larg; i += 2) ctx.fillRect(Math.round(x0 + i), y0 - 6, 1, 1);
          ctx.fillRect(x0, y0 - 9, 1, 7); ctx.fillRect(Math.round(x0 + larg), y0 - 9, 1, 7);
          for (let i = 0; i < alt; i += 2) ctx.fillRect(Math.round(x0 + larg + 6), Math.round(y0 + i), 1, 1);
          ctx.fillRect(Math.round(x0 + larg + 3), y0, 7, 1); ctx.fillRect(Math.round(x0 + larg + 3), Math.round(y0 + alt), 7, 1);
        }
      }

      // Engrenagens: giram em volta do centro, aceleram e se juntam no clarão.
      if (t > 300 && t < T.choque) {
        const ent = suave(limitar((t - 300) / 700, 0, 1));
        const conv = t > T.convergir ? suave((t - T.convergir) / (T.choque - T.convergir)) : 0;
        const ts = t / 1000;
        const giro = ts + 0.45 * ts ** 3;
        const tam = Math.min(W, H) * 0.12 * ent * (1 - 0.6 * conv);
        const orbita = Math.min(W, H) * 0.42 * (1 - 0.3 * suave(limitar(t / T.convergir, 0, 1))) * (1 - conv);
        for (let i = 0; i < 4; i++) {
          const a = giro * 0.5 + (i * Math.PI) / 2;
          engrenagem(ctx, cx + Math.cos(a) * orbita, cy + Math.sin(a) * orbita * 0.65, tam * (i % 2 ? 0.75 : 1), i % 2 ? 8 : 11, (i % 2 ? -1 : 1) * giro * 1.4, i % 2 ? '#6fb8f0' : '#9fdcff');
        }
      }

      // Solda elétrica: clarão azulado + faíscas.
      if (t >= T.choque - 80) {
        const u = t - T.choque;
        if (u < 450) {
          const alfa = u < 0 ? (80 + u) / 80 : 1 - u / 450;
          ctx.fillStyle = `rgba(235,248,255,${(0.95 * alfa).toFixed(3)})`;
          ctx.fillRect(0, 0, W, H);
        }
        if (u > 0 && u < 1400) {
          ctx.globalAlpha = 1 - u / 1400;
          for (const f of faiscas) {
            const d = f.v * u;
            ctx.fillStyle = f.cor;
            ctx.fillRect(Math.round(cx + Math.cos(f.a) * d), Math.round(cy + Math.sin(f.a) * d + f.g * u * u), 2, 2);
          }
          ctx.globalAlpha = 1;
        }
        estrelas(ctx, cx, cy, t, '#cfe8ff', W, H);
      }
    },
  };
}

// ---------- Função principal ----------
// carta: a fusão. materiais: cartas usadas (aparecem girando). origem: elemento do Deck Extra (não usado
// no desenho final, mantido para compatibilidade). criarCartaEl: monta o elemento HTML de uma carta.
let tocando = null;

export function tocarAnimacaoFusao({ carta, materiais = [], criarCartaEl, modo = 'completa', raiz = document.body }) {
  const nomeTema = carta?.deck;
  if (modo === 'desligada' || !TEMAS[nomeTema] || typeof criarCartaEl !== 'function') return Promise.resolve();
  if (tocando) tocando(); // se já houver uma animação, encerra a anterior
  injetarEstilo();

  const reduzir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const largura = window.innerWidth, altura = window.innerHeight;
  const W = Math.ceil(largura / PX), H = Math.ceil(altura / PX);

  const sobre = document.createElement('div');
  sobre.id = 'anim-fusao';
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  sobre.appendChild(canvas);

  // Cartas que giram (materiais) e a carta final (holograma).
  const orbitando = materiais.map((m) => {
    const d = document.createElement('div');
    d.className = 'carta-anim';
    d.appendChild(criarCartaEl(m));
    sobre.appendChild(d);
    return d;
  });
  const holo = document.createElement('div');
  holo.className = 'carta-anim holo';
  holo.appendChild(criarCartaEl(carta));
  sobre.appendChild(holo);

  const rotulo = document.createElement('div');
  rotulo.className = 'nome';
  rotulo.innerHTML = '<small>EVOLUÇÃO</small>';
  rotulo.appendChild(document.createTextNode(carta.nome));
  sobre.appendChild(rotulo);

  const dica = document.createElement('div');
  dica.className = 'pular';
  dica.textContent = 'clique ou pressione uma tecla para pular';
  sobre.appendChild(dica);
  raiz.appendChild(sobre);

  const tema = nomeTema === 'marciano' ? temaMarciano(W, H) : temaHumanos(W, H, { w: holo.offsetWidth, h: holo.offsetHeight });
  sobre.style.setProperty('--anim-brilho', tema.brilho);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Movimento reduzido: pula direto para a revelação da carta.
  const inicioT = reduzir ? T.choque : 0;
  const duracao = reduzir ? 1600 : T.total;

  if (modo === 'completa' && !reduzir && sonsAtivos()) {
    const ac = audio();
    if (ac) {
      const impacto = nomeTema === 'marciano' ? 1.05 : 1.35; // instante do impacto dentro de cada som
      (nomeTema === 'marciano' ? somMarciano : somHumanos)(ac, T.choque / 1000 - impacto);
    }
  }

  const R0 = Math.min(largura, altura) * 0.34;
  const n = orbitando.length;

  return new Promise((resolver) => {
    const inicio = performance.now();
    let quadro = 0;
    let terminou = false;

    const encerrar = () => {
      if (terminou) return;
      terminou = true;
      cancelAnimationFrame(quadro);
      document.removeEventListener('keydown', encerrar, true);
      sobre.remove();
      tocando = null;
      resolver();
    };
    tocando = encerrar;
    sobre.addEventListener('click', encerrar);
    document.addEventListener('keydown', encerrar, true);

    const passo = (agora) => {
      if (terminou) return;
      const real = Math.min(duracao, agora - inicio);
      const t = real + inicioT;
      ctx.clearRect(0, 0, W, H);
      tema.fundo(ctx, t);

      // ----- Materiais em órbita (estilo Forbidden Memories) -----
      orbitando.forEach((d, i) => {
        if (t >= T.choque) { d.style.opacity = '0'; return; }
        const ts = t / 1000;
        const giro = ts + 0.45 * ts ** 3; // rotação acumulada: acelera cada vez mais (≈4 voltas até o choque)
        const entrada = sair(limitar(t / T.entrada, 0, 1));
        const conv = t > T.convergir ? suave((t - T.convergir) / (T.choque - T.convergir)) : 0;
        // Raio: entra de fora, fica na órbita e depois fecha até o centro.
        const raio = R0 * (2.2 - 1.2 * entrada) * (1 - 0.3 * suave(limitar(t / T.convergir, 0, 1))) * (1 - conv);
        const a = giro + (i * 2 * Math.PI) / Math.max(1, n);
        const x = Math.cos(a) * raio;
        const y = Math.sin(a) * raio * 0.55; // órbita achatada = sensação de profundidade
        const prof = Math.sin(a);            // >0: cartas da frente, <0: de trás
        const escala = 1.4 + 0.25 * prof + 0.5 * conv;
        d.style.zIndex = prof > 0 ? '4' : '2';
        d.style.opacity = String(limitar(t / 500, 0, 1) * (1 - 0.35 * (prof < 0 ? 1 : 0)));
        d.style.filter = `brightness(${1 + 0.9 * conv}) drop-shadow(0 0 ${8 + 20 * conv}px ${tema.brilho})`;
        d.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${Math.sin(a) * 10}deg) scale(${escala})`;
      });

      tema.efeitos(ctx, t);

      // ----- Carta evoluída: surge girando e dá o zoom final -----
      const u = limitar((t - T.choque) / 1300, 0, 1);
      const fim = limitar((t - T.saida) / (T.total - T.saida), 0, 1);
      if (t < T.choque) {
        holo.style.opacity = '0';
      } else {
        const rot = (1 - sair(u)) * 720;                        // gira 2 voltas e assenta
        const esc = 0.25 + 1.75 * sair(u) + 0.04 * Math.sin((t - T.choque) / 260); // leve "respiração" depois
        holo.style.opacity = String(limitar(u * 3, 0, 1) * (1 - fim));
        holo.style.filter = (u < 0.5 ? 'brightness(2.2) ' : 'brightness(1.05) ') + tema.brilhoCarta;
        holo.style.transform = `perspective(900px) translate(-50%, -50%) rotateY(${rot}deg) scale(${esc})`;
      }

      // ----- Faixa com o nome -----
      const un = limitar((t - T.nome) / 300, 0, 1) * (1 - fim);
      rotulo.style.opacity = String(un);
      rotulo.style.transform = `skewX(-12deg) translateX(${(1 - un) * 90}px)`;

      if (real >= duracao) encerrar();
      else quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
  });
}
