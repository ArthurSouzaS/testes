// Vocabulário do domínio Protutal (rótulos exibidos na interface).

const SERIES = { 1: '1º ano', 2: '2º ano', 3: '3º ano' };

// Etapas de avaliação = trimestres do ano letivo
const ETAPAS = { 1: '1º trimestre', 2: '2º trimestre', 3: '3º trimestre' };

// Modelos de atividade pré-definidos na plataforma (RF9 / RF20 / RN09)
const MODELOS = {
  questionario_justificado: {
    nome: 'Questionário com justificativa',
    descricao: 'Múltipla escolha com justificativa obrigatória em todos os itens.',
    alternativas: true,
    justificativa: true,
  },
  multipla_escolha: {
    nome: 'Múltipla escolha',
    descricao: 'Questões objetivas tradicionais, sem justificativa.',
    alternativas: true,
    justificativa: false,
  },
  dissertativa: {
    nome: 'Dissertativa',
    descricao: 'Questões abertas respondidas por escrito.',
    alternativas: false,
    justificativa: false,
  },
  envio_arquivo: {
    nome: 'Envio de arquivo',
    descricao: 'O aluno envia um arquivo (ex.: foto do caderno, PDF).',
    alternativas: false,
    justificativa: false,
    semQuestoes: true,
  },
};

// Tipos de atividade lançada pelo professor (RF11)
const TIPOS_ATIVIDADE = {
  exercicio: 'Exercício',
  aula_invertida: 'Aula invertida',
  prova_alternativa: 'Prova alternativa',
  simulado: 'Simulado',
  revisao: 'Revisão',
};

const TIPOS_OBSERVACAO = {
  dificuldade: 'Dificuldade',
  avanco: 'Avanço',
  potencialidade: 'Potencialidade',
};

// Rubrica do aluno sobre o tutor — critérios vindos do briefing
// ("conforto para tirar dúvidas com o tutor").
const CRITERIOS_AVALIACAO_TUTOR = [
  { chave: 'clareza', nome: 'Clareza', descricao: 'Explica em linguagem simples e fácil de entender.' },
  { chave: 'dominio', nome: 'Domínio do conteúdo', descricao: 'Demonstra segurança sobre os conteúdos de Geografia.' },
  { chave: 'disponibilidade', nome: 'Disponibilidade', descricao: 'Responde dúvidas e mensagens em tempo razoável.' },
  { chave: 'respeito', nome: 'Respeito', descricao: 'Atende sem julgamentos e de forma individual.' },
];

const NOTA_DOMINIO = 7; // média a partir da qual um conteúdo é considerado dominado

module.exports = {
  SERIES,
  ETAPAS,
  MODELOS,
  TIPOS_ATIVIDADE,
  TIPOS_OBSERVACAO,
  CRITERIOS_AVALIACAO_TUTOR,
  NOTA_DOMINIO,
};
