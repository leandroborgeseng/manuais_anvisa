#!/usr/bin/env python3
"""
Sincroniza o catálogo completo de produtos para saúde da ANVISA no PostgreSQL (via stdout).

Emite linhas estruturadas para o catalogManager do dashboard:
  CATALOG_META {"totalElements":..., "pageSize":..., "queryTerm":"..."}
  CATALOG_PAGE {"page":0,"count":50}
  REGISTRO_BATCH [{...}, ...]
  CATALOG_DONE {"records":1234}

Uso:
  python3 anvisa_catalog_sync.py --sync-id 1 --start-page 0
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from typing import Any, Dict, List, Optional

try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
except ImportError:
    print("Erro: pip install requests", flush=True)
    sys.exit(1)

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO")),
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger(__name__)

API_URL = "https://consultas.anvisa.gov.br/api/consulta/saude"


def create_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=1.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "pt-BR,pt;q=0.9",
            "Authorization": "Guest",
            "Referer": "https://consultas.anvisa.gov.br/",
        }
    )
    return session


def parse_anvisa_date(value: Optional[str]) -> Optional[str]:
    return value or None


def map_registro(item: Dict[str, Any], sync_id: int) -> Dict[str, Any]:
    empresa = item.get("empresa") or {}
    risco = item.get("risco") or {}
    venc = item.get("vencimento") or {}
    return {
        "processo": str(item.get("processo") or ""),
        "numeroRegistro": item.get("registro"),
        "nomeProduto": item.get("produto"),
        "nomeTecnico": item.get("nomeTecnico"),
        "situacao": item.get("situacao"),
        "cnpjEmpresa": empresa.get("cnpj"),
        "razaoSocial": empresa.get("razaoSocial"),
        "autorizacaoEmpresa": empresa.get("autorizacao"),
        "riscoSigla": risco.get("sigla"),
        "riscoDescricao": risco.get("descricao"),
        "vencimentoDescricao": venc.get("descricao"),
        "dataInicioVigencia": parse_anvisa_date(item.get("dataInicioVigencia")),
        "dataVencimento": parse_anvisa_date(
            item.get("dataVencimento") or venc.get("data")
        ),
        "dataCancelamento": parse_anvisa_date(item.get("dataCancelamento")),
        "cancelado": item.get("cancelado"),
        "catalogSyncId": sync_id,
        "metadataJson": item,
    }


class AnvisaCatalogSync:
    def __init__(
        self,
        sync_id: int,
        start_page: int = 0,
        query_term: str = "a",
        page_size: int = 50,
        max_pages: Optional[int] = None,
    ):
        self.sync_id = sync_id
        self.start_page = start_page
        self.query_term = query_term
        self.page_size = page_size
        self.max_pages = max_pages
        self.session = create_session()
        self.total_emitted = 0

    def fetch_page(self, page: int) -> tuple[List[Dict], bool, int]:
        params = {
            "pagina": page,
            "tamanho": self.page_size,
            "nomeProduto": self.query_term,
        }
        response = self.session.get(API_URL, params=params, timeout=60)
        response.raise_for_status()
        data = response.json()
        content = data.get("content") or []
        total = int(data.get("totalElements") or 0)
        is_last = bool(data.get("last", True))
        return content, is_last, total

    def run(self) -> int:
        page = self.start_page
        total_elements = 0
        pages_done = 0
        delay = float(os.getenv("ANVISA_CATALOG_DELAY", "0.2"))

        logger.info(
            f"Catálogo ANVISA: termo='{self.query_term}', página inicial={self.start_page}, "
            f"tamanho={self.page_size}"
        )

        while True:
            if self.max_pages is not None and pages_done >= self.max_pages:
                logger.info(f"Limite de páginas atingido ({self.max_pages})")
                break

            try:
                items, is_last, total_elements = self.fetch_page(page)
            except Exception as e:
                logger.error(f"Erro na página {page}: {e}")
                print(f"CATALOG_ERROR:{{\"page\":{page},\"message\":{json.dumps(str(e))}}}", flush=True)
                time.sleep(5)
                continue

            if page == self.start_page:
                total_pages = (
                    (total_elements + self.page_size - 1) // self.page_size
                    if total_elements
                    else 0
                )
                meta = {
                    "totalElements": total_elements,
                    "totalPages": total_pages,
                    "pageSize": self.page_size,
                    "queryTerm": self.query_term,
                    "startPage": self.start_page,
                }
                print(f"CATALOG_META {json.dumps(meta, ensure_ascii=False)}", flush=True)

            batch = [map_registro(item, self.sync_id) for item in items if item.get("processo")]
            if batch:
                print(f"REGISTRO_BATCH {json.dumps(batch, ensure_ascii=False)}", flush=True)
                self.total_emitted += len(batch)

            print(
                f"CATALOG_PAGE {json.dumps({'page': page, 'count': len(batch), 'totalEmitted': self.total_emitted}, ensure_ascii=False)}",
                flush=True,
            )
            logger.info(
                f"Página {page}: {len(batch)} registros (total emitido: {self.total_emitted} / catálogo ~{total_elements})"
            )

            pages_done += 1
            if is_last or not items:
                break

            page += 1
            if delay > 0:
                time.sleep(delay)

        print(f"CATALOG_DONE {json.dumps({'records': self.total_emitted}, ensure_ascii=False)}", flush=True)
        logger.info(f"Sincronização concluída: {self.total_emitted} registros emitidos")
        return self.total_emitted


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync catálogo ANVISA")
    parser.add_argument("--sync-id", type=int, required=True)
    parser.add_argument("--start-page", type=int, default=0)
    parser.add_argument("--query-term", type=str, default=None)
    parser.add_argument("--page-size", type=int, default=None)
    parser.add_argument("--max-pages", type=int, default=None)
    args = parser.parse_args()

    query_term = args.query_term or os.getenv("ANVISA_CATALOG_QUERY", "a")
    page_size = args.page_size or int(os.getenv("ANVISA_CATALOG_PAGE_SIZE", "50"))
    max_pages = args.max_pages
    if max_pages is None and os.getenv("ANVISA_CATALOG_MAX_PAGES"):
        max_pages = int(os.getenv("ANVISA_CATALOG_MAX_PAGES"))

    sync = AnvisaCatalogSync(
        sync_id=args.sync_id,
        start_page=args.start_page,
        query_term=query_term,
        page_size=page_size,
        max_pages=max_pages,
    )
    sync.run()


if __name__ == "__main__":
    main()
