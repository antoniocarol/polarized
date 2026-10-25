# Polarized — notas para o Claude Code

Globo 3D mobile-first com o estado do mundo em tempo real (conflitos, eleições, protestos,
economia, clima, sismos, diplomacia, ciber, militar, notícias, mercados) e análise por IA com
camadas de proteção. Código aberto (AGPL-3.0). Mantenedor escreve em português do Brasil;
responda em português.

Leia primeiro: `README.md` (visão geral, credenciais, checklist) e `SCHEMA.md` (esquema 0.5.0).

## Como o projeto é montado
- `index.html` é o app inteiro (sem build). Blocos `/* @generated NOME */ … /* @end NOME */`
  são copiados por `npm run sync-app` de: `schema/taxonomy.json`, `i18n/ui/*.json`,
  `pipeline/lib/prompt.js`, `guards.js`, `attention.js`, contornos e países. Nunca edite um
  bloco gerado à mão; edite a fonte e rode o sync. O teste falha se esquecer.
- `pipeline/run.js` orquestra adaptadores → classificação de notícias → estados → territórios
  disputados → agrupamento → análise → tradução. Grava `public/snapshot.json` e `public/text/<idioma>.json`.
- `.github/workflows/snapshot.yml` roda a cada 15 min e publica no GitHub Pages
  (https://antoniocarol.github.io/polarized/). Erros do pipeline viram anotações no Actions.

## Comandos
```sh
npm ci
npm run check            # sincronia app/pipeline + testes (node:test)
npm run build:fixtures   # exemplo sem rede -> data/snapshot.example.json + data/text/
npm run build            # execução real (precisa de rede e, para IA, ANTHROPIC_API_KEY)
node scripts/build-site.js data/snapshot.example.json && python3 -m http.server -d _site 8080
bash scripts/setup-secrets.sh   # cadastra credenciais como segredos do GitHub (gh CLI)
```

## Regras do projeto
- Toda afirmação de análise aponta para um fato; sem porcentagem de chance; sempre contraponto;
  nada de recomendação de investimento ou previsão de preço, em nenhum idioma (`pipeline/lib/guards.js`).
- Fonte com licença `verificar` só entra depois de `licenseCheckedAt` preenchido em `schema/sources.json`.
- Território disputado: nome e fronteira seguem a ONU (`pipeline/data/disputed.json`).
- Tradução do conteúdo só entra se preservar todos os números do original (`pipeline/lib/translate.js`).
- Modelos: padrão `claude-opus-5-5`; `POLARIZED_TRANSLATE_MODEL` e `POLARIZED_CLASSIFIER_MODEL`
  podem apontar para `claude-haiku-5-5` para baratear.
- Commits em português, terminando com a linha `Co-Authored-By` do Claude.

## Onde paramos (outubro de 2026)
- Pendente com o mantenedor: cadastrar credenciais (`scripts/setup-secrets.sh`), conferir licenças
  de Bluesky, Stooq e outras em `schema/sources.json`, conferir feeds marcados com `verifyFeed`
  em `schema/outlets.json`, revisar textos de `pipeline/data/disputed.json` e descrições de
  programas em `pipeline/data/sanction-programs.json`, revisão nativa de `i18n/ui/ar.json` e `zh.json`.
- Próximo pedido do mantenedor: melhorar mais a UI (organização e explicação das informações).
