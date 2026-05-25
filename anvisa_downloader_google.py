#!/usr/bin/env python3
"""
Script para download de manuais da ANVISA usando Google como intermediário.

Este script:
1. Usa a busca do Google para encontrar PDFs da ANVISA
2. Extrai URLs diretas dos resultados
3. Faz download dos arquivos
4. Organiza os arquivos localmente

Vantagens:
- Contorna bloqueios do Cloudflare
- Muito mais rápido que scraping direto
- Aproveita o índice do Google
- Menos requisições ao servidor da ANVISA

Uso:
    python3 anvisa_downloader_google.py --output-dir /caminho/para/manuais --max-files 100
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
from urllib.parse import urljoin, quote, urlparse, parse_qs
from typing import List, Dict, Optional, Set
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
    from bs4 import BeautifulSoup
except ImportError:
    print("Erro: Dependências não encontradas. Instale com:")
    print("  pip3 install requests beautifulsoup4 lxml")
    sys.exit(1)

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('anvisa_downloader_google.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class AnvisaGoogleDownloader:
    """Classe para download de manuais da ANVISA usando Google."""
    
    def __init__(self, output_dir: str, max_files: Optional[int] = None, max_workers: int = 4):
        """
        Inicializa o downloader.
        
        Args:
            output_dir: Diretório para armazenar os manuais
            max_files: Limite máximo de arquivos para fazer download
            max_workers: Número de workers para download paralelo
        """
        self.output_dir = Path(output_dir)
        self.max_files = max_files
        self.max_workers = max_workers
        self.session = self._create_session()
        self.progress_file = self.output_dir / "progress_google.json"
        self.manifest_file = self.output_dir / "manifest_google.json"
        self.downloaded_urls: Set[str] = set()
        
        # Criar diretório de saída
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Carregar progresso anterior
        self.progress = self._load_progress()
        self.downloaded_urls = set(self.progress.get("downloaded_urls", []))
    
    def _create_session(self) -> requests.Session:
        """Cria uma sessão HTTP com retry automático."""
        session = requests.Session()
        
        # Configurar retry strategy
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "HEAD"]
        )
        
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        
        # Headers para parecer um navegador real
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        })
        
        return session
    
    def _load_progress(self) -> Dict:
        """Carrega o arquivo de progresso anterior."""
        if self.progress_file.exists():
            try:
                with open(self.progress_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Erro ao carregar progresso anterior: {e}")
        
        return {
            "start_time": datetime.now().isoformat(),
            "last_update": datetime.now().isoformat(),
            "downloaded_files": 0,
            "failed_urls": [],
            "downloaded_urls": [],
            "search_queries": []
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
    
    def search_google_for_anvisa_pdfs(self, search_term: str = "site:consultas.anvisa.gov.br filetype:pdf", 
                                     max_results: int = 100) -> List[str]:
        """
        Busca PDFs da ANVISA no Google.
        
        Args:
            search_term: Termo de busca (pode incluir site: e filetype:)
            max_results: Número máximo de resultados
            
        Returns:
            Lista de URLs encontradas
        """
        urls = []
        
        # Variações de busca para cobrir diferentes tipos de manuais
        search_queries = [
            "site:consultas.anvisa.gov.br filetype:pdf manual",
            "site:consultas.anvisa.gov.br filetype:pdf instrução",
            "site:consultas.anvisa.gov.br filetype:pdf equipamento",
            "site:consultas.anvisa.gov.br/api/consulta/produtos filetype:pdf",
        ]
        
        logger.info(f"Iniciando busca de PDFs da ANVISA no Google...")
        
        for query in search_queries:
            if self.max_files and len(urls) >= self.max_files:
                break
            
            try:
                logger.info(f"Buscando: {query}")
                
                # Usar DuckDuckGo como alternativa (menos bloqueios)
                urls_found = self._search_duckduckgo(query, max_results // len(search_queries))
                urls.extend(urls_found)
                
                # Também tentar com Google
                urls_found = self._search_google(query, max_results // len(search_queries))
                urls.extend(urls_found)
                
                time.sleep(2)  # Respeitar rate limit
                
            except Exception as e:
                logger.warning(f"Erro ao buscar '{query}': {e}")
                continue
        
        # Remover duplicatas
        urls = list(set(urls))
        
        logger.info(f"Total de URLs encontradas: {len(urls)}")
        return urls[:max_results]
    
    def _search_google(self, query: str, max_results: int = 20) -> List[str]:
        """Busca no Google."""
        urls = []
        
        try:
            # Usar a API do Google Custom Search (alternativa: usar requests direto)
            search_url = "https://www.google.com/search"
            params = {
                'q': query,
                'num': max_results,
                'filter': '0'
            }
            
            response = self.session.get(search_url, params=params, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Extrair URLs dos resultados
            for link in soup.find_all('a', href=True):
                href = link['href']
                
                # Filtrar links válidos
                if 'consultas.anvisa.gov.br' in href and '.pdf' in href.lower():
                    # Limpar URL
                    if href.startswith('/url?q='):
                        href = href.split('/url?q=')[1].split('&')[0]
                    
                    if href.startswith('http'):
                        urls.append(href)
            
            logger.info(f"Google: {len(urls)} URLs encontradas")
            
        except Exception as e:
            logger.warning(f"Erro ao buscar no Google: {e}")
        
        return urls
    
    def _search_duckduckgo(self, query: str, max_results: int = 20) -> List[str]:
        """Busca no DuckDuckGo (menos bloqueios)."""
        urls = []
        
        try:
            search_url = "https://duckduckgo.com/html"
            params = {
                'q': query,
                'kl': 'br-pt'
            }
            
            response = self.session.get(search_url, params=params, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Extrair URLs dos resultados
            for link in soup.find_all('a', {'class': 'result__url'}):
                href = link.get('href', '')
                
                if 'consultas.anvisa.gov.br' in href and '.pdf' in href.lower():
                    if href.startswith('http'):
                        urls.append(href)
            
            logger.info(f"DuckDuckGo: {len(urls)} URLs encontradas")
            
        except Exception as e:
            logger.warning(f"Erro ao buscar no DuckDuckGo: {e}")
        
        return urls
    
    def search_direct_anvisa_api(self) -> List[str]:
        """
        Busca diretamente na API da ANVISA usando padrões conhecidos.
        
        Returns:
            Lista de URLs de PDFs
        """
        urls = []
        
        logger.info("Buscando PDFs diretamente na API da ANVISA...")
        
        try:
            # Padrão de URL conhecida da ANVISA
            # https://consultas.anvisa.gov.br/api/consulta/produtos/{id}/anexo/{tipo}/nomeArquivo/{nome}.pdf
            
            # Tentar encontrar produtos com manuais
            base_url = "https://consultas.anvisa.gov.br/api/consulta/produtos"
            
            # Fazer requisição com diferentes parâmetros
            for page in range(1, 11):  # Primeiras 10 páginas
                try:
                    # Tentar diferentes endpoints
                    endpoints = [
                        f"{base_url}?pagina={page}&tamanho=50",
                        f"{base_url}?page={page}&pageSize=50",
                    ]
                    
                    for endpoint in endpoints:
                        try:
                            response = self.session.get(endpoint, timeout=10)
                            
                            if response.status_code == 200:
                                try:
                                    data = response.json()
                                    
                                    # Procurar por URLs de anexos
                                    if isinstance(data, dict):
                                        for key, value in data.items():
                                            if isinstance(value, str) and 'anexo' in value and '.pdf' in value:
                                                urls.append(value)
                                except:
                                    pass
                        except:
                            pass
                    
                    time.sleep(1)
                    
                except Exception as e:
                    logger.debug(f"Erro na página {page}: {e}")
                    continue
            
            logger.info(f"API direta: {len(urls)} URLs encontradas")
            
        except Exception as e:
            logger.warning(f"Erro ao buscar na API direta: {e}")
        
        return urls
    
    def download_file(self, url: str, destination: Path) -> bool:
        """
        Faz download de um arquivo.
        
        Args:
            url: URL do arquivo
            destination: Caminho de destino
            
        Returns:
            True se bem-sucedido
        """
        try:
            # Verificar se já foi baixado
            if url in self.downloaded_urls:
                logger.info(f"Arquivo já foi baixado: {url}")
                return True
            
            # Verificar se arquivo já existe
            if destination.exists():
                logger.info(f"Arquivo já existe: {destination.name}")
                self.downloaded_urls.add(url)
                return True
            
            logger.info(f"Baixando: {url}")
            
            response = self.session.get(url, timeout=60, stream=True, allow_redirects=True)
            response.raise_for_status()
            
            # Validar se é realmente um PDF
            content_type = response.headers.get('content-type', '').lower()
            if 'pdf' not in content_type and response.status_code == 200:
                # Verificar magic bytes do PDF
                if not response.content.startswith(b'%PDF'):
                    logger.warning(f"Arquivo não é um PDF válido: {url}")
                    return False
            
            # Criar diretório se necessário
            destination.parent.mkdir(parents=True, exist_ok=True)
            
            # Salvar arquivo
            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0
            
            with open(destination, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
            
            file_size = destination.stat().st_size
            
            if file_size > 0:
                logger.info(f"Arquivo salvo: {destination.name} ({file_size} bytes)")
                self.downloaded_urls.add(url)
                self.progress["downloaded_files"] += 1
                return True
            else:
                logger.warning(f"Arquivo vazio: {destination.name}")
                destination.unlink()
                return False
            
        except Exception as e:
            logger.error(f"Erro ao baixar {url}: {e}")
            self.progress["failed_urls"].append(url)
            return False
    
    def _sanitize_filename(self, filename: str) -> str:
        """Remove caracteres inválidos do nome de arquivo."""
        import re
        filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
        filename = filename[:200]
        return filename.strip()
    
    def process_urls(self, urls: List[str]):
        """
        Processa uma lista de URLs e faz download dos arquivos.
        
        Args:
            urls: Lista de URLs para fazer download
        """
        logger.info(f"Processando {len(urls)} URLs...")
        
        # Usar ThreadPoolExecutor para downloads paralelos
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {}
            
            for idx, url in enumerate(urls, 1):
                if self.max_files and len(self.downloaded_urls) >= self.max_files:
                    logger.info(f"Limite de {self.max_files} arquivos atingido")
                    break
                
                if url in self.downloaded_urls:
                    continue
                
                try:
                    # Extrair nome do arquivo da URL
                    parsed_url = urlparse(url)
                    filename = os.path.basename(parsed_url.path)
                    
                    if not filename or not filename.lower().endswith('.pdf'):
                        filename = f"manual_{idx}.pdf"
                    
                    # Criar caminho de destino
                    destination = self.output_dir / self._sanitize_filename(filename)
                    
                    # Submeter tarefa de download
                    future = executor.submit(self.download_file, url, destination)
                    futures[future] = (url, idx, len(urls))
                    
                except Exception as e:
                    logger.error(f"Erro ao processar URL {idx}: {e}")
            
            # Aguardar conclusão dos downloads
            for future in as_completed(futures):
                url, idx, total = futures[future]
                try:
                    result = future.result()
                    if result:
                        logger.info(f"[{idx}/{total}] Download concluído")
                except Exception as e:
                    logger.error(f"[{idx}/{total}] Erro no download: {e}")
                
                self._save_progress()
    
    def generate_manifest(self, urls: List[str]):
        """Gera um manifesto com informações dos arquivos baixados."""
        manifest = {
            "timestamp": datetime.now().isoformat(),
            "total_urls_processadas": len(urls),
            "total_arquivos_baixados": self.progress["downloaded_files"],
            "urls_falhadas": self.progress["failed_urls"],
            "arquivos": []
        }
        
        # Listar arquivos baixados
        for pdf_file in self.output_dir.glob('*.pdf'):
            manifest["arquivos"].append({
                "nome": pdf_file.name,
                "tamanho_bytes": pdf_file.stat().st_size,
                "data_modificacao": datetime.fromtimestamp(pdf_file.stat().st_mtime).isoformat()
            })
        
        try:
            with open(self.manifest_file, 'w', encoding='utf-8') as f:
                json.dump(manifest, f, indent=2, ensure_ascii=False)
            logger.info(f"Manifesto salvo: {self.manifest_file}")
        except Exception as e:
            logger.error(f"Erro ao salvar manifesto: {e}")
    
    def run(self):
        """Executa o download completo."""
        logger.info("=" * 60)
        logger.info("Iniciando download de manuais da ANVISA via Google")
        logger.info(f"Diretório de saída: {self.output_dir}")
        logger.info("=" * 60)
        
        try:
            # Buscar URLs
            all_urls = []
            
            # Estratégia 1: Buscar via Google/DuckDuckGo
            google_urls = self.search_google_for_anvisa_pdfs(max_results=100)
            all_urls.extend(google_urls)
            
            # Estratégia 2: Buscar diretamente na API
            api_urls = self.search_direct_anvisa_api()
            all_urls.extend(api_urls)
            
            # Remover duplicatas
            all_urls = list(set(all_urls))
            
            if not all_urls:
                logger.warning("Nenhuma URL encontrada")
                return
            
            logger.info(f"Total de URLs únicas: {len(all_urls)}")
            
            # Fazer download dos arquivos
            self.process_urls(all_urls)
            
            # Gerar manifesto
            self.generate_manifest(all_urls)
            
            logger.info("=" * 60)
            logger.info("Download concluído com sucesso!")
            logger.info(f"Arquivos baixados: {self.progress['downloaded_files']}")
            logger.info(f"URLs com erro: {len(self.progress['failed_urls'])}")
            logger.info("=" * 60)
            
        except KeyboardInterrupt:
            logger.info("Download interrompido pelo usuário")
            self._save_progress()
        except Exception as e:
            logger.error(f"Erro fatal: {e}", exc_info=True)
            self._save_progress()


def main():
    """Função principal."""
    parser = argparse.ArgumentParser(
        description="Download de manuais da ANVISA usando Google como intermediário",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos de uso:
  # Download básico
  python3 anvisa_downloader_google.py
  
  # Limitar a 50 arquivos
  python3 anvisa_downloader_google.py --max-files 50
  
  # Especificar diretório de saída
  python3 anvisa_downloader_google.py --output-dir ./manuais
  
  # Usar 8 workers para downloads paralelos
  python3 anvisa_downloader_google.py --max-workers 8
        """
    )
    
    parser.add_argument(
        '--output-dir',
        type=str,
        default='./anvisa_manuais',
        help='Diretório para armazenar os manuais (padrão: ./anvisa_manuais)'
    )
    
    parser.add_argument(
        '--max-files',
        type=int,
        default=None,
        help='Limite máximo de arquivos para fazer download'
    )
    
    parser.add_argument(
        '--max-workers',
        type=int,
        default=4,
        help='Número de workers para downloads paralelos (padrão: 4)'
    )
    
    args = parser.parse_args()
    
    # Criar downloader e executar
    downloader = AnvisaGoogleDownloader(
        output_dir=args.output_dir,
        max_files=args.max_files,
        max_workers=args.max_workers
    )
    
    downloader.run()


if __name__ == '__main__':
    main()
