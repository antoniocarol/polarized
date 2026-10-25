# Adaptadores

Cada adaptador lê uma fonte e devolve entidades no esquema `0.3.0`.

```js
export default {
  id: "usgs",                 // chave em schema/sources.json
  fixture: "usgs.json",       // arquivo em pipeline/fixtures/ usado com --fixtures (.json, .csv ou .xml)
  needs: ["CHAVE"],           // variáveis obrigatórias; sem elas a fonte fica "sem_credencial"
  async fetch(ctx) { … },     // ctx: { now, policy, source, fixtures, state }
  normalize(raw, ctx) { … },  // devolve Entity[] ou { entities, observations, sources }
};
```

Trilhas (`observations`) não viram entidades no adaptador: o pipeline junta com o
histórico, aplica a política de atraso e só então publica. Toda entidade passa pelo
JSON Schema antes de entrar; a malformada sai sozinha e fica contada no relatório.

## Implementados

| adaptador | fonte | credencial | o que gera | ponto a conferir na primeira execução real |
|---|---|---|---|---|
| `usgs.js` | USGS, GeoJSON de 2 dias | — | terremotos ≥ 4,5 | — |
| `emsc.js` | EMSC, FDSN JSON | — | terremotos; junta com o USGS e gera medida de magnitude | licença |
| `gdacs.js` | GDACS | — | enchentes, ciclones, secas, incêndios, vulcões | **endpoint** (`MAP`) e campos |
| `ioda.js` | IODA | — | quedas de internet por país | **formato da resposta** e licença |
| `cloudflare_radar.js` | Cloudflare Radar | `CLOUDFLARE_API_TOKEN` | quedas com causa e alcance; junta com o IODA | licença CC BY-NC |
| `cisa_kev.js` | CISA KEV | — | falhas exploradas (sem lugar no mapa) | — |
| `ucdp.js` | UCDP GED candidato | `UCDP_TOKEN` | eventos e condição de conflito por país | **versão do conjunto** (`UCDP_ENDPOINT`) |
| `acled.js` | ACLED | `ACLED_USERNAME`, `ACLED_PASSWORD` | conflito, protesto, repressão; ondas de protesto por país | **login OAuth** e termos de redistribuição |
| `sanctions.js` → `ofac` | OFAC SDN.CSV | — | regime de sanções dos EUA por país | tabela de programas |
| `sanctions.js` → `unsc` | Lista consolidada da ONU (XML) | — | regime de sanções da ONU por país | — |
| `sanctions.js` → `eu` | Lista consolidada da UE (XML) | `EU_FSF_TOKEN` | regime de sanções da UE por país | — |
| `opensky.js` | OpenSky `/states/all` | opcional (OAuth2) | trilhas de aeronaves militares | licença (uso não comercial) |
| `aisstream.js` | AISStream WebSocket | `AISSTREAM_API_KEY` | trilhas de navios militares | licença |
| `elections.js` | `data/curated/elections.json` | — | campanha e dia de votação | datas e `verifiedAt` |
| `curated.js` | `data/curated/*.json` | — | qualquer condição mantida à mão | — |

Programas de sanção são ligados a países em `pipeline/data/sanction-programs.json`.
Programas temáticos (terrorismo, drogas, ciber, direitos humanos globais) ficam de fora.

## Ideias para depois

| fonte | camada | por quê |
|---|---|---|
| ReliefWeb (OCHA) | conflito, clima | relatórios humanitários e números de deslocados |
| IDMC / ACNUR | conflito | deslocamento, para medidas com várias versões |
| Cloudflare Radar (ataques) | ciber | tendências de DDoS por país |
| OMC / Global Trade Alert | economia | tarifas e barreiras comerciais em vigor |
| Órgãos eleitorais nacionais | eleição | resultado oficial como `measure` verificada |
