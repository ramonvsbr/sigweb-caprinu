// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Em desenvolvimento local aponta direto para o Uvicorn; em produção usa o
// caminho /mapas/api/ que o nginx repassa para o backend.
const API_URL = (location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname))
    ? "http://127.0.0.1:8000/api/comunidades/geojson"
    : "/mapas/api/comunidades/geojson";

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────
// Ícones Lucide: <i data-lucide="..."> vira <svg>. Chamar de novo sempre que
// um HTML com ícones for inserido dinamicamente.
const ico = (nome) => `<i data-lucide="${nome}"></i>`;
const renderizarIcones = () => { if (window.lucide) lucide.createIcons(); };

// Evita que texto vindo da API seja interpretado como HTML.
function esc(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// Números inteiros no padrão brasileiro: 1250 -> 1.250
const fmtInt = (n) => Number(n || 0).toLocaleString('pt-BR');
const plural = (n, singular, pl) => (n === 1 ? singular : pl);

// Esqueleto de carregamento: mesma estrutura da visão geral, em blocos cinza.
function htmlEsqueleto() {
    return `
    <div class="conteudo-painel esqueleto" role="status" aria-busy="true">
        <span class="sr-only">Carregando dados das comunidades…</span>
        <div class="comunidade-header">
            <div class="esq esq-pill"></div>
            <div class="esq esq-titulo"></div>
            <div class="esq esq-linha" style="width:45%"></div>
        </div>
        <div class="grid-kpi">
            <div class="esq esq-card"></div><div class="esq esq-card"></div>
            <div class="esq esq-card"></div><div class="esq esq-card"></div>
        </div>
        <div class="esq esq-linha" style="width:55%"></div>
        <div class="esq esq-barra"></div>
        <div class="esq esq-barra"></div>
    </div>`;
}

// ─── MAPA ─────────────────────────────────────────────────────────────────────
// Área navegável do mapa: Brasil inteiro, com uma pequena margem.
// O usuário não consegue arrastar para fora deste retângulo (graus decimais).
const LIMITES = {
    sul:   -35.0,   // extremo sul do Brasil: ~-33,75
    norte:   6.0,   // extremo norte: ~5,27
    oeste: -75.0,   // extremo oeste: ~-73,99
    leste: -28.0,   // extremo leste (Fernando de Noronha): ~-28,85
};
const limitesNordeste = L.latLngBounds(
    L.latLng(LIMITES.sul,   LIMITES.oeste),
    L.latLng(LIMITES.norte, LIMITES.leste)
);

// Vista inicial: região de Petrolina (PE), com Juazeiro (BA) do outro lado do São Francisco.
// [sul, oeste] e [norte, leste]. Ajuste aqui se quiser enquadrar mais ou menos área.
const VISTA_INICIAL = L.latLngBounds(
    L.latLng(-9.70, -40.90),
    L.latLng(-9.10, -40.10)
);

const map = L.map('map', {
    zoomSnap: 0.25,
    maxZoom: 18,
    minZoom: 4,
    maxBounds: limitesNordeste,
    maxBoundsViscosity: 1.0,
    zoomControl: false,
});

map.fitBounds(VISTA_INICIAL, { padding: [20, 20] });

// Mapas base: ruas (OpenStreetMap) e satélite (Esri World Imagery), ambos sem API Key.
const mapaRuas = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const mapaSatelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
});

const controleCamadasMapa = L.control.layers({ 'Ruas': mapaRuas, 'Satélite': mapaSatelite }, null, {
    position: 'topright',
    collapsed: true,
}).addTo(map);

// Controles de zoom posicionados à esquerda
L.control.zoom({ position: 'topleft' }).addTo(map);

// ─── ESTADO GLOBAL ────────────────────────────────────────────────────────────
let camadaGeoJson       = null;
let grupoCluster        = null; // Nova variável para gerenciar o agrupamento
let dadosGlobaisGeoJson = null;
let marcadorSelecionado = null; // círculo da comunidade aberta no painel
let nomeSelecionado     = null; // guarda a seleção quando os círculos são redesenhados
let legendaEl           = null;
let controleBusca       = null; // controle de busca (refeito a cada redesenho)
let dadosVisiveis       = { type: 'FeatureCollection', features: [] }; // comunidades que passam nos filtros
const desenhos          = new Set(); // formas desenhadas pelo usuário (Geoman)
let botaoExportarDesenhos = null;
let modoVisualizacao    = 'circulos'; // 'circulos' ou 'calor'
let camadaCalor         = null;       // camada do mapa de calor (leaflet.heat)
let areaAtiva           = null;       // forma desenhada cujo resumo está aberto no painel
let quadroArea          = null;       // requestAnimationFrame pendente do painel da área

// ─── TOGGLE DO PAINEL ─────────────────────────────────────────────────────────
function togglePainel() {
    document.getElementById('painel-lateral').classList.toggle('colapsado');
    // No desktop o mapa muda de largura; reajusta depois da animação do painel.
    setTimeout(() => map.invalidateSize(), 420);
}

// ─── FILTRO ───────────────────────────────────────────────────────────────────
document.getElementById('filtro-dados').addEventListener('change', () => {
    if (dadosGlobaisGeoJson) renderizarCamadaEspacial(dadosGlobaisGeoJson);
});

// ─── FILTROS (município, sistema de criação, escrituração) ────────────────────
// Os filtros escolhem QUAIS comunidades aparecem; a "Métrica espacial" escolhe
// COMO elas são desenhadas. Mapa, legenda, busca, visão geral e CSV usam só as
// comunidades filtradas.
const IDS_FILTROS = ['filtro-municipio', 'filtro-sistema', 'filtro-escrituracao'];
const CAMPO_SISTEMA = {
    extensiva:      'criacao_extensiva',
    semi_extensiva: 'criacao_semi_extensiva',
    intensiva:      'criacao_intensiva',
};

function lerFiltros() {
    return {
        municipio:    document.getElementById('filtro-municipio').value,
        sistema:      document.getElementById('filtro-sistema').value,
        escrituracao: document.getElementById('filtro-escrituracao').value,
    };
}
const filtrosAtivos = () => Object.values(lerFiltros()).filter(Boolean).length;

function passaNosFiltros(p, f) {
    if (f.municipio && String(p.municipio ?? '').trim() !== f.municipio) return false;

    if (f.sistema) {
        // Sistema predominante = o de maior valor na comunidade (empate conta para os dois).
        const maior = Math.max(...Object.values(CAMPO_SISTEMA).map((c) => Number(p[c]) || 0));
        if (maior <= 0 || (Number(p[CAMPO_SISTEMA[f.sistema]]) || 0) !== maior) return false;
    }

    if (f.escrituracao) {
        const sim = Number(p.escrituracao_sim) || 0;
        if (f.escrituracao === 'sem' && sim > 0)   return false; // alguém registra
        if (f.escrituracao === 'com' && sim === 0) return false; // ninguém registra
    }
    return true;
}

function filtrar(dadosGeo) {
    const f = lerFiltros();
    return {
        type: 'FeatureCollection',
        features: (dadosGeo.features || []).filter((ft) => passaNosFiltros(ft.properties || {}, f)),
    };
}

// Lista de municípios vem dos próprios dados. Sem a propriedade "municipio" na
// API, o campo fica escondido.
function prepararFiltros(dadosGeo) {
    const nomes = [...new Set((dadosGeo.features || [])
        .map((f) => String((f.properties || {}).municipio ?? '').trim())
        .filter(Boolean))]
        .sort((x, y) => x.localeCompare(y, 'pt-BR'));

    document.getElementById('campo-municipio').hidden = nomes.length === 0;
    document.getElementById('filtro-municipio').innerHTML =
        '<option value="">Todos</option>' +
        nomes.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
}

function atualizarInterfaceFiltros(total, visiveis) {
    const n = filtrosAtivos();
    const badge = document.getElementById('filtros-badge');
    badge.hidden = n === 0;
    badge.textContent = n;
    document.getElementById('btn-limpar-filtros').hidden = n === 0;
    document.getElementById('filtros-resultado').textContent =
        `${fmtInt(visiveis)} de ${fmtInt(total)} ${plural(total, 'comunidade', 'comunidades')}`;

    const btn = document.getElementById('btn-exportar-csv');
    btn.disabled = visiveis === 0;
    btn.querySelector('span').textContent = `Baixar CSV (${fmtInt(visiveis)})`;
}

function enquadrarVisiveis() {
    const pontos = dadosVisiveis.features
        .filter((f) => f.geometry && f.geometry.coordinates)
        .map((f) => L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]));
    if (pontos.length) map.fitBounds(L.latLngBounds(pontos), { padding: [40, 40], maxZoom: 13 });
}

function aoMudarFiltros(ajustarVista) {
    if (!dadosGlobaisGeoJson) return;
    renderizarCamadaEspacial(dadosGlobaisGeoJson);
    // Sem comunidade aberta (ou a aberta saiu do filtro): volta à visão geral já recalculada.
    // Com uma área desenhada aberta, o painel dela já foi refeito em renderizarCamadaEspacial.
    if (!marcadorSelecionado && !areaAtiva) mostrarResumoGeral();
    if (ajustarVista && filtrosAtivos()) enquadrarVisiveis();
}

IDS_FILTROS.forEach((id) =>
    document.getElementById(id).addEventListener('change', () => aoMudarFiltros(true)));

document.getElementById('btn-limpar-filtros').addEventListener('click', () => {
    IDS_FILTROS.forEach((id) => { document.getElementById(id).value = ''; });
    aoMudarFiltros(false);
});

// ─── EXPORTAÇÃO ───────────────────────────────────────────────────────────────
function nomeArquivo(base, extensao) {
    const d = new Date(), p = (n) => String(n).padStart(2, '0'); // data local, não UTC
    return `${base}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${extensao}`;
}

function baixarArquivo(conteudo, nome, tipo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// CSV para o Excel em português: separador ";", vírgula decimal e BOM (acentos).
function celulaCsv(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita que o Excel execute texto como fórmula
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const CAMPOS_NUMERICOS_CSV = [
    'total_produtores', 'qtd_caprinos', 'qtd_ovinos',
    'criacao_extensiva', 'criacao_semi_extensiva', 'criacao_intensiva',
    'escrituracao_sim', 'escrituracao_nao',
];
const NUM_OU_VAZIO = (v) => (v === null || v === undefined || v === '' ? '' : Number(v));

function exportarCsv() {
    const feats = dadosVisiveis.features;
    if (!feats.length) return;

    const temMunicipio = feats.some((f) => (f.properties || {}).municipio);
    const colunas = [
        'nome', ...(temMunicipio ? ['municipio'] : []), 'latitude', 'longitude',
        ...CAMPOS_NUMERICOS_CSV, 'informacoes_adicionais', 'observacoes',
    ];

    const linhas = [colunas.join(';')];
    feats.forEach((f) => {
        const p = f.properties || {};
        const coords = (f.geometry && f.geometry.coordinates) || [];
        const valores = {
            latitude:  coords[1],   // GeoJSON guarda [longitude, latitude]
            longitude: coords[0],
        };
        linhas.push(colunas.map((c) => {
            if (c in valores) return celulaCsv(valores[c]);
            if (CAMPOS_NUMERICOS_CSV.includes(c)) return celulaCsv(NUM_OU_VAZIO(p[c]));
            return celulaCsv(p[c]);
        }).join(';'));
    });

    const base = 'comunidades_caprinusig' + (filtrosAtivos() ? '_filtrado' : '');
    baixarArquivo('\ufeff' + linhas.join('\r\n'), nomeArquivo(base, 'csv'), 'text/csv;charset=utf-8');
}
document.getElementById('btn-exportar-csv').addEventListener('click', exportarCsv);

// ─── VISUALIZAÇÃO: CÍRCULOS OU MAPA DE CALOR ──────────────────────────────────
// No calor, o peso de cada comunidade é a métrica atual (raiz quadrada, para uma
// comunidade muito grande não apagar as demais). As comunidades continuam no mapa
// como pontos pequenos, para clicar, buscar e ver o tooltip.
const GRADIENTE_CALOR = { 0.15: '#bfd4fb', 0.4: '#2d69de', 0.7: '#eab444', 1: '#d4302e' };

document.querySelectorAll('.vis-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        if (modoVisualizacao === btn.dataset.modo) return;
        modoVisualizacao = btn.dataset.modo;
        document.querySelectorAll('.vis-btn').forEach((b) => {
            const ativo = b === btn;
            b.classList.toggle('ativo', ativo);
            b.setAttribute('aria-pressed', String(ativo));
        });
        if (dadosGlobaisGeoJson) renderizarCamadaEspacial(dadosGlobaisGeoJson);
    });
});

function desenharCalor(dados, filtro) {
    if (!L.heatLayer) return;
    const valores = dados.features.map((f) => Number(f.properties[filtro]) || 0);
    const maximo  = Math.max(0, ...valores);
    if (!maximo) return;

    const pontos = dados.features
        .map((f, i) => ({ f, v: valores[i] }))
        .filter(({ f, v }) => v > 0 && f.geometry && f.geometry.coordinates)
        .map(({ f, v }) => [f.geometry.coordinates[1], f.geometry.coordinates[0], Math.sqrt(v / maximo)]);
    if (!pontos.length) return;

    camadaCalor = L.heatLayer(pontos, {
        radius: 30, blur: 25, maxZoom: 11, minOpacity: 0.35, gradient: GRADIENTE_CALOR,
    }).addTo(map);
    // O canvas do calor fica atrás dos pontos e não captura cliques.
    if (camadaCalor._canvas) {
        camadaCalor._canvas.style.zIndex = '-1';
        camadaCalor._canvas.style.pointerEvents = 'none';
    }
}

// ─── CARGA DE DADOS ───────────────────────────────────────────────────────────
async function carregarDadosDaAPI() {
    const dot = document.getElementById('status-dot');
    try {
        const resposta = await fetch(API_URL);
        if (!resposta.ok) throw new Error("Falha na conexão com o servidor.");

        dadosGlobaisGeoJson = await resposta.json();

        prepararFiltros(dadosGlobaisGeoJson);
        renderizarCamadaEspacial(dadosGlobaisGeoJson); // também refaz a busca

        // Atualiza status visual
        if (dot) { dot.classList.remove('erro'); dot.classList.add('ok'); }
        document.getElementById('status-texto').textContent = 'API conectada · Dados em tempo real';

        mostrarResumoGeral();
    } catch (erro) {
        console.error("Erro na API:", erro);
        if (dot) { dot.classList.remove('ok'); dot.classList.add('erro'); }
        document.getElementById('status-texto').textContent = 'API indisponível';
        document.getElementById('conteudo-dinamico').innerHTML = `
            <div class="placeholder-wrap erro fade-in">
                <div class="placeholder-icon">${ico('triangle-alert')}</div>
                <p class="placeholder-texto">
                    Não foi possível carregar os dados.<br>
                    Verifique se a API está em execução.
                </p>
            </div>
        `;
    }
    renderizarIcones();
}

// ─── CÁLCULO DE RAIO (Otimizado para Pixels em Tela) ──────────────────────────
function calcularRaio(valor, tipo) {
    if (tipo === 'total_produtores') {
        return Math.min(Math.max(valor * 1.5, 6), 25); // Raio mínimo de 6px e máximo de 25px
    }
    return Math.min(Math.max(Math.sqrt(valor || 1) * 0.8, 6), 25);
}

// ─── RENDERIZAÇÃO ESPACIAL COM CLUSTER ────────────────────────────────────────
// Hex equivalentes (oklch -> hex) da paleta .theme-inovisertao do globals.css.
// O Leaflet precisa de cor literal no SVG; no resto da interface usamos var(--*).
const PALETA = {
    primary:     '#2d69de',   // azul da marca
    primaryDark: '#0e49bc',
    navy:        '#1b3a8f',   // marinho (um pouco mais claro que o do painel, para aparecer no mapa)
    navyDark:    '#041b5d',
    warning:     '#eab444',
    warningDark: '#c98f12',
    success:     '#269143',
    destructive: '#d4302e',
};

const CORES_FILTRO = {
    qtd_ovinos:             { fill: PALETA.navy,        stroke: PALETA.navyDark },
    qtd_caprinos:           { fill: PALETA.primary,     stroke: PALETA.primaryDark },
    total_produtores:       { fill: PALETA.warning,     stroke: PALETA.warningDark },
    criacao_extensiva:      { fill: PALETA.success,     stroke: PALETA.success },
    criacao_semi_extensiva: { fill: PALETA.warning,     stroke: PALETA.warningDark },
    criacao_intensiva:      { fill: PALETA.destructive, stroke: PALETA.destructive }
};

// Textos de cada métrica (tooltip e legenda).
const METRICAS = {
    qtd_ovinos:             { rotulo: 'ovinos',       titulo: 'Ovinos por comunidade' },
    qtd_caprinos:           { rotulo: 'caprinos',     titulo: 'Caprinos por comunidade' },
    total_produtores:       { rotulo: 'produtores',   titulo: 'Produtores por comunidade' },
    criacao_extensiva:      { rotulo: 'extensiva',    titulo: 'Criação extensiva' },
    criacao_semi_extensiva: { rotulo: 'semi-extensiva', titulo: 'Criação semi-extensiva' },
    criacao_intensiva:      { rotulo: 'intensiva',    titulo: 'Criação intensiva' },
};

// ─── SELEÇÃO DO MARCADOR ──────────────────────────────────────────────────────
function aplicarEstilo(layer) {
    if (!layer._estilos) return;
    layer.setStyle(layer === marcadorSelecionado ? layer._estilos.sel : layer._estilos.base);
}

function selecionarMarcador(layer) {
    const anterior = marcadorSelecionado;
    marcadorSelecionado = layer;
    nomeSelecionado = layer ? layer.feature.properties.nome : null;
    if (layer) areaAtiva = null; // abriu uma comunidade: sai do resumo da área
    if (anterior && anterior !== layer) aplicarEstilo(anterior);
    if (layer) {
        aplicarEstilo(layer);
        try { layer.bringToFront(); } catch (e) { /* fora do mapa (agrupado) */ }
    }
}

function renderizarCamadaEspacial(dadosGeo) {
    if (grupoCluster) map.removeLayer(grupoCluster);
    if (camadaCalor) { map.removeLayer(camadaCalor); camadaCalor = null; }
    marcadorSelecionado = null; // os círculos antigos saem; a seleção é refeita por nome abaixo

    const filtro = document.getElementById('filtro-dados').value;
    const cores  = CORES_FILTRO[filtro] || CORES_FILTRO.qtd_ovinos;
    const dados  = filtrar(dadosGeo); // só as comunidades que passam nos filtros
    dadosVisiveis = dados;

    grupoCluster = L.markerClusterGroup({
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        maxClusterRadius: modoVisualizacao === 'calor' ? 1 : 45 // no calor, praticamente sem agrupar
    });

    camadaGeoJson = L.geoJSON(dados, {
        pointToLayer: function (feature, latlng) {
            const valor = feature.properties[filtro] || 0;
            const calor = modoVisualizacao === 'calor';
            const raio  = calor ? 5 : calcularRaio(valor, filtro);
            
            const marcador = L.circleMarker(latlng, {
                radius:      raio,
                fillColor:   calor ? '#ffffff' : cores.fill,
                color:       calor ? PALETA.navyDark : cores.stroke,
                weight:      1.5,
                opacity:     calor ? 1 : 0.8,
                fillOpacity: calor ? 0.9 : 0.4,
                pmIgnore:    true, // o Geoman não edita, move nem apaga as comunidades
            });
            marcador._estilos = {
                base:  calor ? { weight: 1.5, opacity: 1, fillOpacity: 0.9 } : { weight: 1.5, opacity: 0.8, fillOpacity: 0.4 },
                hover: calor ? { weight: 2.5, opacity: 1, fillOpacity: 1 }   : { weight: 2.5, opacity: 0.8, fillOpacity: 0.7 },
                sel:   calor ? { weight: 4,   opacity: 1, fillOpacity: 1 }   : { weight: 4,   opacity: 1,   fillOpacity: 0.8 },
            };
            return marcador;
        },
        onEachFeature: function (feature, layer) {
            feature.properties.title = feature.properties.nome;

            // Tooltip no hover: nome e valor da métrica atual.
            const valorMetrica = feature.properties[filtro] || 0;
            const rotuloMetrica = (METRICAS[filtro] || {}).rotulo || '';
            layer.bindTooltip(
                `<strong>${esc(feature.properties.nome)}</strong><span>${fmtInt(valorMetrica)} ${rotuloMetrica}</span>`,
                { direction: 'top', offset: [0, -layer.getRadius()], className: 'tooltip-comunidade' }
            );

            // Redesenho (troca de métrica): mantém a comunidade aberta destacada.
            if (feature.properties.nome === nomeSelecionado) {
                marcadorSelecionado = layer;
                aplicarEstilo(layer);
            }

            layer.on({
                click: (e) => {
                    // Desenhando/editando com o Geoman: deixa o clique chegar ao mapa.
                    if (geomanAtivo()) return;
                    L.DomEvent.stopPropagation(e);
                    
                    const painel = document.getElementById('painel-lateral');
                    if (painel.classList.contains('colapsado')) togglePainel();
                    selecionarMarcador(layer);
                    exibirDadosNoPainel(feature.properties);
                },
                mouseover: () => { if (layer !== marcadorSelecionado) layer.setStyle(layer._estilos.hover); },
                mouseout:  () => aplicarEstilo(layer),
            });
        }
    });

    grupoCluster.addLayer(camadaGeoJson);
    map.addLayer(grupoCluster);
    if (modoVisualizacao === 'calor') desenharCalor(dados, filtro);
    atualizarLegenda(dados, filtro, cores);
    configurarBarraDeBusca(); // a busca precisa apontar para o grupo recém-criado
    atualizarInterfaceFiltros((dadosGeo.features || []).length, dados.features.length);
    atualizarSelecoesDeArea(); // filtros e métrica mudam quem está dentro das áreas desenhadas
}

// ─── LEGENDA ──────────────────────────────────────────────────────────────────
// Mostra a métrica atual, tamanhos de exemplo (menor, mediano e maior valor dos
// dados, com o mesmo raio dos círculos do mapa) e o que significam os clusters.
function criarLegenda() {
    const controle = L.control({ position: 'bottomright' });
    controle.onAdd = () => {
        legendaEl = L.DomUtil.create('div', 'legenda-mapa');
        L.DomEvent.disableClickPropagation(legendaEl);
        L.DomEvent.disableScrollPropagation(legendaEl);
        return legendaEl;
    };
    controle.addTo(map);
}

function atualizarLegenda(dadosGeo, filtro, cores) {
    if (!legendaEl) return;
    const aberta = legendaEl.querySelector('details')
        ? legendaEl.querySelector('details').open
        : !window.matchMedia('(max-width: 768px)').matches; // no celular começa fechada

    const valores = (dadosGeo.features || [])
        .map((f) => Number(f.properties[filtro]) || 0)
        .filter((v) => v > 0)
        .sort((a, b) => a - b);

    const exemplos = valores.length
        ? [...new Set([valores[valores.length - 1], valores[Math.floor((valores.length - 1) / 2)], valores[0]])]
        : [];

    const linhas = exemplos.map((v) => {
        const d = Math.round(calcularRaio(v, filtro) * 2);
        return `<li>
            <span class="legenda-bolha-box"><span class="legenda-bolha" style="width:${d}px;height:${d}px;"></span></span>
            <span>${fmtInt(v)}</span>
        </li>`;
    }).join('');

    const titulo = (METRICAS[filtro] || {}).titulo || 'Métrica';

    if (modoVisualizacao === 'calor') {
        const degrade = Object.entries(GRADIENTE_CALOR).map(([p, c]) => `${c} ${Math.round(p * 100)}%`).join(', ');
        legendaEl.innerHTML = `
        <details${aberta ? ' open' : ''}>
            <summary>Legenda</summary>
            <div class="legenda-corpo">
                <p class="legenda-titulo">Calor: ${titulo}</p>
                ${valores.length
                    ? `<div class="legenda-gradiente" style="background:linear-gradient(90deg, ${degrade});"></div>
                       <div class="legenda-gradiente-rotulos"><span>menos</span><span>mais</span></div>
                       <p class="legenda-nota">Quanto mais quente a cor, maior a concentração. Os pontos pequenos são as comunidades: clique para abrir.</p>`
                    : '<p class="legenda-nota">Nenhuma comunidade com esse dado.</p>'}
            </div>
        </details>`;
        return;
    }

    legendaEl.innerHTML = `
        <details${aberta ? ' open' : ''}>
            <summary>Legenda</summary>
            <div class="legenda-corpo" style="--fill:${cores.fill}; --stroke:${cores.stroke};">
                <p class="legenda-titulo">${titulo}</p>
                ${linhas ? `<ul class="legenda-lista">${linhas}</ul>
                <p class="legenda-nota">Quanto maior o círculo, maior a quantidade.</p>`
                         : '<p class="legenda-nota">Nenhuma comunidade com esse dado.</p>'}
                <div class="legenda-cluster">
                    <span class="legenda-cluster-dot">3</span>
                    <span>Comunidades próximas ficam agrupadas. Clique para ampliar.</span>
                </div>
            </div>
        </details>`;
}

// ─── VISÃO GERAL (painel sem comunidade aberta) ───────────────────────────────
function mostrarResumoGeral() {
    selecionarMarcador(null);
    areaAtiva = null;

    const feats = dadosVisiveis.features || [];
    const soma = (campo) => feats.reduce((s, f) => s + (Number(f.properties[campo]) || 0), 0);
    const n = feats.length;
    const total = ((dadosGlobaisGeoJson && dadosGlobaisGeoJson.features) || []).length;
    const filtrando = filtrosAtivos() > 0;
    const chipTexto = filtrando
        ? `${fmtInt(n)} de ${fmtInt(total)} ${plural(total, 'comunidade', 'comunidades')} (filtro ativo)`
        : `${fmtInt(n)} ${plural(n, 'comunidade cadastrada', 'comunidades cadastradas')}`;

    document.getElementById('conteudo-dinamico').innerHTML = `
    <div class="conteudo-painel fade-in">
        <div class="comunidade-header">
            <div class="badge-regiao">${ico('map-pin')} Semiárido Nordestino</div>
            <h2 class="titulo-comunidade">Visão geral${filtrando ? ' filtrada' : ''}</h2>
            <div class="comunidade-meta">
                <span class="meta-chip">${ico('database')} ${chipTexto}</span>
            </div>
        </div>

        <div class="grid-kpi">
            <div class="card-kpi" style="--acc: var(--success);">
                <div class="card-kpi-label">${ico('map-pin')} Comunidades</div>
                <div class="card-kpi-value">${fmtInt(n)}</div>
            </div>
            <div class="card-kpi" style="--acc: var(--warning);">
                <div class="card-kpi-label">${ico('users')} Produtores</div>
                <div class="card-kpi-value">${fmtInt(soma('total_produtores'))}</div>
            </div>
            <div class="card-kpi" style="--acc: var(--primary);">
                <div class="card-kpi-label">${ico('paw-print')} Caprinos</div>
                <div class="card-kpi-value">${fmtInt(soma('qtd_caprinos'))}<span class="card-kpi-unit">cab.</span></div>
            </div>
            <div class="card-kpi" style="--acc: var(--secondary);">
                <div class="card-kpi-label">${ico('paw-print')} Ovinos</div>
                <div class="card-kpi-value">${fmtInt(soma('qtd_ovinos'))}<span class="card-kpi-unit">cab.</span></div>
            </div>
        </div>

        ${n === 0 && filtrando ? `
        <div class="card-texto neutro dica">
            ${ico('filter-x')}
            <span>Nenhuma comunidade atende aos filtros escolhidos. Ajuste ou limpe os filtros.</span>
        </div>` : `
        <div class="card-texto verde dica">
            ${ico('mouse-pointer-click')}
            <span>Clique em uma comunidade no mapa para ver o relatório dela.</span>
        </div>`}
    </div>`;

    renderizarIcones();
}

// ─── EXIBIÇÃO NO PAINEL ───────────────────────────────────────────────────────
function exibirDadosNoPainel(p) {
    const painel = document.getElementById('conteudo-dinamico');

    const ext   = p.criacao_extensiva        || 0;
    const semi  = p.criacao_semi_extensiva  || 0;
    const int_  = p.criacao_intensiva        || 0;
    const totSis = ext + semi + int_ || 1;

    const pctExt  = +((ext  / totSis) * 100).toFixed(0);
    const pctSemi = +((semi / totSis) * 100).toFixed(0);
    const pctInt  = +((int_ / totSis) * 100).toFixed(0);

    const escrSim = p.escrituracao_sim || 0;
    const escrNao = p.escrituracao_nao || 0;
    const totEscr = escrSim + escrNao || 1;

    const pctSim = +((escrSim / totEscr) * 100).toFixed(0);
    const pctNao = +((escrNao / totEscr) * 100).toFixed(0);

    function barra(nome, icone, valor, pct, cor) {
        return `
        <div class="item-barra">
            <div class="item-barra-header">
                <span class="item-barra-nome">${ico(icone)} ${nome}</span>
                <span class="item-barra-valor">${fmtInt(valor)} <span class="item-barra-pct">(${pct}%)</span></span>
            </div>
            <div class="track">
                <div class="fill" style="width:${pct}%; --cor:${cor};"></div>
            </div>
        </div>`;
    }

    painel.innerHTML = `
    <div class="conteudo-painel fade-in">

        <div class="comunidade-header">
            <button type="button" class="btn-voltar" onclick="mostrarResumoGeral()">${ico('arrow-left')} Visão geral</button>
            <div class="badge-regiao">${ico('map-pin')} Semiárido Nordestino</div>
            <h2 class="titulo-comunidade">${esc(p.nome)}</h2>
            <div class="comunidade-meta">
                <span class="meta-chip">${ico('database')} Registro integrado</span>
                <span class="meta-chip">${ico('radio')} Dados em tempo real</span>
            </div>
        </div>

        <div class="grid-kpi">
            <div class="card-kpi card-kpi-full" style="--acc: var(--warning);">
                <div class="card-kpi-accent"></div>
                <div class="card-kpi-label">${ico('users')} Total de produtores</div>
                <div class="card-kpi-value">${fmtInt(p.total_produtores)}</div>
            </div>
            <div class="card-kpi" style="--acc: var(--primary);">
                <div class="card-kpi-accent"></div>
                <div class="card-kpi-label">${ico('paw-print')} Caprinos</div>
                <div class="card-kpi-value">${fmtInt(p.qtd_caprinos)}<span class="card-kpi-unit">cab.</span></div>
            </div>
            <div class="card-kpi" style="--acc: var(--secondary);">
                <div class="card-kpi-accent"></div>
                <div class="card-kpi-label">${ico('paw-print')} Ovinos</div>
                <div class="card-kpi-value">${fmtInt(p.qtd_ovinos)}<span class="card-kpi-unit">cab.</span></div>
            </div>
        </div>

        <div class="secao-titulo">Sistemas de criação</div>
        ${barra('Extensiva',      'trees',   ext,  pctExt,  'var(--success)')}
        ${barra('Semi-extensiva', 'compass', semi, pctSemi, 'var(--primary)')}
        ${barra('Intensiva',      'factory', int_, pctInt,  'var(--warning)')}

        <div class="secao-titulo">Escrituração zootécnica</div>
        ${barra('Realizam controle', 'circle-check', escrSim, pctSim, 'var(--success)')}
        ${barra('Não realizam',      'circle-x',     escrNao, pctNao, 'var(--destructive)')}

        <div class="secao-titulo">Informações de cadastro</div>
        <div class="card-texto verde">
            ${p.informacoes_adicionais ? esc(p.informacoes_adicionais) : '<span class="vazio">Nenhuma informação adicional cadastrada para esta comunidade.</span>'}
        </div>

        <div class="secao-titulo">Nota técnica de campo</div>
        <div class="card-texto neutro">
            <span class="nota-label">Observação do técnico</span>
            ${p.observacoes ? esc(p.observacoes) : '<span class="vazio">Nenhuma observação registrada pelo técnico de campo.</span>'}
        </div>

    </div>`;

    renderizarIcones();
}

// ─── BUSCA ESPACIAL (Adaptada para abrir o Cluster) ───────────────────────────
function configurarBarraDeBusca() {
    if (controleBusca) { map.removeControl(controleBusca); controleBusca = null; }

    controleBusca = new L.Control.Search({
        layer: grupoCluster,
        propertyName: 'title',
        marker: false,
        moveToLocation: function(latlng, title) {
            let marcadorAlvo = null;
            camadaGeoJson.eachLayer(layer => {
                if (layer.feature.properties.nome === title) marcadorAlvo = layer;
            });

            if (marcadorAlvo) {
                grupoCluster.zoomToShowLayer(marcadorAlvo, () => {
                    map.setView(latlng, 13);
                    marcadorAlvo.fire('click');
                });
            }
        }
    });
    map.addControl(controleBusca);
}

// ─── GEOLOCALIZAÇÃO ───────────────────────────────────────────────────────────
L.Control.Geolocalizacao = L.Control.extend({
    onAdd: function(map) {
        const container = L.DomUtil.create('div', 'leaflet-bar');
        const botao     = L.DomUtil.create('button', 'botao-geo', container);
        botao.innerHTML = ico('locate-fixed');
        botao.title     = 'Minha localização';
        botao.setAttribute('aria-label', 'Minha localização');
        botao.onclick   = (e) => {
            L.DomEvent.stopPropagation(e);
            map.locate({ setView: true, maxZoom: 14 });
        };
        return container;
    }
});
new L.Control.Geolocalizacao({ position: 'topleft' }).addTo(map);
renderizarIcones();

// ─── DESENHO E MEDIÇÃO (Leaflet-Geoman + Turf.js) ─────────────────────────────
// O Geoman (versão gratuita) desenha e edita linhas, polígonos e retângulos.
// A medição não vem nele: calculamos com o Turf.js e mostramos num tooltip.
map.pm.setLang('pt_br');
map.pm.setGlobalOptions({
    pathOptions: { color: PALETA.primary, weight: 3, fillOpacity: 0.15 },
    templineStyle: { color: PALETA.primary },
    hintlineStyle: { color: PALETA.primary, dashArray: [5, 5] },
});
map.pm.addControls({
    position:         'topleft',
    drawMarker:       false,
    drawCircleMarker: false,
    drawCircle:       true,
    drawText:         false,
    cutPolygon:       false,
    rotateMode:       false,
    drawPolyline:     true,
    drawRectangle:    true,
    drawPolygon:      true,
    editMode:         true,
    dragMode:         true,
    removalMode:      true,
});

// true enquanto algum modo do Geoman está ligado (evita abrir o painel).
function geomanAtivo() {
    return map.pm.globalDrawModeEnabled()
        || map.pm.globalEditModeEnabled()
        || map.pm.globalDragModeEnabled()
        || map.pm.globalRemovalModeEnabled();
}

const fmt = (n, casas = 2) => n.toLocaleString('pt-BR', { maximumFractionDigits: casas });

function textoMedida(layer) {
    if (layer instanceof L.Circle) { // círculo: raio em metros reais
        const r  = layer.getRadius();
        const m2 = Math.PI * r * r;
        return `<b>Raio:</b> ${fmt(r / 1000)} km (${fmt(r, 0)} m)<br>`
             + `<b>Área:</b> ${fmt(m2 / 10000)} ha (${fmt(m2, 0)} m²)`;
    }
    const gj = layer.toGeoJSON();
    if (layer instanceof L.Polygon) { // inclui retângulo
        const m2   = turf.area(gj);
        const perm = turf.length(turf.polygonToLine(gj), { units: 'kilometers' });
        return `<b>Área:</b> ${fmt(m2 / 10000)} ha (${fmt(m2, 0)} m²)<br>`
             + `<b>Perímetro:</b> ${fmt(perm)} km`;
    }
    const km = turf.length(gj, { units: 'kilometers' });
    return `<b>Distância:</b> ${fmt(km)} km (${fmt(km * 1000, 0)} m)`;
}

// ─── SELEÇÃO POR ÁREA DESENHADA ───────────────────────────────────────────────
// Polígono, retângulo e círculo contam as comunidades que estão dentro deles
// (só as que passam nos filtros, as mesmas do mapa). Linhas não selecionam nada.
const ehAreaSelecionavel = (l) => l instanceof L.Circle || l instanceof L.Polygon;

function comunidadesDentro(layer) {
    const pontos = (dadosVisiveis.features || [])
        .filter((f) => f.geometry && f.geometry.type === 'Point');
    try {
        if (layer instanceof L.Circle) {
            const centro = layer.getLatLng(), raio = layer.getRadius();
            return pontos.filter((f) => {
                const [lng, lat] = f.geometry.coordinates;
                return centro.distanceTo(L.latLng(lat, lng)) <= raio; // metros reais
            });
        }
        const poligono = layer.toGeoJSON(); // polígono e retângulo
        return pontos.filter((f) => turf.booleanPointInPolygon(f.geometry.coordinates, poligono));
    } catch (e) {
        return []; // forma incompleta ou inválida
    }
}

function resumoDaArea(layer) {
    const dentro = comunidadesDentro(layer);
    const soma = (campo) => dentro.reduce((t, f) => t + (Number((f.properties || {})[campo]) || 0), 0);
    return {
        dentro,
        n:          dentro.length,
        produtores: soma('total_produtores'),
        caprinos:   soma('qtd_caprinos'),
        ovinos:     soma('qtd_ovinos'),
    };
}

// Texto do tooltip permanente da forma: medidas + contagem (quando é uma área).
function textoForma(layer) {
    let html = textoMedida(layer);
    if (ehAreaSelecionavel(layer)) {
        const r = resumoDaArea(layer);
        html += `<br><b>Comunidades:</b> ${fmtInt(r.n)} · <b>Produtores:</b> ${fmtInt(r.produtores)}`
              + `<br><b>Caprinos:</b> ${fmtInt(r.caprinos)} · <b>Ovinos:</b> ${fmtInt(r.ovinos)}`;
    }
    return html;
}

function atualizarMedida(layer) {
    if (!layer.getTooltip()) return;
    try { layer.setTooltipContent(textoForma(layer)); } catch (e) { /* forma incompleta */ }
    if (layer === areaAtiva) agendarPainelDaArea(layer);
}

// Edição e arraste disparam muitos eventos: o painel é refeito no máximo uma vez por quadro.
function agendarPainelDaArea(layer) {
    if (quadroArea) cancelAnimationFrame(quadroArea);
    quadroArea = requestAnimationFrame(() => {
        quadroArea = null;
        if (layer === areaAtiva && map.hasLayer(layer)) mostrarSelecaoArea(layer);
    });
}

function atualizarSelecoesDeArea() {
    desenhosAtuais().forEach((l) => { if (ehAreaSelecionavel(l)) atualizarMedida(l); });
    // atualizarMedida agenda o painel da área ativa; aqui ele é refeito agora, então cancela o agendado.
    if (quadroArea) { cancelAnimationFrame(quadroArea); quadroArea = null; }
    if (areaAtiva && map.hasLayer(areaAtiva)) mostrarSelecaoArea(areaAtiva);
}

function descricaoForma(layer) {
    if (layer instanceof L.Circle) return `Círculo · raio ${fmt(layer.getRadius() / 1000)} km`;
    const km2 = turf.area(layer.toGeoJSON()) / 1e6;
    return `${layer instanceof L.Rectangle ? 'Retângulo' : 'Polígono'} · ${fmt(km2)} km²`;
}

// Abre uma comunidade a partir da lista da área (mesmo caminho da busca: desagrupa e clica).
function abrirComunidadePorFeature(feature) {
    let alvo = null;
    camadaGeoJson.eachLayer((l) => {
        if (l.feature.properties.nome === feature.properties.nome) alvo = l;
    });
    if (alvo) grupoCluster.zoomToShowLayer(alvo, () => alvo.fire('click'));
}

const MAX_LISTA_AREA = 100;

function mostrarSelecaoArea(layer, abrirPainel = false) {
    selecionarMarcador(null);
    areaAtiva = layer;

    if (abrirPainel) {
        // No celular o painel cobre o mapa inteiro: não abre sozinho (o tooltip da forma já traz os totais).
        const celular = window.matchMedia('(max-width: 768px)').matches;
        const painel  = document.getElementById('painel-lateral');
        if (!celular && painel.classList.contains('colapsado')) togglePainel();
    }

    const r = resumoDaArea(layer);
    const filtrando = filtrosAtivos() > 0;
    const lista = r.dentro
        .slice()
        .sort((a, b) => String((a.properties || {}).nome ?? '').localeCompare(String((b.properties || {}).nome ?? ''), 'pt-BR'))
        .slice(0, MAX_LISTA_AREA);

    const itens = lista.map((f, i) => {
        const p = f.properties || {};
        return `<li><button type="button" class="item-area" data-i="${i}">
            <span class="item-area-nome">${esc(p.nome)}</span>
            <span class="item-area-num">${fmtInt(p.total_produtores)} produtores · ${fmtInt(p.qtd_caprinos)} caprinos · ${fmtInt(p.qtd_ovinos)} ovinos</span>
        </button></li>`;
    }).join('');

    document.getElementById('conteudo-dinamico').innerHTML = `
    <div class="conteudo-painel">
        <div class="comunidade-header">
            <button type="button" class="btn-voltar" onclick="mostrarResumoGeral()">${ico('arrow-left')} Visão geral</button>
            <div class="badge-regiao">${ico('shapes')} Área desenhada</div>
            <h2 class="titulo-comunidade">Dentro da área</h2>
            <div class="comunidade-meta">
                <span class="meta-chip">${ico('ruler')} ${esc(descricaoForma(layer))}</span>
                ${filtrando ? `<span class="meta-chip">${ico('filter')} Filtros aplicados</span>` : ''}
            </div>
        </div>

        <div class="grid-kpi">
            <div class="card-kpi" style="--acc: var(--success);">
                <div class="card-kpi-label">${ico('map-pin')} Comunidades</div>
                <div class="card-kpi-value">${fmtInt(r.n)}</div>
            </div>
            <div class="card-kpi" style="--acc: var(--warning);">
                <div class="card-kpi-label">${ico('users')} Produtores</div>
                <div class="card-kpi-value">${fmtInt(r.produtores)}</div>
            </div>
            <div class="card-kpi" style="--acc: var(--primary);">
                <div class="card-kpi-label">${ico('paw-print')} Caprinos</div>
                <div class="card-kpi-value">${fmtInt(r.caprinos)}<span class="card-kpi-unit">cab.</span></div>
            </div>
            <div class="card-kpi" style="--acc: var(--secondary);">
                <div class="card-kpi-label">${ico('paw-print')} Ovinos</div>
                <div class="card-kpi-value">${fmtInt(r.ovinos)}<span class="card-kpi-unit">cab.</span></div>
            </div>
        </div>

        <button type="button" class="btn-area" id="btn-enquadrar-area">${ico('locate-fixed')} Enquadrar a área no mapa</button>

        ${r.n === 0 ? `
        <div class="card-texto neutro dica">
            ${ico('map-pin-off')}
            <span>Nenhuma comunidade dentro desta área${filtrando ? ' com os filtros atuais' : ''}.</span>
        </div>` : `
        <div class="secao-titulo">Comunidades na área</div>
        <ul class="lista-area">${itens}</ul>
        ${r.n > MAX_LISTA_AREA ? `<p class="legenda-nota">Mostrando ${MAX_LISTA_AREA} de ${fmtInt(r.n)} comunidades (os totais acima contam todas).</p>` : ''}`}
    </div>`;

    const conteudo = document.getElementById('conteudo-dinamico');
    conteudo.querySelector('#btn-enquadrar-area').addEventListener('click', () => {
        map.fitBounds(layer.getBounds(), { padding: [40, 40] });
    });
    conteudo.querySelectorAll('.item-area').forEach((btn) => {
        btn.addEventListener('click', () => abrirComunidadePorFeature(lista[Number(btn.dataset.i)]));
    });

    renderizarIcones();
}

map.on('pm:create', ({ layer }) => {
    if (!(layer instanceof L.Polyline) && !(layer instanceof L.Circle)) return; // polígono e retângulo também são Polyline
    layer.bindTooltip(textoForma(layer), {
        permanent: true, direction: 'center', className: 'medida-tooltip',
    });
    ['pm:edit', 'pm:markerdrag', 'pm:drag', 'pm:dragend', 'pm:vertexadded', 'pm:vertexremoved']
        .forEach((ev) => layer.on(ev, () => atualizarMedida(layer)));
});

// ─── EXPORTAR DESENHOS (GeoJSON) ──────────────────────────────────────────────
// Guarda as formas desenhadas. Círculos são exportados como polígono (GeoJSON
// não tem círculo) com o raio nas propriedades.
map.on('pm:create', ({ layer }) => {
    desenhos.add(layer);
    layer.on('remove', atualizarBotaoExportarDesenhos);
    atualizarBotaoExportarDesenhos();
});

const desenhosAtuais = () => [...desenhos].filter((l) => map.hasLayer(l));

function formaParaFeature(layer, indice) {
    const r2 = (n) => +n.toFixed(2);
    let f;
    if (layer instanceof L.Circle) {
        const c = layer.getLatLng(), raio = layer.getRadius();
        const m2 = Math.PI * raio * raio;
        f = turf.circle([c.lng, c.lat], raio, { steps: 64, units: 'meters' });
        f.properties = {
            forma: 'circulo', raio_m: r2(raio), area_m2: r2(m2), area_ha: r2(m2 / 10000),
            centro_lat: +c.lat.toFixed(6), centro_lng: +c.lng.toFixed(6),
        };
    } else if (layer instanceof L.Polygon) { // inclui retângulo
        f = layer.toGeoJSON();
        const m2   = turf.area(f);
        const perm = turf.length(turf.polygonToLine(f), { units: 'kilometers' });
        f.properties = {
            forma: layer instanceof L.Rectangle ? 'retangulo' : 'poligono',
            area_m2: r2(m2), area_ha: r2(m2 / 10000), perimetro_km: +perm.toFixed(3),
        };
    } else {
        f = layer.toGeoJSON();
        const km = turf.length(f, { units: 'kilometers' });
        f.properties = { forma: 'linha', distancia_km: +km.toFixed(3), distancia_m: r2(km * 1000) };
    }
    f.properties.id = indice + 1;
    return f;
}

function exportarDesenhos() {
    const formas = desenhosAtuais();
    if (!formas.length) return;
    const colecao = { type: 'FeatureCollection', features: formas.map(formaParaFeature) };
    baixarArquivo(JSON.stringify(colecao, null, 2), nomeArquivo('desenhos_caprinusig', 'geojson'), 'application/geo+json');
}

function atualizarBotaoExportarDesenhos() {
    if (!botaoExportarDesenhos) return;
    const n = desenhosAtuais().length;
    const texto = n
        ? `Exportar ${n} ${plural(n, 'forma desenhada', 'formas desenhadas')} (GeoJSON)`
        : 'Desenhe uma forma no mapa para exportar (GeoJSON)';
    botaoExportarDesenhos.disabled = n === 0;
    botaoExportarDesenhos.title = texto;
    botaoExportarDesenhos.setAttribute('aria-label', texto);
}

L.Control.ExportarDesenhos = L.Control.extend({
    onAdd: function () {
        const container = L.DomUtil.create('div', 'leaflet-bar');
        botaoExportarDesenhos = L.DomUtil.create('button', 'botao-geo', container);
        botaoExportarDesenhos.type = 'button';
        botaoExportarDesenhos.innerHTML = ico('download');
        L.DomEvent.disableClickPropagation(container);
        botaoExportarDesenhos.onclick = exportarDesenhos;
        return container;
    }
});
new L.Control.ExportarDesenhos({ position: 'topleft' }).addTo(map);
atualizarBotaoExportarDesenhos();
renderizarIcones();

// ─── SELEÇÃO POR ÁREA: LIGAÇÃO COM O DESENHO ──────────────────────────────────
// Ao terminar de desenhar um polígono, retângulo ou círculo, o painel mostra o
// resumo da área. Clicar na forma (fora dos modos do Geoman) reabre o resumo dela.
map.on('pm:create', ({ layer }) => {
    if (!ehAreaSelecionavel(layer)) return;
    layer.on('click', () => { if (!geomanAtivo()) mostrarSelecaoArea(layer, true); });
    layer.on('remove', () => { if (areaAtiva === layer) mostrarResumoGeral(); });
    mostrarSelecaoArea(layer, true);
});

// ─── CAMADAS IMPORTADAS (GeoJSON do usuário) ──────────────────────────────────
// O usuário escolhe um .geojson/.json (ex.: limites municipais) e ele é desenhado
// por baixo das comunidades. Cada camada tem liga/desliga no painel e no seletor
// de camadas do mapa (os dois ficam sincronizados), zoom e remoção.
const TAMANHO_MAX_GEOJSON = 20 * 1024 * 1024; // 20 MB
const CORES_CAMADAS = ['#7c3aed', '#0d9488', '#db2777', '#ea580c', '#475569', '#0891b2'];
const TIPOS_GEOMETRIA = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'];

// Painel próprio, abaixo dos círculos das comunidades (overlayPane = 400).
map.createPane('camadasImportadas');
map.getPane('camadasImportadas').style.zIndex = 380;
// Canvas aguenta melhor arquivos grandes (limites municipais) do que SVG.
const rendererImportado = L.canvas({ pane: 'camadasImportadas', padding: 0.5 });

const camadasImportadas = []; // { nome, cor, camada, el }
let contadorCamadas = 0;

const elMsgCamadas = document.getElementById('camadas-msg');
function mostrarMsgCamadas(texto, erro) {
    elMsgCamadas.textContent = texto;
    elMsgCamadas.classList.toggle('erro', !!erro);
    elMsgCamadas.hidden = !texto;
}

function normalizarGeoJson(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('não é um GeoJSON válido.');

    const crs = obj.crs && obj.crs.properties && String(obj.crs.properties.name || '');
    if (crs && !/4326|CRS84/i.test(crs)) {
        throw new Error(`está em outro sistema de coordenadas (${crs}). Converta para WGS 84 (EPSG:4326).`);
    }

    let colecao;
    if (obj.type === 'FeatureCollection') {
        if (!Array.isArray(obj.features)) throw new Error('FeatureCollection sem a lista "features".');
        colecao = obj;
    } else if (obj.type === 'Feature') {
        colecao = { type: 'FeatureCollection', features: [obj] };
    } else if (TIPOS_GEOMETRIA.includes(obj.type)) {
        colecao = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: obj }] };
    } else {
        throw new Error('tipo GeoJSON não reconhecido.');
    }

    const features = colecao.features.filter((f) => f && f.geometry && f.geometry.type);
    if (!features.length) throw new Error('não tem nenhuma geometria.');
    return { type: 'FeatureCollection', features };
}

// Tabela de atributos do popup (texto do arquivo sempre passa por esc()).
function htmlAtributos(props) {
    const chaves = Object.keys(props || {})
        .filter((k) => props[k] !== null && props[k] !== '' && typeof props[k] !== 'object');
    if (!chaves.length) return '<em>Sem atributos.</em>';
    const linhas = chaves.slice(0, 20)
        .map((k) => `<tr><th>${esc(k)}</th><td>${esc(props[k])}</td></tr>`).join('');
    const resto = chaves.length - 20;
    return `<table class="popup-attrs">${linhas}</table>`
         + (resto > 0 ? `<p class="popup-mais">+ ${resto} ${plural(resto, 'atributo', 'atributos')}</p>` : '');
}

function criarCamadaImportada(colecao, cor) {
    const ehPonto = (f) => /Point/.test((f.geometry || {}).type || '');
    return L.geoJSON(colecao, {
        pane:     'camadasImportadas',
        renderer: rendererImportado,
        pmIgnore: true, // o Geoman não edita, move nem apaga a camada importada
        style: (f) => (ehPonto(f)
            ? { color: cor, weight: 2, opacity: 1, fillColor: '#ffffff', fillOpacity: 0.9 }
            : { color: cor, weight: 2, opacity: 0.9, fillColor: cor, fillOpacity: 0.08 }),
        pointToLayer: (f, latlng) => L.circleMarker(latlng, {
            pane: 'camadasImportadas', renderer: rendererImportado, radius: 5, pmIgnore: true,
        }),
        onEachFeature: (feature, layer) => {
            layer.on('click', (e) => {
                if (geomanAtivo()) return; // desenhando: o clique vai para o mapa
                L.DomEvent.stopPropagation(e);
                L.popup({ maxWidth: 280 })
                    .setLatLng(e.latlng)
                    .setContent(htmlAtributos(feature.properties))
                    .openOn(map);
            });
        },
    });
}

function atualizarBadgeCamadas() {
    const badge = document.getElementById('camadas-badge');
    badge.hidden = camadasImportadas.length === 0;
    badge.textContent = camadasImportadas.length;
}

function criarItemCamada(item, n) {
    const li = document.createElement('li');
    li.className = 'camada-item';
    li.innerHTML = `
        <label class="camada-nome">
            <input type="checkbox" checked>
            <span class="camada-cor"></span>
            <span class="camada-texto"></span>
        </label>
        <span class="camada-qtd"></span>
        <button type="button" class="camada-btn" data-acao="zoom">${ico('locate-fixed')}</button>
        <button type="button" class="camada-btn" data-acao="remover">${ico('trash-2')}</button>`;

    const caixa = li.querySelector('input');
    li.querySelector('.camada-cor').style.background = item.cor;
    li.querySelector('.camada-texto').textContent = item.nome;
    li.querySelector('.camada-texto').title = item.nome;
    li.querySelector('.camada-qtd').textContent = `${fmtInt(n)} ${plural(n, 'feição', 'feições')}`;
    caixa.setAttribute('aria-label', `Mostrar a camada ${item.nome}`);
    li.querySelector('[data-acao="zoom"]').title = 'Ir para a camada';
    li.querySelector('[data-acao="zoom"]').setAttribute('aria-label', `Ir para a camada ${item.nome}`);
    li.querySelector('[data-acao="remover"]').title = 'Remover a camada';
    li.querySelector('[data-acao="remover"]').setAttribute('aria-label', `Remover a camada ${item.nome}`);

    // Liga/desliga pelo painel...
    caixa.addEventListener('change', () => {
        if (caixa.checked) map.addLayer(item.camada); else map.removeLayer(item.camada);
    });
    // ...ou pelo seletor de camadas do mapa: a caixa acompanha.
    item.camada.on('add',    () => { caixa.checked = true; });
    item.camada.on('remove', () => { caixa.checked = false; });

    li.querySelector('[data-acao="zoom"]').addEventListener('click', () => {
        if (!map.hasLayer(item.camada)) map.addLayer(item.camada);
        map.fitBounds(item.camada.getBounds(), { padding: [30, 30] });
    });
    li.querySelector('[data-acao="remover"]').addEventListener('click', () => {
        map.removeLayer(item.camada);
        controleCamadasMapa.removeLayer(item.camada);
        camadasImportadas.splice(camadasImportadas.indexOf(item), 1);
        li.remove();
        atualizarBadgeCamadas();
        mostrarMsgCamadas('', false);
    });
    return li;
}

async function importarArquivoGeoJson(arquivo) {
    const nome = arquivo.name.replace(/\.(geo)?json$/i, '') || 'Camada';
    if (arquivo.size > TAMANHO_MAX_GEOJSON) throw new Error(`"${arquivo.name}" passa de 20 MB.`);

    let obj;
    try { obj = JSON.parse(await arquivo.text()); }
    catch (e) { throw new Error(`"${arquivo.name}" não é um JSON válido.`); }

    let colecao;
    try { colecao = normalizarGeoJson(obj); }
    catch (e) { throw new Error(`"${arquivo.name}": ${e.message}`); }

    const cor    = CORES_CAMADAS[contadorCamadas % CORES_CAMADAS.length];
    const camada = criarCamadaImportada(colecao, cor);
    const limites = camada.getBounds();
    if (!limites.isValid() || !limitesNordeste.intersects(limites)) {
        throw new Error(`"${arquivo.name}": as coordenadas ficam fora da área do mapa. Confira se o arquivo está em WGS 84 (lat/long).`);
    }

    contadorCamadas += 1;
    const item = { nome, cor, camada };
    camadasImportadas.push(item);
    camada.addTo(map);
    controleCamadasMapa.addOverlay(camada, esc(nome)); // o seletor monta o nome como HTML
    document.getElementById('camadas-lista').appendChild(criarItemCamada(item, colecao.features.length));
    atualizarBadgeCamadas();
    renderizarIcones();
    map.fitBounds(limites, { padding: [30, 30] });
    return nome;
}

const entradaGeoJson = document.getElementById('camadas-arquivo');
document.getElementById('btn-importar-geojson').addEventListener('click', () => entradaGeoJson.click());
entradaGeoJson.addEventListener('change', async () => {
    const arquivos = [...entradaGeoJson.files];
    entradaGeoJson.value = ''; // permite importar o mesmo arquivo de novo
    if (!arquivos.length) return;

    const importadas = [], erros = [];
    for (const arquivo of arquivos) {
        try { importadas.push(await importarArquivoGeoJson(arquivo)); }
        catch (e) { erros.push(e.message); }
    }
    if (erros.length) mostrarMsgCamadas(erros.join(' '), true);
    else mostrarMsgCamadas(`${importadas.length} ${plural(importadas.length, 'camada importada', 'camadas importadas')}.`, false);
});

// ─── ESCALA, COORDENADAS, TELA CHEIA E HASH NA URL ────────────────────────────
// Escala em metros/km (sem milhas).
L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);

// Coordenadas: seguem o cursor no desktop e, no celular, mostram o ponto tocado.
L.Control.Coordenadas = L.Control.extend({
    onAdd: function (mapa) {
        const div = L.DomUtil.create('div', 'controle-coordenadas');
        div.textContent = 'Lat — · Lng —';
        const mostrar = (e) => {
            const f = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 5, maximumFractionDigits: 5 });
            div.textContent = `Lat ${f(e.latlng.lat)} · Lng ${f(e.latlng.lng)}`;
        };
        mapa.on('mousemove', mostrar);
        mapa.on('click', mostrar);
        return div;
    }
});
new L.Control.Coordenadas({ position: 'bottomleft' }).addTo(map);

// Tela cheia: usa a página toda (o painel continua visível). Se o navegador não
// suportar a API (iPhone), o plugin usa tela cheia simulada via CSS.
new L.Control.FullScreen({
    position:            'topright',
    title:               'Tela cheia',
    titleCancel:         'Sair da tela cheia',
    forceSeparateButton: true,
    fullscreenElement:   document.body,
}).addTo(map);
map.on('enterFullscreen exitFullscreen', () => setTimeout(() => map.invalidateSize(), 200));

// Hash na URL (#zoom/lat/lng): o endereço guarda a vista e dá para compartilhar.
// Implementação própria (sem plugin): lê o hash ao abrir e regrava a cada movimento.
// Também guarda a última vista no navegador (localStorage): ao abrir sem hash na URL,
// o mapa volta onde o usuário parou; só na primeira visita usa a VISTA_INICIAL.
(function configurarHash() {
    const CHAVE_VISTA = 'caprinusig:ultima-vista';
    let aplicando = false;

    const lerSalvo = () => { try { return localStorage.getItem(CHAVE_VISTA) || ''; } catch (e) { return ''; } };
    const salvar   = (h) => { try { localStorage.setItem(CHAVE_VISTA, h); } catch (e) { /* storage bloqueado */ } };

    function ler(hash) {
        const p = hash.replace(/^#/, '').split('/');
        if (p.length !== 3) return null;
        const zoom = parseFloat(p[0]), lat = parseFloat(p[1]), lng = parseFloat(p[2]);
        if ([zoom, lat, lng].some(isNaN) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
        return { zoom: zoom, center: L.latLng(lat, lng) };
    }

    function gravar() {
        if (aplicando) return;
        const c = map.getCenter(), z = map.getZoom();
        const casas = z >= 14 ? 5 : z >= 10 ? 4 : 3;
        const hash = `#${z}/${c.lat.toFixed(casas)}/${c.lng.toFixed(casas)}`;
        salvar(hash);
        if (hash === location.hash) return;
        try { history.replaceState(null, '', hash); } catch (e) { location.hash = hash; }
    }

    function aplicar(hash) {
        const v = ler(typeof hash === 'string' ? hash : location.hash);
        if (!v) return false;
        aplicando = true;
        map.setView(v.center, v.zoom, { animate: false });
        aplicando = false;
        return true;
    }

    map.on('moveend', gravar);
    window.addEventListener('hashchange', () => aplicar());
    // Prioridade ao abrir: 1) hash da URL  2) última vista salva  3) VISTA_INICIAL
    if (!aplicar(location.hash)) aplicar(lerSalvo());
    gravar();
})();

map.on('locationerror', () => alert("Não foi possível acessar sua geolocalização."));

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────
// Filtros começam abertos só em tela grande; no celular, o badge mostra se há filtro ativo.
document.getElementById('filtros').open = window.innerWidth > 768 && window.innerHeight >= 800;
renderizarIcones();
criarLegenda();
document.getElementById('conteudo-dinamico').innerHTML = htmlEsqueleto();
carregarDadosDaAPI();