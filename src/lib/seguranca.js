// RNF3 — cabeçalhos de segurança, proteção CSRF e limite de tentativas de login.
const crypto = require('node:crypto');

function cabecalhos(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
      "connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'",
  });
  next();
}

// ------------------------------------------------------------------ CSRF
function tokenCsrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  next();
}

function csrfValido(req) {
  const enviado = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const esperado = req.session && req.session.csrf;
  if (!esperado || enviado.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(enviado), Buffer.from(esperado));
}

/** Verifica o token em todo POST, exceto multipart (verificado após o upload — ver lib/upload.js). */
function verificarCsrf(req, res, next) {
  if (req.method !== 'POST' || req.is('multipart/form-data')) return next();
  if (csrfValido(req)) return next();
  const erro = new Error('Sua sessão expirou ou o formulário é inválido. Recarregue a página e tente novamente.');
  erro.status = 403;
  next(erro);
}

// ------------------------------------------------- Limite de tentativas
const tentativas = new Map();
const MAX_TENTATIVAS = 5;
const JANELA_MS = 15 * 60 * 1000;

function bloqueado(chave) {
  const t = tentativas.get(chave);
  if (!t) return 0;
  if (Date.now() > t.ate) {
    tentativas.delete(chave);
    return 0;
  }
  return t.n >= MAX_TENTATIVAS ? Math.ceil((t.ate - Date.now()) / 60000) : 0;
}

function registrarFalha(chave) {
  const t = tentativas.get(chave);
  if (!t || Date.now() > t.ate) tentativas.set(chave, { n: 1, ate: Date.now() + JANELA_MS });
  else t.n++;
}

const limparFalhas = (chave) => tentativas.delete(chave);

module.exports = { cabecalhos, tokenCsrf, verificarCsrf, csrfValido, bloqueado, registrarFalha, limparFalhas };
