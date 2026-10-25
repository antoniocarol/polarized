# Esquema de dados do Polarized

Versão `0.4.0` · documento normativo do projeto

Tudo que aparece no globo é uma **entidade** com **procedência obrigatória**. Nenhuma
afirmação chega à tela sem dizer de onde veio, quando foi observada e quem a contesta.

Arquivos de referência:

| arquivo | papel |
|---|---|
| `schema/polarized.schema.json` | JSON Schema 2020-12. O pipeline não publica nada que falhe nele. |
| `schema/types.ts` | Tipos TypeScript equivalentes. Em conflito, o JSON Schema vale. |
| `schema/taxonomy.json` | Camadas, subtipos, cores, molduras e ícones. |
| `schema/sources.json` | Registro de fontes, com licença e direito de redistribuição. |
| `schema/outlets.json` | Veículos de notícia acompanhados, com tipo, financiamento e critério de entrada. |

---

## 1. Sete tipos, separados pela forma no tempo

| `kind` | forma no tempo | exemplos |
|---|---|---|
| `condition` | estado durável, com início e fim incerto | guerra em curso, regime de sanções, período eleitoral |
| `event` | ocorrência discreta e datada | terremoto, ataque aéreo, greve, debate, queda de internet |
| `track` | objeto que se move, amostrado ao longo do tempo | aeronave militar, navio de guerra |
| `measure` | número de um período, com uma ou mais versões | deslocados, inflação, magnitude, participantes |
| `analysis` | leitura produzida por IA sobre fatos do snapshot | precedente histórico, impacto, checagem, mercado, panorama |
| `report` | manchete de um veículo sobre um fato | relato da BBC, post da AP no Bluesky |
| `series` | fechamento diário de um mercado | Ibovespa, dólar em reais, petróleo Brent |

O assunto é a camada (`layer`) e não depende do tipo. Uma guerra é `condition` da camada
`conflito`; um bombardeio dentro dela é `event` da mesma camada, com `parentId`
apontando para a guerra.

## 2. Envelope comum de condições e eventos

```jsonc
{
  "id": "usgs:evt:us7000abcd",     // <fonte>:<tipo>:<id na fonte> — reprocessar não duplica
  "schemaVersion": "0.4.0",
  "kind": "event",
  "layer": "sismico",
  "subtype": "terremoto",          // define o ícone (taxonomy.json)
  "geo": { "type": "Point", "coordinates": [141.9, 36.1] },  // GeoJSON [lon, lat]; null = sem lugar no mapa
  "place": { "iso2": "JP", "iso3": "JPN", "name": "Japão", "admin1": null, "admin1Code": null },  // admin1Code = ISO 3166-2 ("BR-SP")
  "time": { "start": "…", "end": null, "observedAt": "…", "precision": "minute" },  // startKnown: false quando a fonte não diz o início
  "intensity": 3,                  // 0–5, sempre calculada
  "intensityBasis": "(magnitude − 4) × 1,25, +1 se PAGER laranja, +2 se vermelho",
  "status": "verificado",          // nao_verificado | corroborado | verificado | disputado | retratado
  "confidence": 0.95,
  "clusterKey": "sismo:36:142:14742",  // relatos de fontes diferentes sobre o mesmo fato
  "sources": [{ "sourceId": "usgs", "ref": "us7000abcd", "url": "https://…", "retrievedAt": "…" }],
  "text": { "pt": { "headline": "…", "summary": "…", "body": "…" } },
  "links": [{ "label": "Página do evento no USGS", "url": "https://…" }],
  "tags": ["oceanico"],
  "relations": [{ "type": "sanciona", "from": "US", "to": "RU", "label": "…" }],  // arcos entre países (§8)
  "reportIds": ["rss:rep:…"],      // relatos sobre este fato (§6)
  "updatedAt": "…",
  "magnitude": { "value": 6.1, "scale": "Mww" },   // só em sismos
  "depthKm": 34
}
```

**Regras duras**

1. `sources` nunca vazio.
2. `intensity` nunca é escrita à mão: sai de uma fórmula, e `intensityBasis` diz qual.
3. `time.precision` impede falsa exatidão. Relato de "esta semana" entra com `day`.
4. Mesma `clusterKey` = um cartão só, com todas as fontes. Duas fontes independentes
   sobem o status de `nao_verificado` para `corroborado`.
5. Convenção de `clusterKey` entre fontes: `conflito:XX`, `protesto:XX`, `sancoes:XX`,
   `eleicao:XX:AAAA-MM-DD`, `queda:XX:AAAA-MM-DD` (XX = ISO-2). Sismos se juntam por
   proximidade (até 90 s e 100 km), porque cada rede dá hora e epicentro um pouco diferentes.
6. `geo: null` é permitido para o que não tem lugar (uma falha de software explorada no
   mundo todo). O app lista esses itens em "Sem lugar no mapa" e não inventa um ponto.
7. Estado (`place.admin1`, `admin1Code`) sai do ponto, pelos contornos do Natural Earth
   (`pipeline/data/admin1.json`), nunca de texto livre de quem publicou o fato.

## 3. `measure` — versões divergentes lado a lado

```jsonc
{
  "kind": "measure",
  "subject": { "type": "condition", "id": "ucdp:cond:ua-guerra-interestatal" },
  "metric": "deslocados_internos", "unit": "pessoas",
  "assertions": [
    { "sourceId": "idmc",  "value": 3700000, "observedAt": "…", "method": "estimativa de campo" },
    { "sourceId": "unhcr", "value": 3400000, "observedAt": "…", "method": "registro" }
  ],
  "spread": { "low": 3400000, "high": 4900000, "relative": 0.44 },
  "disputed": true,     // relative > taxonomy.disputeThreshold (0,15)
  "consensus": null     // sempre null: o app mostra o leque, nunca a média
}
```

Quando dois sismógrafos publicam magnitudes diferentes do mesmo terremoto, o pipeline
cria essa `measure` sozinho a partir do agrupamento. Medidas com o mesmo `metric` sobre o
mesmo fato, vindas de fontes diferentes, viram uma só com uma versão por fonte — por isso
o nome da métrica carrega a janela (`mortes_45d`, `mortes_14d`): números de janelas
diferentes nunca são comparados como se divergissem. Contagens por emissor
(`designacoes_ofac`, `designacoes_un_sc`) também ficam separadas, porque cada lista é outra
coisa, não outra versão.

## 4. `track` — aeronaves e navios

```jsonc
{
  "kind": "track", "layer": "militar", "subtype": "aeronave",
  "asset": { "callsign": "RCH871", "icao24": "ae1a01", "operator": "USAF Air Mobility Command", "flag": "US", "class": "transporte" },
  "classification": { "military": true, "rule": "indicativo RCH*", "confidence": 0.9 },
  "samples": [{ "t": "…", "lat": 47.9, "lon": -32.0, "altM": 10668, "speedKn": 459, "headingDeg": 62 }],
  "firstSeen": "…", "lastSeen": "…",
  "trackStatus": "live",        // live | stale (>15 min) | lost (>60 min), descontado o atraso
  "releaseDelayMinutes": 0,
  "sources": [{ "sourceId": "opensky", "retrievedAt": "…" }]
}
```

- **ADS-B e AIS não dizem se algo é militar.** `classification` registra a regra que
  marcou o veículo (`pipeline/data/military.json`) e a confiança dela.
- **A amostra é enviesada.** Militar desliga transponder quando quer. Ausência no mapa
  não é ausência no mundo, e o app diz isso no cartão.
- **Atraso em zona de conflito.** `pipeline/policy.json` lista as zonas e o atraso. O
  pipeline guarda tudo num estado privado (`state/tracks.json`, nunca publicado) e só
  põe no snapshot as posições mais velhas que o prazo. O atraso é aplicado antes de
  gravar, não no app — se fosse no app, o dado em tempo real estaria no JSON público.
- **Sem extrapolação.** O ícone fica na última posição publicada, com a idade dela.

## 5. `analysis` — a camada de análise e suas proteções

Uma análise sempre aponta para fatos do mesmo snapshot (`subjectIds`) e nunca se
confunde com eles na tela.

| tipo | pergunta | conteúdo obrigatório |
|---|---|---|
| `precedente` | Já foi tentado antes, e deu certo? | `precedents` (casos, resultado, por quê) e `conditions` (essas condições estão presentes aqui?) |
| `impacto` | O que isso muda, e para quem? | `impacts`: domínio, região, direção, cadeia de causa e efeito, horizonte |
| `checagem` | O que foi dito confere? | `claims`: fala, classe (fato verificável, promessa, opinião), veredito |
| `contexto` | Como se chegou aqui? | `points` |
| `mercado` | Por que o mercado se mexeu assim? | `moves`: um item por dia, com a variação da série e os fatos que podem explicá-la — ou `explained: false` |
| `panorama` | O que importa agora? | pelo menos três `points`; `scope` diz se é do mundo (`mundo`) ou de um país (`pais`) |

`watch` (opcional, todos os tipos) lista o que acompanhar nos próximos dias.

**Camadas de proteção** (`pipeline/lib/guards.js`, as mesmas no pipeline e no app):

| regra | o que o código faz |
|---|---|
| `apoio_em_fatos` | Toda referência precisa existir nos fatos enviados. Referência inventada cai; ponto sem apoio sai; sem pontos, a análise é descartada. "Fato" só se apoia em fato, nunca em precedente. |
| `sem_probabilidade` | Porcentagem ou "chance de dar certo" que não venha dos fatos descarta a análise. Não existe campo de probabilidade no esquema. |
| `contraponto` | Sem o argumento contrário mais forte, a análise é descartada. |
| `magnitude_com_base` | Tamanho de impacto só fica se o número aparece nos fatos; senão vira `null`. |
| `conteudo_do_tipo` | Checagem sem falas, impacto sem impactos ou precedente sem casos é descartado. |
| `precedentes_marcados` | Casos vindos do conhecimento do modelo saem sempre com `verified: false`. |
| `sem_recomendacao` | "Compre", "venda", "vale a pena investir" e afins descartam a análise, de qualquer tipo. |
| `sem_previsao_de_preco` | Em `mercado`, prever para onde o preço vai ("deve subir", "alvo de 130 mil") descarta a análise. |
| `movimentos_da_serie` | Em `mercado`, cada dia de `moves` precisa existir na série analisada, com a variação dela (tolerância de arredondamento). Dia inventado ou número trocado cai. |
| `conferencia_cruzada` | Com um segundo modelo configurado, as duas análises são comparadas caso a caso; a concordância e as divergências ficam registradas em `crossCheck`. |

Por que "condições" no lugar de "chance de dar certo": uma porcentagem gerada por
modelo parece medição e não é calibrada. A lista de condições ensina o mecanismo — o
que fez dar certo ou errado antes, e se isso está presente agora.

**Revisão humana.** Toda análise nasce `review.status: "pendente"`. Revisões ficam em
`data/reviews/*.json` (ver o README da pasta). Rejeitada sai do snapshot; aprovada
mostra quem revisou.

**Rastreabilidade.** `method` guarda provedor, modelo, versão do prompt e data. Uma
análise é refeita quando o fato muda ou quando `PROMPT_VERSION` muda.

## 6. `report` — manchetes, histórias e corroboração

```jsonc
{
  "id": "rss:rep:3f9a1c0b7d2e4a", "kind": "report", "sourceId": "rss",
  "outlet": "bbc_world",                 // chave em snapshot.outlets
  "url": "https://…", "title": "Strong earthquake strikes off Japan…", "lang": "en",
  "excerpt": "…",                        // o resumo do próprio feed, até 320 caracteres
  "summaryPt": "Terremoto forte atinge a costa leste do Japão",  // só quando o modelo classificou
  "publishedAt": "…",
  "place": { "iso2": "JP", "iso3": "JPN", "name": "Japão", "admin1": null, "admin1Code": null },
  "layer": "sismico", "subtype": "terremoto",
  "storyKey": "jp:sismico:3f9a…",        // relatos do mesmo fato compartilham a chave
  "classifiedBy": "modelo",              // modelo | palavras-chave | fonte
  "relatedIds": ["usgs:evt:us7000abcd"]
}
```

- **Só manchete, link e resumo do veículo.** A matéria fica no site de quem apurou.
- **Classificação conferida.** País, estado, camada e tema vêm de palavras-chave ou de um
  modelo barato em lote (`CLASSIFIER_MODEL`); o pipeline confere cada campo contra as
  listas do esquema e guarda o resultado em cache por 72 h.
- **História = relatos com a mesma `storyKey`.** O app mostra quantas redações e de
  quantos países contaram o fato. Uma redação só aparece como "não confirmado".
- **Veículos** (`schema/outlets.json`) entram por critério escrito, com tipo e
  financiamento. Financiamento estatal aparece marcado em cada relato. X (Twitter) é
  opcional e pago (`X_BEARER_TOKEN`); o padrão é RSS e Bluesky.

## 7. `series` — bolsas, câmbio e commodities

```jsonc
{
  "id": "stooq:ser:^bvp", "kind": "series", "layer": "economia", "subtype": "indice_bolsa",
  "instrument": { "symbol": "^bvp", "name": "Ibovespa", "exchange": "B3", "currency": "pontos", "unit": null },
  "place": { "iso2": "BR", … }, "geo": { "type": "Point", "coordinates": [-46.63, -23.55] },
  "points": [{ "d": "2026-10-23", "close": 126383, "changePct": -2.4 }],  // até 30 pregões
  "last": { "d": "2026-10-23", "close": 126383, "changePct": -2.4 }
}
```

A análise `mercado` explica os dias que mais se mexeram com os fatos do snapshot, sempre
dizendo que coincidência no tempo não prova causa. Ela nunca prevê preço e nunca
recomenda investimento (§5).

## 8. Relações e índice de atenção

`relations` liga dois países: `sanciona` (listas OFAC, ONU, UE — `from` pode ser `EU` ou
`UN`), `conflito_com` (díades entre governos no UCDP) e `acordo_com`. O app desenha arcos
no globo e lista as conexões no país.

O **índice de atenção** (`pipeline/lib/attention.js`, o mesmo código no app) soma, por
país e camada, o fato mais grave mais meia raiz da soma dos demais; eventos perdem peso
com o tempo (meia-vida de cerca de 33 h), as notícias somam 0,15 cada (até 3 pontos) e
movimentos de mercado somam até 1. O resultado vai de 0 a 100, relativo ao país com mais
atenção no instantâneo. A fórmula aparece no app, em cada país. Gravidade pesa mais que
volume: um país com uma guerra fica acima de um país com muitas notícias leves.

## 9. Camadas e símbolos

Cada camada tem cor e moldura; cada subtipo tem ícone. Forma e cor carregam a mesma
informação, para funcionar também sem distinção de cores.

| camada | moldura | subtipos |
|---|---|---|
| `conflito` | losango | guerra entre países, guerra civil, insurgência, confronto armado, ataque aéreo, bombardeio, incidente naval, cessar-fogo, ocupação, violência armada |
| `protesto` | círculo | manifestação, greve geral, tumulto, repressão, bloqueio |
| `eleicao` | quadrado | presidencial, legislativa, referendo, segundo turno, dia de votação, campanha, pré-eleitoral, debate, transição, golpe |
| `economia` | hexágono | tarifa, controle de exportação, acordo e negociação comercial, regulação, calote, crise cambial, choque de commodity |
| `clima` | círculo | enchente, incêndio, tempestade ou ciclone, seca, onda de calor |
| `sismico` | triângulo | terremoto, réplica, vulcão, alerta de tsunami |
| `diplomacia` | octógono | sanções, embargo, tratado, expulsão de diplomatas, reconhecimento, cúpula |
| `ciber` | colchetes | queda de internet, DDoS, falha explorada, ransomware, incidente, campanha atribuída |
| `militar` | sem moldura | aeronave e navio (orientados pelo rumo), comboio, exercício, mobilização |

A legenda completa, desenhada, está no app em "Sobre".

## 10. Registro de fontes

```jsonc
{
  "id": "usgs", "name": "USGS Earthquake Hazards", "shortName": "USGS",
  "endpoint": "https://earthquake.usgs.gov/…/2.5_day.geojson",
  "access": "aberto", "license": "domínio público",
  "redistribution": "permitida",       // permitida | com_atribuicao | proibida | verificar
  "reliability": "primaria",           // primaria | agregador | imprensa | colaborativa | curadoria
  "env": [],                           // credenciais exigidas
  "licenseCheckedAt": null             // preencher depois de ler os termos atuais
}
```

**Trava de licença** (`pipeline/policy.json`): em produção, fonte com redistribuição
`verificar` ou `proibida` e `licenseCheckedAt` nulo não entra no snapshot, e o relatório
de ingestão mostra `bloqueada_licenca`. As licenças anotadas são ponto de partida para
conferência, não aconselhamento jurídico.

## 11. Snapshot

```jsonc
{
  "schemaVersion": "0.4.0",
  "generatedAt": "…",
  "window": { "from": "…", "to": "…" },
  "dataClass": "example",          // example | live — a tarja de exemplo no app segue este campo
  "sources": { "<id>": { … } },
  "outlets": { "<id>": { … } },     // veículos citados pelos relatos
  "ingest": [{ "sourceId": "usgs", "status": "ok", "count": 12, "fetchedAt": "…", "error": null }],
  "policy": { "militaryTrackZones": [ … ], "analysis": { "reused": 6, "generated": 2, … } },
  "entities": [ … ]
}
```

`ingest` aparece no app ("Estado das fontes"): fonte fora do ar, sem credencial ou
bloqueada por licença fica visível em vez de sumir em silêncio. Cada entidade é validada
sozinha antes de entrar: uma malformada é descartada, contada em `rejected` e o primeiro
erro vai em `error`, sem derrubar o resto do snapshot.
