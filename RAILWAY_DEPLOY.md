# Deploy no Railway — passo a passo

## 1. Criar projeto no Railway

1. Acesse [railway.app](https://railway.app) e faça login com GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Selecione `leandroborgeseng/manuais_anvisa`
4. Railway detecta o `Dockerfile` na raiz e inicia o build automaticamente

## 2. Adicionar PostgreSQL

1. No projeto Railway, clique em **+ New** → **Database** → **PostgreSQL**
2. Após provisionar, clique no serviço PostgreSQL → **Variables** → copie `DATABASE_URL`
3. No serviço do app, adicione a variável `DATABASE_URL` com o valor copiado
4. As migrations rodam automaticamente no startup

## 3. Variáveis de ambiente do app

No serviço web (não no PostgreSQL), em **Variables**:

```
JWT_SECRET=<gere com: openssl rand -hex 32>
B2_APPLICATION_KEY_ID=<sua chave B2>
B2_APPLICATION_KEY=<sua chave secreta B2>
B2_BUCKET_NAME=anvisa-manuais
MAX_FILES=100
MAX_WORKERS=4
```

## 4. Verificar deploy

- Logs: aba **Deployments** → clique no deploy → **View Logs**
- Health: `https://<seu-app>.up.railway.app/health` deve retornar `{"ok":true}`
- Dashboard: abra a URL pública gerada pelo Railway
- Startup: nos logs deve aparecer `Railway startup (deploy v2026-05-25)`

## Watch paths (deploy não dispara)

O app usa **Dockerfile na raiz** + scripts Python fora de `dashboard/`. Se o Railway mostrar *"No changes to watched files"*, ajuste:

1. Serviço web → **Settings** → **Build** → **Watch Paths**
2. Deixe **vazio** (observa tudo) **ou** use os mesmos padrões do `railway.json`:
   ```
   Dockerfile
   railway.json
   requirements.txt
   anvisa_*.py
   scripts/**
   dashboard/**
   ```
3. **Root Directory** deve ser `/` (raiz do repositório), não `dashboard/`
4. **Config file**: `/railway.json` (caminho absoluto na raiz)

O `railway.json` na raiz já define `build.watchPatterns` — ele sobrescreve o painel quando o deploy roda com esse arquivo.

## 5. Domínio público

1. Serviço web → **Settings** → **Networking** → **Generate Domain**
2. Anote a URL `*.up.railway.app`

## Troubleshooting

| Problema | Solução |
|----------|---------|
| Build falha no `pnpm install` | Verifique se `pnpm-lock.yaml` está commitado |
| Health check timeout | Aguarde migrations; confira `DATABASE_URL` |
| Downloads em simulação | Configure B2 e verifique logs do script Python |
| Erro de migration | Confira se PostgreSQL está no mesmo projeto e acessível |
| Erro SSL no Postgres | Railway exige SSL; o app já configura automaticamente |

Veja também: `SETUP_RAILWAY_B2.md` e `.env.example`
