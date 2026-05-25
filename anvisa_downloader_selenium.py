#!/usr/bin/env python3
"""
Script para download automático de manuais da ANVISA usando Selenium.

Este script usa Selenium com Chrome/Chromium para contornar proteções Cloudflare
e fazer scraping da interface web da ANVISA.

Instalação de dependências:
    pip3 install selenium beautifulsoup4 webdriver-manager

Uso:
    python3 anvisa_downloader_selenium.py --output-dir /caminho/para/manuais --max-products 100
"""

import os
import sys
import json
import time
import logging
import argparse
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional
from urllib.parse import urljoin

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from webdriver_manager.chrome import ChromeDriverManager
    from bs4 import BeautifulSoup
    import requests
except ImportError:
    print("Erro: Dependências não encontradas. Instale com:")
    print("  pip3 install selenium beautifulsoup4 webdriver-manager")
    sys.exit(1)

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('anvisa_downloader_selenium.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class AnvisaSeleniumDownloader:
    """Classe para gerenciar o download de manuais da ANVISA usando Selenium."""
    
    def __init__(self, output_dir: str, max_products: Optional[int] = None, headless: bool = True):
        """
        Inicializa o downloader.
        
        Args:
            output_dir: Diretório para armazenar os manuais
            max_products: Limite máximo de produtos para processar
            headless: Executar navegador em modo headless
        """
        self.output_dir = Path(output_dir)
        self.max_products = max_products
        self.base_url = "https://consultas.anvisa.gov.br"
        self.headless = headless
        self.driver = None
        self.progress_file = self.output_dir / "progress_selenium.json"
        self.manifest_file = self.output_dir / "manifest_selenium.json"
        
        # Criar diretório de saída
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Carregar progresso anterior
        self.progress = self._load_progress()
    
    def _setup_driver(self) -> webdriver.Chrome:
        """Configura o driver do Selenium."""
        options = Options()
        
        if self.headless:
            options.add_argument("--headless")
        
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--start-maximized")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option('useAutomationExtension', False)
        
        # User-Agent
        options.add_argument(
            "user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        )
        
        # Desabilitar imagens para acelerar
        prefs = {"profile.managed_default_content_settings.images": 2}
        options.add_experimental_option("prefs", prefs)
        
        try:
            service = Service(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=options)
            logger.info("Driver do Selenium configurado com sucesso")
            return driver
        except Exception as e:
            logger.error(f"Erro ao configurar driver: {e}")
            raise
    
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
    
    def search_products(self, search_term: str = "a") -> List[Dict]:
        """
        Busca produtos na ANVISA usando Selenium.
        
        Args:
            search_term: Termo de busca
            
        Returns:
            Lista de produtos encontrados
        """
        all_products = []
        page = self.progress.get("current_page", 1)
        
        logger.info(f"Iniciando busca de produtos (página {page})...")
        
        try:
            # Navegar para a página de busca
            search_url = f"{self.base_url}/#/saude/"
            logger.info(f"Navegando para: {search_url}")
            self.driver.get(search_url)
            
            # Aguardar carregamento
            time.sleep(3)
            
            # Preencher campo de busca
            try:
                search_field = WebDriverWait(self.driver, 10).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "input[type='text']"))
                )
                search_field.clear()
                search_field.send_keys(search_term)
                logger.info(f"Termo de busca inserido: {search_term}")
            except Exception as e:
                logger.error(f"Erro ao preencher campo de busca: {e}")
                return []
            
            # Clicar em Consultar
            try:
                submit_button = self.driver.find_element(By.CSS_SELECTOR, "input[type='submit']")
                submit_button.click()
                logger.info("Botão Consultar clicado")
            except Exception as e:
                logger.error(f"Erro ao clicar em Consultar: {e}")
                return []
            
            # Aguardar resultados
            time.sleep(5)
            
            # Extrair produtos da tabela
            page_num = 1
            while True:
                try:
                    # Aguardar tabela de resultados
                    WebDriverWait(self.driver, 10).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, "table tbody tr"))
                    )
                    
                    # Parsear HTML
                    soup = BeautifulSoup(self.driver.page_source, 'html.parser')
                    rows = soup.find_all('tr')
                    
                    page_products = 0
                    for row in rows[1:]:  # Pular header
                        cells = row.find_all('td')
                        if len(cells) >= 3:
                            product = {
                                'nome': cells[0].get_text(strip=True),
                                'numero_notificacao': cells[1].get_text(strip=True),
                                'numero_registro': cells[2].get_text(strip=True),
                                'empresa': cells[3].get_text(strip=True) if len(cells) > 3 else '',
                                'situacao': cells[4].get_text(strip=True) if len(cells) > 4 else '',
                            }
                            all_products.append(product)
                            page_products += 1
                    
                    logger.info(f"Página {page_num}: {page_products} produtos extraídos")
                    
                    # Verificar limite
                    if self.max_products and len(all_products) >= self.max_products:
                        logger.info(f"Limite de {self.max_products} produtos atingido")
                        all_products = all_products[:self.max_products]
                        break
                    
                    # Tentar ir para próxima página
                    try:
                        next_button = self.driver.find_element(By.CSS_SELECTOR, "a[ng-click*='next']")
                        if next_button.get_attribute('disabled'):
                            logger.info("Última página atingida")
                            break
                        next_button.click()
                        page_num += 1
                        time.sleep(2)
                    except:
                        logger.info("Nenhum botão de próxima página encontrado")
                        break
                        
                except Exception as e:
                    logger.error(f"Erro ao extrair produtos: {e}")
                    break
            
            logger.info(f"Total de produtos encontrados: {len(all_products)}")
            return all_products
            
        except Exception as e:
            logger.error(f"Erro na busca de produtos: {e}")
            return []
    
    def get_product_attachments(self, product_id: str) -> List[Dict]:
        """
        Obtém os anexos de um produto.
        
        Args:
            product_id: ID do produto (número de registro)
            
        Returns:
            Lista de anexos com URLs
        """
        try:
            # Navegar para página do produto
            product_url = f"{self.base_url}/#/saude/{product_id}"
            logger.info(f"Acessando: {product_url}")
            self.driver.get(product_url)
            
            time.sleep(2)
            
            # Parsear HTML para encontrar anexos
            soup = BeautifulSoup(self.driver.page_source, 'html.parser')
            
            attachments = []
            for link in soup.find_all('a'):
                href = link.get('href', '')
                if '/api/consulta/produtos/' in href and '.pdf' in href.lower():
                    attachments.append({
                        'url': urljoin(self.base_url, href),
                        'name': link.get_text(strip=True) or os.path.basename(href)
                    })
            
            logger.info(f"Encontrados {len(attachments)} anexos para {product_id}")
            return attachments
            
        except Exception as e:
            logger.error(f"Erro ao obter anexos do produto {product_id}: {e}")
            return []
    
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
            if destination.exists():
                logger.info(f"Arquivo já existe: {destination.name}")
                return True
            
            logger.info(f"Baixando: {url}")
            
            # Usar cookies da sessão do Selenium
            response = requests.get(
                url,
                timeout=60,
                cookies={cookie['name']: cookie['value'] for cookie in self.driver.get_cookies()},
                headers={
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
                }
            )
            response.raise_for_status()
            
            # Salvar arquivo
            destination.parent.mkdir(parents=True, exist_ok=True)
            
            with open(destination, 'wb') as f:
                f.write(response.content)
            
            logger.info(f"Arquivo salvo: {destination.name} ({len(response.content)} bytes)")
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
                product_id = product.get('numero_registro')
                
                if product_id in self.progress.get("products_processed", []):
                    logger.info(f"[{idx}] Produto já processado: {product_id}")
                    continue
                
                logger.info(f"[{idx}/{len(products)}] Processando: {product.get('nome', 'N/A')}")
                
                # Obter anexos
                attachments = self.get_product_attachments(product_id)
                
                # Fazer download dos anexos
                for attachment in attachments:
                    safe_name = self._sanitize_filename(attachment['name'])
                    product_dir = self.output_dir / self._sanitize_filename(product.get('nome', product_id))
                    destination = product_dir / safe_name
                    
                    self.download_file(attachment['url'], destination)
                
                # Marcar como processado
                self.progress["products_processed"].append(product_id)
                self.progress["processed_products"] += 1
                self._save_progress()
                
                time.sleep(1)
                
            except Exception as e:
                logger.error(f"Erro ao processar produto: {e}")
                self.progress["failed_products"].append(product_id)
                self._save_progress()
    
    def _sanitize_filename(self, filename: str) -> str:
        """Remove caracteres inválidos do nome de arquivo."""
        import re
        filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
        filename = filename[:200]
        return filename.strip()
    
    def run(self, search_term: str = "a"):
        """
        Executa o download completo.
        
        Args:
            search_term: Termo de busca para produtos
        """
        logger.info("=" * 60)
        logger.info("Iniciando download com Selenium")
        logger.info(f"Diretório de saída: {self.output_dir}")
        logger.info("=" * 60)
        
        try:
            # Configurar driver
            self.driver = self._setup_driver()
            
            # Buscar produtos
            products = self.search_products(search_term)
            
            if not products:
                logger.warning("Nenhum produto encontrado")
                return
            
            # Processar produtos
            self.process_products(products)
            
            logger.info("=" * 60)
            logger.info("Download concluído com sucesso!")
            logger.info(f"Produtos processados: {self.progress['processed_products']}")
            logger.info(f"Arquivos baixados: {self.progress['downloaded_files']}")
            logger.info("=" * 60)
            
        except KeyboardInterrupt:
            logger.info("Download interrompido pelo usuário")
            self._save_progress()
        except Exception as e:
            logger.error(f"Erro fatal: {e}", exc_info=True)
            self._save_progress()
        finally:
            if self.driver:
                self.driver.quit()


def main():
    """Função principal."""
    parser = argparse.ArgumentParser(
        description="Download automático de manuais da ANVISA com Selenium",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos de uso:
  # Download com interface gráfica
  python3 anvisa_downloader_selenium.py --output-dir ./manuais --no-headless
  
  # Download em background (headless)
  python3 anvisa_downloader_selenium.py --output-dir ./manuais --max-products 100
        """
    )
    
    parser.add_argument(
        '--output-dir',
        type=str,
        default='./anvisa_manuais',
        help='Diretório para armazenar os manuais'
    )
    
    parser.add_argument(
        '--max-products',
        type=int,
        default=None,
        help='Limite máximo de produtos para processar'
    )
    
    parser.add_argument(
        '--search-term',
        type=str,
        default='a',
        help='Termo de busca para produtos'
    )
    
    parser.add_argument(
        '--no-headless',
        action='store_true',
        help='Executar navegador com interface gráfica'
    )
    
    args = parser.parse_args()
    
    # Criar downloader e executar
    downloader = AnvisaSeleniumDownloader(
        output_dir=args.output_dir,
        max_products=args.max_products,
        headless=not args.no_headless
    )
    
    downloader.run(search_term=args.search_term)


if __name__ == '__main__':
    main()
