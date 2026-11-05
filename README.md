# Fernando — Assistente Fiscal

Aplicação PWA de apoio à organização de consultas e fontes fiscais portuguesas. Este repositório publica a aplicação num domínio GitHub Pages próprio, separado das aplicações da conta `universidadechat-ux`.

## Funcionalidades da versão 0.4

- Instalação no computador ou telemóvel a partir do navegador.
- Biblioteca editável: ativar/desativar fontes, adicionar fontes HTTPS personalizadas e removê-las.
- Diretório de fontes oficiais e complementares (AT, Diário da República, CNC, EUR-Lex e OCC).
- Anexação à pergunta de PDFs com texto, DOCX, TXT, CSV, Markdown, JSON ou HTML (até três ficheiros de 12 MB).
- Extração de texto local, no navegador, com bibliotecas PDF.js e JSZip guardadas neste repositório; PDFs digitalizados requerem OCR.
- Pesquisa em artigos dos códigos fiscais publicados pela AT (CIVA, CIRC, CIRS, EBF e LGT) através de um índice estático datado, além da pesquisa nos anexos e documentos locais.
- Tarefa GitHub Actions agendada diariamente para atualizar o índice de artigos no repositório; falhas ou atrasos podem impedir a atualização.
- Apenas a AT dispõe desta recolha automática inicial. A seleção de outros portais não importa os seus conteúdos automaticamente.
- Histórico, documentos, preferências de fontes e backups v2 guardados localmente no navegador (IndexedDB); compatibilidade com backups v1.
- Interface disponível offline após a primeira visita; ligações externas exigem Internet.
- Identidade visual «Fernando» e ícone próprio; domínio e identificador de armazenamento preservados.

**Limitações:** não existe IA conversacional, pesquisa em tempo real nem validação automática da vigência. A recolha automática depende de páginas da AT e da execução do GitHub Actions; é uma cópia datada, não autenticada e pode estar incompleta. Não há sincronização entre dispositivos. Os anexos da pergunta são temporários, salvo se forem guardados explicitamente na biblioteca. Os excertos não são pareceres fiscais nem garantias de exatidão/vigência. Confirma a redação aplicável e as datas de entrada em vigor no Diário da República.

Os componentes de leitura PDF e Word incluem as licenças originais em `vendor/` (PDF.js — Apache 2.0; JSZip — MIT).

## Publicação

Em **Settings → Pages**, selecionar **Deploy from a branch**, branch `main`, pasta `/(root)` e guardar. Depois de publicada, a aplicação fica disponível em `https://assistente-fiscal-pt.github.io/`.

Este repositório tem de ser público para utilizar GitHub Pages no plano gratuito. Não incluir dados pessoais, documentos de clientes ou segredos no repositório. Os dados guardados na aplicação ficam no navegador e devem ser exportados periodicamente para backup.

### Índice oficial de consulta

O ficheiro `data/legal-index.json` é atualizado pelo workflow `.github/workflows/atualizar-legislacao.yml` (execução programada e manual). O script `scripts/update_legal_index.py` obtém artigos diretamente do Portal das Finanças e preserva os textos anteriores quando falha pontualmente a leitura de uma página. Os textos recolhidos são servidos estaticamente pelo GitHub Pages e qualquer pessoa pode consultar o índice público. A data da última recolha surge em cada pesquisa, para evitar confundi-la com confirmação de vigência.
