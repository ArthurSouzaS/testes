// Funções de formatação usadas nas views.
const config = require('../config');

const fuso = config.fusoHorario;
const fmtData = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const fmtCurta = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: 'short' });
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' });
const fmtPartes = new Intl.DateTimeFormat('en-CA', {
  timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const valida = (iso) => iso && !Number.isNaN(new Date(iso).getTime());

function partes(d) {
  const p = Object.fromEntries(fmtPartes.formatToParts(d).map((x) => [x.type, x.value]));
  return p;
}

module.exports = {
  data: (iso) => (valida(iso) ? fmtData.format(new Date(iso)) : '—'),
  dataHora: (iso) => (valida(iso) ? fmtDataHora.format(new Date(iso)).replace(',', ' às') : '—'),
  dataCurta: (iso) => (valida(iso) ? fmtCurta.format(new Date(iso)).replace('.', '') : '—'),
  hora: (iso) => (valida(iso) ? fmtHora.format(new Date(iso)) : ''),

  /** "há 5 min", "em 2 dias"… */
  relativo(iso) {
    if (!valida(iso)) return '';
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    const abs = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
    if (abs < 60) return 'agora';
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
    return module.exports.data(iso);
  },

  nota: (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(1).replace('.', ',')),

  /** Converte o valor de um <input type="datetime-local"> (horário de Brasília) para ISO UTC. */
  localParaIso(valor) {
    if (!valor || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return null;
    const d = new Date(`${valor}:00-03:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  },

  /** Converte ISO UTC para o valor de um <input type="datetime-local">. */
  isoParaLocal(iso) {
    if (!valida(iso)) return '';
    const p = partes(new Date(iso));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  },

  /** Data de hoje (YYYY-MM-DD) no fuso do Brasil. */
  hoje() {
    const p = partes(new Date());
    return `${p.year}-${p.month}-${p.day}`;
  },

  anoAtual: () => Number(partes(new Date()).year),

  iniciais(nome = '') {
    const p = nome.trim().split(/\s+/);
    return ((p[0] || '')[0] || '').concat(p.length > 1 ? p[p.length - 1][0] : '').toUpperCase();
  },

  tamanhoArquivo(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  },

  plural: (n, um, varios) => `${n} ${n === 1 ? um : varios}`,
};
