"""Recolhe textos dos códigos fiscais diretamente da AT para pesquisa estática.

As páginas continuam a ser da responsabilidade da Autoridade Tributária. O índice
é apenas uma cópia datada para pesquisa e nunca uma certificação de vigência.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from legal_text import normalize_article_lines


ROOT = "https://info.portaldasfinancas.gov.pt"
OUT = Path(__file__).resolve().parents[1] / "data" / "legal-index.json"
# A versão 2 preserva alíneas curtas como «j)», essenciais para interpretar a lei.
EXTRACTOR_VERSION = 2
CATALOG = {
    "CIVA": "/pt/informacao_fiscal/codigos_tributarios/civa_rep/pages/codigo-do-iva-indice.aspx",
    "CIRC": "/pt/informacao_fiscal/codigos_tributarios/CIRC_2R/Pages/circ-codigo-do-irc-indice.aspx",
    "CIRS": "/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/codigo-do-irs-indice.aspx",
    "EBF": "/pt/informacao_fiscal/codigos_tributarios/bf_rep/Pages/estatuto-dos-beneficios-fiscais-indice.aspx",
    "LGT": "/pt/informacao_fiscal/codigos_tributarios/lgt/Pages/lei-geral-tributaria-indice.aspx",
}

session = requests.Session()
session.headers.update({"User-Agent": "FernandoFiscal/1.0 (+GitHub-Pages; official-tax-document-index)", "Accept-Language": "pt-PT,pt;q=0.9"})


def get_html(url: str) -> BeautifulSoup:
    response = session.get(url, timeout=28)
    response.raise_for_status()
    response.encoding = response.apparent_encoding or response.encoding
    return BeautifulSoup(response.text, "html.parser")


def discover(code: str, path: str) -> list[str]:
    base = urljoin(ROOT, path)
    soup = get_html(base)
    prefix = path.split("/Pages/")[0].split("/pages/")[0].lower() + "/"
    discovered = set()
    for link in soup.select("a[href]"):
        url = urljoin(base, link.get("href", ""))
        parsed = urlparse(url)
        if parsed.hostname != "info.portaldasfinancas.gov.pt":
            continue
        pathname = parsed.path.lower()
        if prefix not in pathname or not pathname.endswith(".aspx"):
            continue
        name = pathname.rsplit("/", 1)[-1]
        if "indice" in name or "index" in name or "codigo-do" in name:
            continue
        label = link.get_text(" ", strip=True).lower()
        if "artigo" not in label and not re.search(r"(?:iva|irs|irc|bf|lgt)[-_]?\d+|ebf-artigo-\d+", name):
            continue
        discovered.add(url.split("#")[0].split("?")[0])
    print(f"{code}: {len(discovered)} artigos identificados")
    return sorted(discovered)


def article_text(soup: BeautifulSoup) -> tuple[str, str]:
    # SharePoint envolve a página inteira num <form id="aspnetForm">.
    # Remover esse elemento apagaria precisamente o artigo que procuramos.
    for element in soup.select("script,style,noscript,nav,footer,header,aside,.ms-core-navigation,.ms-srch-sb"): element.decompose()
    title = ""
    for selector in ("h1", "h2", "title"):
        node = soup.select_one(selector)
        if node and node.get_text(" ", strip=True):
            title = node.get_text(" ", strip=True)
            break
    # O Portal das Finanças usa páginas SharePoint com campos de conteúdo variáveis.
    selectors = (
        ".ms-rtestate-field", "[id*='RichHtmlField']", "[id*='Conteudo']",
        ".article-content", "#DeltaPlaceHolderMain", "main", "article",
        "[role='main']", "#contentBox",
    )
    candidates = []
    for selector in selectors:
        for node in soup.select(selector):
            content = node.get_text("\n", strip=True)
            if 180 <= len(content) <= 150000:
                candidates.append(content)
        if candidates and max(len(c) for c in candidates) >= 350:
            break
    if not candidates:
        body = soup.body or soup
        candidates = [body.get_text("\n", strip=True)]
    content = max(candidates, key=len)
    content = normalize_article_lines(content)
    return title[:190], content[:75000]


def main() -> None:
    prior = {}
    previously_fetched_today = False
    if OUT.exists():
        try:
            old_index = json.loads(OUT.read_text(encoding="utf-8"))
            prior = {article["url"]: article for article in old_index.get("articles", [])}
            previously_fetched_today = (
                str(old_index.get("generatedAt", "")).startswith(datetime.now(timezone.utc).date().isoformat())
                and old_index.get("extractorVersion") == EXTRACTOR_VERSION
            )
        except (OSError, ValueError, KeyError):
            pass
    new_articles = []
    failed = []
    for code, path in CATALOG.items():
        try:
            urls = discover(code, path)
        except requests.RequestException as exc:
            print(f"Falha a descobrir {code}: {exc}")
            urls = [url for url, item in prior.items() if item.get("code") == code]
        successes_in_code = 0
        for position, url in enumerate(urls, start=1):
            # Numa correção no mesmo dia, conservar os artigos já obtidos e
            # voltar a recolher o EBF, que tinha ligações ainda não reconhecidas.
            # Nas atualizações dos dias seguintes, verificar novamente tudo.
            if previously_fetched_today and code != "EBF" and url in prior:
                new_articles.append(prior[url]); successes_in_code += 1
                continue
            try:
                soup = get_html(url)
                title, content = article_text(soup)
                if len(content) < 180 or "artigo" not in (title + " " + content[:600]).lower():
                    raise ValueError("conteúdo legislativo não identificado")
                new_articles.append({"code": code, "title": title, "url": url, "text": content, "hash": hashlib.sha256(content.encode()).hexdigest()[:16]})
                successes_in_code += 1
            except (requests.RequestException, ValueError) as exc:
                failed.append(url)
                if url in prior:
                    new_articles.append(prior[url])
                print(f"Aviso ao ler {url}: {exc}")
            time.sleep(0.35)
            if position == 10 and not successes_in_code:
                raise RuntimeError(f"Não foi possível ler os primeiros 10 artigos de {code}; verificar estrutura do portal antes de continuar.")
            if position % 40 == 0:
                print(f"{code}: {position}/{len(urls)} páginas verificadas; {successes_in_code} artigos aceites", flush=True)
    if not new_articles:
        raise RuntimeError("Nenhum texto legal recolhido. Índice anterior preservado.")
    # Não publicar atualização parcial se houve quebra significativa da fonte.
    if prior and len(new_articles) < max(20, len(prior) * .6):
        raise RuntimeError("Recolha demasiado incompleta. Índice anterior preservado.")
    result = {
        "extractorVersion": EXTRACTOR_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "origin": ROOT,
        "notice": "Cópia de pesquisa não autenticada. Confirmar redação e vigência no Portal das Finanças e no Diário da República.",
        "articleCount": len(new_articles),
        "failedCount": len(failed),
        "articles": new_articles,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Índice preparado: {len(new_articles)} artigos, {len(failed)} falhas (com recurso a cache quando possível)")


if __name__ == "__main__":
    main()
