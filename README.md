# Assistente Fiscal PT

Aplicação PWA de apoio à organização de consultas e fontes fiscais portuguesas. Este repositório publica a aplicação num domínio GitHub Pages próprio, separado das aplicações da conta `universidadechat-ux`.

## Funcionalidades da versão 0.2

- Instalação no computador ou telemóvel a partir do navegador.
- Biblioteca editável: ativar/desativar fontes, adicionar fontes HTTPS personalizadas e removê-las.
- Diretório de fontes oficiais e complementares (AT, Diário da República, CNC, EUR-Lex e OCC).
- Anexação à pergunta de PDFs com texto, DOCX, TXT, CSV, Markdown, JSON ou HTML (até três ficheiros de 12 MB).
- Extração de texto local, no navegador, com bibliotecas PDF.js e JSZip guardadas neste repositório; PDFs digitalizados requerem OCR.
- Pesquisa de excertos nos documentos locais e anexados, filtrada pelas fontes ativas. A seleção de fontes não importa automaticamente conteúdos dos portais.
- Histórico, documentos, preferências de fontes e backups v2 guardados localmente no navegador (IndexedDB); compatibilidade com backups v1.
- Interface disponível offline após a primeira visita; ligações externas exigem Internet.

**Limitações:** não existe ainda IA, importação automática de códigos tributários, verificação de legislação em vigor, atualização automática nem sincronização entre dispositivos. Os anexos da pergunta são temporários, salvo se o documento for guardado explicitamente na biblioteca. Os excertos encontrados não são um parecer fiscal nem uma garantia de exatidão ou vigência. Confirma sempre a legislação nas fontes oficiais.

Os componentes de leitura PDF e Word incluem as licenças originais em `vendor/` (PDF.js — Apache 2.0; JSZip — MIT).

## Publicação

Em **Settings → Pages**, selecionar **Deploy from a branch**, branch `main`, pasta `/(root)` e guardar. Depois de publicada, a aplicação fica disponível em `https://assistente-fiscal-pt.github.io/`.

Este repositório tem de ser público para utilizar GitHub Pages no plano gratuito. Não incluir dados pessoais, documentos de clientes ou segredos no repositório. Os dados guardados na aplicação ficam no navegador e devem ser exportados periodicamente para backup.
