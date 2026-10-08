// Conexão com o SQLite nativo do Node (node:sqlite) — não exige compilação.
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

// O módulo node:sqlite ainda emite um aviso "experimental"; silenciamos só ele.
const emitirAviso = process.emitWarning;
process.emitWarning = (aviso, ...resto) => {
  const texto = typeof aviso === 'string' ? aviso : aviso && aviso.message;
  if (texto && texto.includes('SQLite')) return;
  return emitirAviso.call(process, aviso, ...resto);
};
const { DatabaseSync } = require('node:sqlite');

if (config.caminhoBanco !== ':memory:') {
  fs.mkdirSync(path.dirname(config.caminhoBanco), { recursive: true });
}

const conexao = new DatabaseSync(config.caminhoBanco);
conexao.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
conexao.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const cache = new Map();
function preparar(sql) {
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = conexao.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

let profundidade = 0;
// undefined não pode ser gravado no SQLite: tratamos como NULL
const p = (params) => params.map((v) => (v === undefined ? null : v));

const db = {
  get: (sql, ...params) => preparar(sql).get(...p(params)) || null,
  all: (sql, ...params) => preparar(sql).all(...p(params)),
  run: (sql, ...params) => {
    const r = preparar(sql).run(...p(params));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  },
  exec: (sql) => conexao.exec(sql),

  /** Executa fn dentro de uma transação (aninhável via SAVEPOINT). */
  transacao(fn) {
    const nome = `sp${profundidade}`;
    conexao.exec(profundidade === 0 ? 'BEGIN' : `SAVEPOINT ${nome}`);
    profundidade++;
    try {
      const resultado = fn();
      profundidade--;
      conexao.exec(profundidade === 0 ? 'COMMIT' : `RELEASE ${nome}`);
      return resultado;
    } catch (erro) {
      profundidade--;
      conexao.exec(profundidade === 0 ? 'ROLLBACK' : `ROLLBACK TO ${nome}; RELEASE ${nome}`);
      throw erro;
    }
  },

  agora: () => new Date().toISOString(),
};

module.exports = db;
