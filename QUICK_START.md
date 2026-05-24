# Quick Start: ANVISA Downloader com Railway + Backblaze B2

## ⚡ 5 Minutos para Começar

### Passo 1: Criar Conta B2 (2 minutos)

1. Acesse https://www.backblaze.com/b2/cloud-storage.html
2. Clique "Sign Up" e crie uma conta
3. Confirme seu email

### Passo 2: Criar Bucket e Chave (2 minutos)

```bash
# No painel B2:
1. Buckets → Create a Bucket
   - Nome: anvisa-manuais
   - Tipo: Private
   - Criar

2. Account → Application Keys → Create New Application Key
   - Capabilities: listBuckets, readBuckets, writeBuckets, readBucketInfo
   - Bucket Restriction: anvisa-manuais
   - Copiar Application Key ID e Application Key
```

### Passo 3: Deploy no Railway (1 minuto)

```bash
# 1. Fazer fork deste repositório no GitHub
# 2. Ir para https://railway.app
# 3. New Project → Deploy from GitHub
# 4. Selecionar seu fork
# 5. Aguardar deploy
```

### Passo 4: Configurar Variáveis (1 minuto)

No painel do Railway:

```
B2_APPLICATION_KEY_ID = seu_id_aqui
B2_APPLICATION_KEY = sua_chave_aqui
B2_BUCKET_NAME = anvisa-manuais
MAX_FILES = 100
```

### ✅ Pronto!

Seu downloader está rodando! Verifique os logs no Railway.

---

## 📊 Próximas Execuções

### Agendar Execução Mensal

No Railway, vá para "Deployments" e crie um "Scheduled Job":

```
Schedule: 0 2 1 * * (Todo dia 1º às 2 da manhã)
Command: python3 anvisa_downloader_b2.py
```

### Verificar Arquivos no B2

1. Acesse painel B2
2. Clique em "Buckets"
3. Selecione "anvisa-manuais"
4. Veja todos os PDFs organizados por data

---

## 💡 Dicas

- **Aumentar limite**: Mude `MAX_FILES` para 500 ou mais
- **Mais workers**: Edite `--max-workers 8` no Dockerfile
- **Monitorar custos**: B2 mostra uso em tempo real

---

## 🆘 Problemas?

**Erro "Bucket not found"**
- Verifique se o nome está correto
- Verifique se a chave tem permissão

**Erro "Invalid credentials"**
- Regenere a chave no B2
- Atualize as variáveis no Railway

**Logs não aparecem**
- Verifique se `PYTHONUNBUFFERED=1` está configurado

---

## 📚 Documentação Completa

Veja `SETUP_RAILWAY_B2.md` para guia detalhado.

---

**Custo estimado**: ~$6/mês para 1TB de armazenamento no B2

Boa sorte! 🚀
