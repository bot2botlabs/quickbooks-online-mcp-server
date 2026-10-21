import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickbooksClientClass, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';

// ESM-compatible module mocking
jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

// Dynamic imports after mock setup
const { createQuickbooksInvoice } = await import('../../../src/handlers/create-quickbooks-invoice.handler');

describe('Invoice Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('createQuickbooksInvoice', () => {
    it('should create an invoice successfully', async () => {
      const mockInvoice = { Id: '123', TotalAmt: 100 };
      mockQuickBooksInstance.createInvoice.mockImplementation((payload: any, cb: any) => cb(null, mockInvoice));

      const result = await createQuickbooksInvoice({
        customer_ref: 'cust-1',
        line_items: [{ item_ref: 'item-1', qty: 1, unit_price: 100 }]
      });

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(mockInvoice);
      const payload = (mockQuickBooksInstance.createInvoice.mock.calls[0] as any)[0];
      expect(payload).not.toHaveProperty('GlobalTaxCalculation');
    });

    it('should pass per-line TaxCodeRef and GlobalTaxCalculation to QuickBooks', async () => {
      const mockInvoice = { Id: '123', TotalAmt: 100 };
      mockQuickBooksInstance.createInvoice.mockImplementation((payload: any, cb: any) => cb(null, mockInvoice));

      const result = await createQuickbooksInvoice({
        customer_ref: 'cust-1',
        line_items: [
          { item_ref: 'item-1', qty: 2, unit_price: 50, tax_code_ref: '14' },
          { item_ref: 'item-2', qty: 1, unit_price: 75 }
        ],
        global_tax_calculation: 'TaxExcluded'
      });

      expect(result.isError).toBe(false);
      const payload = (mockQuickBooksInstance.createInvoice.mock.calls[0] as any)[0];
      expect(payload.Line[0].SalesItemLineDetail.TaxCodeRef).toEqual({ value: '14' });
      expect(payload.Line[1].SalesItemLineDetail.TaxCodeRef).toBeUndefined();
      expect(payload.GlobalTaxCalculation).toBe('TaxExcluded');
    });

    it('should pass per-line ClassRef to QuickBooks when class_ref is given', async () => {
      mockQuickBooksInstance.createInvoice.mockImplementation((payload: any, cb: any) => cb(null, { Id: '123' }));

      await createQuickbooksInvoice({
        customer_ref: 'cust-1',
        line_items: [
          { item_ref: 'item-1', qty: 1, unit_price: 100, class_ref: 'class-7' },
          { item_ref: 'item-2', qty: 1, unit_price: 50 },
        ],
      });

      const payload = (mockQuickBooksInstance.createInvoice.mock.calls[0] as any)[0];
      expect(payload.Line[0].SalesItemLineDetail.ClassRef).toEqual({ value: 'class-7' });
      expect(payload.Line[1].SalesItemLineDetail.ClassRef).toBeUndefined();
    });

    it('should handle authentication errors', async () => {
      (mockQuickbooksClientClass.getInstance as any).mockRejectedValue(new Error('Auth failed'));

      const result = await createQuickbooksInvoice({ customer_ref: 'cust-1', line_items: [] });

      expect(result.isError).toBe(true);
      expect(result.error).toContain('Auth failed');
    });

    it('should handle API errors', async () => {
      mockQuickBooksInstance.createInvoice.mockImplementation((payload: any, cb: any) =>
        cb(new Error('Validation error'), null)
      );

      const result = await createQuickbooksInvoice({ customer_ref: 'cust-1', line_items: [] });

      expect(result.isError).toBe(true);
    });
  });
});
