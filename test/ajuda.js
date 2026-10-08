// Utilitários de teste: banco em memória com dados de demonstração + cliente HTTP com cookies.
process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), 'protutal-teste-uploads');
const { popular, SENHA } = require('../src/db/seed');

const _log = console.log;
console.log = () => {};
popular();
console.log = _log;

const app = require('../src/app');

function iniciar() {
  return new Promise((resolve) => {
    const servidor = app.listen(0, () => resolve({ servidor, base: `http://127.0.0.1:${servidor.address().port}` }));
  });
}

class Cliente {
  constructor(base) { this.base = base; this.cookies = {}; }
  async req(caminho, opcoes = {}) {
    const res = await fetch(this.base + caminho, {
      redirect: 'manual', ...opcoes,
      headers: { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '), ...(opcoes.headers || {}) },
    });
    for (const c of res.headers.getSetCookie()) {
      const [par] = c.split(';');
      const [k, v] = par.split('=');
      this.cookies[k] = v;
    }
    return res;
  }
  async csrf(caminho = '/') {
    const html = await (await this.req(caminho)).text();
    return (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  }
  async post(caminho, dados, origem = '/') {
    const token = await this.csrf(origem);
    return this.req(caminho, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', referer: this.base + origem },
      body: new URLSearchParams({ _csrf: token, ...dados }).toString(),
    });
  }
  async login(email, perfil) {
    return this.post('/login', { email, senha: SENHA, perfil });
  }
}

module.exports = { iniciar, Cliente, db: require('../src/db') };
