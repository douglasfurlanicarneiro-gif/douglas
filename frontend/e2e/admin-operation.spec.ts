import { expect, test, type Page } from '@playwright/test';


async function mockAdminApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

    if (path === '/api/vitrine') return json({ atualizadoEm: null, itens: [] });
    if (path === '/api/admin/configuracoes/publicas') return json({
      nomeLoja: 'L’Essence Furlani',
      logoUrl: '',
      whatsapp: '',
      instagram: '',
      email: '',
      cartaoOnlineAtivo: true,
      pixManualAtivo: false,
    });
    if (path === '/api/admin/pedidos/reset-version') return json({ version: 1 });
    if (path === '/api/auth/login') return json({ ok: true, token: 'sessao-e2e' });
    if (path === '/api/auth/step-up') return json({ ok: true, token: 'stepup-e2e', expiresInSeconds: 300 });
    if (path === '/api/perfumes' && request.method() === 'GET') return json([
      { id: 'perfume-a', seq: 1, nome: 'Âmbar Noturno', prontaEntrega: true, precos: [] },
      { id: 'perfume-b', seq: 2, nome: 'Brisa Dourada', prontaEntrega: false, precos: [] },
    ]);
    if (path === '/api/perfumes' && request.method() === 'POST') {
      return json({ id: 'perfume-novo', seq: 3, ...request.postDataJSON() }, 201);
    }
    if (path === '/api/estoque/resumo') return json({
      'perfume-a': { saldoAtualMl: 150, reservadoMl: 30, disponivelMl: 120 },
      'perfume-b': { saldoAtualMl: 0, reservadoMl: 0, disponivelMl: 0 },
    });
    if (path === '/api/movimentos' && request.method() === 'POST') {
      return json({ id: 'movimento-novo', origem: 'manual', data: '2026-08-11T12:00:00Z', ...request.postDataJSON() }, 201);
    }
    if (path === '/api/estoque/conferir' && request.method() === 'POST') {
      return json({ alterado: true, saldoAnteriorMl: 150, saldoAtualMl: 180, diferencaMl: 30, movimento: null });
    }
    if (path === '/api/pedidos' && request.method() === 'GET') return json([{
      id: 'pedido-e2e',
      seq: 42,
      cliente: 'Cliente Kanban',
      contato: '11999999999',
      status: 'pendente',
      observacoes: '',
      itens: [{ perfumeId: 'perfume-a', nome: 'Âmbar Noturno', ml: 30, quantidade: 1, precoUnitario: 50 }],
      subtotalTabela: 50,
      ajusteManual: 0,
      total: 50,
      pagamento: {
        status: 'pago',
        metodo: 'cartao',
        provedor: 'infinitepay',
        transactionNsu: 'e2e-42',
        historico: [],
      },
      criadoEm: '2026-08-11T12:00:00Z',
    }]);
    if (path === '/api/pedidos/pedido-e2e' && request.method() === 'PUT') {
      return json({
        id: 'pedido-e2e',
        seq: 42,
        criadoEm: '2026-08-11T12:00:00Z',
        ...request.postDataJSON(),
      });
    }
    if (path === '/api/pagamentos/pedidos/pedido-e2e/operacoes' && request.method() === 'POST') {
      return json({
        id: 'pedido-e2e',
        seq: 42,
        cliente: 'Cliente Kanban',
        contato: '11999999999',
        status: 'pendente',
        observacoes: '',
        itens: [{ perfumeId: 'perfume-a', nome: 'Âmbar Noturno', ml: 30, quantidade: 1, precoUnitario: 50 }],
        subtotalTabela: 50,
        ajusteManual: 0,
        total: 50,
        pagamento: {
          status: 'estorno_solicitado',
          metodo: 'cartao',
          provedor: 'infinitepay',
          historico: [{ ...request.postDataJSON(), criadoEm: '2026-08-11T12:10:00Z' }],
        },
        criadoEm: '2026-08-11T12:00:00Z',
      });
    }
    if (path === '/api/admin/catalogo-estoque/disponibilidade' && request.method() === 'PUT') {
      return json({
        prontaEntrega: 2,
        sobEncomenda: 0,
        encontrados: ['perfume-a', 'perfume-b'],
        naoEncontrados: [],
      });
    }
    if (path === '/api/admin/operacao/resumo') return json({
      status: 'atencao',
      pagamentosFalhos: 1,
      pagamentosRevisaoManual: 1,
      pagamentosEmEspera: 2,
      pagamentosProcessando: 0,
      ultimoBackupEm: '2026-08-10T10:00:00Z',
      ultimaRestauracaoEm: null,
      falhasRecentes: [{
        id: 'evento-1',
        orderNsu: 'pedido-42',
        tentativas: 5,
        erro: 'gateway indisponível',
        ultimaTentativaEm: '2026-08-10T10:00:00Z',
      }],
    });
    if (path === '/api/admin/backup/validar' && request.method() === 'POST') {
      return json({
        valido: true,
        geradoEm: '2026-08-10T09:00:00Z',
        versao: 3,
        colecoes: { clientes: 2 },
        totalRegistros: 2,
      });
    }
    if (path === '/api/admin/backup/restaurar' && request.method() === 'POST') {
      if (request.headers()['x-atelie-step-up'] !== 'stepup-e2e') {
        return json({ detail: 'Reautenticação ausente.' }, 403);
      }
      return json({ status: 'Backup restaurado.', colecoes: { clientes: 2 }, totalRegistros: 2 });
    }
    if (path === '/api/admin/operacao/pagamentos/reprocessar-falhos') {
      return json({ status: 'Eventos reenfileirados.', reprocessados: 1 });
    }
    return json({ detail: `Mock opcional ausente para ${path}` }, 404);
  });
}


async function openAdminSystem(page: Page) {
  await page.goto('/');
  await page.getByTestId('atelie-access-button').click();
  await page.getByTestId('login-usuario').fill('admin');
  await page.getByTestId('login-senha').fill('senha-local');
  await page.getByTestId('login-submit').click();
  await expect(page.getByText('Administração')).toBeVisible();
  await page.getByTestId('tab-sistema').click();
  await expect(page.getByText('Saúde operacional')).toBeVisible();
}


test('painel mostra saúde, recuperação e valida o backup antes de restaurar', async ({ page }) => {
  await mockAdminApi(page);
  await openAdminSystem(page);

  await expect(page.getByText('Pedido pedido-42 · 5 tentativa(s)')).toBeVisible();
  await expect(page.getByText('Reprocessar confirmações com falha')).toBeVisible();
  await expect(page.getByText('Restaurar backup', { exact: true })).toBeVisible();

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByText('Restaurar backup', { exact: true }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('e2e/fixtures/test-backup.lfe');

  await expect(page.getByText(/Backup válido, gerado em/)).toBeVisible();
  await expect(page.getByText(/2 registro\(s\)/)).toBeVisible();
  await expect(page.getByText('Restaurar agora')).toBeVisible();
  await expect(page.getByTestId('critical-password')).toBeVisible();
  await page.getByTestId('critical-password').fill('senha-local');
  await page.getByText('Restaurar agora').click();
  await expect(page.getByText(/Backup restaurado com segurança: 2 registro/)).toBeVisible();
});


test('gerencia a disponibilidade e revisa antes de salvar', async ({ page }) => {
  await mockAdminApi(page);
  await openAdminSystem(page);

  await page.getByText('Gerenciar pronta entrega').click();
  await expect(page.getByTestId('availability-search')).toBeVisible();
  await expect(page.getByTestId('availability-perfume-a')).toBeVisible();

  await page.getByTestId('availability-search').fill('Brisa');
  await expect(page.getByTestId('availability-perfume-a')).toHaveCount(0);
  await page.getByTestId('availability-perfume-b').click();
  await page.getByTestId('availability-save').click();

  await expect(page.getByText(/Confirmar 2 perfume/)).toBeVisible();
  const saveRequest = page.waitForRequest((request) => (
    request.url().endsWith('/api/admin/catalogo-estoque/disponibilidade')
    && request.method() === 'PUT'
  ));
  await page.getByText('Salvar disponibilidade').click();
  const request = await saveRequest;
  expect(request.postDataJSON()).toEqual({ ids: ['perfume-a', 'perfume-b'] });
  await expect(page.getByText(/Disponibilidade salva: 2 em pronta entrega/)).toBeVisible();
});


test('move pedido pelo Kanban mantendo a transição esperada', async ({ page }) => {
  await mockAdminApi(page);
  await openAdminSystem(page);

  await page.getByTestId('tab-pedidos').click();
  await expect(page.getByTestId('kanban-pedido-pedido-e2e')).toBeVisible();

  const moveRequest = page.waitForRequest((request) => (
    request.url().endsWith('/api/pedidos/pedido-e2e')
    && request.method() === 'PUT'
  ));
  await page.getByTestId('kanban-pedido-pedido-e2e-avancar').click();
  const request = await moveRequest;
  expect(request.postDataJSON().status).toBe('pagamento_confirmado');
});


test('edita pedido preservando cálculo e valor final negociado', async ({ page }) => {
  await mockAdminApi(page);
  await openAdminSystem(page);

  await page.getByTestId('tab-pedidos').click();
  await page.getByTestId('kanban-pedido-pedido-e2e').getByText('Detalhes').click();
  await expect(page.getByTestId('pedido-cliente')).toHaveValue('Cliente Kanban');
  await page.getByTestId('pedido-cliente').fill('Cliente Atualizado');
  await page.getByTestId('pedido-valor-final').fill('45,00');

  const saveRequest = page.waitForRequest((request) => (
    request.url().endsWith('/api/pedidos/pedido-e2e')
    && request.method() === 'PUT'
  ));
  await page.getByTestId('pedido-save').click();
  const payload = (await saveRequest).postDataJSON();
  expect(payload).toMatchObject({
    cliente: 'Cliente Atualizado',
    subtotalTabela: 50,
    ajusteManual: -5,
    total: 45,
  });
  expect(payload.itens[0]).toMatchObject({ precoUnitario: 50, subtotal: 50 });
});


test('registra solicitação de estorno com motivo auditável', async ({ page }) => {
  await mockAdminApi(page);
  await openAdminSystem(page);

  await page.getByTestId('tab-pedidos').click();
  await page.getByTestId('kanban-pedido-pedido-e2e').getByText('Detalhes').click();
  await page.getByTestId('manage-payment').click();
  await page.getByPlaceholder('Ex.: cliente solicitou cancelamento').fill('Cliente desistiu da compra');

  const operationRequest = page.waitForRequest((request) => (
    request.url().endsWith('/api/pagamentos/pedidos/pedido-e2e/operacoes')
    && request.method() === 'POST'
  ));
  await page.getByTestId('payment-operation-save').click();
  const payload = (await operationRequest).postDataJSON();
  expect(payload).toEqual({
    operacao: 'solicitar_estorno',
    motivo: 'Cliente desistiu da compra',
    referencia: '',
  });
  await expect(page.getByText(/Situação financeira registrada: Estorno solicitado/)).toBeVisible();
});


test('mantém cadastro, movimentação e conferência de estoque funcionais', async ({ page }) => {
  await mockAdminApi(page);
  await openAdminSystem(page);

  await page.getByTestId('tab-catalogo').click();
  await page.getByTestId('fab-add').click();
  await page.getByTestId('perfume-nome').fill('Novo Perfume E2E');
  const createRequest = page.waitForRequest((request) => request.url().endsWith('/api/perfumes') && request.method() === 'POST');
  await page.getByTestId('perfume-save').click();
  expect((await createRequest).postDataJSON().nome).toBe('Novo Perfume E2E');

  await page.getByTestId('tab-estoque').click();
  await page.getByTestId('fab-add').click();
  await page.getByTestId('mov-qtd').fill('125');
  const movementRequest = page.waitForRequest((request) => request.url().endsWith('/api/movimentos') && request.method() === 'POST');
  await page.getByTestId('mov-save').click();
  expect((await movementRequest).postDataJSON().quantidadeMl).toBe(125);

  await page.getByText('Conferir quantidade física').first().click();
  await page.getByTestId('stock-count-quantity').fill('180');
  const countRequest = page.waitForRequest((request) => request.url().endsWith('/api/estoque/conferir') && request.method() === 'POST');
  await page.getByTestId('stock-count-save').click();
  expect((await countRequest).postDataJSON()).toMatchObject({
    perfumeId: 'perfume-a',
    quantidadeFisicaMl: 180,
    saldoEsperadoMl: 150,
  });
});
