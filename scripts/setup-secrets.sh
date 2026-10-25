#!/usr/bin/env bash
# Cadastra as credenciais do Polarized como segredos do GitHub Actions, uma por vez.
# A chave é digitada sem aparecer na tela e vai direto para o GitHub (gh secret set):
# não fica no histórico do terminal nem em arquivo. Enter vazio pula a credencial.
#
# uso: bash scripts/setup-secrets.sh            (pergunta tudo)
#      bash scripts/setup-secrets.sh ANTHROPIC_API_KEY AISSTREAM_API_KEY   (só estas)
# requer: GitHub CLI autenticado (gh auth login) com acesso de admin ao repositório.
set -euo pipefail

REPO="${REPO:-antoniocarol/polarized}"

# nome | para quê | onde conseguir
SECRETS=(
  "ANTHROPIC_API_KEY|análise, tradução e classificação por IA|console.anthropic.com → Settings → API Keys"
  "AISSTREAM_API_KEY|navios militares (AIS), grátis|aisstream.io → entrar → API Keys"
  "OPENSKY_CLIENT_ID|aviões militares com limite maior (opcional; sem ela roda anônimo)|opensky-network.org → conta → API client"
  "OPENSKY_CLIENT_SECRET|par do OPENSKY_CLIENT_ID|mesma tela do OpenSky"
  "UCDP_TOKEN|conflitos do UCDP (token gratuito)|pedido pelo site do UCDP (ucdp.uu.se), seção da API"
  "ACLED_USERNAME|conflitos e protestos do ACLED (conta gratuita)|acleddata.com → registrar"
  "ACLED_PASSWORD|senha da conta ACLED|—"
  "EU_FSF_TOKEN|lista de sanções da União Europeia|portal Financial Sanctions Files da Comissão Europeia"
  "CLOUDFLARE_API_TOKEN|quedas de internet com causa (Cloudflare Radar)|dash.cloudflare.com → My Profile → API Tokens (permissão de leitura do Radar)"
  "X_BEARER_TOKEN|posts de agências no X (API paga; opcional)|developer.x.com"
  "CROSSCHECK_API_KEY|segundo modelo para conferência cruzada (opcional)|provedor compatível com /chat/completions"
)
# nome | valor sugerido | para quê
VARIABLES=(
  "POLARIZED_TRANSLATE_MODEL|claude-haiku-5-5|modelo da tradução (o estágio de maior volume; o Haiku custa ~40x menos)"
  "POLARIZED_CLASSIFIER_MODEL|claude-haiku-5-5|modelo que classifica manchetes"
  "CROSSCHECK_BASE_URL||endereço do segundo modelo (opcional)"
  "CROSSCHECK_MODEL||nome do segundo modelo (opcional)"
)

command -v gh >/dev/null || { echo "Instale o GitHub CLI: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Rode antes: gh auth login"; exit 1; }
gh repo view "$REPO" >/dev/null || { echo "Sem acesso ao repositório $REPO"; exit 1; }

only=" $* "
want() { [[ "$only" == "  " || "$only" == *" $1 "* ]]; }   # sem argumentos: pergunta tudo

existing="$(gh secret list --repo "$REPO" --json name -q '.[].name' 2>/dev/null || true)"
echo "Repositório: $REPO"
echo "Enter vazio pula. O que você digita não aparece na tela."
echo

for row in "${SECRETS[@]}"; do
  IFS='|' read -r name why where <<<"$row"
  want "$name" || continue
  state="não cadastrado"; grep -qx "$name" <<<"$existing" && state="já cadastrado (Enter mantém)"
  echo "• $name — $why"
  echo "  onde: $where · $state"
  read -rsp "  valor: " value; echo
  if [[ -n "$value" ]]; then printf '%s' "$value" | gh secret set "$name" --repo "$REPO" && echo "  ✓ salvo"; fi
  unset value
  echo
done

for row in "${VARIABLES[@]}"; do
  IFS='|' read -r name suggestion why <<<"$row"
  want "$name" || continue
  echo "• $name — $why"
  read -rp "  valor [${suggestion:-vazio = pular}]: " value
  value="${value:-$suggestion}"
  if [[ -n "$value" ]]; then gh variable set "$name" --repo "$REPO" --body "$value" && echo "  ✓ $name=$value"; fi
  echo
done

read -rp "Rodar o pipeline agora para testar? [s/N] " go
if [[ "$go" =~ ^[sS] ]]; then
  gh workflow run snapshot.yml --repo "$REPO" && echo "Disparado. Acompanhe com: gh run watch --repo $REPO"
fi
echo "Depois confira no app: Sobre → Estado das fontes."
