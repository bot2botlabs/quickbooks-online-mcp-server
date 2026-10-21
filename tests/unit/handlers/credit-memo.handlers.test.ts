import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickbooksClientClass, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';

// ESM-compatible module mocking
jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

// Dynamic imports after mock setup
const { createQuickbooksCreditMemo } = await import('../../../src/handlers/create-quickbooks-credit-memo.handler');
const { getQuickbooksCreditMemo } = await import('../../../src/handlers/get-quickbooks-credit-memo.handler');
const { updateQuickbooksCreditMemo } = await import('../../../src/handlers/update-quickbooks-credit-memo.handler');
const { deleteQuickbooksCreditMemo } = await import('../../../src/handlers/delete-quickbooks-credit-memo.handler');
const { searchQuickbooksCreditMemos } = await import('../../../src/handlers/search-quickbooks-credit-memos.handler');

describe('CreditMemo Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('createQuickbooksCreditMemo', () => {
    it('should create a credit memo successfully', async () => {
      const mockMemo = { Id: '123', TotalAmt: 100 };
      mockQuickBooksInstance.createCreditMemo.mockImplementation((payload: any, cb: any) => cb(null, mockMemo));

      const result = await createQuickbooksCreditMemo({
        customer_ref: 'cust-1',
        line_items: [{ item_ref: 'item-1', qty: 1, unit_price: 100 }]
      });

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(mockMemo);
      const payload = (mockQuickBooksInstance.createCreditMemo.mock.calls[0] as any)[0];
      expect(payload).not.toHaveProperty('GlobalTaxCalculation');
    });

    it('should pass per-line TaxCodeRef and GlobalTaxCalculation to QuickBooks', async () => {
      mockQuickBooksInstance.createCreditMemo.mockImplementation((payload: any, cb: any) => cb(null, { Id: '123' }));

      const result = await createQuickbooksCreditMemo({
        customer_ref: 'cust-1',
        line_items: [
          { item_ref: 'item-1', qty: 2, unit_price: 50, tax_code_ref: '14' },
          { item_ref: 'item-2', qty: 1, unit_price: 75 }
        ],
        global_tax_calculation: 'TaxExcluded'
      });

      expect(result.isError).toBe(false);
      const payload = (mockQuickBooksInstance.createCreditMemo.mock.calls[0] as any)[0];
      expect(payload.Line[0].SalesItemLineDetail.TaxCodeRef).toEqual({ value: '14' });
      expect(payload.Line[1].SalesItemLineDetail.TaxCodeRef).toBeUndefined();
      expect(payload.GlobalTaxCalculation).toBe('TaxExcluded');
    });

    it('should reject a non-numeric class_ref before calling QuickBooks', async () => {
      const result = await createQuickbooksCreditMemo({
        customer_ref: 'cust-1',
        line_items: [{ item_ref: 'item-1', qty: 1, unit_price: 1, class_ref: 'Restoration' }],
      });

      expect(result.isError).toBe(true);
      expect(mockQuickBooksInstance.createCreditMemo).not.toHaveBeenCalled();
    });

    it('should pass per-line ClassRef to QuickBooks when class_ref is given', async () => {
      mockQuickBooksInstance.createCreditMemo.mockImplementation((payload: any, cb: any) =>
        cb(null, {
          Id: '123',
          Line: [
            {
              DetailType: 'SalesItemLineDetail',
              SalesItemLineDetail: { ClassRef: { value: '682828' } },
            },
            { DetailType: 'SalesItemLineDetail', SalesItemLineDetail: {} },
          ],
        })
      );

      await createQuickbooksCreditMemo({
        customer_ref: 'cust-1',
        line_items: [
          { item_ref: 'item-1', qty: 1, unit_price: 100, class_ref: '682828' },
          { item_ref: 'item-2', qty: 1, unit_price: 50 },
        ],
      });

      const payload = (mockQuickBooksInstance.createCreditMemo.mock.calls[0] as any)[0];
      expect(payload.Line[0].SalesItemLineDetail.ClassRef).toEqual({ value: '682828' });
      expect(payload.Line[1].SalesItemLineDetail.ClassRef).toBeUndefined();
    });

    it('should handle errors', async () => {
      mockQuickBooksInstance.createCreditMemo.mockImplementation((payload: any, cb: any) =>
        cb('Error occurred', null)
      );

      const result = await createQuickbooksCreditMemo({ customer_ref: 'cust-1', line_items: [] });

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClientClass.getInstance as any).mockRejectedValue(new Error('Auth failed'));

      const result = await createQuickbooksCreditMemo({ customer_ref: 'cust-1', line_items: [] });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });

    it('should create with all optional fields', async () => {
      const mockMemo = { Id: '123', TotalAmt: 200 };
      mockQuickBooksInstance.createCreditMemo.mockImplementation((payload: any, cb: any) => cb(null, mockMemo));

      const result = await createQuickbooksCreditMemo({
        customer_ref: 'cust-1',
        line_items: [
          { item_ref: 'item-1', qty: 2, unit_price: 100, description: 'Test item' }
        ],
        txn_date: '2024-01-15',
        doc_number: 'CM-001',
        private_note: 'Test credit memo'
      });

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(mockMemo);
    });
  });

  describe('getQuickbooksCreditMemo', () => {
    it('should get a credit memo by ID', async () => {
      const mockMemo = { Id: '123' };
      mockQuickBooksInstance.getCreditMemo.mockImplementation((_id: any, cb: any) => cb(null, mockMemo));

      const result = await getQuickbooksCreditMemo('123');

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(mockMemo);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.getCreditMemo.mockImplementation((_id: any, cb: any) =>
        cb(new Error('Not found'), null)
      );

      const result = await getQuickbooksCreditMemo('999');

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClientClass.getInstance as any).mockRejectedValue(new Error('Auth failed'));

      const result = await getQuickbooksCreditMemo('123');

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });
  });

  describe('updateQuickbooksCreditMemo', () => {
    it('should update a credit memo', async () => {
      const mockUpdated = { Id: '123' };
      mockQuickBooksInstance.updateCreditMemo.mockImplementation((payload: any, cb: any) => cb(null, mockUpdated));

      const result = await updateQuickbooksCreditMemo({ id: '123', sync_token: '0' });

      expect(result.isError).toBe(false);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.updateCreditMemo.mockImplementation((payload: any, cb: any) =>
        cb(new Error('Update failed'), null)
      );

      const result = await updateQuickbooksCreditMemo({ id: '123', sync_token: '0' });

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClientClass.getInstance as any).mockRejectedValue(new Error('Auth failed'));

      const result = await updateQuickbooksCreditMemo({ id: '123', sync_token: '0' });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });

    it('should update with all optional fields', async () => {
      const mockUpdated = { Id: '123', DocNumber: 'CM-002' };
      mockQuickBooksInstance.updateCreditMemo.mockImplementation((payload: any, cb: any) => cb(null, mockUpdated));

      const result = await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        customer_ref: 'cust-2',
        private_note: 'Updated note',
        doc_number: 'CM-002'
      });

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(mockUpdated);
    });

    it('header-only update does not call getCreditMemo', async () => {
      mockQuickBooksInstance.updateCreditMemo.mockImplementation((payload: any, cb: any) => cb(null, { Id: '123' }));
      await updateQuickbooksCreditMemo({ id: '123', sync_token: '0' });
      expect(mockQuickBooksInstance.getCreditMemo).not.toHaveBeenCalled();
    });

    it('line_items sets optional header fields individually', async () => {
      const current = {
        Id: '123',
        SyncToken: '0',
        Line: [
          {
            Id: '1',
            DetailType: 'SalesItemLineDetail',
            Amount: 5,
            SalesItemLineDetail: { ItemRef: { value: 'item-1' }, Qty: 1, UnitPrice: 5 },
          },
        ],
      };
      mockQuickBooksInstance.getCreditMemo.mockImplementation((_id: any, cb: any) => cb(null, current));
      mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) => cb(null, {}));
      mockQuickBooksInstance.updateCreditMemo.mockImplementation((payload: any, cb: any) => cb(null, payload));

      await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        customer_ref: 'cust-1',
        line_items: [{ id: '1', qty: 1 }],
      });
      await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        private_note: 'n',
        line_items: [{ id: '1', qty: 1 }],
      });
      await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        doc_number: 'CM-9',
        line_items: [{ id: '1', qty: 1 }],
      });
      expect(mockQuickBooksInstance.updateCreditMemo).toHaveBeenCalled();
    });

    it('line_items success without optional header fields or warnings', async () => {
      const current = {
        Id: '123',
        SyncToken: '0',
        Line: [
          {
            Id: '1',
            DetailType: 'SalesItemLineDetail',
            Amount: 5,
            SalesItemLineDetail: { ItemRef: { value: 'item-1' }, Qty: 1, UnitPrice: 5 },
          },
        ],
      };
      mockQuickBooksInstance.getCreditMemo.mockImplementation((_id: any, cb: any) => cb(null, current));
      mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) => cb(null, {}));
      mockQuickBooksInstance.updateCreditMemo.mockImplementation((payload: any, cb: any) => cb(null, payload));
      const result = await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        line_items: [{ id: '1', description: 'ok' }],
      });
      expect(result.isError).toBe(false);
      expect((result.result as any)._warning).toBeUndefined();
    });

    it('line_items path read-merge-writes lines', async () => {
      const current = {
        Id: '123',
        SyncToken: '0',
        Line: [
          {
            Id: '1',
            DetailType: 'SalesItemLineDetail',
            Amount: 10,
            SalesItemLineDetail: { ItemRef: { value: 'item-1' }, Qty: 2, UnitPrice: 5, ClassRef: { value: '682828' } },
          },
        ],
      };
      mockQuickBooksInstance.getCreditMemo.mockImplementation((_id: any, cb: any) => cb(null, current));
      mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) => cb(null, {}));
      let sent: any;
      mockQuickBooksInstance.updateCreditMemo.mockImplementation((payload: any, cb: any) => {
        sent = payload;
        cb(null, payload);
      });

      const result = await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        line_items: [{ id: '1', qty: 3 }],
      });

      expect(result.isError).toBe(false);
      expect(sent.Line[0].SalesItemLineDetail.Qty).toBe(3);
    });

    it('invalid class_ref and merge errors skip update', async () => {
      const current = {
        Id: '123',
        SyncToken: '0',
        Line: [
          {
            Id: '1',
            DetailType: 'SalesItemLineDetail',
            Amount: 10,
            SalesItemLineDetail: { ItemRef: { value: 'item-1' }, Qty: 2, UnitPrice: 5 },
          },
        ],
      };
      mockQuickBooksInstance.getCreditMemo.mockImplementation((_id: any, cb: any) => cb(null, current));

      const badClass = await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        line_items: [{ id: '1', class_ref: 'name' }],
      });
      expect(badClass.isError).toBe(true);

      const badMerge = await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        line_items: [{ id: '9', qty: 1 }],
      });
      expect(badMerge.isError).toBe(true);
      expect(mockQuickBooksInstance.updateCreditMemo).not.toHaveBeenCalled();
    });

    it('line_items with header fields and post-write ClassRef error', async () => {
      const current = {
        Id: '123',
        SyncToken: '0',
        Line: [
          {
            Id: '1',
            DetailType: 'SalesItemLineDetail',
            Amount: 10,
            SalesItemLineDetail: {
              ItemRef: { value: 'item-1' },
              Qty: 2,
              UnitPrice: 5,
              ClassRef: { value: '682828' },
            },
          },
        ],
      };
      mockQuickBooksInstance.getCreditMemo.mockImplementation((_id: any, cb: any) => cb(null, current));
      mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) => cb(null, {}));
      mockQuickBooksInstance.updateCreditMemo.mockImplementation((payload: any, cb: any) =>
        cb(null, {
          ...payload,
          Line: [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: 'item-1' } } }],
        })
      );

      const result = await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        customer_ref: 'cust-1',
        private_note: 'n',
        doc_number: 'CM-3',
        line_items: [{ id: '1', qty: 2 }],
      });
      expect(result.isError).toBe(true);
    });

    it('line_items AST warning returns success with _warning', async () => {
      const current = {
        Id: '123',
        SyncToken: '0',
        Line: [
          {
            Id: '1',
            DetailType: 'SalesItemLineDetail',
            Amount: 10,
            SalesItemLineDetail: { ItemRef: { value: 'item-1' }, Qty: 2, UnitPrice: 5, TaxCodeRef: { value: 'NON' } },
          },
        ],
      };
      mockQuickBooksInstance.getCreditMemo.mockImplementation((_id: any, cb: any) => cb(null, current));
      mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) =>
        cb(null, { TaxPrefs: { PartnerTaxEnabled: true } })
      );
      mockQuickBooksInstance.updateCreditMemo.mockImplementation((_payload: any, cb: any) =>
        cb(null, {
          Line: [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: 'item-1' } } }],
        })
      );
      const result = await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        line_items: [{ id: '1', qty: 2 }],
      });
      expect(result.isError).toBe(false);
      expect((result.result as any)._warning).toBeDefined();
    });

    it('line_items when read returns no Line uses empty base lines for new items', async () => {
      mockQuickBooksInstance.getCreditMemo.mockImplementation((_id: any, cb: any) =>
        cb(null, { Id: '123', SyncToken: '0' })
      );
      mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) => cb(null, {}));
      mockQuickBooksInstance.updateCreditMemo.mockImplementation((payload: any, cb: any) => cb(null, payload));
      const result = await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        line_items: [{ item_ref: 'item-1', qty: 1, unit_price: 3 }],
      });
      expect(result.isError).toBe(false);
    });

    it('line_items update API error', async () => {
      const current = {
        Id: '123',
        SyncToken: '0',
        Line: [
          {
            Id: '1',
            DetailType: 'SalesItemLineDetail',
            Amount: 5,
            SalesItemLineDetail: { ItemRef: { value: 'item-1' }, Qty: 1, UnitPrice: 5 },
          },
        ],
      };
      mockQuickBooksInstance.getCreditMemo.mockImplementation((_id: any, cb: any) => cb(null, current));
      mockQuickBooksInstance.getPreferences.mockImplementation((cb: any) => cb(null, {}));
      mockQuickBooksInstance.updateCreditMemo.mockImplementation((_p: any, cb: any) => cb(new Error('write'), null));
      const result = await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        line_items: [{ id: '1', qty: 2 }],
      });
      expect(result.isError).toBe(true);
    });

    it('getCreditMemo failure on line_items path', async () => {
      mockQuickBooksInstance.getCreditMemo.mockImplementation((_id: any, cb: any) => cb(new Error('read'), null));
      const result = await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        line_items: [{ id: '1', qty: 1 }],
      });
      expect(result.isError).toBe(true);
    });

    it('stale sync_token skips update', async () => {
      mockQuickBooksInstance.getCreditMemo.mockImplementation((_id: any, cb: any) =>
        cb(null, { Id: '123', SyncToken: '9', Line: [] })
      );
      const result = await updateQuickbooksCreditMemo({
        id: '123',
        sync_token: '0',
        line_items: [{ item_ref: 'item-1', qty: 1, unit_price: 1 }],
      });
      expect(result.isError).toBe(true);
      expect(mockQuickBooksInstance.updateCreditMemo).not.toHaveBeenCalled();
    });
  });

  describe('deleteQuickbooksCreditMemo', () => {
    it('should delete a credit memo', async () => {
      mockQuickBooksInstance.deleteCreditMemo.mockImplementation((payload: any, cb: any) => cb(null, {}));

      const result = await deleteQuickbooksCreditMemo({ id: '123', sync_token: '0' });

      expect(result.isError).toBe(false);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.deleteCreditMemo.mockImplementation((payload: any, cb: any) =>
        cb(new Error('Delete failed'), null)
      );

      const result = await deleteQuickbooksCreditMemo({ id: '123', sync_token: '0' });

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClientClass.getInstance as any).mockRejectedValue(new Error('Auth failed'));

      const result = await deleteQuickbooksCreditMemo({ id: '123', sync_token: '0' });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });
  });

  describe('searchQuickbooksCreditMemos', () => {
    it('should search credit memos', async () => {
      const mockMemos = [{ Id: '1' }];
      mockQuickBooksInstance.findCreditMemos.mockImplementation((criteria: any, cb: any) =>
        cb(null, { QueryResponse: { CreditMemo: mockMemos } })
      );

      const result = await searchQuickbooksCreditMemos({});

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(mockMemos);
    });

    it('should search with all filter options', async () => {
      mockQuickBooksInstance.findCreditMemos.mockImplementation((criteria: any, cb: any) =>
        cb(null, { QueryResponse: { CreditMemo: [] } })
      );

      const result = await searchQuickbooksCreditMemos({
        customer_ref: 'cust-1',
        txn_date_from: '2024-01-01',
        txn_date_to: '2024-12-31',
        limit: 50
      });

      expect(result.isError).toBe(false);
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.findCreditMemos.mockImplementation((criteria: any, cb: any) =>
        cb(new Error('Search failed'), null)
      );

      const result = await searchQuickbooksCreditMemos({});

      expect(result.isError).toBe(true);
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClientClass.getInstance as any).mockRejectedValue(new Error('Auth failed'));

      const result = await searchQuickbooksCreditMemos({});

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });

    it('should handle empty QueryResponse', async () => {
      mockQuickBooksInstance.findCreditMemos.mockImplementation((criteria: any, cb: any) =>
        cb(null, { QueryResponse: {} })
      );

      const result = await searchQuickbooksCreditMemos({ limit: 5 });

      expect(result.isError).toBe(false);
      expect(result.result).toEqual([]);
    });
  });
});


