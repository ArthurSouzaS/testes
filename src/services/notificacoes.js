// Notificações persistidas + empurradas em tempo real (RF15, RU12, RU17, RU22, alertas de prazo).
const db = require('../db');
const tempoReal = require('../lib/tempo-real');

function notificar(usuarioIds, { tipo, titulo, texto = null, link = null }) {
  const ids = [...new Set([].concat(usuarioIds).map(Number).filter(Boolean))];
  for (const usuarioId of ids) {
    const { id } = db.run(
      'INSERT INTO notificacoes (usuario_id, tipo, titulo, texto, link) VALUES (?, ?, ?, ?, ?)',
      usuarioId, tipo, titulo, texto, link,
    );
    tempoReal.enviar(usuarioId, 'notificacao', { id, tipo, titulo, texto, link, naoLidas: contarNaoLidas(usuarioId) });
  }
}

const contarNaoLidas = (usuarioId) =>
  db.get('SELECT COUNT(*) AS n FROM notificacoes WHERE usuario_id = ? AND lida = 0', usuarioId).n;

const listar = (usuarioId, limite = 50) =>
  db.all('SELECT * FROM notificacoes WHERE usuario_id = ? ORDER BY id DESC LIMIT ?', usuarioId, limite);

function marcarLida(usuarioId, id) {
  db.run('UPDATE notificacoes SET lida = 1 WHERE id = ? AND usuario_id = ?', id, usuarioId);
}

function marcarTodasLidas(usuarioId) {
  db.run('UPDATE notificacoes SET lida = 1 WHERE usuario_id = ? AND lida = 0', usuarioId);
}

/** Sinaliza às telas abertas que algum dado mudou (sem gerar notificação). */
function atualizar(usuarioIds, motivo) {
  for (const id of new Set([].concat(usuarioIds).map(Number))) tempoReal.enviar(id, 'atualizacao', { motivo });
}

module.exports = { notificar, contarNaoLidas, listar, marcarLida, marcarTodasLidas, atualizar };
