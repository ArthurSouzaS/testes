const config = require('./src/config');
const db = require('./src/db');
const app = require('./src/app');
const { verificarPrazos } = require('./src/services/apoio');

if (!db.get('SELECT 1 FROM usuarios LIMIT 1') && process.env.SEED_DEMO !== 'false') {
  console.log('Banco vazio: carregando dados de demonstração…');
  require('./src/db/seed').popular();
}

verificarPrazos();
setInterval(verificarPrazos, 10 * 60 * 1000).unref();

app.listen(config.porta, () => console.log(`Protutal rodando em ${config.urlBase}`));
