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
const limitesNordeste = L.latLngBounds(
    L.latLng(-18.5, -49.0),
    L.latLng(-1.0,  -34.5)
);

const map = L.map('map', {
    center: [-8.7214, -39.1164],
    zoom: 7.2,
    maxZoom: 18,
    minZoom: 5.5,
    maxBounds: limitesNordeste,
    maxBoundsViscosity: 1.0,
    zoomControl: false,
});

// Tile Layer — OpenStreetMap (Gratuito, sem necessidade de API Key)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
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
            });
        },
        onEachFeature: function (feature, layer) {
            feature.properties.title = feature.properties.nome;

            layer.on({
                click: (e) => {
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

map.on('locationerror', () => alert("Não foi possível acessar sua geolocalização."));

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────
renderizarIcones();
carregarDadosDaAPI();