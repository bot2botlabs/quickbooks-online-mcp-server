import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickbooksClientClass, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

const { updateQuickbooksInvoice } = await import('../../../src/handlers/update-quickbooks-invoice.handler');

const line = (id: string) => ({
  Id: id,
  Amount: 10,
  DetailType: 'SalesItemLineDetail',
  SalesItemLineDetail: {
    ItemRef: { value: 'item-1' },
    Qty: 2,
    UnitPrice: 5,
    ClassRef: { value: '682828' },
    TaxCodeRef: { value: 'NON' },
    ServiceDate: '2026-01-01',
  },
});

const currentInvoice = {
  Id: 'inv-1',
  SyncToken: '3',
  Line: [line('1'), line('2')],
};

describe('updateQuickbooksInvoice line_items (#141)', () => {
  beforeEach(() => {
    resetAllMocks();
    mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) => cb(null, {}));
  });

  it('header-only patch omits Line from payload', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    let sent: any;
    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) => {
      sent = payload;
      cb(null, payload);
    });

    await updateQuickbooksInvoice({ invoice_id: 'inv-1', patch: { PrivateNote: 'note' } });

    expect(sent.Line).toBeUndefined();
    expect(sent.PrivateNote).toBe('note');
    expect(sent.SyncToken).toBe('3');
  });

  it('rejects partial patch.Line without replace_all_lines', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    const result = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { Line: [line('1')] },
    });
    expect(result.isError).toBe(true);
    expect(result.error).toContain('line_items');
    expect(mockQuickBooksInstance.updateInvoice).not.toHaveBeenCalled();
  });

  it('allows partial patch.Line with replace_all_lines and complete patch.Line', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) => cb(null, payload));
    const partial = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { Line: [line('1')] },
      replace_all_lines: true,
    });
    expect(partial.isError).toBe(false);

    const complete = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { Line: [line('1'), line('2')] },
    });
    expect(complete.isError).toBe(false);
  });

  it('patch.Line with matching sync_token omits sync_token and uses server SyncToken', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    let sent: any;
    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) => {
      sent = payload;
      cb(null, payload);
    });
    await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { sync_token: '3', Line: [line('1'), line('2')] },
    });
    expect(sent.sync_token).toBeUndefined();
    expect(sent.SyncToken).toBe('3');
    expect(sent.sparse).toBe(true);
    expect(sent.Line).toHaveLength(2);
    expect(mockQuickBooksInstance.updateInvoice).toHaveBeenCalledTimes(1);
  });

  it('partial patch.Line with replace_all_lines strips matching sync_token', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    let sent: any;
    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) => {
      sent = payload;
      cb(null, payload);
    });
    await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { sync_token: '3', Line: [line('1')] },
      replace_all_lines: true,
    });
    expect(sent).not.toHaveProperty('sync_token');
    expect(sent.SyncToken).toBe('3');
    expect(sent.Line).toHaveLength(1);
  });

  it('stale sync token on patch.Line path skips update', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    mockQuickBooksInstance.updateInvoice.mockClear();

    const staleCamel = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { SyncToken: '0', Line: [line('1'), line('2')] },
    });
    expect(staleCamel.isError).toBe(true);

    const staleSnake = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { sync_token: '0', Line: [line('1'), line('2')] },
    });
    expect(staleSnake.isError).toBe(true);
    expect(mockQuickBooksInstance.updateInvoice).not.toHaveBeenCalled();
  });

  it('rejects patch.Line with line_items', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    const result = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { Line: [line('1'), line('2')] },
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(result.isError).toBe(true);
    expect(mockQuickBooksInstance.updateInvoice).not.toHaveBeenCalled();
  });

  it('line_items edit sends full Line array with both lines', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    let sent: any;
    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) => {
      sent = payload;
      cb(null, payload);
    });

    await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { PrivateNote: 'hdr' },
      line_items: [{ id: '1', qty: 4 }],
    });

    expect(sent.Line.length).toBe(2);
    expect(sent.Line[0].SalesItemLineDetail.Qty).toBe(4);
    expect(sent.Line[1]).toEqual(currentInvoice.Line[1]);
    expect(sent.PrivateNote).toBe('hdr');
  });

  it('validates class_ref and buildMergedLines before write', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    const badClass = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      line_items: [{ id: '1', class_ref: 'not-numeric' }],
    });
    expect(badClass.isError).toBe(true);

    const badId = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      line_items: [{ id: 'missing', qty: 1 }],
    });
    expect(badId.isError).toBe(true);
    expect(mockQuickBooksInstance.updateInvoice).not.toHaveBeenCalled();
  });

  it('post-write ClassRef drop returns isError with entity', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) =>
      cb(null, {
        ...payload,
        Line: [
          {
            Id: '1',
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: { ItemRef: { value: 'item-1' } },
          },
          payload.Line[1],
        ],
      })
    );
    const result = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      line_items: [{ id: '1', qty: 4 }],
    });
    expect(result.isError).toBe(true);
    expect(result.error).toContain('ClassRef');
  });

  it('AST TaxCodeRef drop yields warning not error', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) =>
      cb(null, {
        ...currentInvoice,
        Line: [
          {
            Id: '1',
            DetailType: 'SalesItemLineDetail',
            Amount: 10,
            SalesItemLineDetail: { ItemRef: { value: 'item-1' }, Qty: 2, UnitPrice: 5, TaxCodeRef: { value: 'NON' } },
          },
        ],
      })
    );
    mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) =>
      cb(null, { TaxPrefs: { PartnerTaxEnabled: true } })
    );
    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) =>
      cb(null, {
        Line: [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: 'item-1' } } }],
      })
    );
    const result = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      line_items: [{ id: '1', qty: 2 }],
    });
    expect(result.isError).toBe(false);
    expect((result.result as any)._warning).toContain('Automated Sales Tax');
  });

  it('surfaces getInvoice and updateInvoice errors', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(new Error('read fail'), null));
    const read = await updateQuickbooksInvoice({ invoice_id: 'inv-1', patch: {} });
    expect(read.isError).toBe(true);

    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    mockQuickBooksInstance.updateInvoice.mockImplementation((_p: any, cb: any) => cb(new Error('write fail'), null));
    const write = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(write.isError).toBe(true);
  });

  it('handles authentication errors', async () => {
    (mockQuickbooksClientClass.getInstance as any).mockRejectedValue(new Error('Auth failed'));
    const result = await updateQuickbooksInvoice({ invoice_id: 'inv-1', patch: {} });
    expect(result.isError).toBe(true);
  });

  it('line_items works when read returns no Line array', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) =>
      cb(null, { Id: 'inv-1', SyncToken: '3' })
    );
    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) => cb(null, payload));
    const result = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      line_items: [{ item_ref: 'item-1', qty: 1, unit_price: 4 }],
    });
    expect(result.isError).toBe(false);
  });

  it('line_items post-write warning path', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) =>
      cb(null, {
        Id: 'inv-1',
        SyncToken: '3',
        Line: [
          {
            Id: '1',
            DetailType: 'SalesItemLineDetail',
            Amount: 5,
            SalesItemLineDetail: { ItemRef: { value: 'item-1' }, Qty: 1, UnitPrice: 5, TaxCodeRef: { value: 'NON' } },
          },
        ],
      })
    );
    mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) =>
      cb(null, { TaxPrefs: { PartnerTaxEnabled: true } })
    );
    mockQuickBooksInstance.updateInvoice.mockImplementation((_payload: any, cb: any) =>
      cb(null, {
        Line: [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: 'item-1' } } }],
      })
    );
    const result = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(result.isError).toBe(false);
    expect((result.result as any)._warning).toBeDefined();
  });

  it('patch.Line guard uses empty Line list when invoice has no Line', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) =>
      cb(null, { Id: 'inv-1', SyncToken: '3' })
    );
    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) => cb(null, payload));
    const result = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { Line: [] },
      replace_all_lines: true,
    });
    expect(result.isError).toBe(false);
  });

  it('rejects stale patch.SyncToken before write and accepts matching token', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));

    const stale = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { SyncToken: '0', PrivateNote: 'x' },
    });
    expect(stale.isError).toBe(true);
    expect(stale.error).toContain('stale sync_token');
    expect(mockQuickBooksInstance.updateInvoice).not.toHaveBeenCalled();

    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) => cb(null, payload));
    const ok = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { SyncToken: '3', PrivateNote: 'ok' },
    });
    expect(ok.isError).toBe(false);
    expect(mockQuickBooksInstance.updateInvoice).toHaveBeenCalled();
  });

  it('strips sync_token from patch body and sends only server SyncToken', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    let sent: any;
    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) => {
      sent = payload;
      cb(null, payload);
    });
    await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { sync_token: '3', PrivateNote: 'ok' },
    });
    expect(sent.SyncToken).toBe('3');
    expect(sent).not.toHaveProperty('sync_token');
  });

  it('rejects stale patch.sync_token on line_items path', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    const result = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { sync_token: '0' },
      line_items: [{ id: '1', qty: 2 }],
    });
    expect(result.isError).toBe(true);
    expect(mockQuickBooksInstance.updateInvoice).not.toHaveBeenCalled();
  });

  it('rejects patch.Id that differs from invoice_id before any write', async () => {
    const result = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { Id: 'other-inv', PrivateNote: 'x' },
    });
    expect(result.isError).toBe(true);
    expect(result.error).toContain('must match');
    expect(mockQuickBooksInstance.getInvoice).not.toHaveBeenCalled();
  });

  it('header-only patch ignores sparse:false and keeps Id and sparse:true', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    let sent: any;
    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) => {
      sent = payload;
      cb(null, payload);
    });
    await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { sparse: false, PrivateNote: 'safe' },
    });
    expect(sent.Id).toBe('inv-1');
    expect(sent.sparse).toBe(true);
    expect(sent.PrivateNote).toBe('safe');
  });

  it('line_items patch ignores sparse:false override in patch body', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    let sent: any;
    mockQuickBooksInstance.updateInvoice.mockImplementation((payload: any, cb: any) => {
      sent = payload;
      cb(null, payload);
    });
    await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { sparse: false, PrivateNote: 'hdr' },
      line_items: [{ id: '1', qty: 3 }],
    });
    expect(sent.Id).toBe('inv-1');
    expect(sent.sparse).toBe(true);
    expect(sent.Line.length).toBe(2);
    expect(mockQuickBooksInstance.updateInvoice).toHaveBeenCalled();
  });

  it('handles update errors on patch.Line and header-only paths', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, currentInvoice));
    mockQuickBooksInstance.updateInvoice.mockImplementation((_p: any, cb: any) => cb(new Error('patch fail'), null));
    const patchLine = await updateQuickbooksInvoice({
      invoice_id: 'inv-1',
      patch: { Line: [line('1'), line('2')] },
    });
    expect(patchLine.isError).toBe(true);

    const header = await updateQuickbooksInvoice({ invoice_id: 'inv-1', patch: { PrivateNote: 'x' } });
    expect(header.isError).toBe(true);
  });
});
