const path = require('node:path');

const lista = (valor, padrao) =>
  (valor ? valor.split(',') : padrao).map((d) => d.trim().toLowerCase()).filter(Boolean);

const raiz = path.join(__dirname, '..');

module.exports = {
  porta: Number(process.env.PORT) || 3000,
  producao: process.env.NODE_ENV === 'production',
  urlBase: process.env.URL_BASE || `http://localhost:${Number(process.env.PORT) || 3000}`,
  segredoSessao: process.env.SESSION_SECRET || 'protutal-dev-troque-este-segredo',

  caminhoBanco: process.env.DB_PATH || path.join(raiz, 'data', 'protutal.db'),
  pastaUploads: process.env.UPLOAD_DIR || path.join(raiz, 'uploads'),

  // RN20 / RN22 — "array de domínios institucionais do SESI cadastrados no sistema".
  // Separados por perfil para impedir que um aluno se cadastre como professor.
  dominiosProfessor: lista(process.env.DOMINIOS_PROFESSOR, ['sesisp.org.br', 'sesi.org.br']),
  dominiosAluno: lista(process.env.DOMINIOS_ALUNO, ['portalsesisp.org.br', 'aluno.sesisp.org.br']),

  // E-mail (RN20 / RN22). Sem SMTP configurado, os e-mails ficam na caixa de
  // saída de desenvolvimento (/dev/emails) e no console.
  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      }
    : null,
  remetente: process.env.EMAIL_FROM || 'Protutal <nao-responda@protutal.local>',

  fusoHorario: 'America/Sao_Paulo',
  horasAlertaPrazo: 24,

  uploads: {
    tamanhoMaximoMB: 10,
    // Formatos permitidos (RF31 / RU18 / RU19)
    tipos: {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.ms-powerpoint': '.ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    },
  },
};
