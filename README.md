# Assistente Fiscal PT

Aplicação PWA de apoio à organização de consultas e fontes fiscais portuguesas. Este repositório publica a aplicação num domínio GitHub Pages próprio, separado das aplicações da conta `universidadechat-ux`.

## Funcionalidades da versão inicial

- Instalação no computador ou telemóvel a partir do navegador.
- Diretório de fontes oficiais e complementares (AT, Diário da República, CNC, EUR-Lex e OCC).
- Pesquisa local de excertos em textos oficiais adicionados manualmente.
- Histórico, documentos e backups guardados localmente no navegador (IndexedDB).
- Interface disponível offline após a primeira visita; ligações externas exigem Internet.

**Limitações:** não existe ainda IA, importação automática de códigos tributários, verificação de legislação em vigor, atualização automática nem sincronização entre dispositivos. Os excertos encontrados não são um parecer fiscal nem uma garantia de exatidão ou vigência. Confirma sempre a legislação nas fontes oficiais.

## Publicação

Em **Settings → Pages**, selecionar **Deploy from a branch**, branch `main`, pasta `/(root)` e guardar. Depois de publicada, a aplicação fica disponível em `https://assistente-fiscal-pt.github.io/`.

Este repositório tem de ser público para utilizar GitHub Pages no plano gratuito. Não incluir dados pessoais, documentos de clientes ou segredos no repositório. Os dados guardados na aplicação ficam no navegador e devem ser exportados periodicamente para backup.
