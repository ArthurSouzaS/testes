// Armazena as sessões no próprio SQLite (o MemoryStore padrão perde tudo ao reiniciar).
const session = require('express-session');
const db = require('../db');

class SessaoSQLite extends session.Store {
  constructor() {
    super();
    const limpar = () => db.run('DELETE FROM sessoes WHERE expira < ?', Date.now());
    limpar();
    setInterval(limpar, 60 * 60 * 1000).unref();
  }

  get(sid, cb) {
    try {
      const linha = db.get('SELECT dados, expira FROM sessoes WHERE sid = ?', sid);
      if (!linha || linha.expira < Date.now()) return cb(null, null);
      cb(null, JSON.parse(linha.dados));
    } catch (e) {
      cb(e);
    }
  }

  set(sid, dados, cb) {
    try {
      const expira = dados.cookie && dados.cookie.expires
        ? new Date(dados.cookie.expires).getTime()
        : Date.now() + 24 * 60 * 60 * 1000;
      db.run(
        'INSERT INTO sessoes (sid, dados, expira) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET dados = excluded.dados, expira = excluded.expira',
        sid, JSON.stringify(dados), expira,
      );
      cb && cb(null);
    } catch (e) {
      cb && cb(e);
    }
  }

  destroy(sid, cb) {
    db.run('DELETE FROM sessoes WHERE sid = ?', sid);
    cb && cb(null);
  }

  touch(sid, dados, cb) {
    this.set(sid, dados, cb);
  }
}

module.exports = SessaoSQLite;
