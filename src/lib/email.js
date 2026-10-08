// Envio de e-mails (RN20 / RN22). Sem SMTP, grava na caixa de saída de desenvolvimento.
const config = require('../config');
const db = require('../db');

let transporte = null;
if (config.smtp) {
  const nodemailer = require('nodemailer');
  transporte = nodemailer.createTransport(config.smtp);
}

async function enviarEmail({ para, assunto, html }) {
  if (transporte) {
    await transporte.sendMail({ from: config.remetente, to: para, subject: assunto, html });
    return;
  }
  db.run('INSERT INTO emails_enviados (para, assunto, html) VALUES (?, ?, ?)', para, assunto, html);
  console.log(`\n[e-mail] Para: ${para}\n[e-mail] Assunto: ${assunto}\n[e-mail] Veja em ${config.urlBase}/dev/emails\n`);
}

module.exports = { enviarEmail, modoDesenvolvimento: !transporte };
