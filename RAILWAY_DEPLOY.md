# Deploy no Railway — passo a passo

## 1. Criar projeto no Railway

1. Acesse [railway.app](https://railway.app) e faça login com GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Selecione `leandroborgeseng/manuais_anvisa`
4. Railway detecta o `Dockerfile` na raiz e inicia o build automaticamente

## 2. Adicionar MySQL

1. No projeto Railway, clique em **+ New** → **Database** → **MySQL**
2. Após provisionar, clique no serviço MySQL → **Variables** → copie `MYSQL_URL` ou `DATABASE_URL`
3. No serviço do app, adicione a variável `DATABASE_URL` com o valor copiado
4. As migrations rodam automaticamente no startup

## 3. Variáveis de ambiente do app

No serviço web (não no MySQL), em **Variables**:

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

## 5. Domínio público

1. Serviço web → **Settings** → **Networking** → **Generate Domain**
2. Anote a URL `*.up.railway.app`

## Troubleshooting

| Problema | Solução |
|----------|---------|
| Build falha no `pnpm install` | Verifique se `pnpm-lock.yaml` está commitado |
| Health check timeout | Aguarde migrations; confira `DATABASE_URL` |
| Downloads em simulação | Configure B2 e verifique logs do script Python |
| Erro de migration | Confira se MySQL está no mesmo projeto e acessível |

Veja também: `SETUP_RAILWAY_B2.md` e `.env.example`
