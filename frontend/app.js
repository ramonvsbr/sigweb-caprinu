// ─── CONFIG ──────────────────────────────────────────────────────────────────
const API_URL = "http://127.0.0.1:8000/api/comunidades/geojson";

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

// Tile Layer — estilo neutro que combina com o painel terroso
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>'
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
        if(dot) dot.style.background = '#7EC8A0';

        document.getElementById('conteudo-dinamico').innerHTML = `
            <div class="placeholder-wrap fade-in">
                <div class="placeholder-icon">📍</div>
                <p class="placeholder-texto">
                    Clique em uma comunidade no mapa<br>para visualizar o relatório analítico.
                </p>
            </div>
        `;
    } catch (erro) {
        console.error("Erro na API:", erro);
        if(dot) dot.style.background = '#C85A3A';
        document.getElementById('conteudo-dinamico').innerHTML = `
            <div class="placeholder-wrap fade-in">
                <div class="placeholder-icon">⚠️</div>
                <p class="placeholder-texto" style="color: #C85A3A;">
                    Não foi possível carregar os dados.<br>
                    Verifique se a API está em execução.
                </p>
            </div>
        `;
    }
}

// ─── CÁLCULO DE RAIO (Otimizado para Pixels em Tela) ──────────────────────────
function calcularRaio(valor, tipo) {
    // Reduzimos drasticamente os raios para se adequarem a pixels de tela (L.circleMarker)
    if (tipo === 'total_produtores') {
        return Math.min(Math.max(valor * 1.5, 6), 25); // Raio mínimo de 6px e máximo de 25px
    }
    // Raio baseado na raiz quadrada para rebanhos grandes não dominarem a tela
    return Math.min(Math.max(Math.sqrt(valor || 1) * 0.8, 6), 25);
}

// ─── RENDERIZAÇÃO ESPACIAL COM CLUSTER ────────────────────────────────────────
const CORES_FILTRO = {
    qtd_ovinos:            { fill: '#2D4A3E', stroke: '#4A7C6F' },
    qtd_caprinos:          { fill: '#4A7C6F', stroke: '#7EC8A0' },
    total_produtores:      { fill: '#C8823A', stroke: '#E8A86A' },
    criacao_extensiva:     { fill: '#b45309', stroke: '#d97706' },
    criacao_semi_extensiva:{ fill: '#d97706', stroke: '#f59e0b' },
    criacao_intensiva:     { fill: '#dc2626', stroke: '#ef4444' }
};

function renderizarCamadaEspacial(dadosGeo) {
    // Remove o grupo de clusters antigo se ele já existir
    if (grupoCluster) map.removeLayer(grupoCluster);

    const filtro = document.getElementById('filtro-dados').value;
    const cores  = CORES_FILTRO[filtro] || CORES_FILTRO.qtd_ovinos;

    // Inicializa o plugin de cluster com animações suaves
    grupoCluster = L.markerClusterGroup({
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        maxClusterRadius: 45 // Distância em pixels para agrupar pontos próximos
    });

    camadaGeoJson = L.geoJSON(dadosGeo, {
        pointToLayer: function (feature, latlng) {
            const valor = feature.properties[filtro] || 0;
            const raio  = calcularRaio(valor, filtro);
            
            // CORREÇÃO: L.circleMarker mantém o tamanho fixo e proporcional na tela baseado em pixels!
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
                    // Evita propagação para o mapa disparar outros eventos involuntários
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

    // Em vez de adicionar a camada direto no mapa, adicionamos no Cluster
    grupoCluster.addLayer(camadaGeoJson);
    map.addLayer(grupoCluster);
}

// ─── EXIBIÇÃO NO PAINEL ───────────────────────────────────────────────────────
function exibirDadosNoPainel(p) {
    const painel = document.getElementById('conteudo-dinamico');

    // Sistemas de criação
    const ext   = p.criacao_extensiva       || 0;
    const semi  = p.criacao_semi_extensiva  || 0;
    const int_  = p.criacao_intensiva       || 0;
    const totSis = ext + semi + int_ || 1;

    const pctExt  = +((ext  / totSis) * 100).toFixed(0);
    const pctSemi = +((semi / totSis) * 100).toFixed(0);
    const pctInt  = +((int_ / totSis) * 100).toFixed(0);

    // Escrituração
    const escrSim = p.escrituracao_sim || 0;
    const escrNao = p.escrituracao_nao || 0;
    const totEscr = escrSim + escrNao || 1;

    const pctSim = +((escrSim / totEscr) * 100).toFixed(0);
    const pctNao = +((escrNao / totEscr) * 100).toFixed(0);

    function barra(nome, icon, valor, pct, cor) {
        return `
        <div class="item-barra">
            <div class="item-barra-header">
                <span class="item-barra-nome">${icon} ${nome}</span>
                <span class="item-barra-valor">${valor} <span class="item-barra-pct">(${pct}%)</span></span>
            </div>
            <div class="track">
                <div class="fill" style="width:${pct}%; background:${cor};"></div>
            </div>
        </div>`;
    }

    painel.innerHTML = `
    <div class="conteudo-painel fade-in">

        <div class="comunidade-header">
            <div class="badge-regiao">📍 Semiárido Nordestino</div>
            <h2 class="titulo-comunidade">${p.nome}</h2>
            <div class="comunidade-meta">
                <span class="meta-chip">🗂 Registro Integrado</span>
                <span class="meta-chip">📡 Dados em tempo real</span>
            </div>
        </div>

        <div class="grid-kpi">
            <div class="card-kpi card-kpi-full">
                <div class="card-kpi-accent" style="background:#C8823A;"></div>
                <div class="card-kpi-label" style="padding-left:10px;">👥 Total de Produtores</div>
                <div class="card-kpi-value" style="padding-left:10px;">${p.total_produtores || 0}</div>
            </div>
            <div class="card-kpi">
                <div class="card-kpi-accent" style="background:#4A7C6F;"></div>
                <div class="card-kpi-label" style="padding-left:10px;">🐐 Caprinos</div>
                <div class="card-kpi-value" style="padding-left:10px;">${p.qtd_caprinos || 0}<span class="card-kpi-unit">cab.</span></div>
            </div>
            <div class="card-kpi">
                <div class="card-kpi-accent" style="background:#2D4A3E;"></div>
                <div class="card-kpi-label" style="padding-left:10px;">🐑 Ovinos</div>
                <div class="card-kpi-value" style="padding-left:10px;">${p.qtd_ovinos || 0}<span class="card-kpi-unit">cab.</span></div>
            </div>
        </div>

        <div class="secao-titulo">Sistemas de Criação</div>
        ${barra('Extensiva',     '🏡', ext,  pctExt,  'linear-gradient(90deg,#2D4A3E,#7EC8A0)')}
        ${barra('Semi-extensiva','🧭', semi, pctSemi, 'linear-gradient(90deg,#4A7C6F,#7EC8A0)')}
        ${barra('Intensiva',     '🏭', int_, pctInt,  'linear-gradient(90deg,#C8823A,#E8A86A)')}

        <div class="secao-titulo">Escrituração Zootécnica</div>
        ${barra('Realizam controle', '✅', escrSim, pctSim, '#4A7C6F')}
        ${barra('Não realizam',      '❌', escrNao, pctNao, '#C85A3A')}

        <div class="secao-titulo">Informações de Cadastro</div>
        <div class="card-texto verde">
            ${p.informacoes_adicionais || '<i style="opacity:.6">Nenhuma informação adicional cadastrada para esta comunidade.</i>'}
        </div>

        <div class="secao-titulo">Nota Técnica de Campo</div>
        <div class="card-texto neutro">
            <span class="nota-label">Observação do Técnico</span>
            ${p.observacoes || '<i style="opacity:.6">Nenhuma observação registrada pelo técnico de campo.</i>'}
        </div>

    </div>`;
}

// ─── BUSCA ESPACIAL (Adaptada para abrir o Cluster) ───────────────────────────
function configurarBarraDeBusca() {
    // Se o controle de busca já existe, não duplica
    const buscaExistente = map.controls ? map.controls.find(c => c instanceof L.Control.Search) : null;
    if (buscaExistente) map.removeControl(buscaExistente);

    const controleBusca = new L.Control.Search({
        layer: grupoCluster, // Aponta para o Cluster para conseguir achar marcadores recolhidos
        propertyName: 'title',
        marker: false,
        moveToLocation: function(latlng, title) {
            // Encontra o marcador correspondente
            let marcadorAlvo = null;
            camadaGeoJson.eachLayer(layer => {
                if (layer.feature.properties.nome === title) marcadorAlvo = layer;
            });

            if (marcadorAlvo) {
                // Força o plugin de cluster a dar zoom e abrir o grupo até revelar este ponto específico
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
        botao.innerHTML = '🎯';
        botao.title     = 'Minha Localização';
        botao.onclick   = (e) => {
            L.DomEvent.stopPropagation(e);
            map.locate({ setView: true, maxZoom: 14 });
        };
        return container;
    }
});
new L.Control.Geolocalizacao({ position: 'topleft' }).addTo(map);

map.on('locationerror', () => alert("Não foi possível acessar sua geolocalização."));

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────
carregarDadosDaAPI();