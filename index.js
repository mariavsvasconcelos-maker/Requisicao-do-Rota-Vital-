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

function guiaTransporteHandler(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
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
