FROM python:3.11-slim

# Definir diretório de trabalho
WORKDIR /app

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copiar requirements
COPY requirements.txt .

# Instalar dependências Python
RUN pip install --no-cache-dir -r requirements.txt

# Copiar scripts
COPY anvisa_downloader_b2.py .
COPY anvisa_downloader_google.py .
COPY anvisa_downloader_s3.py .
COPY schedule_anvisa_download.sh .

# Criar diretórios
RUN mkdir -p /app/downloads /app/logs

# Tornar scripts executáveis
RUN chmod +x anvisa_downloader_b2.py anvisa_downloader_google.py anvisa_downloader_s3.py schedule_anvisa_download.sh

# Definir variáveis de ambiente padrão
ENV PYTHONUNBUFFERED=1
ENV OUTPUT_DIR=/tmp/anvisa_download
ENV LOG_LEVEL=INFO

# Comando padrão (usar script B2)
CMD ["python3", "anvisa_downloader_b2.py", "--output-dir", "/tmp/anvisa_download"]
