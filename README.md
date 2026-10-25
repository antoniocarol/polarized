# Polarized

O mundo em tempo real, num globo. Guerras, eleições, protestos, tarifas, sanções,
terremotos, quedas de internet, aviões e navios militares — cada um com a sua fonte à
vista, e com análise por IA que nunca se mistura com o fato.

Projeto aberto, mantido por anúncios discretos e doações.

## Como funciona

```
fontes públicas ──► adaptadores ──► normalização ──► trilhas + atraso ──► agrupamento
                                                                              │
              app (index.html) ◄── snapshot.json ◄── validação ◄── análise com IA + guardas
```

O app não fala com nenhuma fonte. Ele lê um `snapshot.json` já normalizado e validado.
Isso mantém o cliente leve, cacheável e independente das APIs.

## Estrutura

| caminho | o quê |
|---|---|
| `index.html` | O app inteiro: globo em canvas, lista, detalhe, análise, legenda. Mobile-first. |
| `SCHEMA.md` | Especificação do esquema de dados (leia primeiro). |
| `schema/` | JSON Schema, tipos TypeScript, taxonomia de camadas e registro de fontes. |
| `pipeline/run.js` | Orquestrador. |
| `pipeline/adapters/` | Um arquivo por fonte: USGS, EMSC, GDACS, IODA, Cloudflare Radar, CISA KEV, UCDP, ACLED, OFAC, ONU, UE, OpenSky, AISStream, calendário eleitoral e curadoria. |
| `pipeline/lib/prompt.js`, `guards.js` | Prompt e camadas de proteção da análise — compartilhados com o app. |
| `pipeline/policy.json` | Política editorial: trava de licença, zonas com atraso para trilhas militares, limites da análise. |
| `pipeline/data/military.json` | Heurística aberta que marca aeronaves e navios como militares. |
| `pipeline/fixtures/` | Respostas fictícias no formato de cada fonte, para testes e para o exemplo. |
| `data/curated/` | Dados mantidos pelo projeto: calendário eleitoral (`elections.json`) e condições extras (`live.json`). |
| `data/reviews/` | Revisões humanas das análises. |
| `data/snapshot.example.json` | Snapshot de exemplo gerado pelo pipeline a partir das fixtures. |
| `test/` | Testes (`node:test`). |

## Rodar localmente

Requer Node 22.

```sh
npm ci
npm run check            # sincronia app/pipeline + testes
npm run build:fixtures   # gera data/snapshot.example.json só com fixtures (sem rede)
npm run build            # execução real: consulta as fontes e grava public/snapshot.json

node scripts/build-site.js data/snapshot.example.json   # monta _site/
python3 -m http.server -d _site 8080                    # abre em http://localhost:8080
```

Depois de mudar `schema/taxonomy.json`, `pipeline/lib/prompt.js` ou `pipeline/lib/guards.js`,
rode `npm run sync-app` para copiar para o `index.html`. O teste falha se esquecer.

## Credenciais

Nenhuma é obrigatória: sem elas, a fonte correspondente aparece como "sem credencial"
no relatório de ingestão e o resto do snapshot sai normalmente.

| variável | para quê |
|---|---|
| `ANTHROPIC_API_KEY` | Camada de análise (Claude). Sem ela, o estágio de análise é pulado. |
| `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` | OpenSky com conta (limite diário maior). Sem elas, roda anônimo. |
| `AISSTREAM_API_KEY` | Navios via AIS (chave gratuita em aisstream.io). |
| `CROSSCHECK_BASE_URL`, `CROSSCHECK_MODEL`, `CROSSCHECK_API_KEY` | Segundo modelo para conferência cruzada. Qualquer endpoint compatível com `/chat/completions` (Ollama local, Groq, OpenRouter e outros com plano gratuito). |
| `UCDP_TOKEN` | Conflitos do UCDP (token gratuito, pedido no site do UCDP). `UCDP_ENDPOINT` troca a versão do conjunto de dados. |
| `ACLED_USERNAME`, `ACLED_PASSWORD` | Conflitos e protestos do ACLED (conta gratuita). |
| `EU_FSF_TOKEN` | Lista de sanções da União Europeia (token público do portal Financial Sanctions Files). |
| `CLOUDFLARE_API_TOKEN` | Quedas de internet com causa, do Cloudflare Radar. |
| `POLARIZED_MODEL` | Troca o modelo da análise (padrão `claude-opus-5-5`). |

## Publicar

`.github/workflows/snapshot.yml` roda a cada 15 minutos: testa, gera o snapshot, guarda o
estado privado das trilhas no cache do Actions e publica o site no GitHub Pages.

1. Em *Settings → Pages*, escolha *GitHub Actions* como fonte. O site sai em
   `https://antoniocarol.github.io/polarized/`.
2. Em *Settings → Secrets and variables → Actions*, cadastre as credenciais que quiser usar.
   Sem nenhuma, o site já sai com sismos, desastres, falhas exploradas, sanções da ONU e dos
   EUA e o calendário eleitoral.
3. Rode o workflow uma vez em *Actions → snapshot → Run workflow* e confira o relatório de
   fontes no app ("Sobre → Estado das fontes").

O GitHub pausa agendamentos de repositórios públicos sem commits há 60 dias. Se o site
parar de atualizar, reative em *Actions → snapshot → Enable workflow*.

Custo da análise: no máximo `analysis.maxPerRun` (8) chamadas por execução, e só para
fatos novos ou alterados — análises de fatos que não mudaram são reaproveitadas.

## Antes de ir ao ar com dados reais

- [ ] **Licenças das fontes.** Fontes com redistribuição `verificar` não são nem consultadas
      até alguém ler os termos e preencher `licenseCheckedAt` em `schema/sources.json`:
      IODA, Cloudflare Radar (CC BY-NC — atenção com anúncios), EMSC, ACLED (restritiva),
      OpenSky (uso não comercial), AISStream. Com o campo preenchido, a fonte entra na
      execução seguinte.
- [ ] **Primeira execução com rede.** Os adaptadores foram escritos contra o formato
      documentado de cada API e testados com respostas fictícias; nenhuma API real estava
      acessível de onde o código foi escrito. Os pontos mais incertos: endpoint do GDACS,
      formato do IODA, versão do GED no UCDP (`UCDP_ENDPOINT`) e o login novo do ACLED.
- [ ] **Calendário eleitoral.** Confirme as datas em `data/curated/elections.json` no órgão
      eleitoral de cada país, preencha `verifiedAt` e acrescente as próximas eleições.
- [ ] **Política de trilhas militares.** Revise zonas e atraso em `pipeline/policy.json`.
- [ ] **Análise de candidatos.** Consulte quem entende de direito eleitoral antes de publicar
      análise de candidatos em período de eleição.

## Licença

Código e dados do projeto sob [AGPL-3.0-or-later](LICENSE): qualquer pessoa pode usar,
estudar e modificar, e quem oferecer uma versão modificada ao público, inclusive como site,
precisa publicar o código dessa versão. Se preferir permitir uso fechado (por exemplo por
empresas), troque por MIT antes de aceitar contribuições externas.

Dados de terceiros seguem as licenças de cada fonte (`schema/sources.json`). Contornos dos
países: Natural Earth (domínio público), via world-atlas (ISC, `pipeline/data/world-atlas.LICENSE`).
