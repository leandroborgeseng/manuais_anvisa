# Download Automático de Manuais da ANVISA

Este projeto fornece scripts Python para fazer download automático de manuais de equipamentos médicos publicados pela ANVISA (Agência Nacional de Vigilância Sanitária).

## Visão Geral

O projeto consiste em quatro componentes principais:

1. **anvisa_downloader_google.py** - Script usando Google (RECOMENDADO - mais rápido e confiável)
2. **anvisa_downloader_selenium.py** - Script robusto usando Selenium
3. **anvisa_downloader.py** - Script básico usando requisições HTTP
4. **schedule_anvisa_download.sh** - Script para agendamento automático

## Características

- ✅ Download automático de todos os manuais de equipamentos médicos
- ✅ Suporte a retomada de downloads interrompidos
- ✅ Proteção contra Cloudflare (via Google e Selenium)
- ✅ Logging detalhado de todas as operações
- ✅ Geração de manifesto com informações dos produtos
- ✅ Agendamento automático via cron
- ✅ Downloads paralelos para maior velocidade
- ✅ Limite configurável de arquivos para processar
- ✅ Estrutura organizada de diretórios

## Instalação

### 1. Requisitos do Sistema

- Python 3.7+
- pip3

### 2. Instalar Dependências

```bash
# Dependências básicas (necessárias para todos os scripts)
pip3 install requests beautifulsoup4 lxml

# Dependências adicionais para versão Selenium (opcional)
pip3 install selenium webdriver-manager
```

### 3. Clonar/Copiar os Scripts

```bash
# Copiar os scripts para um diretório de trabalho
mkdir -p ~/anvisa_project
cp anvisa_downloader*.py schedule_anvisa_download.sh ~/anvisa_project/
cd ~/anvisa_project
```

## Uso

### Execução Rápida

#### Versão Google (RECOMENDADA - Mais Rápida)

```bash
# Download básico
python3 anvisa_downloader_google.py

# Com limite de arquivos
python3 anvisa_downloader_google.py --max-files 100

# Com mais workers para downloads paralelos
python3 anvisa_downloader_google.py --max-files 500 --max-workers 8

# Especificar diretório de saída
python3 anvisa_downloader_google.py --output-dir /caminho/para/manuais
```

#### Versão Selenium (Mais Robusta)

```bash
# Download básico
python3 anvisa_downloader_selenium.py

# Com limite de produtos
python3 anvisa_downloader_selenium.py --max-products 100

# Com interface gráfica (para debug)
python3 anvisa_downloader_selenium.py --no-headless
```

#### Versão HTTP Básica

```bash
# Download básico
python3 anvisa_downloader.py

# Com limite de produtos
python3 anvisa_downloader.py --max-products 50
```

### Agendamento Automático

#### Executar Download Imediatamente

```bash
bash schedule_anvisa_download.sh run
```

#### Agendar Execução Automática

```bash
# Todo dia 1º do mês às 2 da manhã
bash schedule_anvisa_download.sh setup-cron "0 2 1 * *"

# Todo domingo às 3 da manhã
bash schedule_anvisa_download.sh setup-cron "0 3 * * 0"

# Diariamente às meia-noite
bash schedule_anvisa_download.sh setup-cron "0 0 * * *"

# A cada 6 horas
bash schedule_anvisa_download.sh setup-cron "0 */6 * * *"
```

#### Ver Status

```bash
bash schedule_anvisa_download.sh status
```

#### Remover Agendamento

```bash
bash schedule_anvisa_download.sh remove-cron
```

## Comparação das Abordagens

| Aspecto | Google | Selenium | HTTP |
|--------|--------|----------|------|
| **Velocidade** | ⭐⭐⭐⭐⭐ Muito Rápida | ⭐⭐⭐ Média | ⭐⭐ Lenta |
| **Confiabilidade** | ⭐⭐⭐⭐⭐ Excelente | ⭐⭐⭐⭐ Boa | ⭐⭐ Fraca |
| **Bloqueios** | ⭐⭐⭐⭐⭐ Contorna | ⭐⭐⭐⭐ Contorna | ⭐ Bloqueado |
| **Recursos** | Baixo | Alto | Baixo |
| **Recomendado** | ✅ SIM | Para casos especiais | Não |

## Sintaxe de Agendamento Cron

O formato de agendamento segue a sintaxe padrão do cron:

```
┌───────────── minuto (0 - 59)
│ ┌───────────── hora (0 - 23)
│ │ ┌───────────── dia do mês (1 - 31)
│ │ │ ┌───────────── mês (1 - 12)
│ │ │ │ ┌───────────── dia da semana (0 - 6) (0 = domingo)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

### Exemplos Comuns

| Agendamento | Descrição |
|-------------|-----------|
| `0 0 1 * *` | Todo dia 1º do mês às 00:00 |
| `0 2 * * 0` | Todo domingo às 02:00 |
| `0 0 * * *` | Diariamente às 00:00 |
| `0 */6 * * *` | A cada 6 horas |
| `0 3 * * 1-5` | Segunda a sexta às 03:00 |
| `0 0 * 1 *` | Todo dia 1º de janeiro |

## Estrutura de Diretórios

Após a execução, os manuais serão organizados da seguinte forma:

```
anvisa_manuais/
├── progress_google.json             # Arquivo de progresso
├── manifest_google.json             # Manifesto de arquivos
├── logs/
│   └── anvisa_downloader_google.log # Log de execução
└── [Nome do Manual].pdf
    [Outro Manual].pdf
    ...
```

## Arquivos de Controle

### progress_google.json

Rastreia o progresso do download para permitir retomada:

```json
{
  "start_time": "2026-05-24T17:52:00.000000",
  "last_update": "2026-05-24T18:15:30.000000",
  "downloaded_files": 450,
  "failed_urls": ["https://..."],
  "downloaded_urls": ["https://...", "https://..."],
  "search_queries": ["site:consultas.anvisa.gov.br filetype:pdf"]
}
```

### manifest_google.json

Contém informações sobre todos os arquivos baixados:

```json
{
  "timestamp": "2026-05-24T18:15:30.000000",
  "total_urls_processadas": 500,
  "total_arquivos_baixados": 450,
  "urls_falhadas": ["https://..."],
  "arquivos": [
    {
      "nome": "manual_1.pdf",
      "tamanho_bytes": 2048576,
      "data_modificacao": "2026-05-24T18:15:30.000000"
    }
  ]
}
```

## Processamento Posterior dos PDFs

Após fazer download dos manuais, você pode extrair o texto para alimentar sua IA:

### Exemplo com Python

```python
import os
from pathlib import Path

try:
    import PyPDF2
except ImportError:
    print("Instale com: pip3 install PyPDF2")

def extract_text_from_pdfs(base_dir):
    """Extrai texto de todos os PDFs"""
    base_path = Path(base_dir)
    
    for pdf_file in base_path.rglob('*.pdf'):
        try:
            with open(pdf_file, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                text = ""
                for page in reader.pages:
                    text += page.extract_text()
                
                # Salvar texto extraído
                txt_file = pdf_file.with_suffix('.txt')
                with open(txt_file, 'w', encoding='utf-8') as out:
                    out.write(text)
                
                print(f"Texto extraído: {txt_file}")
        except Exception as e:
            print(f"Erro ao processar {pdf_file}: {e}")

# Usar
extract_text_from_pdfs('./anvisa_manuais')
```

### Indexação em Banco de Dados

```python
import sqlite3
from pathlib import Path

def index_pdfs_to_db(base_dir, db_path='manuais.db'):
    """Indexa PDFs em banco de dados SQLite"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Criar tabela
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS manuais (
            id INTEGER PRIMARY KEY,
            nome_arquivo TEXT,
            arquivo_pdf TEXT,
            arquivo_texto TEXT,
            tamanho_bytes INTEGER,
            data_download TEXT
        )
    ''')
    
    # Indexar arquivos
    base_path = Path(base_dir)
    for pdf_file in base_path.rglob('*.pdf'):
        txt_file = pdf_file.with_suffix('.txt')
        
        cursor.execute('''
            INSERT INTO manuais 
            (nome_arquivo, arquivo_pdf, arquivo_texto, tamanho_bytes)
            VALUES (?, ?, ?, ?)
        ''', (
            pdf_file.name,
            str(pdf_file),
            str(txt_file),
            pdf_file.stat().st_size
        ))
    
    conn.commit()
    conn.close()
    print(f"Banco de dados criado: {db_path}")

# Usar
index_pdfs_to_db('./anvisa_manuais')
```

## Troubleshooting

### Erro: "Nenhuma URL encontrada"

**Solução**: Isso pode significar que o Google ou DuckDuckGo estão bloqueando as buscas. Tente:

```bash
# Usar versão Selenium como alternativa
python3 anvisa_downloader_selenium.py --max-products 50
```

### Erro: "Chrome/Chromium not found" (apenas para Selenium)

**Solução**: Instale Chrome ou Chromium:

```bash
# Ubuntu/Debian
sudo apt-get install chromium-browser

# Fedora
sudo dnf install chromium

# macOS
brew install chromium
```

### Downloads muito lentos

**Solução**: Aumentar o número de workers:

```bash
# Usar 8 workers em vez de 4
python3 anvisa_downloader_google.py --max-workers 8
```

### Erro: "Permission denied" ao agendar

**Solução**: Verificar permissões do cron:

```bash
# Verificar se cron está habilitado
sudo systemctl status cron

# Iniciar cron se necessário
sudo systemctl start cron
```

## Logs

Os logs são salvos em arquivos específicos:

- `anvisa_downloader_google.log` - Versão Google
- `anvisa_downloader_selenium.log` - Versão Selenium
- `anvisa_downloader.log` - Versão HTTP

Para visualizar logs em tempo real:

```bash
tail -f anvisa_downloader_google.log
```

## Limitações e Considerações

1. **Taxa de Requisições**: Os scripts respeitam rate limits com delays entre requisições
2. **Tamanho Total**: Dependendo do número de arquivos, o tamanho total pode ser de vários GB
3. **Tempo de Execução**: Download completo pode levar horas
4. **Conexão**: Requer conexão estável com a internet
5. **Espaço em Disco**: Verifique espaço disponível antes de iniciar
6. **Bloqueios de IP**: Em caso de muitas requisições, seu IP pode ser bloqueado temporariamente

## Conformidade Legal

- Os manuais são documentos públicos da ANVISA
- Uso para fins educacionais e de pesquisa é permitido
- Não redistribuir sem atribuição apropriada
- Respeitar os termos de serviço da ANVISA

## Suporte e Contribuições

Para problemas ou sugestões:

1. Verificar os logs para mensagens de erro
2. Consultar a documentação da ANVISA
3. Testar com um número pequeno de arquivos primeiro
4. Verificar conexão com a internet

## Licença

Este projeto é fornecido como está, sem garantias.

## Changelog

### v2.0 (2026-05-24)
- Adicionado script com busca via Google (RECOMENDADO)
- Downloads paralelos para maior velocidade
- Melhorias na confiabilidade
- Suporte a DuckDuckGo como alternativa

### v1.0 (2026-05-24)
- Versão inicial com suporte a HTTP e Selenium
- Agendamento automático via cron
- Logging detalhado
- Suporte a retomada de downloads

---

**Última atualização**: 2026-05-24
**Versão recomendada**: Google Downloader (v2.0)
