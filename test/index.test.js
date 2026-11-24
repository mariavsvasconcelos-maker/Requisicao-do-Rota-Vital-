const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  guiaTransporteHandler,
  gerarGuiaTransporte,
  formatarGuiaTexto
} = require('../index');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    contentType: 'application/json',
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    type(ct) { this.contentType = ct; return this; },
    json(data) { this.body = data; return this; },
    send(data) { this.body = data; return this; }
  };
  return res;
}

describe('Funcao HTTP guiaTransporte (Google Cloud Functions - Emulador Local)', () => {
  it('gera guia de transporte para remessa homogenea de hemacias', () => {
    const req = {
      method: 'POST',
      query: {},
      body: {
        id: 'rota-01',
        hemocentroOrigemId: 'HC01',
        hospitalDestinoId: 'HO04',
        status: 'PLANEJADA',
        tempoEstimadoMinutos: 23.5,
        caminho: ['HC01', 'HO04'],
        previsaoSaida: '2026-11-24T17:00:00',
        previsaoChegada: '2026-11-24T17:23:30',
        bolsas: [
          {
            id: 'BOL00001',
            tipoHemocomponente: 'CONCENTRADO_HEMACIAS',
            grupoSanguineo: 'O-',
            volumeMl: 450,
            dataValidade: '2026-12-15'
          }
        ]
      }
    };
    const res = mockRes();

    guiaTransporteHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body.numeroGuia, /^GT-ROTA01-/);
    assert.equal(res.body.provedor.nome, 'Google Cloud Functions');
    assert.equal(res.body.provedor.modoExecucao, 'emulador-local');
    assert.equal(res.body.resumoCarga.totalBolsas, 1);
    assert.equal(res.body.resumoCarga.volumeTotalMl, 450);
    assert.equal(res.body.cadeiaFria.requerSeparacaoTermica, false);
    assert.deepEqual(res.body.itens[0].faixaTemperaturaCelsius, { min: 1, max: 6 });
  });

  it('alerta separacao termica quando remessa mistura hemacias e plaquetas (HU-07)', () => {
    const guia = gerarGuiaTransporte({
      id: 'rota-mista',
      hemocentroOrigemId: 'HC01',
      hospitalDestinoId: 'HO05',
      bolsas: [
        { id: 'BOL01', tipoHemocomponente: 'CONCENTRADO_HEMACIAS', grupoSanguineo: 'A+', volumeMl: 300 },
        { id: 'BOL02', tipoHemocomponente: 'CONCENTRADO_PLAQUETAS', grupoSanguineo: 'O-', volumeMl: 250 }
      ]
    }, new Date('2026-11-24T18:00:00Z'));

    assert.equal(guia.cadeiaFria.requerSeparacaoTermica, true);
    assert.equal(guia.cadeiaFria.compartimentosNecessarios.length, 2);
    assert.equal(guia.resumoCarga.volumeTotalMl, 550);
  });

  it('retorna guia formatada em texto quando formato=texto', () => {
    const req = {
      method: 'POST',
      query: { formato: 'texto' },
      body: {
        id: 'rota-txt',
        hemocentroOrigemId: 'HC02',
        hospitalDestinoId: 'HO06',
        bolsas: [
          { id: 'BOL10', tipoHemocomponente: 'PLASMA_FRESCO_CONGELADO', grupoSanguineo: 'AB+', volumeMl: 220 }
        ]
      }
    };
    const res = mockRes();

    guiaTransporteHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.contentType, /text\/plain/);
    assert.match(res.body, /GUIA DE TRANSPORTE DE HEMOCOMPONENTES/);
    assert.match(res.body, /Plasma Fresco Congelado/);
  });

  it('rejeita metodo diferente de POST com 405', () => {
    const res = mockRes();
    guiaTransporteHandler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 405);
  });

  it('rejeita payload sem bolsas com 400', () => {
    const res = mockRes();
    guiaTransporteHandler({
      method: 'POST',
      body: { hemocentroOrigemId: 'HC01', hospitalDestinoId: 'HO04', bolsas: [] }
    }, res);
    assert.equal(res.statusCode, 400);
  });
});
