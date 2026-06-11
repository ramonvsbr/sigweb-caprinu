-- Garante que o banco está limpo antes da carga (opcional, mas bom para evitar duplicidade)
TRUNCATE comunidades, coletas_producao RESTART IDENTITY CASCADE;

-- 1. Inserção das 10 Comunidades (Coordenadas Reais do Semiárido - Longitude primeiro no PostGIS)
INSERT INTO comunidades (nome, informacoes_adicionais, geom) VALUES
('Associação Vereda do Bode', 'Região de sequeiro, forte tradição em caprinos.', ST_SetSRID(ST_MakePoint(-40.2534, -9.3845), 4326)),
('Cooperativa Mandacaru', 'Próxima à bacia do São Francisco.', ST_SetSRID(ST_MakePoint(-40.5012, -9.4021), 4326)),
('Comunidade Angico Seco', 'Grupo de mulheres produtoras de derivados de leite.', ST_SetSRID(ST_MakePoint(-39.8214, -10.1245), 4326)),
('Associação Caroá', 'Foco em melhoramento genético de ovinos.', ST_SetSRID(ST_MakePoint(-39.5055, -9.8912), 4326)),
('Sítio Umbuzeiro Grande', 'Produção integrada com palma forrageira.', ST_SetSRID(ST_MakePoint(-40.1123, -9.6541), 4326)),
('Comunidade Caatinga Viva', 'Projeto piloto de manejo sustentável da vegetação nativa.', ST_SetSRID(ST_MakePoint(-40.7891, -9.2104), 4326)),
('Associação Riacho do Mel', 'Pequenos produtores familiares agrupados.', ST_SetSRID(ST_MakePoint(-39.2987, -8.7541), 4326)),
('Cooperativa Bode Rei', 'Famosa pela feira de animais local.', ST_SetSRID(ST_MakePoint(-38.9542, -7.8845), 4326)),
('Associação Sertão Verde', 'Dificuldade histórica de acesso à água, uso de cisternas.', ST_SetSRID(ST_MakePoint(-41.1245, -10.5012), 4326)),
('Comunidade Algodões', 'Parceria com o poder público para assistência técnica.', ST_SetSRID(ST_MakePoint(-39.9512, -9.1124), 4326));

-- 2. Inserção das Coletas Zootécnicas Casadas (ID 1 a 10)
INSERT INTO coletas_producao (comunidade_id, data_coleta, total_produtores, qtd_caprinos, qtd_ovinos, criacao_extensiva, criacao_semi_extensiva, criacao_intensiva, escrituracao_sim, escrituracao_nao, observacoes) VALUES
(1, '2026-03-15', 18, 450, 120, 15, 3, 0, 5, 13, 'Necessitam de capacitação urgente em manejo reprodutivo.'),
(2, '2026-03-20', 32, 890, 410, 10, 20, 2, 18, 14, 'Boa organização interna. Resfriador de leite comunitário ativo.'),
(3, '2026-04-02', 12, 210, 80,  12, 0, 0, 2, 10, 'Foco em queijos artesanais. Demanda por selo de inspeção.'),
(4, '2026-04-10', 25, 150, 950, 5, 15, 5, 22, 3, 'Rebanho ovino de alta qualidade genética (Santa Inês).'),
(5, '2026-04-18', 8,  190, 110, 4, 4, 0, 0, 8, 'Suplementação alimentar baseada estritamente em palma.'),
(6, '2026-04-25', 40, 1200, 350, 38, 2, 0, 10, 30, 'Área territorial vasta, animais criados soltos na caatinga.'),
(7, '2026-05-01', 15, 310, 240, 10, 5, 0, 4, 11, 'Produtores relatam ataques esporádicos de predadores nativos.'),
(8, '2026-05-05', 55, 1500, 1100, 20, 30, 5, 45, 10, 'Maior associação da microrregião. Controle zootécnico excelente.'),
(9, '2026-05-12', 10, 180, 90,  10, 0, 0, 1, 9, 'Período de estiagem severa afetando o escore corporal dos animais.'),
(10, '2026-05-20', 22, 400, 530, 8, 14, 0, 12, 10, 'Contam com apoio veterinário trimestral de uma ONG parceira.');