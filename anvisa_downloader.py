#!/usr/bin/env python3
"""
Script para download automático de manuais de equipamentos médicos da ANVISA.

Este script:
1. Busca todos os produtos para saúde registrados na ANVISA
2. Extrai os números de registro
3. Faz download dos manuais (PDFs) associados a cada produto
4. Armazena os arquivos localmente com estrutura organizada
5. Mantém um log de progresso para retomada em caso de interrupção

Uso:
    python3 anvisa_downloader.py --output-dir /caminho/para/manuais --max-products 100
"""

import os
import sys
import json
import time
import logging
import argparse
import hashlib
from pathlib import Path
from datetime import datetime
from urllib.parse import urljoin, quote
from typing import List, Dict, Optional, Tuple

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
        logging.FileHandler('anvisa_downloader.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class AnvisaDownloader:
    """Classe para gerenciar o download de manuais da ANVISA."""
    
    def __init__(self, output_dir: str, max_products: Optional[int] = None):
        """
        Inicializa o downloader.
        
        Args:
            output_dir: Diretório para armazenar os manuais
            max_products: Limite máximo de produtos para processar (None = todos)
        """
        self.output_dir = Path(output_dir)
        self.max_products = max_products
        self.base_url = "https://consultas.anvisa.gov.br"
        self.api_url = f"{self.base_url}/api/consulta/produtos"
        self.session = self._create_session()
        self.progress_file = self.output_dir / "progress.json"
        self.manifest_file = self.output_dir / "manifest.json"
        
        # Criar diretório de saída
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Carregar progresso anterior
        self.progress = self._load_progress()
        
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
        
        # Headers para contornar proteções
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'pt-BR,pt;q=0.9',
            'Referer': f'{self.base_url}/',
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
            "processed_products": 0,
            "downloaded_files": 0,
            "failed_products": [],
            "current_page": 1,
            "products_processed": []
        }
    
    def _save_progress(self):
        """Salva o progresso atual."""
        self.progress["last_update"] = datetime.now().isoformat()
        try:
            with open(self.progress_file, 'w', encoding='utf-8') as f:
                json.dump(self.progress, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Erro ao salvar progresso: {e}")
    
    def search_products(self, search_term: str = "a", page_size: int = 50) -> List[Dict]:
        """
        Busca produtos na ANVISA.
        
        Args:
            search_term: Termo de busca (padrão: "a" para buscar todos)
            page_size: Número de resultados por página
            
        Returns:
            Lista de produtos encontrados
        """
        all_products = []
        page = self.progress.get("current_page", 1)
        
        logger.info(f"Iniciando busca de produtos (página {page})...")
        
        while True:
            try:
                # Construir URL de busca
                search_url = f"{self.base_url}/#/saude/q/?nomeProduto={quote(search_term)}&page={page}&pageSize={page_size}"
                
                logger.info(f"Buscando página {page}...")
                
                # Fazer requisição
                response = self.session.get(
                    search_url,
                    timeout=30,
                    allow_redirects=True
                )
                response.raise_for_status()
                
                # Nota: A página é uma SPA, então precisamos usar a API diretamente
                # Tentar acessar a API REST
                api_url = f"{self.api_url}?pagina={page}&tamanho={page_size}&nomeDispositivo={quote(search_term)}"
                
                logger.info(f"Acessando API: {api_url}")
                
                response = self.session.get(api_url, timeout=30)
                response.raise_for_status()
                
                # Tentar parsear como JSON
                try:
                    data = response.json()
                    if isinstance(data, dict) and 'content' in data:
                        products = data.get('content', [])
                        if not products:
                            logger.info("Nenhum produto encontrado nesta página.")
                            break
                        
                        all_products.extend(products)
                        logger.info(f"Página {page}: {len(products)} produtos encontrados")
                        
                        # Verificar se há mais páginas
                        if not data.get('last', True):
                            page += 1
                            self.progress["current_page"] = page
                            self._save_progress()
                            
                            # Verificar limite de produtos
                            if self.max_products and len(all_products) >= self.max_products:
                                logger.info(f"Limite de {self.max_products} produtos atingido")
                                all_products = all_products[:self.max_products]
                                break
                            
                            time.sleep(1)  # Respeitar rate limit
                        else:
                            break
                    else:
                        logger.warning(f"Resposta inesperada da API: {response.text[:200]}")
                        break
                        
                except json.JSONDecodeError:
                    logger.warning("Resposta não é JSON, tentando parsear HTML...")
                    # Fallback: parsear HTML
                    soup = BeautifulSoup(response.text, 'html.parser')
                    rows = soup.find_all('tr')
                    
                    if not rows:
                        logger.info("Nenhuma linha encontrada na tabela")
                        break
                    
                    for row in rows[1:]:  # Pular header
                        cells = row.find_all('td')
                        if len(cells) >= 3:
                            product = {
                                'nome': cells[0].get_text(strip=True),
                                'numero_registro': cells[2].get_text(strip=True),
                                'numero_notificacao': cells[1].get_text(strip=True),
                            }
                            all_products.append(product)
                    
                    if len(rows) <= 1:
                        break
                    
                    page += 1
                    self.progress["current_page"] = page
                    self._save_progress()
                    time.sleep(1)
                    
            except requests.RequestException as e:
                logger.error(f"Erro ao buscar página {page}: {e}")
                time.sleep(5)  # Aguardar antes de tentar novamente
                continue
            except Exception as e:
                logger.error(f"Erro inesperado: {e}")
                break
        
        logger.info(f"Total de produtos encontrados: {len(all_products)}")
        return all_products
    
    def get_product_details(self, product_id: str) -> Dict:
        """
        Obtém detalhes de um produto, incluindo anexos.
        
        Args:
            product_id: ID do produto (número de registro)
            
        Returns:
            Dicionário com detalhes do produto
        """
        try:
            # Construir URL de detalhes
            detail_url = f"{self.base_url}/#/saude/{quote(product_id)}"
            
            response = self.session.get(detail_url, timeout=30)
            response.raise_for_status()
            
            # Parsear HTML para encontrar anexos
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Procurar por links de download
            attachments = []
            for link in soup.find_all('a'):
                href = link.get('href', '')
                if '/api/consulta/produtos/' in href and '.pdf' in href.lower():
                    attachments.append({
                        'url': urljoin(self.base_url, href),
                        'name': link.get_text(strip=True) or os.path.basename(href)
                    })
            
            return {
                'id': product_id,
                'url': detail_url,
                'attachments': attachments
            }
            
        except Exception as e:
            logger.error(f"Erro ao obter detalhes do produto {product_id}: {e}")
            return {'id': product_id, 'attachments': []}
    
    def download_file(self, url: str, destination: Path) -> bool:
        """
        Faz download de um arquivo.
        
        Args:
            url: URL do arquivo
            destination: Caminho de destino
            
        Returns:
            True se bem-sucedido, False caso contrário
        """
        try:
            # Verificar se arquivo já existe
            if destination.exists():
                logger.info(f"Arquivo já existe: {destination.name}")
                return True
            
            logger.info(f"Baixando: {url}")
            
            response = self.session.get(url, timeout=60, stream=True)
            response.raise_for_status()
            
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
                        if total_size:
                            percent = (downloaded / total_size) * 100
                            logger.debug(f"  Progresso: {percent:.1f}%")
            
            logger.info(f"Arquivo salvo: {destination.name} ({downloaded} bytes)")
            self.progress["downloaded_files"] += 1
            return True
            
        except Exception as e:
            logger.error(f"Erro ao baixar {url}: {e}")
            return False
    
    def process_products(self, products: List[Dict]):
        """
        Processa uma lista de produtos e faz download dos manuais.
        
        Args:
            products: Lista de produtos para processar
        """
        logger.info(f"Processando {len(products)} produtos...")
        
        for idx, product in enumerate(products, 1):
            try:
                # Verificar se já foi processado
                product_id = product.get('numero_registro') or product.get('id')
                
                if product_id in self.progress.get("products_processed", []):
                    logger.info(f"[{idx}] Produto já processado: {product_id}")
                    continue
                
                logger.info(f"[{idx}/{len(products)}] Processando: {product.get('nome', 'N/A')}")
                
                # Obter detalhes do produto
                details = self.get_product_details(product_id)
                
                # Fazer download dos anexos
                for attachment in details.get('attachments', []):
                    # Criar nome de arquivo seguro
                    safe_name = self._sanitize_filename(attachment['name'])
                    product_dir = self.output_dir / self._sanitize_filename(product.get('nome', product_id))
                    destination = product_dir / safe_name
                    
                    self.download_file(attachment['url'], destination)
                
                # Marcar como processado
                self.progress["products_processed"].append(product_id)
                self.progress["processed_products"] += 1
                self._save_progress()
                
                time.sleep(0.5)  # Respeitar rate limit
                
            except Exception as e:
                logger.error(f"Erro ao processar produto: {e}")
                self.progress["failed_products"].append(product_id)
                self._save_progress()
    
    def _sanitize_filename(self, filename: str) -> str:
        """Remove caracteres inválidos do nome de arquivo."""
        import re
        # Remover caracteres especiais
        filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
        # Limitar tamanho
        filename = filename[:200]
        return filename.strip()
    
    def generate_manifest(self, products: List[Dict]):
        """Gera um manifesto com informações dos produtos processados."""
        manifest = {
            "timestamp": datetime.now().isoformat(),
            "total_products": len(products),
            "downloaded_files": self.progress.get("downloaded_files", 0),
            "products": []
        }
        
        for product in products:
            product_id = product.get('numero_registro') or product.get('id')
            product_dir = self.output_dir / self._sanitize_filename(product.get('nome', product_id))
            
            files = []
            if product_dir.exists():
                files = [f.name for f in product_dir.glob('*') if f.is_file()]
            
            manifest["products"].append({
                "id": product_id,
                "name": product.get('nome'),
                "files": files
            })
        
        try:
            with open(self.manifest_file, 'w', encoding='utf-8') as f:
                json.dump(manifest, f, indent=2, ensure_ascii=False)
            logger.info(f"Manifesto salvo: {self.manifest_file}")
        except Exception as e:
            logger.error(f"Erro ao salvar manifesto: {e}")
    
    def run(self, search_term: str = "a"):
        """
        Executa o download completo.
        
        Args:
            search_term: Termo de busca para produtos
        """
        logger.info("=" * 60)
        logger.info("Iniciando download de manuais da ANVISA")
        logger.info(f"Diretório de saída: {self.output_dir}")
        logger.info("=" * 60)
        
        try:
            # Buscar produtos
            products = self.search_products(search_term)
            
            if not products:
                logger.warning("Nenhum produto encontrado")
                return
            
            # Processar produtos
            self.process_products(products)
            
            # Gerar manifesto
            self.generate_manifest(products)
            
            logger.info("=" * 60)
            logger.info("Download concluído com sucesso!")
            logger.info(f"Produtos processados: {self.progress['processed_products']}")
            logger.info(f"Arquivos baixados: {self.progress['downloaded_files']}")
            logger.info(f"Produtos com erro: {len(self.progress['failed_products'])}")
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
        description="Download automático de manuais de equipamentos médicos da ANVISA",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos de uso:
  # Download de todos os produtos
  python3 anvisa_downloader.py --output-dir ./manuais
  
  # Download limitado a 100 produtos
  python3 anvisa_downloader.py --output-dir ./manuais --max-products 100
  
  # Retomar download anterior
  python3 anvisa_downloader.py --output-dir ./manuais
        """
    )
    
    parser.add_argument(
        '--output-dir',
        type=str,
        default='./anvisa_manuais',
        help='Diretório para armazenar os manuais (padrão: ./anvisa_manuais)'
    )
    
    parser.add_argument(
        '--max-products',
        type=int,
        default=None,
        help='Limite máximo de produtos para processar (padrão: nenhum limite)'
    )
    
    parser.add_argument(
        '--search-term',
        type=str,
        default='a',
        help='Termo de busca para produtos (padrão: "a" para todos)'
    )
    
    args = parser.parse_args()
    
    # Criar downloader e executar
    downloader = AnvisaDownloader(
        output_dir=args.output_dir,
        max_products=args.max_products
    )
    
    downloader.run(search_term=args.search_term)


if __name__ == '__main__':
    main()
