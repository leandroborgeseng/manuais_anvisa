#!/usr/bin/env python3
"""
Script para download de manuais da ANVISA com upload automático para S3/Wasabi.

Este script:
1. Busca PDFs da ANVISA via Google
2. Faz download dos arquivos
3. Faz upload automático para S3/Wasabi
4. Mantém histórico de progresso
5. Otimizado para rodar no Railway

Variáveis de ambiente necessárias:
    S3_ENDPOINT: URL do endpoint S3 (ex: s3.wasabisys.com)
    S3_BUCKET: Nome do bucket
    S3_ACCESS_KEY: Chave de acesso
    S3_SECRET_KEY: Chave secreta
    S3_REGION: Região (ex: us-east-1)
    MAX_FILES: Limite de arquivos (padrão: 100)

Uso:
    python3 anvisa_downloader_s3.py
"""

import os
import sys
import json
import time
import logging
import argparse
import re
from pathlib import Path
from datetime import datetime
from urllib.parse import urljoin, quote, urlparse
from typing import List, Dict, Optional, Set
from concurrent.futures import ThreadPoolExecutor, as_completed
import tempfile
import shutil

try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
    from bs4 import BeautifulSoup
except ImportError:
    print("Erro: Dependências não encontradas. Instale com:")
    print("  pip3 install requests beautifulsoup4 lxml boto3")
    sys.exit(1)

# Tentar importar boto3 para S3
try:
    import boto3
    from botocore.exceptions import ClientError
    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False
    print("Aviso: boto3 não instalado. Instale com: pip3 install boto3")

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('anvisa_downloader_s3.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class S3Manager:
    """Gerenciador de uploads para S3/Wasabi."""
    
    def __init__(self, endpoint: str, bucket: str, access_key: str, secret_key: str, region: str = 'us-east-1'):
        """
        Inicializa o gerenciador S3.
        
        Args:
            endpoint: URL do endpoint S3
            bucket: Nome do bucket
            access_key: Chave de acesso
            secret_key: Chave secreta
            region: Região S3
        """
        self.endpoint = endpoint
        self.bucket = bucket
        self.region = region
        
        if not HAS_BOTO3:
            raise ImportError("boto3 é necessário para usar S3. Instale com: pip3 install boto3")
        
        # Criar cliente S3
        self.s3_client = boto3.client(
            's3',
            endpoint_url=f'https://{endpoint}' if not endpoint.startswith('http') else endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region
        )
        
        logger.info(f"Cliente S3 configurado para {endpoint}/{bucket}")
    
    def upload_file(self, local_path: Path, s3_key: str, metadata: Optional[Dict] = None) -> bool:
        """
        Faz upload de um arquivo para S3.
        
        Args:
            local_path: Caminho local do arquivo
            s3_key: Chave no S3 (caminho remoto)
            metadata: Metadados adicionais
            
        Returns:
            True se bem-sucedido
        """
        try:
            if not local_path.exists():
                logger.error(f"Arquivo não encontrado: {local_path}")
                return False
            
            file_size = local_path.stat().st_size
            logger.info(f"Fazendo upload: {s3_key} ({file_size} bytes)")
            
            # Preparar metadados
            extra_args = {}
            if metadata:
                extra_args['Metadata'] = metadata
            
            # Upload
            self.s3_client.upload_file(
                str(local_path),
                self.bucket,
                s3_key,
                ExtraArgs=extra_args if extra_args else None
            )
            
            logger.info(f"Upload concluído: {s3_key}")
            return True
            
        except ClientError as e:
            logger.error(f"Erro ao fazer upload: {e}")
            return False
        except Exception as e:
            logger.error(f"Erro inesperado durante upload: {e}")
            return False
    
    def list_files(self, prefix: str = "") -> List[str]:
        """
        Lista arquivos no bucket.
        
        Args:
            prefix: Prefixo para filtrar
            
        Returns:
            Lista de chaves
        """
        try:
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket,
                Prefix=prefix
            )
            
            if 'Contents' not in response:
                return []
            
            return [obj['Key'] for obj in response['Contents']]
            
        except Exception as e:
            logger.error(f"Erro ao listar arquivos: {e}")
            return []
    
    def get_file_url(self, s3_key: str) -> str:
        """
        Gera URL pública para um arquivo.
        
        Args:
            s3_key: Chave do arquivo
            
        Returns:
            URL pública
        """
        return f"https://{self.bucket}.{self.endpoint}/{s3_key}"


class AnvisaS3Downloader:
    """Downloader da ANVISA com suporte a S3."""
    
    def __init__(self, output_dir: str, s3_manager: Optional[S3Manager] = None, 
                 max_files: Optional[int] = None, max_workers: int = 4):
        """
        Inicializa o downloader.
        
        Args:
            output_dir: Diretório temporário para armazenar arquivos
            s3_manager: Gerenciador S3 (opcional)
            max_files: Limite máximo de arquivos
            max_workers: Número de workers para downloads paralelos
        """
        self.output_dir = Path(output_dir)
        self.s3_manager = s3_manager
        self.max_files = max_files
        self.max_workers = max_workers
        self.session = self._create_session()
        self.progress_file = self.output_dir / "progress_s3.json"
        self.manifest_file = self.output_dir / "manifest_s3.json"
        self.downloaded_urls: Set[str] = set()
        
        # Criar diretório de saída
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Carregar progresso anterior
        self.progress = self._load_progress()
        self.downloaded_urls = set(self.progress.get("downloaded_urls", []))
    
    def _create_session(self) -> requests.Session:
        """Cria uma sessão HTTP com retry automático."""
        session = requests.Session()
        
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "HEAD"]
        )
        
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
        })
        
        return session
    
    def _load_progress(self) -> Dict:
        """Carrega o arquivo de progresso anterior."""
        if self.progress_file.exists():
            try:
                with open(self.progress_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Erro ao carregar progresso: {e}")
        
        return {
            "start_time": datetime.now().isoformat(),
            "last_update": datetime.now().isoformat(),
            "downloaded_files": 0,
            "uploaded_files": 0,
            "failed_urls": [],
            "downloaded_urls": [],
            "uploaded_s3_keys": []
        }
    
    def _save_progress(self):
        """Salva o progresso atual."""
        self.progress["last_update"] = datetime.now().isoformat()
        self.progress["downloaded_urls"] = list(self.downloaded_urls)
        try:
            with open(self.progress_file, 'w', encoding='utf-8') as f:
                json.dump(self.progress, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Erro ao salvar progresso: {e}")
    
    def search_anvisa_pdfs(self, max_results: int = 100) -> List[str]:
        """
        Busca PDFs da ANVISA.
        
        Args:
            max_results: Número máximo de resultados
            
        Returns:
            Lista de URLs
        """
        urls = []
        
        search_queries = [
            "site:consultas.anvisa.gov.br filetype:pdf manual",
            "site:consultas.anvisa.gov.br filetype:pdf instrução",
            "site:consultas.anvisa.gov.br filetype:pdf equipamento",
        ]
        
        logger.info("Iniciando busca de PDFs da ANVISA...")
        
        for query in search_queries:
            if len(urls) >= max_results:
                break
            
            try:
                # Buscar no DuckDuckGo (mais confiável que Google)
                urls_found = self._search_duckduckgo(query, max_results // len(search_queries))
                urls.extend(urls_found)
                
                time.sleep(2)
                
            except Exception as e:
                logger.warning(f"Erro ao buscar '{query}': {e}")
                continue
        
        urls = list(set(urls))
        logger.info(f"Total de URLs encontradas: {len(urls)}")
        return urls[:max_results]
    
    def _search_duckduckgo(self, query: str, max_results: int = 20) -> List[str]:
        """Busca no DuckDuckGo."""
        urls = []
        
        try:
            search_url = "https://duckduckgo.com/html"
            params = {'q': query, 'kl': 'br-pt'}
            
            response = self.session.get(search_url, params=params, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            for link in soup.find_all('a', {'class': 'result__url'}):
                href = link.get('href', '')
                
                if 'consultas.anvisa.gov.br' in href and '.pdf' in href.lower():
                    if href.startswith('http'):
                        urls.append(href)
            
            logger.info(f"DuckDuckGo: {len(urls)} URLs encontradas")
            
        except Exception as e:
            logger.warning(f"Erro ao buscar no DuckDuckGo: {e}")
        
        return urls
    
    def download_and_upload_file(self, url: str) -> bool:
        """
        Faz download de um arquivo e faz upload para S3.
        
        Args:
            url: URL do arquivo
            
        Returns:
            True se bem-sucedido
        """
        try:
            if url in self.downloaded_urls:
                logger.info(f"Arquivo já processado: {url}")
                return True
            
            logger.info(f"Processando: {url}")
            
            # Download para arquivo temporário
            response = self.session.get(url, timeout=60, stream=True, allow_redirects=True)
            response.raise_for_status()
            
            # Validar PDF
            if not response.content.startswith(b'%PDF'):
                logger.warning(f"Arquivo não é um PDF válido: {url}")
                return False
            
            # Extrair nome do arquivo
            parsed_url = urlparse(url)
            filename = os.path.basename(parsed_url.path)
            
            if not filename or not filename.lower().endswith('.pdf'):
                filename = f"manual_{int(time.time())}.pdf"
            
            filename = self._sanitize_filename(filename)
            
            # Salvar temporariamente
            temp_file = self.output_dir / filename
            
            with open(temp_file, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            
            file_size = temp_file.stat().st_size
            logger.info(f"Download concluído: {filename} ({file_size} bytes)")
            
            # Upload para S3 se configurado
            if self.s3_manager:
                s3_key = f"manuais/{datetime.now().strftime('%Y/%m')}/{filename}"
                
                metadata = {
                    'original_url': url,
                    'download_date': datetime.now().isoformat(),
                    'file_size': str(file_size)
                }
                
                if self.s3_manager.upload_file(temp_file, s3_key, metadata):
                    self.progress["uploaded_files"] += 1
                    self.progress["uploaded_s3_keys"].append(s3_key)
                    logger.info(f"Upload S3 concluído: {s3_key}")
                else:
                    logger.error(f"Falha ao fazer upload para S3: {s3_key}")
                    return False
                
                # Remover arquivo local após upload
                try:
                    temp_file.unlink()
                except:
                    pass
            
            self.downloaded_urls.add(url)
            self.progress["downloaded_files"] += 1
            self._save_progress()
            
            return True
            
        except Exception as e:
            logger.error(f"Erro ao processar {url}: {e}")
            self.progress["failed_urls"].append(url)
            return False
    
    def process_urls(self, urls: List[str]):
        """
        Processa uma lista de URLs com downloads paralelos.
        
        Args:
            urls: Lista de URLs
        """
        logger.info(f"Processando {len(urls)} URLs com {self.max_workers} workers...")
        
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {}
            
            for idx, url in enumerate(urls, 1):
                if self.max_files and len(self.downloaded_urls) >= self.max_files:
                    logger.info(f"Limite de {self.max_files} arquivos atingido")
                    break
                
                if url in self.downloaded_urls:
                    continue
                
                future = executor.submit(self.download_and_upload_file, url)
                futures[future] = (url, idx, len(urls))
            
            for future in as_completed(futures):
                url, idx, total = futures[future]
                try:
                    result = future.result()
                    if result:
                        logger.info(f"[{idx}/{total}] Sucesso")
                except Exception as e:
                    logger.error(f"[{idx}/{total}] Erro: {e}")
                
                self._save_progress()
    
    def generate_manifest(self, urls: List[str]):
        """Gera um manifesto dos arquivos processados."""
        manifest = {
            "timestamp": datetime.now().isoformat(),
            "total_urls_processadas": len(urls),
            "total_arquivos_baixados": self.progress["downloaded_files"],
            "total_arquivos_enviados_s3": self.progress["uploaded_files"],
            "urls_falhadas": self.progress["failed_urls"],
            "s3_keys": self.progress["uploaded_s3_keys"]
        }
        
        try:
            with open(self.manifest_file, 'w', encoding='utf-8') as f:
                json.dump(manifest, f, indent=2, ensure_ascii=False)
            logger.info(f"Manifesto salvo: {self.manifest_file}")
        except Exception as e:
            logger.error(f"Erro ao salvar manifesto: {e}")
    
    def _sanitize_filename(self, filename: str) -> str:
        """Remove caracteres inválidos."""
        filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
        filename = filename[:200]
        return filename.strip()
    
    def run(self):
        """Executa o download completo."""
        logger.info("=" * 60)
        logger.info("Iniciando download de manuais da ANVISA com S3")
        logger.info(f"Diretório temporário: {self.output_dir}")
        if self.s3_manager:
            logger.info(f"Bucket S3: {self.s3_manager.bucket}")
        logger.info("=" * 60)
        
        try:
            # Buscar URLs
            urls = self.search_anvisa_pdfs(max_results=self.max_files or 100)
            
            if not urls:
                logger.warning("Nenhuma URL encontrada")
                return
            
            # Processar URLs
            self.process_urls(urls)
            
            # Gerar manifesto
            self.generate_manifest(urls)
            
            logger.info("=" * 60)
            logger.info("Download concluído com sucesso!")
            logger.info(f"Arquivos baixados: {self.progress['downloaded_files']}")
            logger.info(f"Arquivos enviados para S3: {self.progress['uploaded_files']}")
            logger.info(f"URLs com erro: {len(self.progress['failed_urls'])}")
            logger.info("=" * 60)
            
        except KeyboardInterrupt:
            logger.info("Interrompido pelo usuário")
            self._save_progress()
        except Exception as e:
            logger.error(f"Erro fatal: {e}", exc_info=True)
            self._save_progress()


def main():
    """Função principal."""
    parser = argparse.ArgumentParser(
        description="Download de manuais da ANVISA com upload para S3/Wasabi"
    )
    
    parser.add_argument('--output-dir', type=str, default='/tmp/anvisa_download',
                       help='Diretório temporário para downloads')
    parser.add_argument('--max-files', type=int, default=None,
                       help='Limite máximo de arquivos')
    parser.add_argument('--max-workers', type=int, default=4,
                       help='Número de workers paralelos')
    parser.add_argument('--s3-endpoint', type=str, default=None,
                       help='Endpoint S3 (ex: s3.wasabisys.com)')
    parser.add_argument('--s3-bucket', type=str, default=None,
                       help='Nome do bucket S3')
    parser.add_argument('--s3-access-key', type=str, default=None,
                       help='Chave de acesso S3')
    parser.add_argument('--s3-secret-key', type=str, default=None,
                       help='Chave secreta S3')
    parser.add_argument('--s3-region', type=str, default='us-east-1',
                       help='Região S3')
    
    args = parser.parse_args()
    
    # Tentar obter credenciais de variáveis de ambiente
    s3_endpoint = args.s3_endpoint or os.getenv('S3_ENDPOINT')
    s3_bucket = args.s3_bucket or os.getenv('S3_BUCKET')
    s3_access_key = args.s3_access_key or os.getenv('S3_ACCESS_KEY')
    s3_secret_key = args.s3_secret_key or os.getenv('S3_SECRET_KEY')
    s3_region = args.s3_region or os.getenv('S3_REGION', 'us-east-1')
    max_files = args.max_files or int(os.getenv('MAX_FILES', 100))
    
    # Criar gerenciador S3 se credenciais disponíveis
    s3_manager = None
    if s3_endpoint and s3_bucket and s3_access_key and s3_secret_key:
        try:
            s3_manager = S3Manager(s3_endpoint, s3_bucket, s3_access_key, s3_secret_key, s3_region)
            logger.info("Gerenciador S3 configurado com sucesso")
        except Exception as e:
            logger.error(f"Erro ao configurar S3: {e}")
            logger.info("Continuando sem S3...")
    else:
        logger.warning("Credenciais S3 não configuradas. Arquivos serão salvos localmente.")
    
    # Criar downloader e executar
    downloader = AnvisaS3Downloader(
        output_dir=args.output_dir,
        s3_manager=s3_manager,
        max_files=max_files,
        max_workers=args.max_workers
    )
    
    downloader.run()


if __name__ == '__main__':
    main()
