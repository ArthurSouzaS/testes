// Upload de arquivos com lista de formatos permitidos e limite de tamanho.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('../config');
const db = require('../db');
const { csrfValido } = require('./seguranca');

fs.mkdirSync(config.pastaUploads, { recursive: true });

const armazenamento = multer.diskStorage({
  destination: config.pastaUploads,
  filename: (req, arquivo, cb) => cb(null, crypto.randomBytes(16).toString('hex') + config.uploads.tipos[arquivo.mimetype]),
});

const multerBase = multer({
  storage: armazenamento,
  limits: { fileSize: config.uploads.tamanhoMaximoMB * 1024 * 1024, files: 5 },
  fileFilter: (req, arquivo, cb) => {
    if (config.uploads.tipos[arquivo.mimetype]) return cb(null, true);
    const erro = new Error(`Formato não permitido: ${arquivo.originalname}. Envie imagens, PDF ou documentos do Office.`);
    erro.status = 422;
    cb(erro);
  },
});

function removerEnviados(req) {
  for (const a of req.files || []) fs.rm(a.path, { force: true }, () => {});
}

/** Middleware: recebe até 5 arquivos no campo indicado e valida o CSRF depois do parse. */
function receber(campo = 'arquivos') {
  const mw = multerBase.array(campo, 5);
  return (req, res, next) => {
    mw(req, res, (erro) => {
      if (erro) {
        removerEnviados(req);
        if (erro.code === 'LIMIT_FILE_SIZE') {
          erro.message = `Arquivo maior que ${config.uploads.tamanhoMaximoMB} MB.`;
          erro.status = 422;
        }
        if (erro.code === 'LIMIT_FILE_COUNT' || erro.code === 'LIMIT_UNEXPECTED_FILE') {
          erro.message = 'Envie no máximo 5 arquivos por vez.';
          erro.status = 422;
        }
        return next(erro);
      }
      if (!csrfValido(req)) {
        removerEnviados(req);
        const e = new Error('Sua sessão expirou ou o formulário é inválido. Recarregue a página e tente novamente.');
        e.status = 403;
        return next(e);
      }
      next();
    });
  };
}

/** Registra no banco os arquivos recebidos, vinculando-os a um contexto (entrega, material…). */
function registrar(req, contexto, refId) {
  return (req.files || []).map((a) => {
    // multer entrega o nome em latin1; convertemos para UTF-8 para preservar acentos
    const nome = Buffer.from(a.originalname, 'latin1').toString('utf8');
    const { id } = db.run(
      'INSERT INTO arquivos (dono_id, nome_original, nome_salvo, mime, tamanho, contexto, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      req.usuario.id, nome, a.filename, a.mimetype, a.size, contexto, refId,
    );
    return id;
  });
}

const listar = (contexto, refId) =>
  db.all('SELECT * FROM arquivos WHERE contexto = ? AND ref_id = ? ORDER BY id', contexto, refId);

module.exports = { receber, registrar, listar, removerEnviados };
