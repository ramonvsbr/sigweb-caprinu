-- 1. Ativar Extensão Espacial
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Tabela de Comunidades (Dados Fixos e GPS)
-- Quem cadastra (admin do Django, API) informa apenas latitude/longitude;
-- a coluna geom é derivada delas pelo próprio PostGIS.
CREATE TABLE comunidades (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    informacoes_adicionais TEXT,
    latitude  DOUBLE PRECISION CHECK (latitude  BETWEEN  -90 AND  90),
    longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
    -- Padrão GPS WGS 84. Coluna gerada: sempre reflete latitude/longitude,
    -- então não há como o ponto do mapa divergir dos números cadastrados.
    geom GEOMETRY(Point, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
    ) STORED
);

-- 3. Tabela de Coletas (Dados Variáveis e Notas do Técnico)
CREATE TABLE coletas_producao (
    id SERIAL PRIMARY KEY,
    comunidade_id INT REFERENCES comunidades(id) ON DELETE CASCADE,
    data_coleta DATE DEFAULT CURRENT_DATE,
    total_produtores INT DEFAULT 0,
    qtd_caprinos INT DEFAULT 0,
    qtd_ovinos INT DEFAULT 0,
    criacao_extensiva INT DEFAULT 0,
    criacao_semi_extensiva INT DEFAULT 0,
    criacao_intensiva INT DEFAULT 0,
    escrituracao_sim INT DEFAULT 0,
    escrituracao_nao INT DEFAULT 0,
    observacoes TEXT -- Campo descritivo de texto longo
);

-- 4. Índices: GiST espacial (busca por quadrantes) e FK das coletas
CREATE INDEX idx_comunidades_geom ON comunidades USING gist(geom);
CREATE INDEX idx_coletas_comunidade ON coletas_producao (comunidade_id, data_coleta DESC);

-- 5. View Unificada para a API (Evita JOINs pesados no Python)
-- DISTINCT ON garante UMA linha por comunidade: a coleta mais recente. Sem isso,
-- cadastrar uma segunda coleta pela mesma comunidade duplicaria o ponto no mapa.
CREATE OR REPLACE VIEW vw_comunidades_dashboard AS
SELECT DISTINCT ON (c.id)
    c.id, c.nome, c.informacoes_adicionais, c.latitude, c.longitude,
    p.data_coleta, p.total_produtores,
    p.qtd_caprinos, p.qtd_ovinos, p.criacao_extensiva, p.criacao_semi_extensiva,
    p.criacao_intensiva, p.escrituracao_sim, p.escrituracao_nao, p.observacoes, c.geom
FROM comunidades c
LEFT JOIN coletas_producao p ON c.id = p.comunidade_id
ORDER BY c.id, p.data_coleta DESC NULLS LAST, p.id DESC;
