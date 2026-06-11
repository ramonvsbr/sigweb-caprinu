with open("README.txt", "w", encoding="utf-8") as file:
    file.write("""# 🌍 SIGWeb Caprinu — Dashboard Geográfico do Semiárido

Este é um sistema de Informações Geográficas baseado na Web (WebGIS) projetado para monitorar, mapear e analisar dados zootécnicos e socioeconômicos da caprinocultura e ovinocultura no Semiárido Nordestino. 

O projeto adota uma arquitetura totalmente desacoplada, separando a inteligência espacial e armazenamento (PostgreSQL/PostGIS), a disponibilização de serviços via API RESTful (FastAPI/Python) e a interface dinâmica de alta performance para o usuário (HTML5/CSS3/Leaflet).

---

## 🚀 Funcionalidades Principais

* Mapeamento Temático Dinâmico: Visualização de comunidades através de marcadores circulares cujos raios e cores se adaptam proporcionalmente ao filtro selecionado.
* Filtros Avançados: Alternância em tempo real entre métricas de rebanho (Caprinos e Ovinos), Total de Produtores e Sistemas de Criação (Extensiva, Semi-extensiva e Intensiva).
* Agrupamento Espacial (Clusters): Agregação inteligente de comunidades próximas através do plugin Leaflet.markercluster, otimizando a performance visual e evitando sobreposição de dados.
* Painel Analítico Integrado: Barra lateral ergonômica que renderiza gráficos de progresso (sistemas de manejo e escrituração zootécnica) e exibe relatórios e notas técnicas de campo completas.
* Busca Avançada: Barra de pesquisa interna capaz de localizar comunidades pelo nome, abrindo automaticamente os clusters e focando o mapa no ponto alvo.

---

## 📂 Estrutura do Repositório

sigweb_caprinu/
│
├── backend/          # Engine em Python (API REST)
│   ├── venv/         # Ambiente virtual (omitido no .gitignore)
│   ├── main.py       # Endpoints, validações e conexão com o banco
│   └── requirements.txt
│
├── frontend/         # Interface do Usuário (Painel e Mapa)
│   ├── index.html    # Estrutura e carregamento de dependências
│   ├── style.css     # Folha de estilo segregada (Tema Terroso/Clean)
│   └── app.js        # Lógica do mapa, clusters e requisições assíncronas
│
└── README.txt         # Documentação do projeto

---

## 🛠️ Tecnologias Utilizadas

### Backend & Banco de Dados
* Python 3.x com FastAPI (Construção de rotas assíncronas de alta performance).
* Uvicorn (Servidor de aplicação ASGI).
* Pydantic (Validação rigorosa de tipos e esquemas de dados).
* Psycopg2 (Driver de comunicação nativa com suporte a encoding UTF-8).
* PostgreSQL 15+ com a extensão espacial PostGIS (Armazenamento de geometrias e geração nativa de coleções em formato GeoJSON).

### Frontend
* Leaflet.js v1.9.4 (Biblioteca core de mapas interativos).
* Leaflet.markercluster (Plugin para agrupamento dinâmico de pontos).
* Leaflet-search (Mecanismo de busca indexada de feições geográficas).
* Vanilla JavaScript (ES6+) (Consumo assíncrono via Fetch API e manipulação de DOM).

---

## 💻 Como Rodar o Projeto Localmente

### 1. Preparação do Banco de Dados
No seu terminal PostgreSQL (ou via pgAdmin), crie o banco de dados e ative a extensão espacial:
CREATE DATABASE sigweb_caprinu;
\\c sigweb_caprinu;
CREATE EXTENSION IF NOT EXISTS postgis;

Em seguida, certifique-se de executar os scripts de criação das tabelas (comunidades, coletas_producao) e a view gerenciadora (vw_comunidades_dashboard).

### 2. Inicialização do Backend
Navegue até a pasta do backend, instale as dependências e ligue o servidor local:
cd backend
python -m venv venv

# No Windows para ativar:
venv\\Scripts\\activate

pip install -r requirements.txt
uvicorn main:app --reload

A API estará acessível em http://127.0.0.1:8000. Você pode conferir os dados brutos estruturados pelo banco em http://127.0.0.1:8000/api/comunidades/geojson.

### 3. Execução do Frontend
Como a aplicação está desacoplada e utiliza requisições HTTP comuns:
1. Navegue até a pasta frontend.
2. Abra o arquivo index.html diretamente em qualquer navegador moderno (ou utilize extensões como o Live Server do VS Code).

---

## 🌐 Deploy (Produção)

O projeto está estruturado para ser hospedado gratuitamente ou de forma escalável em plataformas como o Render:
* Banco de Dados: Instância gerenciada do PostgreSQL no Render (com PostGIS habilitado).
* Backend: Configurado como Web Service apontando para a pasta backend, injetando a variável de ambiente DATABASE_URL.
* Frontend: Configurado como Static Site apontando para a pasta frontend.

---

## 📝 Licença

Este projeto é desenvolvido para fins técnicos e acadêmicos voltados ao desenvolvimento do Semiárido. Sinta-se livre para clonar, modificar e distribuir.
""")
