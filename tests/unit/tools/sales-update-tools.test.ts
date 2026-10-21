import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import {
  mockQuickbooksClient,
  mockQuickbooksClientClass,
  mockQuickBooksInstance,
  resetAllMocks,
} from '../../mocks/quickbooks.mock';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

const { UpdateInvoiceTool } = await import('../../../src/tools/update-invoice.tool.js');
const { UpdateEstimateTool } = await import('../../../src/tools/update-estimate.tool.js');
const { UpdateCreditMemoTool } = await import('../../../src/tools/update-credit-memo.tool.js');
const { UpdateSalesReceiptTool } = await import('../../../src/tools/update-sales-receipt.tool.js');
const { UpdateRefundReceiptTool } = await import('../../../src/tools/update-refund-receipt.tool.js');

describe('sales update tool schemas (#141)', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  const lineItem = { id: '1', qty: 2, item_ref: 'item-1', unit_price: 1 };

  it('update_invoice accepts line_items without patch', () => {
    expect(UpdateInvoiceTool.schema.safeParse({ invoice_id: '1', line_items: [lineItem] }).success).toBe(true);
  });

  it('update_invoice accepts line_items and rejects invalid qty', () => {
    expect(UpdateInvoiceTool.schema.safeParse({ invoice_id: '1', patch: {}, line_items: [lineItem] }).success).toBe(
      true
    );
    expect(
      UpdateInvoiceTool.schema.safeParse({ invoice_id: '1', patch: {}, line_items: [{ qty: -1 }] }).success
    ).toBe(false);
  });

  it('update_estimate accepts line_items', () => {
    expect(UpdateEstimateTool.schema.safeParse({ estimate: { Id: '1' }, line_items: [lineItem] }).success).toBe(true);
  });

  it('credit memo, sales receipt, refund receipt accept line_items', () => {
    const base = { id: '1', sync_token: '0', line_items: [lineItem] };
    expect(UpdateCreditMemoTool.schema.safeParse(base).success).toBe(true);
    expect(UpdateSalesReceiptTool.schema.safeParse(base).success).toBe(true);
    expect(UpdateRefundReceiptTool.schema.safeParse(base).success).toBe(true);
  });

  it('tool handlers surface handler success and error text', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) =>
      cb(null, { Id: '1', SyncToken: '0', Line: [] })
    );
    mockQuickBooksInstance.updateInvoice.mockImplementation((_p: any, cb: any) => cb(null, { Id: '1' }));
    const extra = {} as any;
    const textOf = (content: { content: Array<{ type: string; text?: string }> }) =>
      (content.content[0] as { text: string }).text;

    const invoiceOk = await UpdateInvoiceTool.handler({ params: { invoice_id: '1', patch: {} } }, extra);
    expect(textOf(invoiceOk)).toContain('success');

    mockQuickBooksInstance.updateInvoice.mockImplementation((_p: any, cb: any) => cb(new Error('bad'), null));
    const invoiceErr = await UpdateInvoiceTool.handler({ params: { invoice_id: '1', patch: {} } }, extra);
    expect(textOf(invoiceErr)).toContain('Error updating invoice');

    mockQuickBooksInstance.updateEstimate.mockImplementation((_p: any, cb: any) => cb(null, { Id: '1' }));
    const estOk = await UpdateEstimateTool.handler({ params: { estimate: { Id: '1', SyncToken: '0' } } }, extra);
    expect(textOf(estOk)).toContain('Estimate updated');
    mockQuickBooksInstance.updateEstimate.mockImplementation((_p: any, cb: any) => cb(new Error('bad'), null));
    const estErr = await UpdateEstimateTool.handler({ params: { estimate: { Id: '1', SyncToken: '0' } } }, extra);
    expect(textOf(estErr)).toContain('Error updating estimate');

    mockQuickBooksInstance.updateCreditMemo.mockImplementation((_p: any, cb: any) => cb(null, { Id: '1' }));
    const cmOk = await UpdateCreditMemoTool.handler({ params: { id: '1', sync_token: '0' } }, extra);
    expect(textOf(cmOk)).toContain('success');
    mockQuickBooksInstance.updateCreditMemo.mockImplementation((_p: any, cb: any) => cb(new Error('bad'), null));
    const cmErr = await UpdateCreditMemoTool.handler({ params: { id: '1', sync_token: '0' } }, extra);
    expect(textOf(cmErr)).toContain('Error updating credit memo');

    mockQuickBooksInstance.updateSalesReceipt.mockImplementation((_p: any, cb: any) => cb(null, { Id: '1' }));
    const srOk = await UpdateSalesReceiptTool.handler({ params: { id: '1', sync_token: '0' } }, extra);
    expect(textOf(srOk)).toContain('success');
    mockQuickBooksInstance.updateSalesReceipt.mockImplementation((_p: any, cb: any) => cb(new Error('bad'), null));
    const srErr = await UpdateSalesReceiptTool.handler({ params: { id: '1', sync_token: '0' } }, extra);
    expect(textOf(srErr)).toContain('Error updating sales receipt');

    mockQuickBooksInstance.updateRefundReceipt.mockImplementation((_p: any, cb: any) => cb(null, { Id: '1' }));
    const rrOk = await UpdateRefundReceiptTool.handler({ params: { id: '1', sync_token: '0' } }, extra);
    expect(textOf(rrOk)).toContain('success');
    mockQuickBooksInstance.updateRefundReceipt.mockImplementation((_p: any, cb: any) => cb(new Error('bad'), null));
    const rrErr = await UpdateRefundReceiptTool.handler({ params: { id: '1', sync_token: '0' } }, extra);
    expect(textOf(rrErr)).toContain('Error updating refund receipt');
  });
});
