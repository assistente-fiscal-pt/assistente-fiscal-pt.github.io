"""Normalização do texto legislativo extraído de páginas SharePoint."""

import re


def normalize_article_lines(text: str) -> str:
    """Preserva identificadores jurídicos curtos, incluindo alíneas isoladas."""
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    # A AT pode colocar «j)» num elemento HTML separado da frase respetiva.
    # Filtrá-lo por comprimento trocava a identificação da norma aplicável.
    lines = [
        line for line in lines
        if len(line) >= 3 or re.fullmatch(r"[a-z]\)|\d{1,2}", line, flags=re.I)
    ]
    return "\n".join(lines)
