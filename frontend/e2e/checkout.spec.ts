import { expect, test, type Page } from '@playwright/test';

const catalog = {
  atualizadoEm: '2026-08-10T12:00:00Z',
  itens: [
    {
      id: 'ready', seq: 1, nome: 'Perfume Pronta Entrega', genero: 'Masculino',
      familiaOlfativa: 'Aromático', familiasOlfativas: ['Aromático'], concentracao: 'Eau De Parfum',
      ocasioes: ['Noite', 'Festa'], notasSaida: 'Limão', notasCoracao: 'Lavanda', notasFundo: 'Âmbar',
      imagemUrl: '/perfume-images/perfume-001.avif',
      prontaEntrega: true, tamanhosDisponiveisMl: [30, 50, 100],
      precos: [{ ml: 30, preco: 50 }, { ml: 50, preco: 85 }, { ml: 100, preco: 160 }],
    },
    {
      id: 'order', seq: 2, nome: 'Perfume Sob Encomenda', genero: 'Feminino',
      familiaOlfativa: 'Floral', familiasOlfativas: ['Floral'], concentracao: 'Eau De Parfum',
      ocasioes: ['Dia'], notasSaida: 'Pera', notasCoracao: 'Jasmim', notasFundo: 'Baunilha',
      imagemUrl: '/perfume-images/perfume-002.avif',
      prontaEntrega: false, tamanhosDisponiveisMl: [30, 50, 100],
      precos: [{ ml: 30, preco: 50 }, { ml: 50, preco: 85 }, { ml: 100, preco: 160 }],
    },
  ],
};

async function mockApi(
  page: Page,
  options: { catalogDelayMs?: number; catalogFailures?: number } = {},
) {
  const state: { checkout: Record<string, unknown> | null } = { checkout: null };
  let catalogRequests = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/vitrine') {
      catalogRequests += 1;
      if (catalogRequests <= (options.catalogFailures || 0)) {
        return json({ detail: 'Servidor acordando' }, 503);
      }
      if (options.catalogDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.catalogDelayMs));
      }
      return json(catalog);
    }
    if (path === '/api/admin/configuracoes/publicas') return json({
      nomeLoja: 'L’Essence Furlani', logoUrl: '', whatsapp: '5511999999999', instagram: '', email: '',
      cartaoOnlineAtivo: true, pixManualAtivo: false,
    });
    if (path === '/api/admin/pedidos/reset-version') return json({ version: 1 });
    if (path === '/api/cep/03069000') return json({
      cep: '03069-000', endereco: 'Rua de Teste', bairro: 'Tatuapé', cidade: 'São Paulo', estado: 'SP',
    });
    if (path === '/api/frete/cotar') return json({ opcoes: [
      { categoriaFrete: 'padrao', nomeExibicao: 'Entrega Padrão', serviceId: 1, transportadora: 'Jadlog', servico: 'Package', precoTransportadora: 18.9, taxaEmbalagem: 6, preco: 24.9, prazoDias: 6 },
      { categoriaFrete: 'prioritaria', nomeExibicao: 'Entrega Prioritária', serviceId: 2, transportadora: 'Jadlog', servico: 'Com', precoTransportadora: 21.9, taxaEmbalagem: 6, preco: 27.9, prazoDias: 4 },
    ] });
    if (path === '/api/compras' && request.method() === 'POST') {
      state.checkout = request.postDataJSON();
      return json({
        id: 'order-1', seq: 1, codigoAcompanhamento: 'TESTE123', status: 'pendente',
        cliente: 'Cliente Teste', contato: '11999999999', total: 109.9,
        pagamento: { provedor: 'infinitepay', status: 'aguardando_pagamento', checkoutUrl: 'https://checkout.infinitepay.com.br/teste' },
      });
    }
    return json({ detail: `Mock ausente para ${path}` }, 404);
  });
  await page.route('https://checkout.infinitepay.com.br/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Pagamento seguro</title>' }));
  return state;
}

async function openStore(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('vitrine-card-ready')).toBeVisible();
}

test('mantém a abertura visível enquanto o catálogo carrega', async ({ page }) => {
  await mockApi(page, { catalogDelayMs: 1200 });
  await page.goto('/');
  await expect(page.getByLabel('Carregando vitrine')).toBeVisible();
  await expect(page.getByTestId('vitrine-card-ready')).toBeVisible();
});

test('recupera automaticamente quando o servidor está acordando', async ({ page }) => {
  await mockApi(page, { catalogFailures: 1 });
  await openStore(page);
  await expect(page.getByLabel('Carregando vitrine')).toHaveCount(0);
});

async function fillCustomer(page: Page) {
  await page.getByTestId('checkout-name').fill('Cliente Teste');
  await page.getByTestId('checkout-whatsapp').fill('11999999999');
  await page.getByTestId('checkout-email').fill('cliente@teste.com.br');
  await page.getByTestId('checkout-to-delivery').click();
}

test('mantém filtros e catálogo legíveis', async ({ page }) => {
  await mockApi(page);
  await openStore(page);
  await expect(page.getByTestId('filter-ready-delivery')).toContainText('Pronta entrega');
  await expect(page.getByTestId('filter-made-to-order')).toContainText('Sob encomenda');
  await expect(page.getByTestId('filter-favorites')).toContainText('Favoritos');
  await expect(page.getByTestId('filter-open')).toContainText('Filtros');
});

test('calcula frete, total e envia checkout completo', async ({ page }) => {
  const state = await mockApi(page);
  await openStore(page);
  await page.getByTestId('buy-ready-50').click();
  await fillCustomer(page);
  await page.getByTestId('checkout-cep').fill('03069000');
  await expect(page.getByTestId('checkout-street')).toHaveValue('Rua de Teste');
  await page.getByTestId('checkout-number').fill('112');
  await expect(page.getByTestId('shipping-option-padrao')).toBeVisible();
  await page.getByTestId('shipping-option-padrao').click();
  await page.getByTestId('checkout-to-payment').click();
  await expect(page.getByTestId('checkout-sheet')).toContainText('Perfume Pronta Entrega');
  await expect(page.getByTestId('checkout-sheet')).toContainText('R$ 109,90');
  await page.getByTestId('accept-privacy-notice').click();
  await expect(page.getByTestId('checkout-submit')).toBeEnabled();
  await page.getByTestId('checkout-submit').click();
  await expect.poll(() => state.checkout).not.toBeNull();
  expect(state.checkout).toMatchObject({
    cliente: 'Cliente Teste', contato: '11999999999',
    tipoEntrega: 'entrega', freteEscolhido: { serviceId: 1 },
    itens: [{ perfumeId: 'ready', ml: 50, quantidade: 1 }],
  });
});

test('exige aceite do prazo para produto sob encomenda', async ({ page }) => {
  await mockApi(page);
  await openStore(page);
  await page.getByTestId('filter-made-to-order').click();
  await expect(page.getByTestId('vitrine-card-order')).toBeVisible();
  await page.getByTestId('buy-order-30').click();
  await fillCustomer(page);
  await page.getByTestId('delivery-method-retirada').click();
  await page.getByTestId('checkout-to-payment').click();
  await expect(page.getByTestId('made-to-order-deadline-notice')).toBeVisible();
  await page.getByTestId('accept-privacy-notice').click();
  await expect(page.getByTestId('checkout-submit')).toBeDisabled();
  await page.getByTestId('accept-made-to-order-deadline').click();
  await expect(page.getByTestId('checkout-submit')).toBeEnabled();
});
