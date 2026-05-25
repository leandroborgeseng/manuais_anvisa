# Guia Completo: Deploy no Railway com Backblaze B2

Este guia passo a passo mostra como fazer deploy do downloader de manuais da ANVISA no Railway com armazenamento em Backblaze B2.

## 📋 Pré-requisitos

1. Conta no [Railway.app](https://railway.app)
2. Conta no [Backblaze B2](https://www.backblaze.com/b2/cloud-storage.html)
3. Git instalado localmente
4. Railway CLI instalado (opcional, mas recomendado)

## 🚀 Passo 1: Configurar Backblaze B2

### 1.1 Criar uma Conta B2

1. Acesse [backblaze.com/b2](https://www.backblaze.com/b2/cloud-storage.html)
2. Clique em "Sign Up" e crie uma conta
3. Confirme seu email

### 1.2 Criar um Bucket

1. No painel do B2, clique em "Buckets"
2. Clique em "Create a Bucket"
3. Nome: `anvisa-manuais` (ou outro nome que preferir)
4. Tipo: "Private" (para segurança)
5. Clique em "Create Bucket"

### 1.3 Gerar Chave de Aplicação

1. No painel do B2, clique em "Account" (canto superior direito)
2. Clique em "Application Keys"
3. Clique em "Create New Application Key"
4. Configurações:
   - **Capabilities**: Selecione `listBuckets`, `readBuckets`, `writeBuckets`, `readBucketInfo`
   - **Bucket Restriction**: Selecione seu bucket `anvisa-manuais`
   - **Name**: `Railway ANVISA Downloader`
5. Clique em "Create New Key"

**⚠️ IMPORTANTE**: Copie e guarde em local seguro:
- `Application Key ID`
- `Application Key` (será mostrado apenas uma vez!)

## 🔧 Passo 2: Preparar o Repositório Git

### 2.1 Clonar ou Criar Repositório

```bash
# Opção 1: Se você já tem um repositório
git clone seu-repositorio
cd seu-repositorio

# Opção 2: Criar um novo repositório
mkdir anvisa-downloader
cd anvisa-downloader
git init
```

### 2.2 Adicionar os Arquivos Necessários

Copie os seguintes arquivos para o diretório:

```bash
# Copiar scripts
cp /home/ubuntu/anvisa_downloader_b2.py .
cp /home/ubuntu/anvisa_downloader_google.py .
cp /home/ubuntu/anvisa_downloader_s3.py .
cp /home/ubuntu/schedule_anvisa_download.sh .

# Copiar configurações
cp /home/ubuntu/Dockerfile .
cp /home/ubuntu/requirements.txt .
cp /home/ubuntu/railway.json .
```

### 2.3 Estrutura Final do Repositório

```
anvisa-downloader/
├── anvisa_downloader_b2.py
├── anvisa_downloader_google.py
├── anvisa_downloader_s3.py
├── schedule_anvisa_download.sh
├── Dockerfile
├── requirements.txt
├── railway.json
└── .gitignore
```

### 2.4 Criar .gitignore

```bash
cat > .gitignore << 'EOF'
*.log
*.pyc
__pycache__/
.env
.env.local
progress_*.json
manifest_*.json
downloads/
/tmp/
EOF
```

### 2.5 Fazer Commit Inicial

```bash
git add .
git commit -m "Initial commit: ANVISA downloader with Railway and B2 support"
git branch -M main
```

### 2.6 Fazer Push para GitHub (ou GitLab)

```bash
# Se usando GitHub
git remote add origin https://github.com/seu-usuario/anvisa-downloader.git
git push -u origin main
```

## 🚂 Passo 3: Deploy no Railway

### 3.1 Conectar Railway ao Repositório

1. Acesse [railway.app](https://railway.app)
2. Clique em "New Project"
3. Selecione "Deploy from GitHub"
4. Autorize o Railway a acessar seu GitHub
5. Selecione o repositório `anvisa-downloader`
6. Clique em "Deploy"

### 3.2 Configurar Variáveis de Ambiente

Após o deploy inicial, configure as variáveis de ambiente:

1. No painel do Railway, vá para "Variables"
2. Clique em "New Variable"
3. Adicione as seguintes variáveis:

| Variável | Valor | Descrição |
|----------|-------|-----------|
| `B2_APPLICATION_KEY_ID` | Seu Application Key ID | ID da chave B2 |
| `B2_APPLICATION_KEY` | Sua Application Key | Chave secreta B2 |
| `B2_BUCKET_NAME` | `anvisa-manuais` | Nome do bucket B2 |
| `MAX_FILES` | `100` | Limite de arquivos por execução |
| `LOG_LEVEL` | `INFO` | Nível de log |

**Exemplo de preenchimento:**

```
B2_APPLICATION_KEY_ID: 0015d8c0a4c8a1234567890
B2_APPLICATION_KEY: K0015d8c0a4c8a1234567890abcdef1234567890
B2_BUCKET_NAME: anvisa-manuais
MAX_FILES: 100
LOG_LEVEL: INFO
```

### 3.3 Configurar Recursos

1. No painel do Railway, vá para "Settings"
2. Configure os recursos:
   - **Memory**: 512 MB (suficiente)
   - **CPU**: 0.5 (suficiente)
   - **Restart Policy**: "No" (executar uma vez)

## ⏰ Passo 4: Agendar Execução Periódica

O Railway não tem cron jobs nativos, mas você pode usar:

### Opção 1: Usar Railway Cron (Recomendado)

1. Acesse [railway.app](https://railway.app)
2. Vá para "Deployments"
3. Clique em "New Deployment"
4. Selecione "Scheduled Job"
5. Configure:
   - **Command**: `python3 anvisa_downloader_b2.py --output-dir /tmp/anvisa_download`
   - **Schedule**: `0 2 1 * *` (Todo dia 1º do mês às 2 da manhã)

### Opção 2: Usar Serviço Externo (EasyCron, etc)

1. Acesse [easycron.com](https://www.easycron.com/)
2. Crie uma nova tarefa cron
3. URL: `https://seu-railway-app.up.railway.app/trigger`
4. Frequência: Mensal (ou a que preferir)

### Opção 3: Usar GitHub Actions

Crie arquivo `.github/workflows/anvisa-download.yml`:

```yaml
name: ANVISA Download

on:
  schedule:
    # Executar todo dia 1º do mês às 2 da manhã (UTC)
    - cron: '0 2 1 * *'
  workflow_dispatch:

jobs:
  download:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: pip install -r requirements.txt
      
      - name: Run ANVISA Downloader
        env:
          B2_APPLICATION_KEY_ID: ${{ secrets.B2_APPLICATION_KEY_ID }}
          B2_APPLICATION_KEY: ${{ secrets.B2_APPLICATION_KEY }}
          B2_BUCKET_NAME: ${{ secrets.B2_BUCKET_NAME }}
          MAX_FILES: 100
        run: python3 anvisa_downloader_b2.py
```

## 📊 Monitorar Execução

### Ver Logs no Railway

1. No painel do Railway, vá para "Logs"
2. Você verá em tempo real:
   - Arquivos sendo baixados
   - Upload para B2
   - Erros (se houver)

### Exemplo de Log

```
2026-05-24 18:30:15 - INFO - ============================================================
2026-05-24 18:30:15 - INFO - Iniciando download de manuais da ANVISA com Backblaze B2
2026-05-24 18:30:15 - INFO - Diretório temporário: /tmp/anvisa_download
2026-05-24 18:30:15 - INFO - Bucket B2: anvisa-manuais
2026-05-24 18:30:15 - INFO - ============================================================
2026-05-24 18:30:16 - INFO - Iniciando busca de PDFs da ANVISA...
2026-05-24 18:30:18 - INFO - DuckDuckGo: 25 URLs encontradas
2026-05-24 18:30:20 - INFO - Processando 25 URLs com 4 workers...
2026-05-24 18:30:25 - INFO - Fazendo download: manual_1.pdf
2026-05-24 18:30:28 - INFO - Download concluído: manual_1.pdf (2048576 bytes)
2026-05-24 18:30:29 - INFO - Fazendo upload: manuais/2026/05/24/manual_1.pdf
2026-05-24 18:30:31 - INFO - Upload concluído: manuais/2026/05/24/manual_1.pdf
```

### Acessar Arquivos no B2

1. Acesse o painel do B2
2. Clique em "Buckets"
3. Selecione `anvisa-manuais`
4. Veja todos os arquivos organizados por data

## 💰 Estimar Custos

Com Backblaze B2:

| Armazenamento | Custo/mês |
|---------------|-----------|
| 100 GB | $0.60 |
| 500 GB | $3.00 |
| 1 TB | $6.00 |
| 5 TB | $30.00 |

**Egress (download)**: $0.01/GB (mas você tem 1GB/dia grátis!)

## 🔒 Segurança

### Boas Práticas

1. **Nunca commitar credenciais**: Use variáveis de ambiente
2. **Bucket privado**: Mantenha o bucket B2 como "Private"
3. **Chave de aplicação restrita**: Crie chaves com permissões mínimas
4. **Rotacionar chaves**: Gere novas chaves periodicamente

### Adicionar Secrets no GitHub

Se usar GitHub Actions:

1. Vá para "Settings" do repositório
2. Clique em "Secrets and variables" > "Actions"
3. Clique em "New repository secret"
4. Adicione:
   - `B2_APPLICATION_KEY_ID`
   - `B2_APPLICATION_KEY`
   - `B2_BUCKET_NAME`

## 🐛 Troubleshooting

### Erro: "Bucket not found"

**Solução**: Verifique se o nome do bucket está correto e se a chave tem permissão para acessá-lo.

```bash
# Testar localmente
export B2_APPLICATION_KEY_ID="seu_id"
export B2_APPLICATION_KEY="sua_chave"
export B2_BUCKET_NAME="anvisa-manuais"
python3 anvisa_downloader_b2.py --max-files 5
```

### Erro: "Invalid credentials"

**Solução**: Regenere a chave de aplicação no B2.

1. Acesse o painel B2
2. Vá para "Application Keys"
3. Delete a chave antiga
4. Crie uma nova chave
5. Atualize as variáveis no Railway

### Erro: "Connection timeout"

**Solução**: Pode ser problema de rede. O Railway tentará reconectar automaticamente.

### Logs não aparecem no Railway

**Solução**: Certifique-se de que `PYTHONUNBUFFERED=1` está configurado.

## 📈 Próximos Passos

### 1. Adicionar Notificações

Configure alertas quando o download falhar:

```python
# Adicionar ao final do script
import smtplib
from email.mime.text import MIMEText

if failed_urls:
    # Enviar email de alerta
    msg = MIMEText(f"Download falhou para {len(failed_urls)} URLs")
    # ... configurar SMTP
```

### 2. Integrar com IA

Após os downloads, extrair texto dos PDFs:

```bash
# Adicionar ao Dockerfile
RUN pip install PyPDF2

# Criar script de extração
python3 extract_text.py
```

### 3. Monitorar Custos

Configure alertas de custo no B2:

1. Acesse "Account Settings"
2. Vá para "Billing"
3. Configure limite de gastos

## 📚 Recursos Adicionais

- [Documentação Railway](https://docs.railway.app/)
- [Documentação Backblaze B2](https://www.backblaze.com/b2/docs/)
- [b2sdk Documentation](https://b2-sdk-python.readthedocs.io/)

## ✅ Checklist Final

- [ ] Conta B2 criada
- [ ] Bucket criado
- [ ] Chave de aplicação gerada
- [ ] Repositório Git criado
- [ ] Arquivos commitados
- [ ] Deploy no Railway realizado
- [ ] Variáveis de ambiente configuradas
- [ ] Execução testada
- [ ] Agendamento configurado
- [ ] Logs verificados

---

**Pronto!** Seu sistema está rodando e fazendo download automático dos manuais da ANVISA para o Backblaze B2! 🎉

Para suporte, consulte a documentação ou verifique os logs no Railway.
