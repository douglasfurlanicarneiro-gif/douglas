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
  options: { catalogDelayMs?: number; catalogFailures?: number; brokenImage?: boolean; confirmedOrder?: boolean } = {},
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
      return json(options.brokenImage ? {
        ...catalog,
        itens: catalog.itens.map((item, index) => (
          index === 0 ? { ...item, imagemUrl: '/imagem-quebrada.avif' } : item
        )),
      } : catalog);
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
      { categoriaFrete: 'prioritaria', nomeExibicao: 'Entrega Prioritária', serviceId: 1, transportadora: 'Jadlog', servico: 'Package', precoTransportadora: 18.9, taxaEmbalagem: 6, preco: 27.9, prazoDias: 4 },
    ] });
    if (path === '/api/cupons/validar' && request.method() === 'POST') {
      const { codigo } = request.postDataJSON() as { codigo: string };
      if (codigo !== 'BEMVINDO10') return json({ detail: 'Cupom inválido ou indisponível.' }, 400);
      return json({ codigo: 'BEMVINDO10', percentual: 10, descricao: 'Boas-vindas' });
    }
    if (path === '/api/compras' && request.method() === 'POST') {
      state.checkout = request.postDataJSON();
      return json({
        id: 'order-1', seq: 1, codigoAcompanhamento: 'TESTE123', status: options.confirmedOrder ? 'pagamento_confirmado' : 'pendente',
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

test('abre com parâmetros de URL Unicode e malformados sem travar', async ({ page }) => {
  await mockApi(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?nome=Jo%C3%A3o+Silva&token=a%2Bb&invalido=' + '%FF'.repeat(150));
  await expect(page.getByTestId('vitrine-card-ready')).toBeVisible();
  await page.getByTestId('filter-made-to-order').click();
  await expect(page.getByTestId('vitrine-card-order')).toBeVisible();
  expect(errors).toEqual([]);
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

test('mantém checkout aberto ao fechar privacidade por teclado', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page);
  await openStore(page);
  await page.getByTestId('buy-ready-50').click();
  await fillCustomer(page);
  await page.getByTestId('delivery-method-retirada').click();
  await page.getByTestId('checkout-to-payment').click();
  const privacyLink = page.getByTestId('open-privacy-notice');
  await privacyLink.click();
  const close = page.getByRole('button', { name: 'Fechar Privacidade e seus dados', exact: true });
  await expect(close).toBeVisible();
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(close).toHaveCount(0);
  await expect(privacyLink).toBeVisible();
  await expect(privacyLink).toBeFocused();
  await expect(page.getByTestId('checkout-submit')).toBeVisible();
});

test('anuncia erro de cupom e permite corrigir sem perder os dados', async ({ page }) => {
  await mockApi(page);
  await openStore(page);
  await page.getByTestId('buy-ready-50').click();
  await fillCustomer(page);
  await page.getByTestId('delivery-method-retirada').click();
  await page.getByTestId('checkout-to-payment').click();
  await page.getByTestId('checkout-coupon-toggle').click();
  await page.getByTestId('checkout-coupon-input').fill('INVALIDO');
  await page.getByTestId('checkout-coupon-apply').click();
  await expect(page.getByRole('alert')).toContainText('Cupom inválido');
  await page.getByTestId('checkout-coupon-input').fill('BEMVINDO10');
  await page.getByTestId('checkout-coupon-apply').click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('checkout-coupon-section')).toContainText('10% de desconto');
});

test('bloqueia reenvio enquanto o pedido está sendo processado', async ({ page }) => {
  await mockApi(page);
  let requests = 0;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/compras', async (route) => {
    requests += 1;
    await pending;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Tente novamente em instantes.' }) });
  });
  await openStore(page);
  await page.getByTestId('buy-ready-50').click();
  await fillCustomer(page);
  await page.getByTestId('delivery-method-retirada').click();
  await page.getByTestId('checkout-to-payment').click();
  await page.getByTestId('accept-privacy-notice').click();
  const submit = page.getByTestId('checkout-submit');
  try {
    await submit.click();
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Enter');
    await expect.poll(() => requests).toBe(1);
  } finally { release(); }
  await expect(page.getByRole('alert')).toContainText('Tente novamente');
  await expect(submit).toBeEnabled();
});

test('campos de toque legíveis e cupom com nome acessível', async ({ page }, testInfo) => {
  await mockApi(page);
  await openStore(page);
  await page.getByTestId('buy-ready-50').click();
  if (testInfo.project.name === 'celular') {
    const size = await page.getByTestId('checkout-name').evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  }
  await fillCustomer(page);
  await page.getByTestId('delivery-method-retirada').click();
  await page.getByTestId('checkout-to-payment').click();
  await page.getByTestId('checkout-coupon-toggle').click();
  await expect(page.getByRole('textbox', { name: 'Código do cupom de desconto', exact: true })).toBeVisible();
});

test('mantém filtros e catálogo legíveis', async ({ page }, testInfo) => {
  await mockApi(page);
  await openStore(page);
  await expect(page.getByTestId('filter-ready-delivery')).toContainText(/Pronta(?: entrega)?/);
  await expect(page.getByTestId('filter-made-to-order')).toContainText(/(?:Sob )?encomenda/i);
  await expect(page.getByTestId('filter-favorites')).toContainText('Favoritos');
  await expect(page.getByTestId('filter-open')).toContainText('Filtros');

  const filterLabels = await Promise.all([
    page.getByTestId('filter-ready-delivery').innerText(),
    page.getByTestId('filter-made-to-order').innerText(),
    page.getByTestId('filter-favorites').innerText(),
    page.getByTestId('filter-open').innerText(),
  ]);
  expect(filterLabels.every((label) => !label.includes('…'))).toBe(true);
  const viewport = page.viewportSize();
  if ((viewport?.width || 0) >= 360) {
    expect(filterLabels.map((label) => label.split('\n').at(-1)?.trim())).toEqual([
      'Pronta entrega', 'Sob encomenda', 'Favoritos', 'Filtros',
    ]);
  }
  for (const testId of ['filter-ready-delivery', 'filter-made-to-order', 'filter-favorites', 'filter-open']) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x || 0).toBeGreaterThanOrEqual(0);
    expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(viewport?.width || 0);
  }
  await expect(page.getByTestId('contact-fab')).toContainText('Ajuda');
  await expect(page.getByTestId('launch-intro')).toBeHidden();
  await expect(page.locator('#brand-preloader')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('vitrine.png') });
  await page.getByTestId('details-ready').scrollIntoViewIfNeeded();
  await page.getByTestId('details-ready').click();
  await expect(page.getByText('ESCOLHA O TAMANHO')).toBeVisible();
});

test('adapta os filtros sem vazamento em telefones estreitos', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockApi(page);
  await openStore(page);
  await expect(page.getByTestId('filter-ready-delivery')).toContainText('Pronta');
  await expect(page.getByTestId('filter-made-to-order')).toContainText('Sob encomenda');
  for (const testId of ['filter-ready-delivery', 'filter-made-to-order', 'filter-favorites', 'filter-open']) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x || 0).toBeGreaterThanOrEqual(0);
    expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(320);
  }
  await expect(page.getByTestId('launch-intro')).toBeHidden();
  await expect(page.locator('#brand-preloader')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('vitrine-320.png') });
});

test('mostra uma alternativa elegante quando a foto externa falha', async ({ page }) => {
  await mockApi(page, { brokenImage: true });
  await openStore(page);
  await expect(page.getByText('Imagem indisponível')).toBeVisible();
});

test('explica com clareza os prazos de pronta entrega e sob encomenda', async ({ page }) => {
  await mockApi(page);
  await openStore(page);
  await page.getByTestId('contact-fab').click();
  await page.getByTestId('contact-faq').click();
  await page.getByTestId('faq-item-1').click();
  await expect(page.getByTestId('faq-sheet')).toContainText('Pronta entrega estão disponíveis em estoque');
  await expect(page.getByTestId('faq-sheet')).toContainText('Sob encomenda podem levar até 14 dias');
  await expect(page.getByTestId('faq-sheet')).toContainText('acrescente o prazo da transportadora exibido no checkout');
});

test('calcula frete, total e envia checkout completo', async ({ page }) => {
  const state = await mockApi(page);
  await openStore(page);
  await page.getByTestId('buy-ready-50').click();
  const sheetBox = await page.getByTestId('checkout-sheet').boundingBox();
  const viewport = page.viewportSize();
  expect(sheetBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if ((viewport?.width || 0) >= 900) {
    expect(sheetBox?.width || 0).toBeLessThanOrEqual(1120);
    expect(Math.abs((sheetBox?.x || 0) - ((viewport?.width || 0) - (sheetBox?.width || 0)) / 2)).toBeLessThanOrEqual(2);
  } else {
    expect(sheetBox?.width || 0).toBeGreaterThanOrEqual((viewport?.width || 0) - 2);
  }
  await fillCustomer(page);
  await page.getByTestId('checkout-cep').fill('03069000');
  await expect(page.getByTestId('checkout-street')).toHaveValue('Rua de Teste');
  await page.getByTestId('checkout-number').fill('112');
  await expect(page.getByTestId('shipping-option-padrao')).toBeVisible();
  await expect(page.getByTestId('shipping-option-prioritaria')).toBeVisible();
  await page.getByTestId('shipping-option-padrao').click();
  await page.getByTestId('checkout-to-payment').click();
  await expect(page.getByTestId('checkout-sheet')).toContainText('Você será direcionado à InfinitePay para pagar com Pix ou cartão.');
  await expect(page.getByTestId('checkout-sheet')).toContainText('Perfume Pronta Entrega');
  await expect(page.getByTestId('checkout-sheet')).toContainText('R$ 109,90');
  const paymentDetailsBox = await page.getByTestId('checkout-payment-details-column').boundingBox();
  const paymentSummaryBox = await page.getByTestId('checkout-payment-summary-column').boundingBox();
  expect(paymentDetailsBox).not.toBeNull();
  expect(paymentSummaryBox).not.toBeNull();
  if ((viewport?.width || 0) >= 768) {
    expect(paymentSummaryBox?.x || 0).toBeGreaterThan((paymentDetailsBox?.x || 0) + (paymentDetailsBox?.width || 0));
    expect(Math.abs((paymentSummaryBox?.y || 0) - (paymentDetailsBox?.y || 0))).toBeLessThanOrEqual(2);
  } else {
    expect(paymentSummaryBox?.y || 0).toBeGreaterThanOrEqual((paymentDetailsBox?.y || 0) + (paymentDetailsBox?.height || 0));
  }
  await page.getByTestId('accept-privacy-notice').click();
  await expect(page.getByTestId('checkout-submit')).toBeEnabled();
  await page.getByTestId('checkout-submit').click();
  await expect.poll(() => state.checkout).not.toBeNull();
  expect(state.checkout).toMatchObject({
    cliente: 'Cliente Teste', contato: '11999999999',
    tipoEntrega: 'entrega', freteEscolhido: { serviceId: 1, categoriaFrete: 'padrao' },
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
  await expect(page.getByTestId('made-to-order-deadline-notice')).toContainText('Preparação: até 14 dias');
  await expect(page.getByTestId('made-to-order-deadline-notice')).toContainText('acrescente o prazo da transportadora exibido acima');
  await expect(page.getByTestId('made-to-order-deadline-notice')).toContainText('Li e concordo com o prazo de até 14 dias.');
  await page.getByTestId('accept-privacy-notice').click();
  await expect(page.getByTestId('checkout-submit')).toBeDisabled();
  await page.getByTestId('accept-made-to-order-deadline').click();
  await expect(page.getByTestId('checkout-submit')).toBeEnabled();
});

test('pedido confirmado não oferece cobrança mesmo com gateway desatualizado', async ({ page }) => {
  await mockApi(page, { confirmedOrder: true });
  await openStore(page);
  await page.getByTestId('buy-ready-50').click();
  await fillCustomer(page);
  await page.getByTestId('delivery-method-retirada').click();
  await page.getByTestId('checkout-to-payment').click();
  await page.getByTestId('accept-privacy-notice').click();
  await page.getByTestId('checkout-submit').click();
  await expect(page.getByTestId('order-success-sheet')).toContainText('Pagamento confirmado!');
  await expect(page.getByTestId('continue-infinitepay')).toHaveCount(0);
  await expect(page.getByTestId('copy-pix-code')).toHaveCount(0);
  await expect(page).not.toHaveURL(/checkout\.infinitepay/);
});

test('aplica cupom somente nos perfumes e envia o código no checkout', async ({ page }) => {
  const state = await mockApi(page);
  await openStore(page);
  await page.getByTestId('buy-ready-50').click();
  await fillCustomer(page);
  await page.getByTestId('delivery-method-retirada').click();
  await page.getByTestId('checkout-to-payment').click();
  await expect(page.getByTestId('checkout-payment-summary')).toContainText('Retirada combinada');
  await page.getByTestId('checkout-coupon-toggle').click();
  await page.getByTestId('checkout-coupon-input').fill('bemvindo10');
  await page.getByTestId('checkout-coupon-apply').click();

  await expect(page.getByTestId('checkout-coupon-input')).toBeHidden();
  await page.getByTestId('checkout-coupon-remove').click();
  await expect(page.getByTestId('checkout-coupon-input')).toBeVisible();
  await expect(page.getByTestId('checkout-discount-row')).toBeHidden();
  await page.getByTestId('checkout-coupon-input').fill('bemvindo10');
  await page.getByTestId('checkout-coupon-apply').click();

  await expect(page.getByTestId('checkout-notes-input')).toBeHidden();
  await page.getByTestId('checkout-notes-toggle').click();
  await page.getByTestId('checkout-notes-input').fill('Embrulhar para presente');
  await page.getByTestId('checkout-notes-toggle').click();
  await page.getByTestId('checkout-notes-toggle').click();
  await expect(page.getByTestId('checkout-notes-input')).toHaveValue('Embrulhar para presente');

  await expect(page.getByTestId('checkout-discount-row')).toContainText('10% de desconto');
  await expect(page.getByTestId('checkout-discount-row')).toContainText('R$ 8,50');
  await expect(page.getByTestId('checkout-sheet')).toContainText('R$ 76,50');

  await page.getByTestId('accept-privacy-notice').click();
  await page.getByTestId('checkout-submit').click();
  await expect.poll(() => state.checkout).not.toBeNull();
  expect(state.checkout).toMatchObject({
    cupomCodigo: 'BEMVINDO10',
    observacoes: 'Embrulhar para presente',
    tipoEntrega: 'retirada',
    itens: [{ perfumeId: 'ready', ml: 50, quantidade: 1 }],
  });
});
