#!/bin/sh
# Aplica as migrações de banco_de_dados/ que ainda não rodaram neste banco.
#
# Rodado pelo serviço sigweb-migrate a cada `docker compose up`. Os scripts de
# /docker-entrypoint-initdb.d/ só rodam em volume vazio; num banco que já existe
# é este script que fecha a diferença entre o esquema no disco e o do repositório.
#
# Cada migracao_NN_*.sql roda uma única vez: o nome do arquivo fica registrado
# em migracoes_aplicadas. Ainda assim, escreva sempre migração idempotente
# (ADD COLUMN IF NOT EXISTS, DROP ... IF EXISTS, CREATE OR REPLACE VIEW) — em
# banco novo, criacao_tabelas.sql já cria o esquema final e a migração roda
# depois, por cima.

set -eu

export PGPASSWORD="$DB_PASSWORD"
psql() {
    command psql \
        --host="$DB_HOST" --port="$DB_PORT" \
        --username="$DB_USER" --dbname="$DB_NAME" \
        --no-psqlrc --quiet -v ON_ERROR_STOP=1 "$@"
}

# O healthcheck do compose já segura a largada; esta espera é para quando o
# script é chamado à mão (docker compose run --rm sigweb-migrate).
tentativa=1
until psql -c 'SELECT 1' >/dev/null 2>&1; do
    if [ "$tentativa" -ge 30 ]; then
        echo "Banco não respondeu em 60s — abortando." >&2
        exit 1
    fi
    tentativa=$((tentativa + 1))
    sleep 2
done

psql -c "CREATE TABLE IF NOT EXISTS migracoes_aplicadas (
    nome        TEXT PRIMARY KEY,
    aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);"

for arquivo in /migracoes/migracao_*.sql; do
    # Glob sem correspondência vem literal — nada a fazer.
    [ -e "$arquivo" ] || continue
    nome=$(basename "$arquivo")

    if [ -n "$(psql --tuples-only --no-align \
            -c "SELECT 1 FROM migracoes_aplicadas WHERE nome = '$nome'")" ]; then
        echo "· $nome (já aplicada)"
        continue
    fi

    echo "→ aplicando $nome"
    psql -f "$arquivo"
    psql -c "INSERT INTO migracoes_aplicadas (nome) VALUES ('$nome');"
    echo "✓ $nome"
done

echo "Migrações em dia."
