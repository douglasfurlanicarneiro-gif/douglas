export type PriceOption = {
  ml: number;
  preco: number;
};

export type Perfume = {
  id: string;
  seq: number;
  nome: string;
  inspiracao: string;
  imagemUrl: string;
  ocasioes: string[];
  familia: string;
  familias?: string[];
  concentracao: string;
  notasSaida: string;
  notasCoracao: string;
  notasFundo: string;
  precos: PriceOption[];
  estoqueMinimoMl: number;
  publicavel: boolean;
  disponivel?: boolean;
  prontaEntrega?: boolean;
  // Campos administrativos. A API pública não os envia na vitrine.
  custoEssenciaPorMl?: number;
  concentracaoPercentual?: number;
  fornecedorId?: string;
  fornecedorCodigo?: string;
  estoqueAtualMl?: number;
  tamanhosDisponiveisMl?: number[];
};

export type Movimento = {
  id: string;
  perfumeId: string;
  tipo: 'entrada' | 'saida';
  quantidadeMl: number;
  motivo: string;
  categoria?: string;
  origem: string;
  data: string;
};

export type EstoqueResumoItem = {
  saldoAtualMl: number;
  reservadoMl: number;
  disponivelMl: number;
};

export type EstoqueResumo = Record<string, EstoqueResumoItem>;

export type OperacaoSistema = {
  id: string;
  tipo: string;
  titulo: string;
  detalhes: string;
  perfumesAfetados: number;
  quantidadeMl: number;
  data: string;
};

export type CatalogoEstoqueResumo = {
  totalPerfumes: number;
  prontaEntrega: number;
  sobEncomenda: number;
  estoqueProntaEntregaMl: number;
  estoqueSobEncomendaMl: number;
  sobEncomendaComSaldo: number;
  historico: OperacaoSistema[];
};

export type OrderStatus =
  | 'pendente'
  | 'pagamento_confirmado'
  | 'preparando'
  | 'pronto'
  | 'enviado'
  | 'entregue'
  | 'cancelado';

export type PedidoItem = {
  perfumeId: string;
  perfumeNome?: string;
  ml: number;
  quantidade: number;
  precoUnitario?: number;
  subtotal?: number;
  prontaEntrega?: boolean;
  tipoAtendimento?: 'pronta_entrega' | 'sob_encomenda';
  custoUnitarioEstimado?: number;
  lucroUnitarioEstimado?: number;
};

export type StatusHistoryItem = {
  status: OrderStatus;
  data: string;
};

export type PaymentDetails = {
  metodo: string;
  status: string;
  referencia: string;
  provedor?: string;
  valor?: number;
  cobrancaId?: string;
  checkoutUrl?: string;
  orderNsu?: string;
  transactionNsu?: string;
  invoiceSlug?: string;
  captureMethod?: string;
  parcelas?: number;
  pagoEm?: string;
  pixCopiaECola?: string;
  recebedor?: string;
  instituicao?: string;
  observacao?: string;
};

export type Pedido = {
  id: string;
  seq: number;
  cliente: string;
  contato: string;
  nomeCompleto?: string;
  whatsapp?: string;
  email?: string;
  status: OrderStatus;
  observacoes: string;
  itens: PedidoItem[];
  subtotal?: number;
  frete?: number;
  entrega?: OpcaoFrete | null;
  subtotalTabela?: number;
  ajusteManual?: number;
  total: number;
  criadoEm: string;
  codigoAcompanhamento?: string;
  historicoStatus?: StatusHistoryItem[];
  pagamento?: PaymentDetails;
  formaPagamento?: 'pix' | 'cartao';
  temSobEncomenda?: boolean;
  prazoEncomendaDias?: number;
  aceitePrazoEncomenda?: boolean;
  aceitePrazoEncomendaEm?: string | null;
  tipoEntrega?: 'entrega' | 'retirada';
  endereco?: {
    cep: string;
    endereco: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    estado: string;
  } | null;
};

export type Opiniao = {
  id: string;
  perfumeId: string;
  cliente: string;
  nota: number;
  comentario: string;
  data: string;
  aprovada?: boolean;
  moderadaEm?: string | null;
};

export type Sugestao = {
  id: string;
  cliente: string;
  contato: string;
  mensagem: string;
  data: string;
  lida: boolean;
};

export type CompraItem = {
  perfumeId: string;
  perfumeNome: string;
  ml: number;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
};

export type OpcaoFrete = {
  tipo?: 'entrega' | 'retirada';
  categoriaFrete?: 'padrao' | 'prioritaria';
  nomeExibicao?: string;
  serviceId: number;
  transportadora: string;
  servico: string;
  precoTransportadora: number;
  taxaEmbalagem: number;
  preco: number;
  prazoDias: number;
  prazoTransportadora?: number;
  tipoAjuste?: 'valor' | 'percentual';
  valorAjuste?: number;
};

export type Compra = {
  id: string;
  seq?: number;
  cliente: string;
  contato: string;
  itens?: CompraItem[];
  perfumeId?: string;
  perfumeNome?: string;
  ml?: number;
  preco?: number;
  subtotal?: number;
  frete?: number;
  entrega?: OpcaoFrete | null;
  total?: number;
  status: string;
  observacoes: string;
  formaPagamento?: 'pix' | 'cartao';
  pagamento?: PaymentDetails;
  data: string;
  criadoEm?: string;
  codigoAcompanhamento?: string;
  historicoStatus?: StatusHistoryItem[];
};

export type Acompanhamento = {
  id: string;
  seq?: number;
  codigoAcompanhamento: string;
  status: OrderStatus;
  itens: CompraItem[];
  subtotal: number;
  frete: number;
  entrega?: OpcaoFrete | null;
  total: number;
  formaPagamento?: 'pix' | 'cartao';
  pagamento?: Compra['pagamento'];
  criadoEm: string;
  historicoStatus: StatusHistoryItem[];
};

export type Metricas = {
  periodo: '7d' | '30d' | 'mes' | 'todos';
  pedidosTotal: number;
  pedidosValidos: number;
  pedidosPagos: number;
  pedidosPendentes: number;
  pedidosCancelados: number;
  pedidosPorStatus: Record<string, number>;
  faturamento: number;
  receitaConfirmada: number;
  receitaEntregue: number;
  aReceber: number;
  ticketMedio: number;
  custoEstimado: number;
  lucroEstimado: number;
  margemEstimada: number;
  mlVendidos: number;
  tamanhoMaisVendido?: { ml: number; quantidade: number; faturamento: number } | null;
  serieDiaria: { data: string; receita: number; lucro: number; pedidos: number; ml: number }[];
  maisVendidos: {
    perfumeId?: string;
    nome: string;
    quantidade: number;
    ml: number;
    faturamento: number;
    lucroEstimado: number;
  }[];
  maisLucrativos: {
    perfumeId?: string;
    nome: string;
    quantidade: number;
    ml: number;
    faturamento: number;
    lucroEstimado: number;
  }[];
};

export type CustosConfig = {
  custoBasePorMl: number;
  custoValvula: number;
  custoTampa: number;
  custoEtiqueta: number;
  custoEmbalagem: number;
  outrosPorFrasco: number;
  taxaPagamentoPercentual: number;
  concentracaoPadraoPercentual: number;
  frascos: Record<string, number>;
};

export type RentabilidadeItem = {
  perfumeId: string;
  nome: string;
  ml: number;
  preco: number;
  publicavel: boolean;
  essenciaMl: number;
  baseMl: number;
  custoEssencia: number;
  custoBase: number;
  custoFrasco: number;
  custoFixo: number;
  custoProducao: number;
  taxaPagamento: number;
  custoTotal: number;
  lucro: number;
  margemPercentual: number;
  custoConfigurado: boolean;
};

export type Fornecedor = {
  id: string;
  nome: string;
  site: string;
  contato: string;
  whatsapp: string;
  email: string;
  documento: string;
  pedidoMinimo: number;
  prazoDias: number;
  observacoes: string;
  ativo: boolean;
  cotacoes?: number;
  criadoEm?: string;
  atualizadoEm?: string;
};

export type CotacaoFornecedor = {
  id: string;
  fornecedorId: string;
  fornecedorNome: string;
  perfumeId?: string;
  perfumeNome?: string;
  produto: string;
  codigo: string;
  quantidade: number;
  unidade: 'ml' | 'g' | 'kg' | 'un';
  precoTotal: number;
  frete: number;
  custoUnitario: number;
  link: string;
  observacoes: string;
  data: string;
};

export type Insumo = {
  id: string;
  nome: string;
  categoria: 'essencia' | 'base' | 'frasco' | 'valvula' | 'tampa' | 'etiqueta' | 'embalagem' | 'outro';
  unidade: 'ml' | 'g' | 'un';
  custoUnitario: number;
  estoqueMinimo: number;
  fornecedorId?: string | null;
  perfumeId?: string | null;
  tamanhoMl?: number | null;
  observacoes: string;
  ativo: boolean;
  saldoAtual: number;
  valorEstoque: number;
};

export type PlanoProducao = {
  perfumeId: string;
  perfumeNome: string;
  ml: number;
  quantidade: number;
  volumeTotalMl: number;
  concentracaoPercentual: number;
  requisitos: {
    insumoId: string;
    nome: string;
    categoria: string;
    unidade: string;
    necessario: number;
    disponivel: number;
    suficiente: boolean;
    custo: number;
  }[];
  faltantesConfiguracao: string[];
  faltantesEstoque: unknown[];
  custoTotal: number;
  custoPorFrasco: number;
  podeProduzir: boolean;
  producaoId?: string;
  registrada?: boolean;
};

export type CheckoutPayload = {
  itens: { perfumeId: string; ml: number; quantidade: number }[];
  cliente: string;
  contato: string;
  nomeCompleto: string;
  whatsapp: string;
  email: string;
  endereco?: {
    cep: string;
    endereco: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    estado: string;
  };
  formaPagamento: 'pix' | 'cartao';
  observacoes: string;
  aceitePrazoEncomenda: boolean;
  aceitePoliticaPrivacidade: boolean;
  salvarDadosParaProximaCompra: boolean;
  tipoEntrega: 'entrega' | 'retirada';
  freteEscolhido?: {
    serviceId: number;
  };
};

export type ConfiguracaoFrete = {
  taxaEmbalagem: number;
  cepOrigem: string;
  freteGratisAcima: number;
  ajustePadraoTipo: 'valor' | 'percentual';
  ajustePadraoValor: number;
  prazoPadraoDias: number;
  ajustePrioritarioTipo: 'valor' | 'percentual';
  ajustePrioritarioValor: number;
  prazoPrioritarioDias: number;
  diferencaMinimaPrioritario: number;
  integrado: boolean;
  aplicativoConfigurado: boolean;
  ambiente: 'sandbox' | 'producao';
};

export type ConfiguracoesLoja = {
  nomeLoja: string;
  logoUrl: string;
  whatsapp: string;
  instagram: string;
  email: string;
  pix: string;
  infinitePayHandle: string;
  cnpj: string;
  margemLucro: number;
};

export type ConfiguracoesLojaPublicas = Pick<
  ConfiguracoesLoja,
  'nomeLoja' | 'logoUrl' | 'whatsapp' | 'instagram' | 'email'
> & {
  cartaoOnlineAtivo: boolean;
  pixManualAtivo: boolean;
};

export type ConfirmacaoInfinitePay = {
  pago: boolean;
  pedido: Compra;
};
