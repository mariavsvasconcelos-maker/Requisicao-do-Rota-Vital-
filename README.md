# Função HTTP — Guia de Transporte (Google Cloud Functions · Emulador Local)

Função HTTP desenvolvida para receber requisições do sistema **Rota Vital** (no mesmo formato do DTO `RotaResponse`) e emitir a **Guia de Transporte de Hemocomponentes**, executando **exclusivamente em ambiente local** através do emulador oficial do provedor Google (`@google-cloud/functions-framework`).

## Verifique no terminal do seu Computador:
npm install
npm start

## Como executar localmente com o emulador Google

1. Instale as dependências (apenas na primeira vez):

```powershell
cd functions/guia-transporte
npm install
```

2. Inicie o emulador oficial do Google Cloud Functions na porta `8085`:

```powershell
npm start
```

O endpoint ficará disponível em `http://localhost:8085/`.

- **Via navegador (interface web):** acesse `http://localhost:8085/` para testar interativamente e visualizar a guia gerada.
- **Via API (`POST`):** envie JSON para `http://localhost:8085/` (ou `?formato=texto`).

3. Execute os testes unitários:

```powershell
npm test
```

## Exemplo de requisição do sistema Rota Vital

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8085/" -ContentType "application/json" -Body '{
  "id": "rota-101",
  "hemocentroOrigemId": "HC01",
  "hospitalDestinoId": "HO04",
  "status": "PLANEJADA",
  "tempoEstimadoMinutos": 23.5,
  "caminho": ["HC01", "HO04"],
  "previsaoSaida": "2026-11-24T17:00:00",
  "previsaoChegada": "2026-11-24T17:23:30",
  "bolsas": [
    {
      "id": "BOL00001",
      "tipoHemocomponente": "CONCENTRADO_HEMACIAS",
      "grupoSanguineo": "O-",
      "volumeMl": 450,
      "dataValidade": "2026-12-15"
    },
    {
      "id": "BOL00002",
      "tipoHemocomponente": "CONCENTRADO_PLAQUETAS",
      "grupoSanguineo": "A+",
      "volumeMl": 280,
      "dataValidade": "2026-11-28"
    }
  ]
}'
```

Para receber a guia formatada em texto simples (pronta para impressão), adicione `?formato=texto` na URL:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8085/?formato=texto" -ContentType "application/json" -Body '...'
```
