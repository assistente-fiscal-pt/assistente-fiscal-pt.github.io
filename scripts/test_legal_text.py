"""Testes de preservação da estrutura dos artigos fiscais."""

import unittest

from legal_text import normalize_article_lines


class NormalizacaoArtigoTest(unittest.TestCase):
    def test_preserva_alineas_em_linhas_isoladas(self):
        text = """Artigo 2.º
Incidência subjetiva
i)
Aquisições dos bens mencionados no anexo E.
j)
Adquirentes de serviços de construção civil.
l)
Direitos de emissão.
"""
        output = normalize_article_lines(text)
        self.assertIn("\ni)\n", output)
        self.assertIn("\nj)\nAdquirentes de serviços de construção civil.", output)
        self.assertIn("\nl)\n", output)

    def test_preserva_numeros_e_filtra_fragmentos_irrelevantes(self):
        output = normalize_article_lines("1\nSão sujeitos passivos do imposto:\nx\n2\nOutras operações.")
        self.assertIn("1\nSão sujeitos passivos", output)
        self.assertIn("\n2\n", output)
        self.assertNotIn("\nx\n", output)


if __name__ == "__main__":
    unittest.main()
