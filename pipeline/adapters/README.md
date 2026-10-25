# Adaptadores

Cada adaptador lê uma fonte e devolve entidades no esquema `0.3.0`.

```js
export default {
  id: "usgs",                 // chave em schema/sources.json
  fixture: "usgs.json",       // arquivo em pipeline/fixtures/ usado com --fixtures
  needs: ["CHAVE"],           // variáveis obrigatórias; sem elas a fonte fica "sem_credencial"
  async fetch(ctx) { … },     // ctx: { now, policy, source, fixtures, state }
  normalize(raw, ctx) { … },  // devolve Entity[] ou { entities, observations, sources }
};
```

Trilhas (`observations`) não viram entidades no adaptador: o pipeline junta com o
histórico, aplica a política de atraso e só então publica.

## Implementados

| adaptador | fonte | credencial | camada | conferido contra a API real? |
|---|---|---|---|---|
| `usgs.js` | USGS, GeoJSON de 2 dias | nenhuma | sismos | formato documentado; testado com fixture |
| `gdacs.js` | GDACS, lista de eventos | nenhuma | clima, vulcões | **conferir endpoint e campos** antes de ativar |
| `ioda.js` | IODA, quedas por país | nenhuma | ciber | **conferir formato** — o parser é tolerante, mas o endpoint não foi testado |
| `cisa_kev.js` | CISA KEV | nenhuma | ciber | formato documentado; testado com fixture |
| `opensky.js` | OpenSky `/states/all` | opcional (OAuth2) | militar | formato documentado; testado com fixture |
| `aisstream.js` | AISStream WebSocket | `AISSTREAM_API_KEY` | militar | formato documentado; testado com fixture |
| `curated.js` | `data/curated/*.json` | — | todas | — |

Nenhuma dessas APIs estava acessível do ambiente onde o pipeline foi escrito. As
fixtures reproduzem o formato documentado de cada uma com eventos fictícios. A primeira
execução real (local ou no Actions) é o teste de verdade: confira o relatório de
ingestão no app ("Sobre → Estado das fontes").

## Próximos

| fonte | camada | o que mapear |
|---|---|---|
| UCDP | conflito | conflito ativo → `condition`; `type_of_conflict` 2 interestatal, 3–4 guerra civil; mortes `best/low/high` → uma `measure` com três versões |
| ACLED | conflito, protesto | `event_type` Battles → confronto, Explosions → ataque aéreo/bombardeio, Protests → manifestação, Riots → tumulto. Termos de redistribuição restritos: confira antes |
| ONU, UE, OFAC | diplomacia | cada país sancionado → `condition`; cada emissor entra como uma `source` da mesma condição |
| TSE, FEC, IFES | eleição | calendário → `condition` de campanha; dia da votação → `event`; resultado só de fonte eleitoral oficial |
| EMSC | sismos | mesma `clusterKey` do USGS: as duas magnitudes viram uma `measure` |
| Cloudflare Radar | ciber | quedas e tendências de DDoS por país (exige token) |

Enquanto não existem, a camada é mantida por curadoria: crie `data/curated/live.json`
com `"dataClass": "live"` e as condições no formato do esquema.
