from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import psycopg2
from psycopg2.extras import RealDictCursor

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Permite que qualquer frontend acesse a API nesta fase de desenvolvimento
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. VALIDADOR DE DADOS (Pydantic)
# Garante que o frontend envie os dados nos formatos corretos
class NovaComunidadeForm(BaseModel):
    nome: str
    informacoes_adicionais: Optional[str] = None
    total_produtores: int
    qtd_caprinos: int
    qtd_ovinos: int
    criacao_extensiva: int
    criacao_semi_extensiva: int
    criacao_intensiva: int
    escrituracao_sim: int
    escrituracao_nao: int
    observacoes: Optional[str] = None
    latitude: float
    longitude: float

# 2. CONEXÃO COM O BANCO (Com a correção de UTF-8 inclusa)
def get_db_connection():
    return psycopg2.connect(
        host="localhost", 
        database="sigweb_caprinu", 
        user="postgres", 
        password="inovi",  # Mantenha a sua senha aqui
        client_encoding="utf8",
        cursor_factory=RealDictCursor
    )

# Rota de teste que já criamos
@app.get("/")
async def rota_teste():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT postgis_version();")
        versao = cursor.fetchone()
        cursor.close(); conn.close()
        return {"status": "Sucesso!", "postgis": versao}
    except Exception as e:
        return {"status": "Erro", "detalhes": str(e)}

# 3. ROTA POST: Salva a comunidade e os dados zootécnicos
@app.post("/api/comunidades", status_code=status.HTTP_201_CREATED)
async def cadastrar_comunidade(dados: NovaComunidadeForm):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Insere na tabela comunidades e retorna o ID gerado (Longitude primeiro no PostGIS!)
        query_c = """
            INSERT INTO comunidades (nome, informacoes_adicionais, geom) 
            VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)) 
            RETURNING id;
        """
        cursor.execute(query_c, (dados.nome, dados.informacoes_adicionais, dados.longitude, dados.latitude))
        novo_id = cursor.fetchone()['id']

        # Insere na tabela de dados zootécnicos usando o ID da comunidade recém-criada
        query_p = """
            INSERT INTO coletas_producao 
            (comunidade_id, total_produtores, qtd_caprinos, qtd_ovinos, criacao_extensiva, criacao_semi_extensiva, criacao_intensiva, escrituracao_sim, escrituracao_nao, observacoes) 
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
        """
        cursor.execute(query_p, (
            novo_id, dados.total_produtores, dados.qtd_caprinos, dados.qtd_ovinos, 
            dados.criacao_extensiva, dados.criacao_semi_extensiva, dados.criacao_intensiva, 
            dados.escrituracao_sim, dados.escrituracao_nao, dados.observacoes
        ))
        
        # Confirma a transação nas duas tabelas
        conn.commit()
        return {"status": "sucesso", "id_cadastrado": novo_id}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close(); conn.close()

# 4. ROTA GET (GeoJSON): Transforma os dados do banco direto no formato do mapa
@app.get("/api/comunidades/geojson")
async def obter_geojson():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        query = """
            SELECT jsonb_build_object(
                'type', 'FeatureCollection', 
                'features', jsonb_agg(feature)
            ) as geojson
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature', 
                    'id', id, 
                    'geometry', ST_AsGeoJSON(geom)::jsonb,
                    'properties', jsonb_build_object(
                        'nome', nome, 
                        'informacoes_adicionais', informacoes_adicionais, 
                        'total_produtores', total_produtores, 
                        'qtd_caprinos', qtd_caprinos, 
                        'qtd_ovinos', qtd_ovinos, 
                        'criacao_extensiva', criacao_extensiva,
                        'criacao_semi_extensiva', criacao_semi_extensiva,
                        'criacao_intensiva', criacao_intensiva,
                        'escrituracao_sim', escrituracao_sim,
                        'escrituracao_nao', escrituracao_nao,
                        'observacoes', observacoes
                    )
                ) AS feature 
                FROM vw_comunidades_dashboard
            ) features;
        """
        cursor.execute(query)
        res = cursor.fetchone()
        
        if res['geojson'] and res['geojson']['features'] is not None:
            return res['geojson']
        else:
            return {"type": "FeatureCollection", "features": []}
            
    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))
    finally: 
        cursor.close(); conn.close()