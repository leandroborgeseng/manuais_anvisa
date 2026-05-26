#!/usr/bin/env python3
"""
Script para download de manuais da ANVISA com upload automático para Backblaze B2.

Este script é otimizado para rodar no Railway com Backblaze B2.

Variáveis de ambiente necessárias:
    B2_APPLICATION_KEY_ID: ID da chave de aplicação B2
    B2_APPLICATION_KEY: Chave de aplicação B2
    B2_BUCKET_NAME: Nome do bucket B2
    MAX_FILES: Limite de arquivos (padrão: 10000)
    RAILWAY_ENVIRONMENT_NAME: Ambiente do Railway (opcional)

Instalação:
    pip3 install requests beautifulsoup4 lxml b2sdk

Uso local:
    export B2_APPLICATION_KEY_ID="seu_id"
    export B2_APPLICATION_KEY="sua_chave"
    export B2_BUCKET_NAME="seu_bucket"
    python3 anvisa_downloader_b2.py

Uso no Railway:
    1. Criar bucket no Backblaze B2
    2. Gerar chave de aplicação
    3. Configurar variáveis de ambiente no Railway
    4. Fazer deploy
"""

import os
import sys
import json
import time
import logging
import argparse
import re
import unicodedata
from pathlib import Path
from datetime import datetime
from urllib.parse import urljoin, quote, unquote, urlparse
from typing import Callable, List, Dict, Optional, Set, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
import tempfile

try:
    import requests
    import certifi
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
    from bs4 import BeautifulSoup
except ImportError:
    print("Erro: Dependências não encontradas. Instale com:")
    print("  pip3 install requests beautifulsoup4 lxml b2sdk")
    sys.exit(1)

# Tentar importar b2sdk
try:
    from b2sdk.v2 import InMemoryAccountInfo, B2Api
    from b2sdk.v2.exception import NonExistentBucket
    HAS_B2SDK = True
except ImportError:
    HAS_B2SDK = False
    print("Aviso: b2sdk não instalado. Instale com: pip3 install b2sdk")

# Configuração de logging
log_level = os.getenv('LOG_LEVEL', 'INFO')
logging.basicConfig(
    level=getattr(logging, log_level),
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('anvisa_downloader_b2.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Equipamentos médicos (filtro client-side — a API não filtra nomeProduto de forma confiável)
DEFAULT_EQUIPMENT_KEYWORDS = [
    "monitor",
    "oximet",
    "ventilador",
    "desfibril",
    "eletrocardiogra",
    "ultrassom",
    "ultrasson",
    "tomogra",
    "ressonancia",
    "endoscop",
    "marcapasso",
    "autoclave",
    "esteriliz",
    "incubadora",
    "hemodial",
    "mamogra",
    "bomba infus",
    "bomba de infus",
    "aspirador cirurg",
    "mesa cirurg",
    "radiolog",
    "implante",
    "raio x",
    "raio-x",
    "cintilograf",
    "litotrips",
    "anestes",
    "respirator",
    "cardiovers",
    "holter",
    "spiromet",
    "nebuliz",
    "fototerap",
    "termometro clinico",
    "pressao arterial",
    "aparelho auditivo",
]

# Consumíveis — excluir mesmo que apareçam na busca genérica da API
CONSUMABLE_MARKERS = [
    "seringa",
    "luva",
    "agulha",
    "cateter",
    "sonda",
    "equipo",
    "gaze",
    "atadura",
    "curativo",
    "algodao",
    "mascara descart",
    "capote",
    "avental",
]


def _normalize_text(value: str) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", ascii_text).strip().lower()


class BackblazeB2Manager:
    """Gerenciador de uploads para Backblaze B2."""
    
    def __init__(self, app_key_id: str, app_key: str, bucket_name: str):
        """
        Inicializa o gerenciador B2.
        
        Args:
            app_key_id: ID da chave de aplicação
            app_key: Chave de aplicação
            bucket_name: Nome do bucket
        """
        if not HAS_B2SDK:
            raise ImportError("b2sdk é necessário. Instale com: pip3 install b2sdk")
        
        self.bucket_name = bucket_name
        
        # Configurar conta B2
        info = InMemoryAccountInfo()
        self.api = B2Api(info)
        
        try:
            self.api.authorize_account('production', app_key_id, app_key)
            logger.info(f"Autorizado no Backblaze B2")
        except Exception as e:
            logger.error(f"Erro ao autorizar B2: {e}")
            raise
        
        # Obter bucket
        try:
            self.bucket = self.api.get_bucket_by_name(bucket_name)
            logger.info(f"Bucket B2 conectado: {bucket_name}")
        except NonExistentBucket:
            logger.error(f"Bucket não encontrado: {bucket_name}")
            raise
        except Exception as e:
            logger.error(f"Erro ao conectar bucket: {e}")
            raise
    
    def upload_file(self, local_path: Path, remote_path: str, metadata: Optional[Dict] = None) -> bool:
        """
        Faz upload de um arquivo para B2.
        
        Args:
            local_path: Caminho local do arquivo
            remote_path: Caminho remoto no B2
            metadata: Metadados adicionais
            
        Returns:
            True se bem-sucedido
        """
        try:
            if not local_path.exists():
                logger.error(f"Arquivo não encontrado: {local_path}")
                return False
            
            file_size = local_path.stat().st_size
            logger.info(f"Fazendo upload: {remote_path} ({file_size} bytes)")
            
            # Preparar metadados
            file_info = metadata or {}
            
            # Upload
            with open(local_path, 'rb') as f:
                file_version = self.bucket.upload_bytes(
                    f.read(),
                    remote_path,
                    file_info=file_info
                )
            
            logger.info(f"Upload concluído: {remote_path}")
            return True
            
        except Exception as e:
            logger.error(f"Erro ao fazer upload: {e}")
            return False
    
    def list_files(self, prefix: str = "") -> List[str]:
        """
        Lista arquivos no bucket.
        
        Args:
            prefix: Prefixo para filtrar
            
        Returns:
            Lista de nomes de arquivos
        """
        try:
            files = []
            for file_version, _ in self.bucket.ls(recursive=True, fetch_count=1000):
                if prefix and not file_version.file_name.startswith(prefix):
                    continue
                files.append(file_version.file_name)
            
            return files
            
        except Exception as e:
            logger.error(f"Erro ao listar arquivos: {e}")
            return []
    
    def get_file_url(self, remote_path: str) -> str:
        """
        Gera URL pública para um arquivo.
        
        Args:
            remote_path: Caminho remoto
            
        Returns:
            URL pública
        """
        # URL pública do B2
        return f"https://f000.backblazeb2.com/file/{self.bucket_name}/{remote_path}"


class AnvisaB2Downloader:
    """Downloader da ANVISA com suporte a Backblaze B2."""
    
    def __init__(self, output_dir: str, b2_manager: Optional[BackblazeB2Manager] = None,
                 max_files: Optional[int] = None, max_workers: int = 4):
        """
        Inicializa o downloader.
        
        Args:
            output_dir: Diretório temporário para armazenar arquivos
            b2_manager: Gerenciador B2 (opcional)
            max_files: Limite máximo de arquivos
            max_workers: Número de workers para downloads paralelos
        """
        self.output_dir = Path(output_dir)
        self.b2_manager = b2_manager
        self.max_files = max_files
        self.max_workers = max_workers
        self.session = self._create_session()
        self.progress_file = self.output_dir / "progress_b2.json"
        self.manifest_file = self.output_dir / "manifest_b2.json"
        self.downloaded_urls: Set[str] = set()
        self.manual_metadata: Dict[str, Dict] = {}
        self._product_manuals_cache: Dict[str, List[Dict]] = {}
        
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate',
            'Authorization': 'Guest',
            'Referer': 'https://consultas.anvisa.gov.br/',
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
            "uploaded_b2_files": []
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
    
    def _is_pdf_attachment(self, arquivo: Dict) -> bool:
        tipo = (arquivo.get("tipoArquivo") or "").upper()
        nome = (
            (arquivo.get("nomeCompleto") or "")
            + " "
            + (arquivo.get("nomeArquivo") or "")
        ).lower()
        if tipo and tipo != "PDF":
            return False
        return tipo == "PDF" or ".pdf" in nome

    def _is_downloadable_attachment(self, arquivo: Dict) -> bool:
        """Anexo PDF disponível para download (manual, rotulagem, etc.)."""
        if not arquivo.get("anexoCod"):
            return False
        if not self._is_pdf_attachment(arquivo):
            return False

        manual_only = os.getenv("ANVISA_MANUAL_ONLY", "").lower() in ("1", "true", "yes")
        any_pdf = os.getenv("ANVISA_ANY_PDF", "true").lower() in ("1", "true", "yes")
        if any_pdf and not manual_only:
            return True

        descricao = (arquivo.get("descricaoTipoAnexo") or "").upper()
        manual_markers = ("INSTRU", "MANUAL", "USO", "ROTULAG", "FOLDER", "ANEXO")
        return any(m in descricao for m in manual_markers)

    def _validate_pdf_bytes(self, data: bytes, url: str) -> Optional[str]:
        """Retorna mensagem de erro ou None se PDF válido."""
        if not data.startswith(b"%PDF"):
            return "não começa com %PDF"
        min_size = int(os.getenv("ANVISA_MIN_PDF_BYTES", "20480"))
        if len(data) < min_size:
            return f"tamanho suspeito ({len(data)} bytes, mínimo {min_size})"
        if b"%%EOF" not in data[-4096:]:
            return "sem marcador %%EOF (arquivo truncado ou inválido)"
        return None

    def _download_pdf_bytes(self, url: str) -> bytes:
        """Baixa o PDF completo em uma única leitura (evita truncar no 1º chunk)."""
        headers = {
            "Accept": "application/pdf, application/octet-stream, */*",
            "Referer": "https://consultas.anvisa.gov.br/",
        }
        response = self.session.get(
            url, timeout=120, allow_redirects=True, headers=headers
        )
        response.raise_for_status()
        return response.content

    def _product_text(self, product: Dict) -> str:
        return _normalize_text(
            f"{product.get('produto') or ''} {product.get('nomeTecnico') or ''}"
        )

    def _is_consumable(self, product: Dict) -> bool:
        text = self._product_text(product)
        return any(marker in text for marker in CONSUMABLE_MARKERS)

    def _matches_keyword(self, product: Dict, keyword: str) -> bool:
        text = self._product_text(product)
        return _normalize_text(keyword) in text

    def _matches_any_keyword(self, product: Dict, keywords: List[str]) -> bool:
        if self._is_consumable(product):
            return False
        text = self._product_text(product)
        return any(_normalize_text(k) in text for k in keywords)

    def _get_equipment_keywords(self) -> List[str]:
        env_terms = os.getenv("ANVISA_EQUIPMENT_KEYWORDS", "")
        if env_terms.strip():
            return [t.strip() for t in env_terms.split(",") if t.strip()]
        env_search = os.getenv("ANVISA_SEARCH_TERMS", "")
        if env_search.strip():
            return [t.strip() for t in env_search.split(",") if t.strip()]
        return DEFAULT_EQUIPMENT_KEYWORDS

    def _anexo_key(self, processo: str, metadata: Dict, url: str) -> str:
        anexo_cod = metadata.get("anexoCod")
        if anexo_cod:
            return f"{processo}:{anexo_cod}"
        nome = metadata.get("nomeArquivo") or metadata.get("pdfFilename")
        if nome:
            return f"{processo}:{nome}"
        return url

    def _register_manual(
        self,
        url: str,
        metadata: Dict,
        seen_urls: Set[str],
        seen_anexos: Set[str],
        urls: List[str],
        on_manual: Optional[Callable[[str, Dict], None]],
        *,
        index: int = 1,
        total: int = 1,
    ) -> bool:
        """Registra anexo novo. Retorna True se ainda não havia sido processado."""
        processo = str(metadata.get("processo") or "")
        anexo_key = self._anexo_key(processo, metadata, url)
        if anexo_key in seen_anexos or url in seen_urls:
            return False
        seen_anexos.add(anexo_key)
        seen_urls.add(url)
        urls.append(url)
        self.manual_metadata[url] = metadata
        arquivo = metadata.get("nomeArquivo") or metadata.get("pdfFilename") or "arquivo"
        logger.info(
            f"Anexo {index}/{total}: {metadata.get('nomeProduto', processo)} "
            f"— {arquivo} ({metadata.get('tipoAnexo', '')})"
        )
        if on_manual:
            on_manual(url, metadata)
        print(f"TOTAL_FOUND:{len(urls)}", flush=True)
        return True

    def _process_product_for_manuals(
        self,
        product: Dict,
        seen_urls: Set[str],
        seen_anexos: Set[str],
        urls: List[str],
        max_results: int,
        on_manual: Optional[Callable[[str, Dict], None]],
        search_term: Optional[str] = None,
    ) -> Tuple[int, int]:
        """
        Consulta detalhe do produto e registra todos os anexos PDF.
        Retorna (anexos_encontrados, anexos_novos).
        """
        processo = product.get("processo")
        if not processo:
            return 0, 0

        nome_produto = product.get("produto") or search_term or ""
        manuals = self._get_product_manuals(
            processo, nome_produto, search_term=search_term
        )
        found = len(manuals)
        new_count = 0

        if found > 1:
            logger.info(
                f"Processo {processo}: {found} arquivo(s) PDF — "
                f"{manuals[0]['metadata'].get('nomeProduto', nome_produto)}"
            )

        for index, manual in enumerate(manuals, start=1):
            if self._register_manual(
                manual["url"],
                manual["metadata"],
                seen_urls,
                seen_anexos,
                urls,
                on_manual,
                index=index,
                total=found,
            ):
                new_count += 1
            if len(urls) >= max_results:
                break
        return found, new_count

    def search_anvisa_pdfs(
        self,
        max_results: int = 100,
        on_manual: Optional[Callable[[str, Dict], None]] = None,
    ) -> List[str]:
        """
        Busca PDFs de manuais via API oficial da ANVISA (consultas.anvisa.gov.br).

        Modos (ANVISA_SCAN_MODE):
          - catalog (padrão): pagina o catálogo inteiro e filtra equipamentos no cliente
          - terms: busca por termos (legado; a API retorna resultados genéricos)
        """
        scan_mode = os.getenv("ANVISA_SCAN_MODE", "open_data").strip().lower()
        if scan_mode in ("catalog", "open_data"):
            return self._search_open_data_catalog(max_results, on_manual)
        if scan_mode == "terms":
            return self._search_by_terms(max_results, on_manual)
        logger.warning(f"ANVISA_SCAN_MODE desconhecido ({scan_mode}), usando open_data")
        return self._search_open_data_catalog(max_results, on_manual)

    def _open_data_verify_ssl(self) -> bool:
        return os.getenv("ANVISA_OPEN_DATA_VERIFY_SSL", "false").lower() not in (
            "0",
            "false",
            "no",
        )

    def _fetch_open_data_csv(self, csv_url: str) -> requests.Response:
        """Baixa CSV de dados abertos (certificado ANVISA costuma falhar em containers)."""
        headers = {"User-Agent": self.session.headers.get("User-Agent", "")}
        verify = certifi.where() if self._open_data_verify_ssl() else False

        try:
            response = requests.get(
                csv_url, timeout=300, verify=verify, stream=True, headers=headers
            )
            response.raise_for_status()
            return response
        except requests.exceptions.SSLError as exc:
            if not verify:
                raise
            logger.warning(
                f"SSL de dados.anvisa.gov.br rejeitado ({exc}); "
                "tentando download sem verificação de certificado"
            )
            response = requests.get(
                csv_url, timeout=300, verify=False, stream=True, headers=headers
            )
            response.raise_for_status()
            return response

    def _download_open_data_csv(self, csv_url: str, cache_path: Path) -> Path:
        """Baixa CSV de dados abertos ANVISA (com cache local)."""
        ttl_hours = int(os.getenv("ANVISA_OPEN_DATA_CACHE_HOURS", "24"))
        if cache_path.exists():
            age_hours = (time.time() - cache_path.stat().st_mtime) / 3600
            if age_hours < ttl_hours:
                logger.info(f"Usando CSV em cache: {cache_path} ({age_hours:.1f}h)")
                return cache_path

        logger.info(f"Baixando dados abertos ANVISA: {csv_url}")
        response = self._fetch_open_data_csv(csv_url)

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = cache_path.with_suffix(".tmp")
        with open(tmp_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
        tmp_path.replace(cache_path)
        logger.info(f"CSV salvo: {cache_path} ({cache_path.stat().st_size} bytes)")
        return cache_path

    def _iter_open_data_products(self, csv_path: Path):
        """Itera produtos do CSV TA_PRODUTO_SAUDE_SITE."""
        import csv

        with open(csv_path, "r", encoding="latin-1", newline="") as f:
            reader = csv.DictReader(f, delimiter=";")
            for row in reader:
                processo = (row.get("NUMERO_PROCESSO") or "").strip()
                if not processo:
                    continue
                yield {
                    "processo": processo,
                    "produto": (row.get("NOME_COMERCIAL") or "").strip(),
                    "nomeTecnico": (row.get("NOME_TECNICO") or "").strip(),
                    "numeroRegistro": (row.get("NUMERO_REGISTRO_CADASTRO") or "").strip(),
                    "situacao": (row.get("VALIDADE_REGISTRO_CADASTRO") or "").strip(),
                }

    def _search_open_data_catalog(
        self,
        max_results: int,
        on_manual: Optional[Callable[[str, Dict], None]] = None,
    ) -> List[str]:
        """
        Usa o CSV oficial de produtos para saúde (dados.abertos ANVISA).

        A API consultas.anvisa.gov.br com Authorization: Guest ignora busca e paginação
        (sempre retorna os mesmos ~10 produtos). O CSV tem ~180k registros reais.
        """
        urls: List[str] = []
        seen_urls: Set[str] = set()
        seen_anexos: Set[str] = set()
        keywords = self._get_equipment_keywords()

        csv_url = os.getenv(
            "ANVISA_OPEN_DATA_URL",
            "https://dados.anvisa.gov.br/dados/TA_PRODUTO_SAUDE_SITE.csv",
        )
        cache_path = Path(
            os.getenv("ANVISA_OPEN_DATA_CACHE", "/tmp/ta_produto_saude_site.csv")
        )
        detail_delay = float(os.getenv("ANVISA_DETAIL_DELAY", "0.15"))
        max_scan = int(os.getenv("ANVISA_OPEN_DATA_MAX_ROWS", "0"))  # 0 = sem limite

        logger.info("Buscando manuais via dados abertos ANVISA (CSV oficial)...")
        logger.info(f"CSV: {csv_url}, keywords={len(keywords)}")

        try:
            csv_path = self._download_open_data_csv(csv_url, cache_path)
        except Exception as e:
            logger.error(f"Falha ao baixar CSV de dados abertos: {e}")
            print(f"ERROR:CSV_DOWNLOAD:{e}", flush=True)
            return []

        equipment_checked = 0
        rows_read = 0

        for product in self._iter_open_data_products(csv_path):
            rows_read += 1
            if max_scan > 0 and rows_read > max_scan:
                logger.info(f"Limite ANVISA_OPEN_DATA_MAX_ROWS atingido ({max_scan})")
                break

            if not self._matches_any_keyword(product, keywords):
                continue

            equipment_checked += 1
            found, new_count = self._process_product_for_manuals(
                product,
                seen_urls,
                seen_anexos,
                urls,
                max_results,
                on_manual,
            )

            if found and logger.isEnabledFor(logging.DEBUG):
                logger.debug(
                    f"CSV [{equipment_checked}] {product.get('produto')} -> "
                    f"{found} manual(is), {new_count} novo(s)"
                )

            if equipment_checked % 50 == 0:
                logger.info(
                    f"Dados abertos: {rows_read} linhas, {equipment_checked} equipamentos, "
                    f"{len(urls)} manuais (total meta: {max_results})"
                )

            if len(urls) >= max_results:
                break
            if detail_delay > 0:
                time.sleep(detail_delay)

        logger.info(
            f"Dados abertos: {rows_read} linhas lidas, {equipment_checked} equipamentos "
            f"filtrados, {len(urls)} manuais encontrados"
        )
        if not on_manual:
            print(f"TOTAL_FOUND:{len(urls)}", flush=True)
        return urls[:max_results]

    def _search_by_terms(
        self,
        max_results: int,
        on_manual: Optional[Callable[[str, Dict], None]] = None,
    ) -> List[str]:
        """Busca legada por termos (com filtro client-side no nome do produto)."""
        urls: List[str] = []
        seen_urls: Set[str] = set()
        seen_anexos: Set[str] = set()

        default_terms = DEFAULT_EQUIPMENT_KEYWORDS[:20]
        env_terms = os.getenv("ANVISA_SEARCH_TERMS", "")
        search_terms = [t.strip() for t in env_terms.split(",") if t.strip()] or default_terms

        logger.info("Buscando manuais via API ANVISA (modo termos + filtro client-side)...")
        page_size = int(os.getenv("ANVISA_PAGE_SIZE", "20"))
        max_pages_per_term = int(os.getenv("ANVISA_MAX_PAGES", "25"))
        max_empty_pages = int(os.getenv("ANVISA_MAX_EMPTY_PAGES", "8"))
        detail_delay = float(os.getenv("ANVISA_DETAIL_DELAY", "0.15"))

        logger.info(
            f"Limites: max_páginas/termo={max_pages_per_term}, "
            f"páginas_vazias_consecutivas={max_empty_pages}, page_size={page_size}"
        )

        for term in search_terms:
            if len(urls) >= max_results:
                break

            page = 0
            empty_pages = 0
            while len(urls) < max_results and page < max_pages_per_term:
                products, is_last = self._search_anvisa_products(term, page, page_size)
                if not products:
                    break

                page_relevant = 0
                page_manuals_found = 0
                page_manuals_new = 0

                for product in products:
                    if not self._matches_keyword(product, term):
                        continue
                    page_relevant += 1

                    found, new_count = self._process_product_for_manuals(
                        product,
                        seen_urls,
                        seen_anexos,
                        urls,
                        max_results,
                        on_manual,
                        search_term=term,
                    )
                    page_manuals_found += found
                    page_manuals_new += new_count

                    if len(urls) >= max_results:
                        break
                    if detail_delay > 0:
                        time.sleep(detail_delay)

                logger.info(
                    f"API ANVISA [{term} pág {page}]: {len(products)} produtos, "
                    f"{page_relevant} relevantes, {page_manuals_found} manuais "
                    f"({page_manuals_new} novos, total: {len(urls)})"
                )

                # Página vazia = nenhum produto relevante OU nenhum manual nos relevantes
                if page_relevant == 0 or page_manuals_found == 0:
                    empty_pages += 1
                    if empty_pages >= max_empty_pages:
                        logger.info(
                            f"Termo '{term}': {max_empty_pages} páginas seguidas sem "
                            f"manuais em produtos relevantes — próximo termo"
                        )
                        break
                else:
                    empty_pages = 0

                if is_last:
                    break

                page += 1
                time.sleep(0.3)

            time.sleep(0.5)

        logger.info(f"Total de URLs encontradas: {len(urls)}")
        if not on_manual:
            print(f"TOTAL_FOUND:{len(urls)}", flush=True)
        return urls[:max_results]

    def _search_anvisa_products(
        self, nome_produto: str, pagina: int = 0, tamanho: int = 20
    ) -> Tuple[List[Dict], bool]:
        """Lista produtos para saúde na API da ANVISA."""
        api_url = "https://consultas.anvisa.gov.br/api/consulta/saude"
        params = {
            "pagina": pagina,
            "tamanho": tamanho,
            "nomeProduto": nome_produto,
        }

        try:
            response = self.session.get(api_url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            content = data.get("content", [])
            is_last = data.get("last", True)
            total = data.get("totalElements", "?")
            logger.debug(
                f"API ANVISA [{nome_produto} pág {pagina}]: "
                f"{len(content)} produtos (total catálogo: {total})"
            )
            return content, is_last
        except Exception as e:
            logger.warning(f"Erro na API ANVISA para '{nome_produto}' pág {pagina}: {e}")
            return [], True

    def _parse_anvisa_date(self, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        return value

    def _build_equipamento_metadata(
        self, detail: Dict, arquivo: Dict, pdf_url: str, pdf_filename: str
    ) -> Dict:
        venc = detail.get("vencimento") or {}
        risco = detail.get("risco") or {}
        empresa = detail.get("empresa") or {}
        return {
            "processo": detail.get("processo"),
            "numeroRegistro": detail.get("registro"),
            "nomeProduto": detail.get("produto"),
            "nomeTecnico": detail.get("nomeTecnico"),
            "situacao": detail.get("situacao"),
            "cnpjEmpresa": empresa.get("cnpj"),
            "razaoSocial": empresa.get("razaoSocial"),
            "autorizacaoEmpresa": empresa.get("autorizacao"),
            "riscoSigla": risco.get("sigla"),
            "riscoDescricao": risco.get("descricao"),
            "vencimentoDescricao": venc.get("descricao"),
            "vencimentoVencido": venc.get("vencido"),
            "dataInicioVigencia": self._parse_anvisa_date(detail.get("dataInicioVigencia")),
            "dataVencimento": self._parse_anvisa_date(
                detail.get("dataVencimento") or venc.get("data")
            ),
            "dataCancelamento": self._parse_anvisa_date(detail.get("dataCancelamento")),
            "cancelado": detail.get("cancelado"),
            "tipoAnexo": arquivo.get("descricaoTipoAnexo"),
            "nomeArquivo": arquivo.get("nomeCompleto") or arquivo.get("nomeArquivo"),
            "dataEnvioAnexo": self._parse_anvisa_date(arquivo.get("dtEnvio")),
            "anexoCod": arquivo.get("anexoCod"),
            "nuExpediente": arquivo.get("nuExpediente"),
            "fabricantes": detail.get("fabricantes", []),
            "pdfUrl": pdf_url,
            "pdfFilename": pdf_filename,
        }

    def _get_product_manuals(
        self, processo: str, nome_produto: str, search_term: Optional[str] = None
    ) -> List[Dict]:
        """Obtém todos os anexos PDF e metadados completos de um produto."""
        cache_key = str(processo)
        if cache_key in self._product_manuals_cache:
            return self._product_manuals_cache[cache_key]

        api_url = f"https://consultas.anvisa.gov.br/api/consulta/saude/{processo}"
        manuals: List[Dict] = []

        param_candidates = [nome_produto]
        if search_term and search_term not in param_candidates:
            param_candidates.append(search_term)

        detail: Optional[Dict] = None
        arquivos_by_key: Dict[str, Dict] = {}

        for param in param_candidates:
            try:
                response = self.session.get(
                    api_url, params={"nomeProduto": param}, timeout=30
                )
                if response.status_code != 200:
                    continue
                data = response.json()
                if not detail:
                    detail = data
                for arq in data.get("arquivos", []):
                    key = arq.get("anexoCod") or arq.get("nomeArquivo") or arq.get("nomeCompleto")
                    if key:
                        arquivos_by_key[str(key)] = arq
            except Exception as e:
                logger.debug(f"Erro ao obter anexos do processo {processo} ({param}): {e}")

        if not detail:
            self._product_manuals_cache[cache_key] = manuals
            return manuals

        try:
            arquivos = list(arquivos_by_key.values())
            pdfs = [a for a in arquivos if self._is_pdf_attachment(a)]
            for arq in arquivos:
                if not self._is_downloadable_attachment(arq):
                    continue

                anexo_cod = arq.get("anexoCod")
                nome = arq.get("nomeCompleto") or arq.get("nomeArquivo")
                if not anexo_cod or not nome:
                    continue

                download_url = (
                    "https://consultas.anvisa.gov.br/api/consulta/produtos/"
                    f"{processo}/anexo/{anexo_cod}/nomeArquivo/{quote(nome, safe='')}"
                )
                pdf_filename = self._sanitize_filename(os.path.basename(nome))
                metadata = self._build_equipamento_metadata(detail, arq, download_url, pdf_filename)
                manuals.append({"url": download_url, "metadata": metadata})

            if pdfs and not manuals:
                logger.debug(
                    f"Processo {processo}: {len(pdfs)} PDF(s) ignorado(s) pelo filtro "
                    f"({detail.get('produto')})"
                )

        except Exception as e:
            logger.debug(f"Erro ao processar anexos do processo {processo}: {e}")

        self._product_manuals_cache[cache_key] = manuals
        return manuals

    def _get_product_pdf_urls(self, processo: str, nome_produto: str) -> List[str]:
        """Compatibilidade: retorna apenas URLs."""
        return [m["url"] for m in self._get_product_manuals(processo, nome_produto)]

    def _search_duckduckgo(self, query: str, max_results: int = 20) -> List[str]:
        """Fallback: busca no DuckDuckGo (pode falhar em datacenters)."""
        urls = []

        try:
            search_url = "https://html.duckduckgo.com/html"
            response = self.session.post(
                search_url,
                data={"q": query, "kl": "br-pt"},
                timeout=15,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")

            for link in soup.find_all("a", href=True):
                href = link["href"]
                if "uddg=" in href:
                    match = re.search(r"uddg=([^&]+)", href)
                    if match:
                        href = requests.utils.unquote(match.group(1))
                if "consultas.anvisa.gov.br" in href and ".pdf" in href.lower():
                    if href.startswith("http"):
                        urls.append(href)

            for link in soup.find_all("a", class_="result__url"):
                href = link.get("href", "")
                if "consultas.anvisa.gov.br" in href and ".pdf" in href.lower():
                    if href.startswith("http"):
                        urls.append(href)

            logger.info(f"DuckDuckGo (fallback): {len(urls)} URLs encontradas")

        except Exception as e:
            logger.warning(f"Erro ao buscar no DuckDuckGo: {e}")

        return urls[:max_results]
    
    def _filename_from_url(self, url: str) -> str:
        parsed_url = urlparse(url)
        filename = unquote(os.path.basename(parsed_url.path))
        if not filename or not filename.lower().endswith(".pdf"):
            filename = f"manual_{int(time.time())}.pdf"
        return self._sanitize_filename(filename)

    def _emit_equipamento(self, url: str, filename: str) -> None:
        equip_meta = {**self.manual_metadata.get(url, {}), "pdfFilename": filename, "pdfUrl": url}
        print(f"EQUIPAMENTO {json.dumps(equip_meta, ensure_ascii=False)}", flush=True)

    def download_and_upload_file(self, url: str, *, skip_announce: bool = False) -> bool:
        """
        Faz download de um arquivo e faz upload para B2.
        
        Args:
            url: URL do arquivo
            
        Returns:
            True se bem-sucedido
        """
        temp_file = None
        meta_file = None
        filename = ""
        
        try:
            if url in self.downloaded_urls:
                logger.info(f"Arquivo já processado: {url}")
                return True
            
            logger.info(f"Processando: {url}")

            filename = self._filename_from_url(url)
            equip_meta = {**self.manual_metadata.get(url, {}), "pdfFilename": filename, "pdfUrl": url}
            if not skip_announce:
                print(f"EQUIPAMENTO {json.dumps(equip_meta, ensure_ascii=False)}", flush=True)
                print(f"DOWNLOAD_START:{filename}:{url}", flush=True)

            # Download completo (não usar iter_content duas vezes — truncava em ~8 KB)
            pdf_data = self._download_pdf_bytes(url)
            pdf_error = self._validate_pdf_bytes(pdf_data, url)
            if pdf_error:
                logger.warning(f"PDF inválido ({pdf_error}): {url}")
                print(f"ERROR:{filename}:PDF inválido — {pdf_error}", flush=True)
                return False

            temp_file = self.output_dir / filename
            with open(temp_file, "wb") as f:
                f.write(pdf_data)

            file_size = len(pdf_data)
            logger.info(f"Download concluído: {filename} ({file_size} bytes)")
            
            # Upload para B2 se configurado
            if self.b2_manager:
                date_prefix = datetime.now().strftime('%Y/%m/%d')
                b2_path = f"manuais/{date_prefix}/{filename}"
                meta_path = f"manuais/{date_prefix}/{filename}.meta.json"
                print(f"UPLOAD_B2:{filename}", flush=True)

                equip_meta["b2MetaKey"] = meta_path
                meta_file = self.output_dir / f"{filename}.meta.json"
                with open(meta_file, "w", encoding="utf-8") as mf:
                    json.dump(equip_meta, mf, indent=2, ensure_ascii=False)

                b2_tags = {
                    "original_url": url,
                    "download_date": datetime.now().isoformat(),
                    "processo": str(equip_meta.get("processo", "")),
                    "numero_registro": str(equip_meta.get("numeroRegistro", "")),
                }

                if self.b2_manager.upload_file(temp_file, b2_path, b2_tags):
                    self.progress["uploaded_files"] += 1
                    self.progress["uploaded_b2_files"].append(b2_path)
                    logger.info(f"Upload B2 concluído: {b2_path}")
                    if meta_file.exists():
                        self.b2_manager.upload_file(
                            meta_file,
                            meta_path,
                            {"tipo": "metadata", "processo": str(equip_meta.get("processo", ""))},
                        )
                    equip_meta["b2MetaKey"] = meta_path
                    print(f"EQUIPAMENTO {json.dumps(equip_meta, ensure_ascii=False)}", flush=True)
                    print(f"COMPLETED:{filename}:{b2_path}:{file_size}", flush=True)
                else:
                    logger.error(f"Falha ao fazer upload para B2: {b2_path}")
                    return False
            
            self.downloaded_urls.add(url)
            self.progress["downloaded_files"] += 1
            self._save_progress()
            if not self.b2_manager:
                print(f"COMPLETED:{filename}:local:{file_size}", flush=True)
            
            return True
            
        except Exception as e:
            logger.error(f"Erro ao processar {url}: {e}")
            self.progress["failed_urls"].append(url)
            return False
        finally:
            if temp_file and temp_file.exists():
                try:
                    temp_file.unlink()
                except OSError:
                    pass
            if meta_file and meta_file.exists():
                try:
                    meta_file.unlink()
                except OSError:
                    pass
    
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
            "total_arquivos_enviados_b2": self.progress["uploaded_files"],
            "urls_falhadas": self.progress["failed_urls"],
            "b2_files": self.progress["uploaded_b2_files"],
            "storage_provider": "Backblaze B2"
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
        logger.info("Iniciando download de manuais da ANVISA com Backblaze B2")
        logger.info(f"Diretório temporário: {self.output_dir}")
        if self.b2_manager:
            logger.info(f"Bucket B2: {self.b2_manager.bucket_name}")
        logger.info("=" * 60)
        
        try:
            collected: List[str] = []

            def process_one(url: str, _metadata: Dict) -> None:
                """Encontrou → grava equipamento → baixa → upload → próximo."""
                filename = self._filename_from_url(url)
                self._emit_equipamento(url, filename)
                print(f"DOWNLOAD_START:{filename}:{url}", flush=True)
                ok = self.download_and_upload_file(url, skip_announce=True)
                if ok:
                    logger.info(f"Concluído, indo para o próximo: {filename}")
                else:
                    logger.warning(f"Falha no download, indo para o próximo: {filename}")

            logger.info("Pipeline sequencial: encontrar → gravar equipamento → baixar → próximo")

            collected = self.search_anvisa_pdfs(
                max_results=self.max_files or 100,
                on_manual=process_one,
            )

            if not collected:
                logger.warning("Nenhuma URL encontrada")
                return

            self.generate_manifest(collected)
            
            logger.info("=" * 60)
            logger.info("Download concluído com sucesso!")
            logger.info(f"Arquivos baixados: {self.progress['downloaded_files']}")
            logger.info(f"Arquivos enviados para B2: {self.progress['uploaded_files']}")
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
        description="Download de manuais da ANVISA com upload para Backblaze B2"
    )
    
    parser.add_argument('--output-dir', type=str, default='/tmp/anvisa_download',
                       help='Diretório temporário para downloads')
    parser.add_argument('--max-files', type=int, default=None,
                       help='Limite máximo de arquivos')
    parser.add_argument('--max-workers', type=int, default=4,
                       help='Número de workers paralelos')
    
    args = parser.parse_args()
    
    # Obter credenciais de variáveis de ambiente
    b2_app_key_id = os.getenv('B2_APPLICATION_KEY_ID')
    b2_app_key = os.getenv('B2_APPLICATION_KEY')
    b2_bucket_name = os.getenv('B2_BUCKET_NAME')
    max_files = args.max_files or int(os.getenv('MAX_FILES', 10000))
    
    # Criar gerenciador B2 se credenciais disponíveis
    b2_manager = None
    if b2_app_key_id and b2_app_key and b2_bucket_name:
        try:
            b2_manager = BackblazeB2Manager(b2_app_key_id, b2_app_key, b2_bucket_name)
            logger.info("Gerenciador B2 configurado com sucesso")
        except Exception as e:
            logger.error(f"Erro ao configurar B2: {e}")
            logger.info("Continuando sem B2...")
    else:
        logger.warning("Credenciais B2 não configuradas. Arquivos serão salvos localmente.")
    
    # Criar downloader e executar
    downloader = AnvisaB2Downloader(
        output_dir=args.output_dir,
        b2_manager=b2_manager,
        max_files=max_files,
        max_workers=args.max_workers
    )
    
    downloader.run()


if __name__ == '__main__':
    main()
