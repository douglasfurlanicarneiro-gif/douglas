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
    if (path === '/api/perfumes') return json([
      { id: 'perfume-a', seq: 1, nome: 'Âmbar Noturno', prontaEntrega: true, precos: [] },
      { id: 'perfume-b', seq: 2, nome: 'Brisa Dourada', prontaEntrega: false, precos: [] },
    ]);
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
