-- Migração 01 — geom passa a ser derivado de latitude/longitude
--
-- Só é necessária em bancos que JÁ EXISTEM (criados pela versão antiga de
-- criacao_tabelas.sql). Em banco novo, criacao_tabelas.sql já vem no formato final.
--
-- Motivo: o cadastro passou a ser feito pelo admin do Django (caprinu_api), que
-- fala SQL comum e não PostGIS. Com latitude/longitude como colunas normais e
-- geom como coluna GERADA, o Django escreve dois números e o PostGIS mantém o
-- ponto — a view, o índice espacial e a API continuam funcionando igual.
--
-- Não precisa aplicar à mão: o serviço sigweb-migrate roda a cada
-- `docker compose up` e aplica o que ainda falta (ver aplicar_migracoes.sh).
--
-- É idempotente: rodar duas vezes não causa dano.

BEGIN;

-- A view depende de geom, então precisa sair da frente antes do ALTER.
DROP VIEW IF EXISTS vw_comunidades_dashboard;

ALTER TABLE comunidades ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE comunidades ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Preserva o que já foi cadastrado: extrai os números do ponto existente.
UPDATE comunidades
   SET latitude  = ST_Y(geom),
       longitude = ST_X(geom)
 WHERE geom IS NOT NULL
   AND (latitude IS NULL OR longitude IS NULL);

ALTER TABLE comunidades DROP CONSTRAINT IF EXISTS comunidades_latitude_check;
ALTER TABLE comunidades DROP CONSTRAINT IF EXISTS comunidades_longitude_check;
ALTER TABLE comunidades
    ADD CONSTRAINT comunidades_latitude_check  CHECK (latitude  BETWEEN  -90 AND  90),
    ADD CONSTRAINT comunidades_longitude_check CHECK (longitude BETWEEN -180 AND 180);

-- Recria geom como coluna gerada (o DROP leva junto o índice GiST antigo).
ALTER TABLE comunidades DROP COLUMN IF EXISTS geom;
ALTER TABLE comunidades ADD COLUMN geom GEOMETRY(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
) STORED;

CREATE INDEX IF NOT EXISTS idx_comunidades_geom ON comunidades USING gist(geom);
CREATE INDEX IF NOT EXISTS idx_coletas_comunidade ON coletas_producao (comunidade_id, data_coleta DESC);

-- View recriada com DISTINCT ON: uma linha por comunidade (a coleta mais
-- recente). Sem isso, uma segunda coleta duplicaria o ponto no mapa.
CREATE VIEW vw_comunidades_dashboard AS
SELECT DISTINCT ON (c.id)
    c.id, c.nome, c.informacoes_adicionais, c.latitude, c.longitude,
    p.data_coleta, p.total_produtores,
    p.qtd_caprinos, p.qtd_ovinos, p.criacao_extensiva, p.criacao_semi_extensiva,
    p.criacao_intensiva, p.escrituracao_sim, p.escrituracao_nao, p.observacoes, c.geom
FROM comunidades c
LEFT JOIN coletas_producao p ON c.id = p.comunidade_id
ORDER BY c.id, p.data_coleta DESC NULLS LAST, p.id DESC;

COMMIT;
