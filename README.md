# ANVISA Manuais Downloader

Sistema completo para download automático de manuais de equipamentos médicos da ANVISA com upload para Backblaze B2.

## Estrutura do Repositório

```
├── dashboard/          ← Interface web de monitoramento (React + Node.js)
├── anvisa_downloader_b2.py      ← Script principal (Backblaze B2)
├── anvisa_downloader_google.py  ← Script via busca Google
├── anvisa_downloader_s3.py      ← Script genérico S3
├── anvisa_downloader_selenium.py← Script com Selenium
├── Dockerfile          ← Deploy no Railway
├── requirements.txt    ← Dependências Python
├── railway.json        ← Configuração Railway
├── QUICK_START.md      ← Guia rápido (5 min)
└── SETUP_RAILWAY_B2.md ← Guia completo
```

## Dashboard Web

Interface moderna com mesh gradient vibrante para monitorar e controlar o processo de download em tempo real.

**Funcionalidades:**
- Dashboard com métricas em tempo real (total, percentual, velocidade, erros, espaço B2)
- Lista de downloads com status individual e barras de progresso
- Controles globais: Iniciar, Pausar, Retomar, Parar
- Botão "Tentar Novamente" para arquivos com erro
- Logs ao vivo filtráveis por INFO / WARNING / ERROR
- Configurações persistentes (MAX_FILES, workers, cron, bucket B2)
- Histórico de execuções anteriores

### Rodando o Dashboard localmente

```bash
cd dashboard
pnpm install
pnpm dev
```

### Deploy no Railway

1. Faça fork ou clone deste repositório
2. Acesse [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Selecione o repositório `manuais_anvisa` (raiz do projeto — **não** a pasta `dashboard`)
4. Adicione um plugin **MySQL** ao projeto e copie a `DATABASE_URL` gerada
5. Configure as variáveis de ambiente (veja `.env.example`, `RAILWAY_DEPLOY.md` e `SETUP_RAILWAY_B2.md`):

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | Sim | URL do MySQL (Railway plugin) |
| `JWT_SECRET` | Sim | Segredo para sessões (`openssl rand -hex 32`) |
| `B2_APPLICATION_KEY_ID` | Para downloads reais | Chave Backblaze B2 |
| `B2_APPLICATION_KEY` | Para downloads reais | Chave secreta B2 |
| `B2_BUCKET_NAME` | Para downloads reais | Nome do bucket |

6. O deploy usa o `Dockerfile` na raiz (Node + Python + dashboard)
7. Health check em `/health` — aguarde o build (~3–5 min na primeira vez)

**Sem B2/MySQL:** o dashboard abre e roda em modo simulação para testes.

## Scripts Python

Veja `QUICK_START.md` para instruções de uso dos scripts de download.

## Licença

Uso pessoal. Os manuais são documentos públicos da ANVISA.
