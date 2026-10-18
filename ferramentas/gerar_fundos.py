"""
gerar_fundos.py  —  gera os cenários panorâmicos (fundos de campo) do Real Battle Card.

Como rodar (precisa de numpy e Pillow:  pip install numpy pillow):
    python ferramentas/gerar_fundos.py            -> gera todos os cenários em fundos/
    python ferramentas/gerar_fundos.py marte      -> gera só o de Marte
    python ferramentas/gerar_fundos.py marte --rapido   -> versão pequena, para testar ajustes

Como funciona (resumo para entender o código):
  1. RELEVO: criamos um "mapa de alturas" (uma imagem em tons de cinza onde claro = alto).
     Ele nasce de ruído fractal: ruído aleatório filtrado no domínio da frequência (FFT),
     o que dá montanhas "naturais" em várias escalas.
  2. COR: cada ponto do mapa ganha uma cor (rampa de cores por altura + faixas de camadas
     de rocha + luz de lado, para o relevo aparecer).
  3. RENDER 3D ("voxel space"): uma câmera olha para a frente. Para cada coluna da tela
     lançamos um raio e andamos pelo mapa de perto até longe; cada ponto do terreno é
     projetado na tela (perto = grande/baixo, longe = pequeno/alto) e pinta uma faixa vertical.
     Quanto mais longe, mais névoa (mistura com a cor do horizonte) — isso dá profundidade.
  4. CÉU: degradê + sol com brilho + planeta/lua com textura + nuvens/estrelas, conforme o cenário.
  5. ACABAMENTO: brilho suave nas partes claras (bloom) e redução ao tamanho final.

Cada cenário é só um dicionário em CENAS: mude as cores/valores e rode de novo.
"""
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

N = 2048                      # tamanho (em pixels) do mapa de alturas; ele "dá a volta" (é repetível)
SAIDA = Path(__file__).resolve().parent.parent / 'fundos'


# ---------------------------------------------------------------------------
# Utilidades de ruído e cor
# ---------------------------------------------------------------------------
def ruido(semente, expoente=1.8, ax=1.0, ay=1.0, n=N):
    """Ruído fractal repetível (0..1). expoente maior = mais suave; ax/ay esticam o ruído."""
    rng = np.random.default_rng(semente)
    branco = rng.standard_normal((n, n)).astype(np.float32)
    F = np.fft.rfft2(branco)
    ky = np.fft.fftfreq(n)[:, None] * ay
    kx = np.fft.rfftfreq(n)[None, :] * ax
    f = np.sqrt(kx ** 2 + ky ** 2)
    f[0, 0] = 1
    F *= f ** (-expoente)
    F[0, 0] = 0
    r = np.fft.irfft2(F, s=(n, n)).astype(np.float32)
    lo, hi = np.percentile(r, [1, 99])
    return np.clip((r - lo) / (hi - lo), 0, 1)


def suave(a, b, x):
    """smoothstep: 0 abaixo de a, 1 acima de b, curva suave no meio."""
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def rampa(valores, pontos):
    """Rampa de cores: pontos = [(posicao 0..1, (r,g,b)), ...]; devolve array (...,3)."""
    pos = np.array([p for p, _ in pontos], dtype=np.float32)
    cor = np.array([c for _, c in pontos], dtype=np.float32)
    return np.stack([np.interp(valores, pos, cor[:, i]) for i in range(3)], axis=-1)


def amostrar(mapa, x, y):
    """Lê o mapa (N,N,C) em posições fracionárias (interpolação bilinear, com repetição)."""
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0)[:, None].astype(np.float32)
    fy = (y - y0)[:, None].astype(np.float32)
    x0 %= N
    y0 %= N
    x1 = (x0 + 1) % N
    y1 = (y0 + 1) % N
    return ((mapa[y0, x0] * (1 - fx) + mapa[y0, x1] * fx) * (1 - fy)
            + (mapa[y1, x0] * (1 - fx) + mapa[y1, x1] * fx) * fy)


# ---------------------------------------------------------------------------
# Terrenos: cada função devolve (alturas 0..1, cor RGB (N,N,3), brilho próprio (N,N,3) ou None)
# ---------------------------------------------------------------------------
def luz_do_relevo(h, escala, direcao):
    """Sombreamento: quanto cada pedacinho do relevo está virado para a luz (0..1)."""
    gy, gx = np.gradient(h * escala)
    nz = np.ones_like(h)
    norma = np.sqrt(gx ** 2 + gy ** 2 + nz ** 2)
    lx, ly, lz = direcao
    ln = np.sqrt(lx ** 2 + ly ** 2 + lz ** 2)
    lamb = (-gx * lx - gy * ly + nz * lz) / (norma * ln)
    return np.clip(lamb, 0, 1)


def terreno_estratos(c):
    """Mesas e camadas de rocha (Marte, Cidade Antiga)."""
    base = ruido(c['semente'], c.get('expoente', 2.1))
    degraus = c.get('degraus', 14)
    t = base * degraus
    terraco = (np.floor(t) + suave(0.25, 0.75, t - np.floor(t))) / degraus
    h = 0.45 * base + 0.55 * terraco
    # riscos horizontais finos, como nas camadas da imagem de referência
    riscos = ruido(c['semente'] + 1, 1.3, ax=0.25, ay=1.0)
    banda = np.sin(t * np.pi * 2) * 0.5 + 0.5
    cor = rampa(h, c['rampa'])
    cor *= (0.80 + 0.32 * banda)[..., None]
    cor *= (0.80 + 0.40 * riscos)[..., None]
    luz = luz_do_relevo(h, c['altura'] * 0.5, c.get('luz', (0.9, 0.2, 0.7)))
    cor *= (0.45 + 0.95 * luz)[..., None]
    return h, cor, None


def terreno_colinas(c):
    """Colinas com mar, areia, mato e floresta (Terra, Floresta)."""
    base = ruido(c['semente'], 2.0)
    h = base
    nivel_mar = c.get('mar')
    detalhe = ruido(c['semente'] + 2, 1.2)
    if c.get('arvores'):
        # copas de árvores: pontinhos escuros que também levantam o relevo (aparecem no horizonte)
        copas = suave(0.60, 0.68, ruido(c['semente'] + 3, 0.35))
        h = h + 0.035 * copas
        detalhe = detalhe * (1 - 0.55 * copas)
    cor = rampa(h, c['rampa'])
    cor *= (0.80 + 0.40 * detalhe)[..., None]
    luz = luz_do_relevo(h, c['altura'] * 0.5, c.get('luz', (0.9, 0.2, 0.7)))
    cor *= (0.50 + 0.85 * luz)[..., None]
    if nivel_mar is not None:
        agua = h < nivel_mar
        h = np.where(agua, nivel_mar, h)
        fundo = suave(nivel_mar - 0.18, nivel_mar, base)
        cor = np.where(agua[..., None], rampa(fundo, c['rampa_agua']), cor)
    return h, cor, None


def terreno_gelo(c):
    """Planície de gelo com rachaduras (Europa)."""
    base = ruido(c['semente'], 2.4)
    rach = 1 - np.abs(ruido(c['semente'] + 1, 1.6) * 2 - 1)
    linhas = suave(*c.get('rachaduras', (0.93, 0.985)), rach)
    h = 0.55 * base + 0.06 * rach
    cor = rampa(base, c['rampa'])
    cor *= (0.88 + 0.22 * ruido(c['semente'] + 2, 1.0))[..., None]
    cor = cor * (1 - 0.8 * linhas[..., None]) + np.array(c['cor_rachadura'], dtype=np.float32) * 0.8 * linhas[..., None]
    return h, cor, None


def terreno_lava(c):
    """Rocha escura com rios de lava que brilham (Tempestade Solar)."""
    base = ruido(c['semente'], 2.0)
    rach = 1 - np.abs(ruido(c['semente'] + 1, 1.5) * 2 - 1)
    rios = suave(*c.get('rios', (0.90, 0.975)), rach)
    h = c.get('relevo', 0.6) * base
    cor = rampa(base, c['rampa'])
    cor *= (0.8 + 0.4 * ruido(c['semente'] + 2, 1.0))[..., None]
    brilho = rios[..., None] * np.array(c['cor_lava'], dtype=np.float32)
    return h, cor, brilho


def terreno_cristal(c):
    """Montanhas pontudas com veios de luz (arena padrão)."""
    base = ruido(c['semente'], 1.9)
    cristas = 1 - np.abs(base * 2 - 1)
    h = 0.35 * base + 0.65 * cristas ** 2
    veios = suave(*c.get('veios', (0.94, 0.985)), 1 - np.abs(ruido(c['semente'] + 1, 1.5) * 2 - 1))
    cor = rampa(h, c['rampa'])
    cor *= (0.8 + 0.4 * ruido(c['semente'] + 2, 1.1))[..., None]
    luz = luz_do_relevo(h, c['altura'] * 0.5, c.get('luz', (0.9, 0.2, 0.7)))
    cor *= (0.45 + 1.0 * luz)[..., None]
    brilho = veios[..., None] * np.array(c['cor_veio'], dtype=np.float32)
    return h, cor, brilho


def adicionar_cidade(h, cor, c):
    """Ruínas: torres e colunas em quadras, desenhadas direto no mapa de alturas."""
    rng = np.random.default_rng(c['semente'] + 9)
    cx, cy = c['cidade_centro']
    larg, prof = c['cidade_tamanho']
    passo = 26
    for gy in range(cy - prof, cy + prof, passo):
        for gx in range(cx - larg, cx + larg, passo):
            if rng.random() < 0.28:
                continue
            dist = np.hypot((gx - cx) / larg, (gy - cy) / prof)
            alto = (0.05 + 0.15 * rng.random()) * (1.3 - dist) + (0.22 if rng.random() < 0.07 else 0)
            w = int(rng.integers(10, 21))
            d = int(rng.integers(10, 21))
            y0, y1, x0, x1 = gy, gy + d, gx, gx + w
            base = h[y0 % N:y1 % N or N, x0 % N:x1 % N].mean()
            h[y0 % N:y1 % N or N, x0 % N:x1 % N] = base + alto
            tom = 0.82 + 0.25 * rng.random()
            cor[y0 % N:y1 % N or N, x0 % N:x1 % N] = np.array(c['cor_pedra'], dtype=np.float32) * tom
    return h, cor


TERRENOS = {'estratos': terreno_estratos, 'colinas': terreno_colinas, 'gelo': terreno_gelo,
            'lava': terreno_lava, 'cristal': terreno_cristal}


# ---------------------------------------------------------------------------
# Céu
# ---------------------------------------------------------------------------
def desenhar_ceu(c, W, H, horizonte):
    """Devolve a imagem do céu (H,W,3) em float 0..1."""
    ys = np.arange(H, dtype=np.float32)[:, None]
    xs = np.arange(W, dtype=np.float32)[None, :]
    t = np.clip(ys / horizonte, 0, 1)                      # 0 no topo, 1 no horizonte
    topo = np.array(c['ceu_topo'], dtype=np.float32)
    hor = np.array(c['ceu_horizonte'], dtype=np.float32)
    meio = np.array(c.get('ceu_meio', (topo + hor) / 2), dtype=np.float32)
    f = (t ** c.get('ceu_curva', 1.6))[..., None]
    ceu = np.where(f < 0.5, topo + (meio - topo) * (f / 0.5), meio + (hor - meio) * ((f - 0.5) / 0.5))
    ceu = np.broadcast_to(ceu, (H, W, 3)).copy()

    rng = np.random.default_rng(c['semente'] + 50)
    # estrelas
    if c.get('estrelas'):
        mapa = rng.random((H, W)).astype(np.float32)
        brilho = (mapa > 1 - c['estrelas']) * rng.random((H, W)).astype(np.float32)
        brilho = np.array(Image.fromarray((brilho * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float32) / 255 * 3.2
        ceu += (np.clip(brilho, 0, 1) * (1 - t) ** 0.7)[..., None]

    # nuvens em perspectiva (um "plano" de nuvens acima de nós)
    if c.get('nuvens'):
        ds = np.maximum(horizonte - ys, 1.0)
        u = (xs - W / 2) / ds * 90 + 1000
        v = 1500 / ds * 0.22 + 400
        nuv = ruido(c['semente'] + 60, 2.2)
        valor = amostrar(nuv[..., None], (u * np.ones((H, 1))).ravel(), (v * np.ones((1, W))).ravel()).reshape(H, W)
        cob = suave(c['nuvens'], c['nuvens'] + 0.18, valor)
        cob = cob * (ys < horizonte) * np.clip(1 - 1.1 * t ** 6, 0, 1)
        ceu = ceu * (1 - 0.85 * cob[..., None]) + np.array(c['cor_nuvem'], dtype=np.float32) * 0.85 * cob[..., None]

    # aurora (faixas de luz ondulantes)
    if c.get('aurora'):
        onda = np.sin(xs / W * 5 + np.sin(xs / W * 11) * 0.8)
        faixa = np.exp(-(((ys / horizonte) - (0.42 + 0.10 * onda)) ** 2) / 0.006)
        faixa = faixa * (0.55 + 0.45 * np.sin(xs / W * 14 + onda * 2)) * (0.6 + 0.4 * np.sin(xs / W * 3.1 + 1)) * (ys < horizonte)
        ceu += faixa[..., None] * np.array(c['aurora'], dtype=np.float32) * 0.55

    # sol: halo grande + disco branco
    if c.get('sol'):
        sx, sy, raio = c['sol']
        sx, sy, raio = sx * W, sy * H, raio * H
        d = np.sqrt((xs - sx) ** 2 + (ys - sy) ** 2)
        cor_sol = np.array(c.get('cor_sol', (1.0, 0.9, 0.6)), dtype=np.float32)
        ceu += (np.exp(-d / (raio * 11)) * 0.35 + np.exp(-d / (raio * 3.2)) * 0.30)[..., None] * cor_sol * c.get('halo_sol', 1.0)
        disco = suave(raio * 1.05, raio * 0.85, d)
        ceu = ceu * (1 - disco[..., None]) + disco[..., None] * np.array([1.0, 0.99, 0.9], dtype=np.float32)

    # planeta / lua / gigante gasoso, com textura e luz
    for p in c.get('corpos', []):
        px, py, pr = p['pos'][0] * W, p['pos'][1] * H, p['pos'][2] * H
        nx = (xs - px) / pr
        ny = (ys - py) / pr
        r2 = nx ** 2 + ny ** 2
        dentro = r2 < 1
        nz = np.sqrt(np.clip(1 - r2, 0, 1))
        ruido_p = ruido(p.get('semente', 3), p.get('expoente', 2.0), n=512)
        lon = (nx * 0.5 + 0.5) * 220 + 100
        lat = (ny * 0.5 + 0.5) * 220 + 100
        if p.get('bandas'):                                   # gigante gasoso: faixas horizontais
            desvio = amostrar(ruido_p[..., None] if False else np.pad(ruido_p, ((0, N - 512), (0, N - 512)))[..., None],
                              (lon * np.ones((H, 1))).ravel(), (lat * np.ones((1, W))).ravel()).reshape(H, W)
            tx = np.sin((ny + (desvio - 0.5) * 0.35) * p['bandas']) * 0.5 + 0.5
        else:
            tx = amostrar(np.pad(ruido_p, ((0, N - 512), (0, N - 512)))[..., None],
                          (lon * np.ones((H, 1))).ravel(), (lat * np.ones((1, W))).ravel()).reshape(H, W)
        cor_p = rampa(tx, p['rampa'])
        luz = np.clip(nx * p.get('luz_x', 0.6) + ny * -0.25 + nz * 0.75, 0.05, 1.0)
        cor_p = cor_p * (0.28 + 0.9 * luz[..., None] ** 1.1)
        borda = suave(1.0, 0.97, np.sqrt(r2))
        if p.get('atmosfera') is not None:
            cor_p += np.array(p['atmosfera'], dtype=np.float32) * (1 - nz[..., None]) ** 2.2 * 0.7
        alfa = (borda * dentro)[..., None]
        ceu = ceu * (1 - alfa) + cor_p * alfa
        if p.get('halo'):
            ceu += np.exp(-np.maximum(np.sqrt(r2) - 1, 0) * 7)[..., None] * (~dentro)[..., None] * np.array(p['halo'], dtype=np.float32) * 0.35
    return np.clip(ceu, 0, 1.6)


# ---------------------------------------------------------------------------
# Render do terreno (voxel space)
# ---------------------------------------------------------------------------
def renderizar_terreno(img, h01, cor, brilho, c, W, H, horizonte):
    escala_h = c['altura']                                   # altura máxima do relevo em "unidades"
    cam_x, cam_y = N / 2, c.get('camera_y', 120)
    # achata o terreno perto da câmera (para ela não "bater" numa montanha)
    wy = (np.arange(N) - cam_y) % N
    achata = suave(0, c.get('achatar', 520), wy.astype(np.float32))[:, None]
    h = h01 * achata + c.get('piso', 0.0) * (1 - achata)
    camh = float(h.max()) * escala_h * c.get('camera_altura', 0.62) + 10
    foco = W * 0.5 / np.tan(np.radians(c.get('fov', 66) / 2))

    # mapa único com todos os canais: altura, r, g, b, emissivo r g b, detalhe
    det = ruido(c['semente'] + 7, 0.9)
    canais = [h[..., None], cor, (brilho if brilho is not None else np.zeros_like(cor)), det[..., None]]
    M = np.concatenate(canais, axis=-1).astype(np.float32)

    ang = (np.arange(W, dtype=np.float32) / W - 0.5) * 2 * np.tan(np.radians(c.get('fov', 66) / 2))
    nevoa = np.array(c['nevoa'], dtype=np.float32)
    ybuf = np.full(W, H, dtype=np.int64)
    cols_idx = np.arange(W)
    z = c.get('z_perto', 40.0)
    zmax = c.get('z_longe', 1900.0)
    paredes = c.get('paredes', 0.72)
    while z < zmax:
        px = cam_x + ang * z
        py = np.full_like(px, cam_y + z)
        s = amostrar(M, px, py)
        alt = s[:, 0] * escala_h
        d = amostrar(M[..., 7:8], px * 2.5, py * 2.5)[:, 0]    # detalhe fino (mais pontos por unidade)
        fade = 1 - suave(150, 600, z)                          # de longe o detalhe some (evita serrilhado)
        rgb = s[:, 1:4] * (1 + (d - 0.5) * 0.5 * fade)[:, None]
        f = 1 - np.exp(-(z / c['nevoa_dist']) ** 1.25)
        rgb = rgb * (1 - f) + nevoa * f
        rgb = rgb + s[:, 4:7] * (1 - 0.7 * f)
        ytop = np.clip(np.ceil(horizonte + (camh - alt) * foco / z).astype(np.int64), 0, H)
        compr = ybuf - ytop
        ativo = compr > 0
        if ativo.any():
            idx = cols_idx[ativo]
            lens = compr[ativo]
            total = int(lens.sum())
            col_rep = np.repeat(idx, lens)
            inicio = np.repeat(np.cumsum(lens) - lens, lens)
            k = np.arange(total) - inicio                      # 0 = primeira linha (a de cima) da faixa
            linhas = np.repeat(ytop[ativo], lens) + k
            cores = rgb[col_rep]
            parede = ((k >= 3) & (np.repeat(lens, lens) >= 6))[:, None]                          # faixas altas = paredes: mais escuras
            cores = np.where(parede, cores * paredes, cores)
            img[linhas, col_rep] = cores
            ybuf[ativo] = ytop[ativo]
        z *= 1.0032


def acabamento(img, intensidade):
    """Bloom: espalha um pouco do brilho das áreas mais claras."""
    mapa8 = (np.clip(img, 0, 1) * 255).astype(np.uint8)
    base = Image.fromarray(mapa8)
    claro = np.clip(img - 0.62, 0, 1)
    claro8 = Image.fromarray((np.clip(claro * 2.2, 0, 1) * 255).astype(np.uint8))
    raio = max(6, img.shape[1] // 90)
    glow = np.array(claro8.filter(ImageFilter.GaussianBlur(raio)), dtype=np.float32) / 255
    glow2 = np.array(claro8.filter(ImageFilter.GaussianBlur(raio * 3)), dtype=np.float32) / 255
    out = np.clip(np.array(base, dtype=np.float32) / 255 + intensidade * (glow * 0.7 + glow2 * 0.6), 0, 1)
    return out


# ---------------------------------------------------------------------------
# Cenários
# ---------------------------------------------------------------------------
CENAS = {
    # Marte: referência — céu laranja, sol branco, planeta azulado/nublado, mesas em camadas
    'marte': dict(
        terreno='estratos', semente=11, degraus=13, altura=300, camera_altura=1.0, achatar=800, expoente=2.5,
        rampa=[(0.0, (0.16, 0.04, 0.025)), (0.35, (0.42, 0.13, 0.055)), (0.7, (0.70, 0.27, 0.10)), (1.0, (0.92, 0.46, 0.20))],
        ceu_topo=(0.66, 0.17, 0.09), ceu_meio=(0.90, 0.34, 0.14), ceu_horizonte=(1.0, 0.60, 0.26),
        nevoa=(0.97, 0.52, 0.22), nevoa_dist=2200, paredes=0.62,
        sol=(0.80, 0.17, 0.026), cor_sol=(1.0, 0.72, 0.38),
        corpos=[dict(pos=(0.19, 0.16, 0.085), semente=5, expoente=2.3,
                     rampa=[(0, (0.55, 0.28, 0.16)), (0.45, (0.85, 0.62, 0.42)), (0.7, (0.97, 0.9, 0.8)), (1, (0.45, 0.5, 0.6))],
                     atmosfera=(0.3, 0.12, 0.05), luz_x=0.5)],
        glow=0.35, bruma=0.22,
    ),

    # Terra (Base de Lançamento Orbital): mar, colinas verdes, nuvens e uma lua no céu
    'terra': dict(
        terreno='colinas', semente=31, mar=0.46, altura=210, camera_altura=1.0, achatar=800,
        rampa=[(0.0, (0.85, 0.78, 0.55)), (0.47, (0.80, 0.74, 0.52)), (0.52, (0.30, 0.55, 0.22)), (0.72, (0.16, 0.38, 0.14)),
               (0.88, (0.38, 0.34, 0.26)), (1.0, (0.92, 0.92, 0.95))],
        rampa_agua=[(0.0, (0.02, 0.12, 0.30)), (1.0, (0.10, 0.48, 0.72))],
        ceu_topo=(0.10, 0.30, 0.70), ceu_meio=(0.35, 0.60, 0.92), ceu_horizonte=(0.80, 0.90, 0.98),
        nevoa=(0.70, 0.84, 0.95), nevoa_dist=1500, paredes=0.7, nuvens=0.52, cor_nuvem=(1.0, 1.0, 1.0),
        sol=(0.22, 0.15, 0.026), cor_sol=(1.0, 0.95, 0.75),
        corpos=[dict(pos=(0.80, 0.17, 0.07), semente=8, expoente=2.2,
                     rampa=[(0, (0.55, 0.57, 0.62)), (0.5, (0.78, 0.80, 0.84)), (1, (0.95, 0.96, 0.98))], luz_x=-0.5)],
        glow=0.25, bruma=0.3,
    ),
    # Mar de Europa: gelo rachado e Júpiter enorme no céu
    'europa': dict(
        terreno='gelo', semente=41, altura=140, camera_altura=1.0, achatar=800, piso=0.2, rachaduras=(0.972, 0.994),
        rampa=[(0.0, (0.45, 0.70, 0.82)), (0.5, (0.74, 0.90, 0.96)), (1.0, (0.96, 0.99, 1.0))],
        cor_rachadura=(0.05, 0.18, 0.30),
        ceu_topo=(0.01, 0.02, 0.07), ceu_meio=(0.04, 0.12, 0.26), ceu_horizonte=(0.55, 0.82, 0.92), ceu_curva=2.4, estrelas=0.0012,
        nevoa=(0.58, 0.84, 0.94), nevoa_dist=1400, paredes=0.78,
        corpos=[dict(pos=(0.80, 0.19, 0.17), semente=4, expoente=1.6, bandas=17, luz_x=-0.55, halo=(0.9, 0.6, 0.4),
                     rampa=[(0, (0.52, 0.30, 0.18)), (0.35, (0.82, 0.58, 0.38)), (0.65, (0.95, 0.85, 0.7)), (1, (0.60, 0.38, 0.26))],
                     atmosfera=(0.2, 0.12, 0.08))],
        glow=0.3, bruma=0.35,
    ),
    # Floresta Ancestral: colinas cobertas de árvores, luz dourada entre a névoa verde
    'floresta': dict(
        terreno='colinas', semente=51, arvores=True, altura=330, camera_altura=1.0, achatar=800,
        rampa=[(0.0, (0.07, 0.20, 0.08)), (0.45, (0.10, 0.34, 0.12)), (0.75, (0.20, 0.50, 0.17)), (1.0, (0.42, 0.62, 0.28))],
        ceu_topo=(0.05, 0.30, 0.44), ceu_meio=(0.26, 0.58, 0.58), ceu_horizonte=(0.96, 0.88, 0.52), halo_sol=0.5,
        nevoa=(0.62, 0.78, 0.46), nevoa_dist=1200, paredes=0.7,
        sol=(0.80, 0.19, 0.030), cor_sol=(1.0, 0.95, 0.55),
        glow=0.3, bruma=0.4,
    ),
    # Cidade Antiga: mesas de arenito e ruínas de torres ao fundo, luz de fim de tarde
    'cidade': dict(
        terreno='estratos', semente=61, degraus=10, altura=170, camera_altura=1.0, achatar=900, expoente=2.6,
        rampa=[(0.0, (0.30, 0.20, 0.10)), (0.4, (0.62, 0.44, 0.22)), (0.75, (0.86, 0.68, 0.38)), (1.0, (0.97, 0.84, 0.55))],
        cidade_centro=(1024, 880), cidade_tamanho=(520, 360), cor_pedra=(0.90, 0.78, 0.55),
        ceu_topo=(0.20, 0.20, 0.45), ceu_meio=(0.74, 0.44, 0.38), ceu_horizonte=(1.0, 0.80, 0.46), halo_sol=0.5,
        nevoa=(0.96, 0.72, 0.42), nevoa_dist=1800, paredes=0.6,
        sol=(0.24, 0.17, 0.034), cor_sol=(1.0, 0.8, 0.45),
        glow=0.4, bruma=0.3,
    ),
    # Tempestade Solar: rios de lava e um sol gigante no horizonte
    'solar': dict(
        terreno='lava', semente=71, altura=300, relevo=0.9, rios=(0.955, 0.99), camera_altura=1.0, achatar=800,
        rampa=[(0.0, (0.05, 0.015, 0.01)), (0.5, (0.13, 0.04, 0.02)), (1.0, (0.28, 0.09, 0.04))],
        cor_lava=(1.2, 0.55, 0.12),
        ceu_topo=(0.35, 0.05, 0.02), ceu_meio=(0.95, 0.35, 0.08), ceu_horizonte=(1.0, 0.85, 0.40),
        nevoa=(0.98, 0.55, 0.16), nevoa_dist=1300, paredes=0.6,
        sol=(0.5, 0.25, 0.13), cor_sol=(1.0, 0.7, 0.2),
        glow=0.55, bruma=0.45,
    ),
    # Arena padrão (sem carta de campo): noite arcana, aurora, lua e cristais
    'padrao': dict(
        terreno='cristal', semente=81, altura=420, veios=(0.962, 0.992), camera_altura=1.0, achatar=900,
        rampa=[(0.0, (0.03, 0.04, 0.12)), (0.5, (0.09, 0.10, 0.28)), (1.0, (0.35, 0.40, 0.72))],
        cor_veio=(0.25, 0.75, 1.1),
        ceu_topo=(0.01, 0.01, 0.06), ceu_meio=(0.07, 0.06, 0.24), ceu_horizonte=(0.28, 0.20, 0.55), estrelas=0.0016,
        aurora=(0.15, 0.9, 0.7),
        nevoa=(0.22, 0.18, 0.50), nevoa_dist=1300, paredes=0.7,
        corpos=[dict(pos=(0.20, 0.15, 0.11), semente=9, expoente=2.0, luz_x=0.5, halo=(0.5, 0.6, 1.0),
                     rampa=[(0, (0.55, 0.60, 0.80)), (0.5, (0.82, 0.86, 0.96)), (1, (0.96, 0.97, 1.0))])],
        glow=0.5, bruma=0.35,
    ),
}


def gerar(nome, rapido=False):
    c = CENAS[nome]
    W, H = (1280, 720) if rapido else (2560, 1440)
    horizonte = int(H * c.get('horizonte', 0.34))
    t0 = time.time()
    h, cor, brilho = TERRENOS[c['terreno']](c)
    if c.get('cidade_centro'):
        h, cor = adicionar_cidade(h, cor, c)
    ceu = desenhar_ceu(c, W, H, horizonte)
    img = ceu.astype(np.float32)
    renderizar_terreno(img, h, cor, brilho, c, W, H, horizonte)
    # faixa de névoa colada ao horizonte (some a emenda entre céu e terreno)
    ys = np.arange(H, dtype=np.float32)[:, None, None]
    faixa = np.exp(-((ys - horizonte) / (H * 0.035)) ** 2) * c.get('bruma', 0.35)
    img = img * (1 - faixa) + np.array(c['nevoa'], dtype=np.float32) * faixa
    img = acabamento(img, c.get('glow', 0.5))
    final = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    if not rapido:
        final = final.resize((1920, 1080), Image.LANCZOS)
    SAIDA.mkdir(exist_ok=True)
    destino = SAIDA / (f'{nome}_rapido.jpg' if rapido else f'{nome}.jpg')
    final.save(destino, quality=86, subsampling=0, optimize=True)
    print(f'{nome}: {destino.name}  ({destino.stat().st_size // 1024} KB, {time.time() - t0:.0f}s)')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    rapido = '--rapido' in sys.argv
    for nome in (args or list(CENAS)):
        gerar(nome, rapido)
