# Revisões humanas das análises

Toda análise gerada entra como `pendente`. Para aprovar ou rejeitar, crie ou edite um
arquivo `.json` nesta pasta, com o id da análise como chave:

```json
{
  "plz:analysis:wto-cond-eu-regulacao-comercial-impacto": {
    "status": "aprovada",
    "reviewer": "nome ou usuário do GitHub",
    "at": "2026-10-25T18:00:00Z",
    "note": "Conferi os três precedentes nas fontes X e Y."
  }
}
```

- `aprovada` muda o status da análise para verificada e mostra quem revisou.
- `rejeitada` tira a análise do próximo snapshot.
- A revisão vale enquanto o fato e a versão do prompt não mudarem. Se o fato for
  atualizado, a análise é refeita e volta para `pendente`.

Revisar por pull request deixa o histórico de quem aprovou o quê à vista de todos.
