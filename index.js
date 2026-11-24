const functions = require('@google-cloud/functions-framework');

/**
 * Faixas termicas e validades espelhadas de
 * src/main/java/com/rotavital/dominio/enums/TipoHemocomponente.java
 */
const REGRAS_HEMOCOMPONENTES = {
  CONCENTRADO_HEMACIAS: {
    descricao: 'Concentrado de Hemacias',
    tempMinCelsius: 1.0,
    tempMaxCelsius: 6.0,
    validadeDias: 42,
    compartimento: 'REFRIGERADO_1_A_6C'
  },
  PLASMA_FRESCO_CONGELADO: {
    descricao: 'Plasma Fresco Congelado',
    tempMinCelsius: -25.0,
    tempMaxCelsius: -18.0,
    validadeDias: 365,
    compartimento: 'CONGELADO_MENOS_25_A_MENOS_18C'
  },
  CONCENTRADO_PLAQUETAS: {
    descricao: 'Concentrado de Plaquetas',
    tempMinCelsius: 20.0,
    tempMaxCelsius: 24.0,
    validadeDias: 5,
    compartimento: 'AMBIENTE_CONTROLADO_20_A_24C'
  },
  CRIOPRECIPITADO: {
    descricao: 'Crioprecipitado',
    tempMinCelsius: -25.0,
    tempMaxCelsius: -18.0,
    validadeDias: 365,
    compartimento: 'CONGELADO_MENOS_25_A_MENOS_18C'
  }
};

function validarRequisicao(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Corpo da requisicao deve ser um JSON com os dados da rota e bolsas.';
  }
  if (!payload.hemocentroOrigemId || !payload.hospitalDestinoId) {
    return 'Campos obrigatorios ausentes: hemocentroOrigemId e hospitalDestinoId.';
  }
  if (!Array.isArray(payload.bolsas) || payload.bolsas.length === 0) {
    return 'A guia de transporte exige ao menos uma bolsa embarcada em bolsas[].';
  }
  for (let i = 0; i < payload.bolsas.length; i++) {
    const bolsa = payload.bolsas[i];
    if (!bolsa || !bolsa.tipoHemocomponente || !bolsa.grupoSanguineo) {
      return `Bolsa na posicao ${i} deve informar tipoHemocomponente e grupoSanguineo.`;
    }
    if (!REGRAS_HEMOCOMPONENTES[bolsa.tipoHemocomponente]) {
      return `Tipo de hemocomponente desconhecido na posicao ${i}: ${bolsa.tipoHemocomponente}.`;
    }
  }
  return null;
}

function gerarNumeroGuia(rotaId, agora) {
  const sufixoRota = String(rotaId || 'SEM-ID')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase() || 'ROTA';
  const carimbo = agora.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `GT-${sufixoRota}-${carimbo}`;
}

function gerarGuiaTransporte(payload, agora = new Date()) {
  const compartimentosMap = new Map();
  let volumeTotalMl = 0;

  const itens = payload.bolsas.map((bolsa, indice) => {
    const regra = REGRAS_HEMOCOMPONENTES[bolsa.tipoHemocomponente];
    const volume = Number(bolsa.volumeMl) || 0;
    volumeTotalMl += volume;

    if (!compartimentosMap.has(regra.compartimento)) {
      compartimentosMap.set(regra.compartimento, {
        compartimento: regra.compartimento,
        tempMinCelsius: regra.tempMinCelsius,
        tempMaxCelsius: regra.tempMaxCelsius,
        componentes: new Set(),
        quantidadeBolsas: 0
      });
    }
    const grupoComp = compartimentosMap.get(regra.compartimento);
    grupoComp.componentes.add(regra.descricao);
    grupoComp.quantidadeBolsas += 1;

    return {
      item: indice + 1,
      bolsaId: bolsa.id || `BOL-TEMP-${indice + 1}`,
      tipoHemocomponente: bolsa.tipoHemocomponente,
      descricaoComponente: regra.descricao,
      grupoSanguineo: bolsa.grupoSanguineo,
      volumeMl: volume,
      dataColeta: bolsa.dataColeta || null,
      dataValidade: bolsa.dataValidade || null,
      faixaTemperaturaCelsius: {
        min: regra.tempMinCelsius,
        max: regra.tempMaxCelsius
      },
      compartimentoRecomendado: regra.compartimento
    };
  });

  const compartimentosNecessarios = Array.from(compartimentosMap.values()).map((c) => ({
    compartimento: c.compartimento,
    tempMinCelsius: c.tempMinCelsius,
    tempMaxCelsius: c.tempMaxCelsius,
    componentes: Array.from(c.componentes),
    quantidadeBolsas: c.quantidadeBolsas
  }));

  const multiplosCompartimentos = compartimentosNecessarios.length > 1;
  const caminho = Array.isArray(payload.caminho) && payload.caminho.length > 0
    ? payload.caminho
    : [payload.hemocentroOrigemId, payload.hospitalDestinoId];

  return {
    numeroGuia: gerarNumeroGuia(payload.id, agora),
    emitidaEm: agora.toISOString(),
    provedor: {
      nome: 'Google Cloud Functions',
      modoExecucao: 'emulador-local'
    },
    rota: {
      id: payload.id || null,
      status: payload.status || 'PLANEJADA',
      hemocentroOrigemId: payload.hemocentroOrigemId,
      hospitalDestinoId: payload.hospitalDestinoId,
      caminho,
      tempoEstimadoMinutos: payload.tempoEstimadoMinutos ?? null,
      previsaoSaida: payload.previsaoSaida || null,
      previsaoChegada: payload.previsaoChegada || null
    },
    cadeiaFria: {
      requerSeparacaoTermica: multiplosCompartimentos,
      alerta: multiplosCompartimentos
        ? 'Remessa contem hemocomponentes com faixas termicas incompativeis. Transportar em compartimentos separados.'
        : 'Todos os hemocomponentes compartilham a mesma faixa de temperatura.',
      compartimentosNecessarios
    },
    resumoCarga: {
      totalBolsas: itens.length,
      volumeTotalMl
    },
    itens
  };
}

function formatarGuiaTexto(guia) {
  const linhas = [
    '============================================================',
    `ROTA VITAL - GUIA DE TRANSPORTE DE HEMOCOMPONENTES`,
    `Numero: ${guia.numeroGuia}`,
    `Emitida em: ${guia.emitidaEm}`,
    `Provedor: ${guia.provedor.nome} (${guia.provedor.modoExecucao})`,
    '------------------------------------------------------------',
    `Rota ID: ${guia.rota.id ?? 'N/A'} | Status: ${guia.rota.status}`,
    `Origem: ${guia.rota.hemocentroOrigemId} -> Destino: ${guia.rota.hospitalDestinoId}`,
    `Caminho: ${guia.rota.caminho.join(' > ')}`,
    `Tempo estimado: ${guia.rota.tempoEstimadoMinutos ?? 'N/A'} min`,
    `Previsao saida: ${guia.rota.previsaoSaida ?? 'N/A'} | chegada: ${guia.rota.previsaoChegada ?? 'N/A'}`,
    '------------------------------------------------------------',
    `CADEIA FRIA: ${guia.cadeiaFria.alerta}`,
    ...guia.cadeiaFria.compartimentosNecessarios.map(
      (c) => `  * ${c.compartimento} (${c.tempMinCelsius}C a ${c.tempMaxCelsius}C): ${c.quantidadeBolsas} bolsa(s) [${c.componentes.join(', ')}]`
    ),
    '------------------------------------------------------------',
    `CARGA (${guia.resumoCarga.totalBolsas} bolsa(s), ${guia.resumoCarga.volumeTotalMl} mL):`,
    ...guia.itens.map(
      (i) => `  ${i.item}. [${i.bolsaId}] ${i.descricaoComponente} (${i.grupoSanguineo}) - ${i.volumeMl} mL | Val: ${i.dataValidade ?? 'N/A'} | Faixa: ${i.faixaTemperaturaCelsius.min}C..${i.faixaTemperaturaCelsius.max}C`
    ),
    '============================================================'
  ];
  return linhas.join('\n');
}

function renderizarPaginaHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Rota Vital — Guia de Transporte (Google Cloud Functions Local)</title>
  <style>
    * { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    body { margin: 0; background: #f8fafc; color: #0f172a; padding: 24px; }
    .container { max-width: 980px; margin: 0 auto; }
    header { background: #991b1b; color: #fff; padding: 20px 24px; border-radius: 12px; margin-bottom: 20px; }
    header h1 { margin: 0 0 6px; font-size: 1.4rem; }
    header p { margin: 0; opacity: 0.9; font-size: 0.92rem; }
    .badge { display: inline-block; background: rgba(255,255,255,0.2); padding: 3px 10px; border-radius: 999px; font-size: 0.78rem; margin-top: 8px; }
    .grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 20px; }
    @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    h2 { margin-top: 0; font-size: 1.05rem; color: #1e293b; }
    textarea { width: 100%; height: 340px; font-family: ui-monospace, Consolas, monospace; font-size: 0.82rem; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; resize: vertical; }
    button { background: #b91c1c; color: #fff; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 12px; font-size: 0.92rem; }
    button:hover { background: #991b1b; }
    .alerta { padding: 12px 14px; border-radius: 8px; margin: 12px 0; font-size: 0.9rem; }
    .alerta-warn { background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; }
    .alerta-ok { background: #dcfce7; border: 1px solid #22c55e; color: #166534; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.88rem; background: #f1f5f9; padding: 12px; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.85rem; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e2e8f0; }
    th { background: #f8fafc; color: #475569; }
    pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 0.78rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Rota Vital — Emissão de Guia de Transporte</h1>
      <p>Função HTTP executando localmente no emulador Google Cloud Functions</p>
      <span class="badge">Provedor: @google-cloud/functions-framework · http://localhost:8085/</span>
    </header>

    <div class="grid">
      <div class="card">
        <h2>1. Requisição do Rota Vital (JSON)</h2>
        <textarea id="payload">{
  "id": "rota-101",
  "hemocentroOrigemId": "HC01",
  "hospitalDestinoId": "HO04",
  "status": "PLANEJADA",
  "tempoEstimadoMinutos": 23.5,
  "caminho": ["HC01", "HO04"],
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
}</textarea>
        <button onclick="emitirGuia()">Emitir Guia de Transporte</button>
      </div>

      <div class="card">
        <h2>2. Guia de Transporte Gerada</h2>
        <div id="resultado">
          <p style="color:#64748b;font-size:0.9rem;">Clique em <strong>Emitir Guia de Transporte</strong> para enviar o POST ao emulador.</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    async function emitirGuia() {
      const box = document.getElementById('resultado');
      try {
        const body = JSON.parse(document.getElementById('payload').value);
        const resp = await fetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (!resp.ok) {
          box.innerHTML = '<div class="alerta alerta-warn">' + (data.erro || 'Erro na requisicao') + '</div>';
          return;
        }
        const classeAlerta = data.cadeiaFria.requerSeparacaoTermica ? 'alerta-warn' : 'alerta-ok';
        box.innerHTML =
          '<div class="meta">' +
            '<div><strong>Guia:</strong> ' + data.numeroGuia + '</div>' +
            '<div><strong>Provedor:</strong> ' + data.provedor.nome + ' (' + data.provedor.modoExecucao + ')</div>' +
            '<div><strong>Rota:</strong> ' + data.rota.caminho.join(' &rarr; ') + '</div>' +
            '<div><strong>Carga:</strong> ' + data.resumoCarga.totalBolsas + ' bolsas (' + data.resumoCarga.volumeTotalMl + ' mL)</div>' +
          '</div>' +
          '<div class="alerta ' + classeAlerta + '"><strong>Cadeia Fria:</strong> ' + data.cadeiaFria.alerta + '</div>' +
          '<table><thead><tr><th>Bolsa</th><th>Componente</th><th>Grupo</th><th>Faixa</th></tr></thead><tbody>' +
            data.itens.map(i =>
              '<tr><td>' + i.bolsaId + '</td><td>' + i.descricaoComponente + '</td><td>' + i.grupoSanguineo + '</td><td>' + i.faixaTemperaturaCelsius.min + '°C a ' + i.faixaTemperaturaCelsius.max + '°C</td></tr>'
            ).join('') +
          '</tbody></table>' +
          '<details style="margin-top:12px;"><summary style="cursor:pointer;font-size:0.85rem;color:#475569;">Ver JSON completo</summary><pre>' + JSON.stringify(data, null, 2) + '</pre></details>';
      } catch (e) {
        box.innerHTML = '<div class="alerta alerta-warn">JSON invalido: ' + e.message + '</div>';
      }
    }
    emitirGuia();
  </script>
</body>
</html>`;
}

function guiaTransporteHandler(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method === 'GET') {
    return res.status(200).type('text/html; charset=utf-8').send(renderizarPaginaHtml());
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      erro: 'Metodo nao permitido. Envie uma requisicao POST com os dados da rota.'
    });
  }

  const erroValidacao = validarRequisicao(req.body);
  if (erroValidacao) {
    return res.status(400).json({ erro: erroValidacao });
  }

  const guia = gerarGuiaTransporte(req.body);
  const formato = (req.query && req.query.formato) || req.body.formato || 'json';

  if (String(formato).toLowerCase() === 'texto') {
    return res.status(200).type('text/plain; charset=utf-8').send(formatarGuiaTexto(guia));
  }

  return res.status(200).json(guia);
}

functions.http('guiaTransporte', guiaTransporteHandler);

module.exports = {
  guiaTransporteHandler,
  gerarGuiaTransporte,
  formatarGuiaTexto,
  validarRequisicao,
  REGRAS_HEMOCOMPONENTES
};
