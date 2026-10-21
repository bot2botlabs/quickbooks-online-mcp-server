import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickbooksClientClass, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

const { updateQuickbooksEstimate } = await import('../../../src/handlers/update-quickbooks-estimate.handler');

const line = (id: string) => ({
  Id: id,
  Amount: 10,
  DetailType: 'SalesItemLineDetail',
  SalesItemLineDetail: { ItemRef: { value: 'item-1' }, Qty: 2, UnitPrice: 5 },
});

const current = { Id: 'est-1', SyncToken: '2', Line: [line('1'), line('2')] };

describe('updateQuickbooksEstimate line_items (#141)', () => {
  beforeEach(() => {
    resetAllMocks();
    mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) => cb(null, {}));
  });

  it('legacy estimate-only payload still works', async () => {
    mockQuickBooksInstance.updateEstimate.mockImplementation((payload: any, cb: any) => cb(null, payload));
    const result = await updateQuickbooksEstimate({ Id: 'est-1', SyncToken: '2', PrivateNote: 'x' });
    expect(result.isError).toBe(false);
  });

  it('requires estimate.Id for line_items', async () => {
    const result = await updateQuickbooksEstimate({ estimate: {}, line_items: [{ id: '1', qty: 1 }] });
    expect(result.isError).toBe(true);
  });

  it('rejects estimate.Line with line_items', async () => {
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', Line: [line('1')] },
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(result.isError).toBe(true);
  });

  it('guards partial estimate.Line like invoice patch', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '2', Line: [line('1')] },
    });
    expect(result.isError).toBe(true);
    expect(result.error).toContain('estimate.Line');
  });

  it('allows replace_all_lines on estimate.Line', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    mockQuickBooksInstance.updateEstimate.mockImplementation((payload: any, cb: any) => cb(null, payload));
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '2', Line: [line('1')] },
      replace_all_lines: true,
    });
    expect(result.isError).toBe(false);
  });

  it('strips sync_token from estimate body on line_items write', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) => cb(null, {}));
    let sent: any;
    mockQuickBooksInstance.updateEstimate.mockImplementation((payload: any, cb: any) => {
      sent = payload;
      cb(null, payload);
    });
    await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', sync_token: '2', PrivateNote: 'n' },
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(sent.SyncToken).toBe('2');
    expect(sent).not.toHaveProperty('sync_token');
  });

  it('matching SyncToken allows line_items write', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) => cb(null, {}));
    mockQuickBooksInstance.updateEstimate.mockImplementation((payload: any, cb: any) => cb(null, payload));
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '2' },
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(result.isError).toBe(false);
  });

  it('stale sync_token via estimate.sync_token blocks line_items write', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', sync_token: '0' },
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(result.isError).toBe(true);
    expect(mockQuickBooksInstance.updateEstimate).not.toHaveBeenCalled();
  });

  it('stale SyncToken blocks estimate.Line write', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '0', Line: [line('1'), line('2')] },
    });
    expect(result.isError).toBe(true);
    expect(mockQuickBooksInstance.updateEstimate).not.toHaveBeenCalled();
  });

  it('stale SyncToken blocks line_items write', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '0' },
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(result.isError).toBe(true);
    expect(mockQuickBooksInstance.updateEstimate).not.toHaveBeenCalled();
  });

  it('line_items works when read returns no Line array', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) =>
      cb(null, { Id: 'est-1', SyncToken: '2' })
    );
    mockQuickBooksInstance.updateEstimate.mockImplementation((payload: any, cb: any) => cb(null, payload));
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '2' },
      line_items: [{ item_ref: 'item-1', qty: 1, unit_price: 3 }],
    });
    expect(result.isError).toBe(false);
  });

  it('line_items post-write warning path', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) =>
      cb(null, {
        Id: 'est-1',
        SyncToken: '2',
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
    mockQuickBooksInstance.updateEstimate.mockImplementation((_payload: any, cb: any) =>
      cb(null, {
        Line: [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: 'item-1' } } }],
      })
    );
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '2' },
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(result.isError).toBe(false);
    expect((result.result as any)._warning).toBeDefined();
  });

  it('line_items merges and writes estimate', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    mockQuickBooksInstance.updateEstimate.mockImplementation((payload: any, cb: any) => cb(null, payload));
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '2', CustomerMemo: { value: 'm' } },
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(result.isError).toBe(false);
  });

  it('getEstimate failure on line_items path', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(new Error('read fail'), null));
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '2' },
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(result.isError).toBe(true);
  });

  it('validates class_ref for line_items', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1' },
      line_items: [{ id: '1', class_ref: 'bad' }],
    });
    expect(result.isError).toBe(true);
  });

  it('surfaces getEstimate and update errors', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(new Error('read'), null));
    const read = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', Line: [line('1'), line('2')] },
    });
    expect(read.isError).toBe(true);

    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    mockQuickBooksInstance.updateEstimate.mockImplementation((_p: any, cb: any) => cb(new Error('write'), null));
    const write = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1' },
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(write.isError).toBe(true);
  });

  it('handles authentication errors', async () => {
    (mockQuickbooksClientClass.getInstance as any).mockRejectedValue(new Error('Auth failed'));
    const result = await updateQuickbooksEstimate({ estimate: { Id: '1' } });
    expect(result.isError).toBe(true);
  });

  it('buildMergedLines error and post-write error on line_items', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    const mergeErr = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '2' },
      line_items: [{ id: 'missing', qty: 1 }],
    });
    expect(mergeErr.isError).toBe(true);

    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) =>
      cb(null, {
        ...current,
        Line: [
          {
            ...line('1'),
            SalesItemLineDetail: {
              ...line('1').SalesItemLineDetail,
              ClassRef: { value: '682828' },
            },
          },
          line('2'),
        ],
      })
    );
    mockQuickBooksInstance.updateEstimate.mockImplementation((payload: any, cb: any) =>
      cb(null, {
        ...payload,
        Line: [
          {
            Id: '1',
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: { ItemRef: { value: 'item-1' }, Qty: 1, UnitPrice: 5 },
          },
          payload.Line[1],
        ],
      })
    );
    const postWriteErr = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '2' },
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(postWriteErr.isError).toBe(true);
  });

  it('estimate.Line path when read returns no Line array', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) =>
      cb(null, { Id: 'est-1', SyncToken: '2' })
    );
    mockQuickBooksInstance.updateEstimate.mockImplementation((payload: any, cb: any) => cb(null, payload));
    const result = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '2', Line: [] },
      replace_all_lines: true,
    });
    expect(result.isError).toBe(false);
  });

  it('line_items ignores estimate.sparse:false in payload', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    let sent: any;
    mockQuickBooksInstance.updateEstimate.mockImplementation((payload: any, cb: any) => {
      sent = payload;
      cb(null, payload);
    });
    await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '2', sparse: false, PrivateNote: 'n' },
      line_items: [{ id: '1', qty: 1 }],
    });
    expect(sent.Id).toBe('est-1');
    expect(sent.sparse).toBe(true);
    expect(sent.PrivateNote).toBe('n');
  });

  it('estimate.Line and legacy update API errors', async () => {
    mockQuickBooksInstance.getEstimate.mockImplementation((_id: any, cb: any) => cb(null, current));
    mockQuickBooksInstance.updateEstimate.mockImplementation((_p: any, cb: any) => cb(new Error('fail'), null));
    const linePath = await updateQuickbooksEstimate({
      estimate: { Id: 'est-1', SyncToken: '2', Line: [line('1'), line('2')] },
    });
    expect(linePath.isError).toBe(true);

    mockQuickBooksInstance.updateEstimate.mockImplementation((_p: any, cb: any) => cb(new Error('legacy fail'), null));
    const legacy = await updateQuickbooksEstimate({ estimate: { Id: 'est-1', SyncToken: '2' } });
    expect(legacy.isError).toBe(true);
  });
});
