#!/usr/bin/env python3
"""
Sincroniza o catálogo completo de produtos para saúde da ANVISA no PostgreSQL (via stdout).

Fonte: CSV oficial de dados abertos (TA_PRODUTO_SAUDE_SITE.csv).
A API consultas.anvisa.gov.br com Guest ignora busca/paginação.

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
import csv
import json
import logging
import os
import sys
import time
from pathlib import Path
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

DEFAULT_CSV_URL = "https://dados.anvisa.gov.br/dados/TA_PRODUTO_SAUDE_SITE.csv"


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
            "Accept": "text/csv, application/octet-stream, */*",
            "Accept-Language": "pt-BR,pt;q=0.9",
        }
    )
    return session


def parse_anvisa_date(value: Optional[str]) -> Optional[str]:
    if not value or not str(value).strip():
        return None
    raw = str(value).strip()
    # CSV usa DD/MM/YYYY
    if len(raw) == 10 and raw[2] == "/" and raw[5] == "/":
        d, m, y = raw.split("/")
        return f"{y}-{m}-{d}T00:00:00"
    return raw


def map_csv_registro(row: Dict[str, Any], sync_id: int) -> Dict[str, Any]:
    return {
        "processo": str(row.get("NUMERO_PROCESSO") or "").strip(),
        "numeroRegistro": (row.get("NUMERO_REGISTRO_CADASTRO") or "").strip() or None,
        "nomeProduto": (row.get("NOME_COMERCIAL") or "").strip() or None,
        "nomeTecnico": (row.get("NOME_TECNICO") or "").strip() or None,
        "situacao": (row.get("VALIDADE_REGISTRO_CADASTRO") or "").strip() or None,
        "cnpjEmpresa": (row.get("CNPJ_DETENTOR_REGISTRO_CADASTRO") or "").strip() or None,
        "razaoSocial": (row.get("DETENTOR_REGISTRO_CADASTRO") or "").strip() or None,
        "autorizacaoEmpresa": None,
        "riscoSigla": (row.get("CLASSE_RISCO") or "").strip() or None,
        "riscoDescricao": None,
        "vencimentoDescricao": (row.get("VALIDADE_REGISTRO_CADASTRO") or "").strip() or None,
        "dataInicioVigencia": parse_anvisa_date(row.get("DT_PUB_REGISTRO_CADASTRO")),
        "dataVencimento": parse_anvisa_date(row.get("VALIDADE_REGISTRO_CADASTRO")),
        "dataCancelamento": None,
        "cancelado": None,
        "catalogSyncId": sync_id,
        "metadataJson": row,
    }


class AnvisaCatalogSync:
    def __init__(
        self,
        sync_id: int,
        start_page: int = 0,
        query_term: str = "open_data",
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
        self.csv_url = os.getenv("ANVISA_OPEN_DATA_URL", DEFAULT_CSV_URL)
        self.cache_path = Path(
            os.getenv("ANVISA_OPEN_DATA_CACHE", "/tmp/ta_produto_saude_site.csv")
        )

    def _download_csv(self) -> Path:
        ttl_hours = int(os.getenv("ANVISA_OPEN_DATA_CACHE_HOURS", "24"))
        if self.cache_path.exists():
            age_hours = (time.time() - self.cache_path.stat().st_mtime) / 3600
            if age_hours < ttl_hours:
                logger.info(f"Usando CSV em cache: {self.cache_path}")
                return self.cache_path

        logger.info(f"Baixando CSV: {self.csv_url}")
        verify_ssl = os.getenv("ANVISA_OPEN_DATA_VERIFY_SSL", "true").lower() not in (
            "0",
            "false",
            "no",
        )
        response = self.session.get(
            self.csv_url, timeout=300, verify=verify_ssl, stream=True
        )
        response.raise_for_status()
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.cache_path.with_suffix(".tmp")
        with open(tmp, "wb") as f:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
        tmp.replace(self.cache_path)
        logger.info(f"CSV salvo: {self.cache_path} ({self.cache_path.stat().st_size} bytes)")
        return self.cache_path

    def _count_csv_rows(self, csv_path: Path) -> int:
        with open(csv_path, "r", encoding="latin-1", newline="") as f:
            return max(sum(1 for _ in f) - 1, 0)

    def run(self) -> int:
        delay = float(os.getenv("ANVISA_CATALOG_DELAY", "0.05"))
        skip_rows = self.start_page * self.page_size
        page = self.start_page
        pages_done = 0

        logger.info(
            f"Catálogo ANVISA (dados abertos): CSV, página inicial={self.start_page}, "
            f"tamanho lote={self.page_size}, skip_rows={skip_rows}"
        )

        try:
            csv_path = self._download_csv()
        except Exception as e:
            logger.error(f"Falha ao baixar CSV: {e}")
            print(
                f"CATALOG_ERROR:{json.dumps({'page': page, 'message': str(e)}, ensure_ascii=False)}",
                flush=True,
            )
            return 0

        total_elements = self._count_csv_rows(csv_path)
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
            "source": "open_data_csv",
            "csvUrl": self.csv_url,
        }
        print(f"CATALOG_META {json.dumps(meta, ensure_ascii=False)}", flush=True)

        batch: List[Dict[str, Any]] = []
        row_index = 0
        seen_processos: set[str] = set()

        with open(csv_path, "r", encoding="latin-1", newline="") as f:
            reader = csv.DictReader(f, delimiter=";")
            for row in reader:
                processo = str(row.get("NUMERO_PROCESSO") or "").strip()
                if not processo or processo in seen_processos:
                    row_index += 1
                    continue
                seen_processos.add(processo)

                if row_index < skip_rows:
                    row_index += 1
                    continue

                batch.append(map_csv_registro(row, self.sync_id))
                row_index += 1

                if len(batch) >= self.page_size:
                    print(f"REGISTRO_BATCH {json.dumps(batch, ensure_ascii=False)}", flush=True)
                    self.total_emitted += len(batch)
                    print(
                        f"CATALOG_PAGE {json.dumps({'page': page, 'count': len(batch), 'totalEmitted': self.total_emitted}, ensure_ascii=False)}",
                        flush=True,
                    )
                    logger.info(
                        f"Página {page}: {len(batch)} registros "
                        f"(total emitido: {self.total_emitted} / ~{total_elements})"
                    )
                    batch = []
                    pages_done += 1
                    page += 1

                    if self.max_pages is not None and pages_done >= self.max_pages:
                        logger.info(f"Limite de páginas atingido ({self.max_pages})")
                        break

                    if delay > 0:
                        time.sleep(delay)

        if batch and (self.max_pages is None or pages_done < self.max_pages):
            print(f"REGISTRO_BATCH {json.dumps(batch, ensure_ascii=False)}", flush=True)
            self.total_emitted += len(batch)
            print(
                f"CATALOG_PAGE {json.dumps({'page': page, 'count': len(batch), 'totalEmitted': self.total_emitted}, ensure_ascii=False)}",
                flush=True,
            )
            logger.info(
                f"Página final {page}: {len(batch)} registros (total: {self.total_emitted})"
            )

        print(
            f"CATALOG_DONE {json.dumps({'records': self.total_emitted}, ensure_ascii=False)}",
            flush=True,
        )
        logger.info(f"Sincronização concluída: {self.total_emitted} registros emitidos")
        return self.total_emitted


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync catálogo ANVISA (dados abertos)")
    parser.add_argument("--sync-id", type=int, required=True)
    parser.add_argument("--start-page", type=int, default=0)
    parser.add_argument("--query-term", type=str, default=None)
    parser.add_argument("--page-size", type=int, default=None)
    parser.add_argument("--max-pages", type=int, default=None)
    args = parser.parse_args()

    query_term = args.query_term or os.getenv("ANVISA_CATALOG_QUERY", "open_data")
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
