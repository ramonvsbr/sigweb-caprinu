-- 1. Ativar Extensão Espacial
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Tabela de Comunidades (Dados Fixos e GPS)
CREATE TABLE comunidades (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    informacoes_adicionais TEXT,
    geom GEOMETRY(Point, 4326) -- Padrão GPS WGS 84 (Longitude, Latitude)
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

-- 4. Índice Espacial GiST (Otimização para busca por quadrantes no mapa)
CREATE INDEX idx_comunidades_geom ON comunidades USING gist(geom);

-- 5. View Unificada para a API (Evita JOINs pesados no Python)
CREATE OR REPLACE VIEW vw_comunidades_dashboard AS
SELECT
    c.id, c.nome, c.informacoes_adicionais, p.data_coleta, p.total_produtores,
    p.qtd_caprinos, p.qtd_ovinos, p.criacao_extensiva, p.criacao_semi_extensiva,
    p.criacao_intensiva, p.escrituracao_sim, p.escrituracao_nao, p.observacoes, c.geom
FROM comunidades c
LEFT JOIN coletas_producao p ON c.id = p.comunidade_id;