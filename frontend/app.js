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

// Vista inicial: semiárido pernambucano (Sertão, Agreste e São Francisco).
// [sul, oeste] e [norte, leste]. Ajuste aqui se quiser enquadrar mais ou menos área.
const VISTA_INICIAL = L.latLngBounds(
    L.latLng(-9.5, -41.4),
    L.latLng(-7.3, -36.0)
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

L.control.layers({ 'Ruas': mapaRuas, 'Satélite': mapaSatelite }, null, {
    position: 'topright',
    collapsed: true,
}).addTo(map);

// Controles de zoom posicionados à esquerda
L.control.zoom({ position: 'topleft' }).addTo(map);

// ─── ESTADO GLOBAL ────────────────────────────────────────────────────────────
let camadaGeoJson       = null;
let grupoCluster        = null; // Nova variável para gerenciar o agrupamento
let dadosGlobaisGeoJson = null;

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

// ─── CARGA DE DADOS ───────────────────────────────────────────────────────────
async function carregarDadosDaAPI() {
    const dot = document.getElementById('status-dot');
    try {
        const resposta = await fetch(API_URL);
        if (!resposta.ok) throw new Error("Falha na conexão com o servidor.");

        dadosGlobaisGeoJson = await resposta.json();

        renderizarCamadaEspacial(dadosGlobaisGeoJson);
        configurarBarraDeBusca();

        // Atualiza status visual
        if (dot) { dot.classList.remove('erro'); dot.classList.add('ok'); }
        document.getElementById('status-texto').textContent = 'API conectada · Dados em tempo real';

        document.getElementById('conteudo-dinamico').innerHTML = `
            <div class="placeholder-wrap fade-in">
                <div class="placeholder-icon">${ico('mouse-pointer-click')}</div>
                <p class="placeholder-texto">
                    Clique em uma comunidade no mapa<br>para ver o relatório.
                </p>
            </div>
        `;
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

function renderizarCamadaEspacial(dadosGeo) {
    if (grupoCluster) map.removeLayer(grupoCluster);

    const filtro = document.getElementById('filtro-dados').value;
    const cores  = CORES_FILTRO[filtro] || CORES_FILTRO.qtd_ovinos;

    grupoCluster = L.markerClusterGroup({
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        maxClusterRadius: 45
    });

    camadaGeoJson = L.geoJSON(dadosGeo, {
        pointToLayer: function (feature, latlng) {
            const valor = feature.properties[filtro] || 0;
            const raio  = calcularRaio(valor, filtro);
            
            return L.circleMarker(latlng, {
                radius:      raio,
                fillColor:   cores.fill,
                color:       cores.stroke,
                weight:      1.5,
                opacity:     0.8,
                fillOpacity: 0.4,
                pmIgnore:    true, // o Geoman não edita, move nem apaga as comunidades
            });
        },
        onEachFeature: function (feature, layer) {
            feature.properties.title = feature.properties.nome;

            layer.on({
                click: (e) => {
                    // Desenhando/editando com o Geoman: deixa o clique chegar ao mapa.
                    if (geomanAtivo()) return;
                    L.DomEvent.stopPropagation(e);
                    
                    const painel = document.getElementById('painel-lateral');
                    if (painel.classList.contains('colapsado')) togglePainel();
                    exibirDadosNoPainel(feature.properties);
                },
                mouseover: function () { this.setStyle({ fillOpacity: 0.7, weight: 2.5 }); },
                mouseout:  function () { this.setStyle({ fillOpacity: 0.4, weight: 1.5 }); },
            });
        }
    });

    grupoCluster.addLayer(camadaGeoJson);
    map.addLayer(grupoCluster);
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
                <span class="item-barra-valor">${valor} <span class="item-barra-pct">(${pct}%)</span></span>
            </div>
            <div class="track">
                <div class="fill" style="width:${pct}%; --cor:${cor};"></div>
            </div>
        </div>`;
    }

    painel.innerHTML = `
    <div class="conteudo-painel fade-in">

        <div class="comunidade-header">
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
                <div class="card-kpi-value">${p.total_produtores || 0}</div>
            </div>
            <div class="card-kpi" style="--acc: var(--primary);">
                <div class="card-kpi-accent"></div>
                <div class="card-kpi-label">${ico('paw-print')} Caprinos</div>
                <div class="card-kpi-value">${p.qtd_caprinos || 0}<span class="card-kpi-unit">cab.</span></div>
            </div>
            <div class="card-kpi" style="--acc: var(--secondary);">
                <div class="card-kpi-accent"></div>
                <div class="card-kpi-label">${ico('paw-print')} Ovinos</div>
                <div class="card-kpi-value">${p.qtd_ovinos || 0}<span class="card-kpi-unit">cab.</span></div>
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
    const buscaExistente = map.controls ? map.controls.find(c => c instanceof L.Control.Search) : null;
    if (buscaExistente) map.removeControl(buscaExistente);

    const controleBusca = new L.Control.Search({
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

function atualizarMedida(layer) {
    if (!layer.getTooltip()) return;
    try { layer.setTooltipContent(textoMedida(layer)); } catch (e) { /* forma incompleta */ }
}

map.on('pm:create', ({ layer }) => {
    if (!(layer instanceof L.Polyline) && !(layer instanceof L.Circle)) return; // polígono e retângulo também são Polyline
    layer.bindTooltip(textoMedida(layer), {
        permanent: true, direction: 'center', className: 'medida-tooltip',
    });
    ['pm:edit', 'pm:markerdrag', 'pm:dragend', 'pm:vertexadded', 'pm:vertexremoved']
        .forEach((ev) => layer.on(ev, () => atualizarMedida(layer)));
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

// Hash na URL (#zoom/lat/lng). O parser original usa parseInt no zoom e perderia
// os zooms quebrados (zoomSnap 0,25); aqui trocamos por parseFloat.
L.Hash.prototype.parseHash = function (hash) {
    if (hash.indexOf('#') === 0) hash = hash.substr(1);
    const args = hash.split('/');
    if (args.length !== 3) return false;
    const zoom = parseFloat(args[0]), lat = parseFloat(args[1]), lng = parseFloat(args[2]);
    if (isNaN(zoom) || isNaN(lat) || isNaN(lng)) return false;
    return { center: new L.LatLng(lat, lng), zoom: zoom };
};
new L.Hash(map); // depois do fitBounds inicial: se a URL tiver hash, ele vence a vista inicial


map.on('locationerror', () => alert("Não foi possível acessar sua geolocalização."));

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────
renderizarIcones();
carregarDadosDaAPI();