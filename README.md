# 📚 ANVISA Manuais - Download Automático

Sistema automatizado para fazer download de manuais de equipamentos médicos publicados pela ANVISA (Agência Nacional de Vigilância Sanitária), com armazenamento em Backblaze B2 e execução no Railway.

## 🎯 Objetivo

Baixar automaticamente todos os manuais de equipamentos médicos da ANVISA e armazená-los em nuvem para posterior extração de texto e alimentação de sistemas de IA.

## ✨ Características

- ✅ Download automático de PDFs da ANVISA
- ✅ Busca via Google/DuckDuckGo (contorna Cloudflare)
- ✅ Upload automático para Backblaze B2
- ✅ Execução no Railway (sem servidor local)
- ✅ Agendamento automático (mensal, semanal, etc)
- ✅ Logging detalhado
- ✅ Retomada de downloads interrompidos
- ✅ Custo muito baixo (~$6/mês para 1TB)

## 🚀 Quick Start (5 Minutos)

Veja **[QUICK_START.md](QUICK_START.md)** para começar em 5 minutos!

## 📖 Documentação

- **[QUICK_START.md](QUICK_START.md)** - Guia rápido (⚡ comece aqui!)
- **[SETUP_RAILWAY_B2.md](SETUP_RAILWAY_B2.md)** - Guia completo e detalhado
- **[README_ANVISA_DOWNLOADER.md](README_ANVISA_DOWNLOADER.md)** - Documentação técnica

## 💰 Custos

| Armazenamento | Custo/mês |
|---------------|-----------|
| 100 GB | $0.60 |
| 500 GB | $3.00 |
| 1 TB | $6.00 |
| 5 TB | $30.00 |

**Railway**: Gratuito (até 5GB/mês)

## 🔧 Tecnologias

- **Python 3.11**
- **Backblaze B2** - Armazenamento em nuvem
- **Railway** - Plataforma de deploy
- **DuckDuckGo/Google** - Busca de PDFs
- **b2sdk** - SDK do Backblaze

## 📋 Pré-requisitos

1. Conta no [Backblaze B2](https://www.backblaze.com/b2/cloud-storage.html)
2. Conta no [Railway.app](https://railway.app)
3. Repositório GitHub (este!)

## 🎬 Como Usar

### Opção 1: Deploy no Railway (Recomendado)

1. Fazer fork deste repositório
2. Criar conta no Railway
3. Conectar Railway ao GitHub
4. Configurar variáveis de ambiente
5. Deploy automático!

Veja [SETUP_RAILWAY_B2.md](SETUP_RAILWAY_B2.md) para instruções detalhadas.

### Opção 2: Executar Localmente

```bash
# Instalar dependências
pip install -r requirements.txt

# Configurar variáveis de ambiente
export B2_APPLICATION_KEY_ID="seu_id"
export B2_APPLICATION_KEY="sua_chave"
export B2_BUCKET_NAME="seu_bucket"

# Executar
python3 anvisa_downloader_b2.py --max-files 100
```

## 📁 Estrutura do Projeto

```
manuais_anvisa/
├── anvisa_downloader_b2.py          # ⭐ Script principal (B2)
├── anvisa_downloader_google.py      # Script com busca Google
├── anvisa_downloader_s3.py          # Script genérico S3
├── anvisa_downloader_selenium.py    # Script com Selenium
├── schedule_anvisa_download.sh      # Script de agendamento
├── Dockerfile                        # Imagem Docker
├── requirements.txt                  # Dependências Python
├── railway.json                      # Configuração Railway
├── QUICK_START.md                   # Guia rápido
├── SETUP_RAILWAY_B2.md              # Guia completo
└── README_ANVISA_DOWNLOADER.md      # Documentação técnica
```

## 🔐 Segurança

- ✅ Bucket B2 privado
- ✅ Chave com permissões mínimas
- ✅ Variáveis de ambiente (não hardcoded)
- ✅ Sem credenciais no repositório
- ✅ Logs detalhados para auditoria

## 📊 Monitorar Execução

### No Railway

1. Acesse seu projeto no Railway
2. Vá para "Logs"
3. Veja em tempo real:
   - PDFs sendo baixados
   - Upload para B2
   - Erros (se houver)

### No Backblaze B2

1. Acesse seu bucket
2. Veja arquivos organizados por data
3. Monitore uso de armazenamento

## ⏰ Agendamento

Configure execução periódica no Railway:

```
Schedule: 0 2 1 * * (Todo dia 1º do mês às 2 da manhã)
Command: python3 anvisa_downloader_b2.py
```

## 🐛 Troubleshooting

### Erro: "Bucket not found"
- Verifique se o nome do bucket está correto
- Verifique se a chave tem permissão

### Erro: "Invalid credentials"
- Regenere a chave no Backblaze B2
- Atualize as variáveis no Railway

### Logs não aparecem
- Certifique-se de que `PYTHONUNBUFFERED=1` está configurado

Veja [SETUP_RAILWAY_B2.md](SETUP_RAILWAY_B2.md) para mais troubleshooting.

## 📈 Próximos Passos

1. **Extrair texto dos PDFs**: Use PyPDF2 para extrair texto
2. **Indexar em banco de dados**: Armazene em SQLite ou PostgreSQL
3. **Integrar com IA**: Alimente seus modelos com o texto extraído
4. **Monitorar custos**: Configure alertas de gastos no B2

## 🤝 Contribuições

Contribuições são bem-vindas! Sinta-se livre para:
- Reportar bugs
- Sugerir melhorias
- Enviar pull requests

## 📝 Licença

Este projeto é fornecido como está, sem garantias.

## 📞 Suporte

Para dúvidas:
1. Leia [QUICK_START.md](QUICK_START.md)
2. Consulte [SETUP_RAILWAY_B2.md](SETUP_RAILWAY_B2.md)
3. Verifique os logs no Railway

## 🎉 Comece Agora!

Leia [QUICK_START.md](QUICK_START.md) e tenha seu sistema rodando em 5 minutos!

---

**Desenvolvido com ❤️ para automatizar o acesso a manuais de equipamentos médicos**

Última atualização: 2026-05-24
