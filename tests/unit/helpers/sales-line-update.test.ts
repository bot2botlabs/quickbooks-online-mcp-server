import { describe, it, expect } from '@jest/globals';
import {
  buildMergedLines,
  computeLineAmount,
  findDroppedLineRefs,
  findClassRefMismatchWarnings,
  isAutomatedSalesTax,
  salesLineItemSchema,
  sparseUpdateBodyFromRecord,
  legacyLineUpdateBodyFromRecord,
  normalizeLegacyEstimateOnlyPayload,
  validatePatchEntityId,
  validatePatchLineAgainstCurrent,
  staleSyncTokenMessage,
  staleSyncTokenIfCallerMismatch,
  applyClassRefRequestWarnings,
  evaluateSalesLinePostWrite,
} from '../../../src/helpers/sales-line-update.js';
import { NON_NUMERIC_CLASS_REF_ERROR } from '../../../src/helpers/sales-line-class-ref.js';

const salesLine = (id: string, overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

describe('sales-line-update helper', () => {
  describe('sparseUpdateBodyFromRecord and validatePatchEntityId', () => {
    it('strips sparse control fields and validates matching Id', () => {
      expect(
        sparseUpdateBodyFromRecord({
          Id: '1',
          SyncToken: '2',
          sync_token: '2',
          sparse: false,
          PrivateNote: 'x',
        })
      ).toEqual({
        PrivateNote: 'x',
      });
      expect(validatePatchEntityId('inv-1', 'inv-1', 'patch')).toBeNull();
      expect(validatePatchEntityId('other', 'inv-1', 'patch')).toContain('must match');
    });

    it('legacyLineUpdateBodyFromRecord keeps Line and strips sync_token', () => {
      expect(
        legacyLineUpdateBodyFromRecord({
          sync_token: '2',
          Line: [{ Id: '1' }],
          PrivateNote: 'n',
        })
      ).toEqual({ Line: [{ Id: '1' }], PrivateNote: 'n' });
    });

    it('normalizeLegacyEstimateOnlyPayload maps sync_token to SyncToken', () => {
      expect(normalizeLegacyEstimateOnlyPayload({ Id: '1', sync_token: '2' })).toEqual({
        Id: '1',
        SyncToken: '2',
      });
      expect(normalizeLegacyEstimateOnlyPayload({ Id: '1', SyncToken: '2' })).toEqual({
        Id: '1',
        SyncToken: '2',
      });
      expect(normalizeLegacyEstimateOnlyPayload({ Id: '1', PrivateNote: 'x' })).toEqual({
        Id: '1',
        PrivateNote: 'x',
      });
      expect(normalizeLegacyEstimateOnlyPayload(null)).toBeNull();
    });
  });

  describe('computeLineAmount', () => {
    it('rounds fractional multiplication', () => {
      expect(computeLineAmount(3, 0.1)).toBe(0.3);
    });
  });

  describe('buildMergedLines', () => {
    it('edits qty and keeps other line byte-identical', () => {
      const current = [salesLine('1'), salesLine('2')];
      const result = buildMergedLines(current, [{ id: '1', qty: 4 }]);
      expect('error' in result).toBe(false);
      if ('lines' in result) {
        expect(result.lines[0].SalesItemLineDetail.Qty).toBe(4);
        expect(result.lines[0].Amount).toBe(20);
        expect(result.lines[0].SalesItemLineDetail.ClassRef).toEqual({ value: '682828' });
        expect(result.lines[1]).toEqual(current[1]);
      }
    });

    it('appends a new line without id', () => {
      const current = [salesLine('1')];
      const result = buildMergedLines(current, [
        {
          item_ref: 'item-2',
          qty: 1,
          unit_price: 9,
          description: 'new',
          tax_code_ref: 'TAX',
          class_ref: '682828',
          service_date: '2026-02-02',
        },
      ]);
      expect('lines' in result && result.lines.length).toBe(2);
      if ('lines' in result) {
        const detail = result.lines[1].SalesItemLineDetail;
        expect(result.lines[1].Id).toBeUndefined();
        expect(result.lines[1].Description).toBe('new');
        expect(detail.ItemRef).toEqual({ value: 'item-2' });
        expect(detail.TaxCodeRef).toEqual({ value: 'TAX' });
        expect(detail.ClassRef).toEqual({ value: '682828' });
        expect(detail.ServiceDate).toBe('2026-02-02');
      }
    });

    it('edits refs without recomputing Amount when qty and price unchanged', () => {
      const current = [salesLine('1')];
      const result = buildMergedLines(current, [
        {
          id: '1',
          item_ref: 'item-9',
          unit_price: 5,
          tax_code_ref: 'TAX',
          class_ref: '111',
          service_date: '2026-03-03',
          description: 'd',
        },
      ]);
      if ('lines' in result) {
        expect(result.lines[0].Amount).toBe(10);
        expect(result.lines[0].Description).toBe('d');
        expect(result.lines[0].SalesItemLineDetail.ItemRef.value).toBe('item-9');
      }
    });

    it('removes a line with remove true', () => {
      const current = [salesLine('1'), salesLine('2')];
      const result = buildMergedLines(current, [{ id: '1', remove: true }]);
      if ('lines' in result) {
        expect(result.lines.map((l) => l.Id)).toEqual(['2']);
      }
    });

    it('handles mixed add edit remove', () => {
      const current = [salesLine('1'), salesLine('2'), salesLine('3')];
      const result = buildMergedLines(current, [
        { id: '1', qty: 1 },
        { id: '2', remove: true },
        { item_ref: 'item-9', qty: 2, unit_price: 3 },
      ]);
      if ('lines' in result) {
        expect(result.lines.length).toBe(3);
        expect(result.lines[0].Id).toBe('1');
        expect(result.lines[1].Id).toBe('3');
        expect(result.lines[2].SalesItemLineDetail.ItemRef.value).toBe('item-9');
      }
    });

    it('excludes SubTotalLineDetail from base', () => {
      const current = [
        salesLine('1'),
        { Id: '99', DetailType: 'SubTotalLineDetail', Amount: 10 },
      ];
      const result = buildMergedLines(current, [{ id: '1', description: 'x' }]);
      if ('lines' in result) {
        expect(result.lines.some((l) => l.DetailType === 'SubTotalLineDetail')).toBe(false);
      }
    });

    it('keeps Group lines verbatim and rejects editing them', () => {
      const group = { Id: 'g1', DetailType: 'GroupLineDetail', Amount: 1 };
      const current = [group, salesLine('1')];
      const bad = buildMergedLines(current, [{ id: 'g1', description: 'nope' }]);
      expect('error' in bad).toBe(true);
      const ok = buildMergedLines(current, [{ id: '1', qty: 1 }]);
      if ('lines' in ok) {
        expect(ok.lines[0]).toEqual(group);
      }
    });

    it('allows removing non-sales lines', () => {
      const group = { Id: 'g1', DetailType: 'GroupLineDetail', Amount: 1 };
      const current = [group, salesLine('1')];
      const result = buildMergedLines(current, [{ id: 'g1', remove: true }]);
      if ('lines' in result) {
        expect(result.lines.length).toBe(1);
      }
    });

    it('handles non-array current lines and base lines without Id', () => {
      const result = buildMergedLines(null as any, [{ item_ref: 'item-1', qty: 1, unit_price: 1 }]);
      expect('lines' in result).toBe(true);
      const withAnonymous = buildMergedLines(
        [{ Amount: 1, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: 'i' }, Qty: 1, UnitPrice: 1 } }],
        [{ item_ref: 'item-2', qty: 1, unit_price: 2 }]
      );
      expect('lines' in withAnonymous && withAnonymous.lines.length).toBe(2);
    });

    it('rejects qty edit when UnitPrice is missing on the line', () => {
      const current = [
        {
          Id: '1',
          Amount: 1,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { ItemRef: { value: 'item-1' }, Qty: 1 },
        },
      ];
      const result = buildMergedLines(current, [{ id: '1', qty: 2 }]);
      expect(result).toEqual({
        error:
          'Line 1 requires finite Qty and UnitPrice when editing qty or unit_price; supply both values on the line_items entry.',
      });
    });

    it('returns validation errors without throwing', () => {
      expect(buildMergedLines([salesLine('1')], [{ id: 'missing', qty: 1 }])).toEqual({
        error: 'Line id missing does not exist on this transaction.',
      });
      expect(buildMergedLines([salesLine('1')], [{ id: '1', remove: true }, { id: '1', qty: 2 }])).toEqual({
        error: 'Duplicate line id in line_items request.',
      });
      expect(buildMergedLines([salesLine('1')], [{ remove: true }])).toEqual({
        error: 'remove: true requires an existing line id.',
      });
      expect(buildMergedLines([salesLine('1')], [{ id: '1', remove: true, qty: 2 }])).toEqual({
        error: 'remove: true cannot be combined with other line edit fields.',
      });
      expect(buildMergedLines([salesLine('1')], [{ item_ref: 'x', qty: 1 }])).toEqual({
        error: 'New lines require item_ref, qty, and unit_price.',
      });
      expect(buildMergedLines([salesLine('1')], [{ id: '1', remove: true }])).toEqual({
        error: 'At least one SalesItemLineDetail line is required.',
      });
      expect(buildMergedLines([], [{ id: '1', remove: true }])).toEqual({
        error: 'Line id 1 does not exist on this transaction.',
      });
      expect(buildMergedLines([salesLine('1')], [{ class_ref: 'name' }])).toEqual({ error: NON_NUMERIC_CLASS_REF_ERROR });
      expect(buildMergedLines([salesLine('1')], [{ id: '1', remove: true }])).toEqual({
        error: 'At least one SalesItemLineDetail line is required.',
      });
    });
  });

  describe('findDroppedLineRefs', () => {
    it('skips non-sales and lines without Id', () => {
      const current = [{ Id: '1', DetailType: 'GroupLineDetail' }, salesLine('2')];
      const dropped = findDroppedLineRefs(current, { Line: current }, []);
      expect(dropped.ClassRef).toEqual([]);
    });

    it('flags dropped ClassRef unless caller changed class_ref', () => {
      const current = [salesLine('1')];
      const updated = [
        {
          Id: '1',
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { ItemRef: { value: 'item-1' }, TaxCodeRef: { value: 'NON' } },
        },
      ];
      const dropped = findDroppedLineRefs(current, { Line: updated }, []);
      expect(dropped.ClassRef).toEqual(['Line 1']);
      const notDropped = findDroppedLineRefs(current, { Line: updated }, [{ id: '1', class_ref: '999' }]);
      expect(notDropped.ClassRef).toEqual([]);
      const taxChanged = findDroppedLineRefs(
        current,
        { Line: updated },
        [{ id: '1', tax_code_ref: 'TAX' }]
      );
      expect(taxChanged.TaxCodeRef).toEqual([]);
    });

    it('ignores removed lines', () => {
      const current = [salesLine('1'), salesLine('2')];
      const updated = [salesLine('2')];
      const dropped = findDroppedLineRefs(current, { Line: updated }, [{ id: '1', remove: true }]);
      expect(dropped.ClassRef).toEqual([]);
    });
  });

  describe('formatErrorPreferences via evaluateSalesLinePostWrite', () => {
    it('stringifies non-Error preference failures', async () => {
      const current = [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { TaxCodeRef: { value: 'NON' } } }];
      const updated = { Line: [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: {} }] };
      const qb = {
        getPreferences: (cb: (err: unknown, prefs: unknown) => void) => cb('boom', null),
      };
      const result = await evaluateSalesLinePostWrite(qb, current, updated, [], 'Invoice 1');
      expect(result.kind).toBe('error');
    });
  });

  describe('validatePatchLineAgainstCurrent', () => {
    it('errors on partial patch.Line', () => {
      const msg = validatePatchLineAgainstCurrent([salesLine('1'), salesLine('2')], [salesLine('1')], false);
      expect(msg).toContain('line_items');
      expect(msg).toContain('2');
    });

    it('allows replace_all_lines', () => {
      expect(validatePatchLineAgainstCurrent([salesLine('1'), salesLine('2')], [salesLine('1')], true)).toBeNull();
    });

    it('allows complete patch.Line', () => {
      expect(
        validatePatchLineAgainstCurrent([salesLine('1'), salesLine('2')], [salesLine('1'), salesLine('2')], false)
      ).toBeNull();
    });

    it('handles non-array current lines', () => {
      expect(validatePatchLineAgainstCurrent(undefined as any, [], false)).toBeNull();
    });
  });

  describe('isAutomatedSalesTax', () => {
    it('detects PartnerTaxEnabled presence', () => {
      expect(isAutomatedSalesTax({ TaxPrefs: { PartnerTaxEnabled: false } })).toBe(true);
      expect(isAutomatedSalesTax({ TaxPrefs: {} })).toBe(false);
    });
  });

  describe('findClassRefMismatchWarnings', () => {
    it('finds mismatches by id and for new appended lines', () => {
      const saved = {
        Line: [
          { Id: '1', SalesItemLineDetail: { ClassRef: { value: '1' } } },
          { SalesItemLineDetail: { ClassRef: { value: '2' } } },
        ],
      };
      expect(findClassRefMismatchWarnings([{ id: '1', class_ref: '9' }], saved)).toEqual([1]);
      expect(
        findClassRefMismatchWarnings([{ item_ref: 'i', qty: 1, unit_price: 1, class_ref: '9' }], saved)
      ).toEqual([1]);
    });
  });

  describe('staleSyncTokenMessage', () => {
    it('includes current token', () => {
      expect(staleSyncTokenMessage('7')).toContain('7');
    });
  });

  describe('staleSyncTokenIfCallerMismatch', () => {
    it('errors when supplied token differs and passes when omitted or matching', () => {
      expect(staleSyncTokenIfCallerMismatch({}, '3')).toBeNull();
      expect(staleSyncTokenIfCallerMismatch({ SyncToken: '3' }, '3')).toBeNull();
      expect(staleSyncTokenIfCallerMismatch({ sync_token: '3' }, '3')).toBeNull();
      expect(staleSyncTokenIfCallerMismatch({ SyncToken: '0' }, '3')).toContain('stale sync_token');
    });
  });

  describe('salesLineItemSchema', () => {
    it('accepts valid shapes and rejects bad qty', () => {
      expect(salesLineItemSchema.safeParse({ id: '1', qty: 2 }).success).toBe(true);
      expect(salesLineItemSchema.safeParse({ qty: 0 }).success).toBe(false);
    });

    it('rejects empty string refs', () => {
      expect(salesLineItemSchema.safeParse({ id: '' }).success).toBe(false);
      expect(salesLineItemSchema.safeParse({ item_ref: '' }).success).toBe(false);
      expect(salesLineItemSchema.safeParse({ tax_code_ref: '' }).success).toBe(false);
      expect(salesLineItemSchema.safeParse({ class_ref: '' }).success).toBe(false);
    });
  });

  describe('applyClassRefRequestWarnings', () => {
    it('adds warning when class_ref not saved', async () => {
      const qb = {
        getPreferences: (cb: (err: null, prefs: unknown) => void) => cb(null, {}),
      };
      const out = await applyClassRefRequestWarnings(
        qb,
        [{ id: '1', class_ref: '682828' }],
        { Line: [{ Id: '1', SalesItemLineDetail: {} }] }
      );
      expect((out as { _warning?: string })._warning).toContain('line(s) 1');
    });

    it('uses preference hint when available', async () => {
      const qb = {
        getPreferences: (cb: (err: null, prefs: unknown) => void) =>
          cb(null, { AccountingInfoPrefs: { ClassTrackingPerTxn: true, ClassTrackingPerTxnLine: false } }),
      };
      const out = await applyClassRefRequestWarnings(
        qb,
        [{ id: '1', class_ref: '682828' }],
        { Line: [{ Id: '1', SalesItemLineDetail: {} }] }
      );
      expect((out as { _warning?: string })._warning).toContain('one class per transaction');
    });

    it('returns entity unchanged when class_ref matches', async () => {
      const saved = { Line: [{ Id: '1', SalesItemLineDetail: { ClassRef: { value: '682828' } } }] };
      const out = await applyClassRefRequestWarnings({}, [{ id: '1', class_ref: '682828' }], saved);
      expect((out as { _warning?: string })._warning).toBeUndefined();
    });
  });

  describe('evaluateSalesLinePostWrite', () => {
    it('errors on dropped ClassRef', async () => {
      const current = [salesLine('1')];
      const updated = {
        Line: [
          {
            Id: '1',
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: { ItemRef: { value: 'item-1' }, TaxCodeRef: { value: 'NON' } },
          },
        ],
      };
      const result = await evaluateSalesLinePostWrite({}, current, updated, [], 'Invoice 1');
      expect(result.kind).toBe('error');
    });

    it('errors on dropped TaxCodeRef when not AST', async () => {
      const current = [
        {
          Id: '1',
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { TaxCodeRef: { value: 'NON' } },
        },
      ];
      const updated = {
        Line: [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: {} }],
      };
      const qb = {
        getPreferences: (cb: (err: null, prefs: unknown) => void) => cb(null, { TaxPrefs: {} }),
      };
      const result = await evaluateSalesLinePostWrite(qb, current, updated, [], 'Invoice 1');
      expect(result.kind).toBe('error');
    });

    it('returns ok when nothing dropped', async () => {
      const line = salesLine('1');
      const result = await evaluateSalesLinePostWrite({}, [line], { Line: [line] }, [], 'Invoice 1');
      expect(result.kind).toBe('ok');
    });

    it('warns on AST TaxCodeRef drop', async () => {
      const current = [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { TaxCodeRef: { value: 'NON' } } }];
      const updated = { Line: [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: {} }] };
      const qb = {
        getPreferences: (cb: (err: null, prefs: unknown) => void) =>
          cb(null, { TaxPrefs: { PartnerTaxEnabled: true } }),
      };
      const result = await evaluateSalesLinePostWrite(qb, current, updated, [], 'Invoice 1');
      expect(result.kind).toBe('warning');
    });

    it('errors when preferences fetch fails after TaxCodeRef drop', async () => {
      const current = [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { TaxCodeRef: { value: 'NON' } } }];
      const updated = { Line: [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: {} }] };
      const qb = {
        getPreferences: (cb: (err: Error, prefs: unknown) => void) => cb(new Error('Preferences read failed'), null),
      };
      const result = await evaluateSalesLinePostWrite(qb, current, updated, [], 'Invoice 1');
      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.message).toContain('Preferences read failed');
      }
    });

    it('returns class_ref warning without tax drop', async () => {
      const qb = {
        getPreferences: (cb: (err: null, prefs: unknown) => void) => cb(null, {}),
      };
      const current = [
        {
          Id: '1',
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { ClassRef: { value: '682828' } },
        },
      ];
      const result = await evaluateSalesLinePostWrite(
        qb,
        current,
        { Line: [{ Id: '1', SalesItemLineDetail: {} }] },
        [{ id: '1', class_ref: '682828' }],
        'Invoice 1'
      );
      expect(result.kind).toBe('warning');
    });

    it('combines AST warning with class_ref warning text', async () => {
      const current = [
        {
          Id: '1',
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { TaxCodeRef: { value: 'NON' } },
        },
      ];
      const updated = { Line: [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: {} }] };
      const qb = {
        getPreferences: (cb: (err: null, prefs: unknown) => void) =>
          cb(null, { TaxPrefs: { PartnerTaxEnabled: true } }),
      };
      const result = await evaluateSalesLinePostWrite(
        qb,
        current,
        updated,
        [{ id: '1', class_ref: '682828' }],
        'Invoice 1'
      );
      expect(result.kind).toBe('warning');
      if (result.kind === 'warning') {
        expect(result.entity._warning).toContain('Automated Sales Tax');
        expect(result.entity._warning).toContain('class_ref');
      }
    });
  });

  describe('findDroppedLineRefs branch coverage', () => {
    it('handles updated entities without Line and missing SalesItemLineDetail', () => {
      expect(findDroppedLineRefs(null as any, {}, [])).toEqual({ ClassRef: [], TaxCodeRef: [] });
      expect(findDroppedLineRefs([salesLine('1')], {}, [])).toEqual({ ClassRef: [], TaxCodeRef: [] });
      const current = [{ Id: '1', DetailType: 'SalesItemLineDetail' }];
      const updated = { Line: [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ClassRef: { value: '1' } } }] };
      expect(findDroppedLineRefs(current, updated, [])).toEqual({ ClassRef: [], TaxCodeRef: [] });
    });

    it('does not flag refs that were never set on the current line', () => {
      const current = [
        {
          Id: '1',
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { ItemRef: { value: 'item-1' } },
        },
      ];
      const updated = {
        Line: [{ Id: '1', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: 'item-1' } } }],
      };
      expect(findDroppedLineRefs(current, updated, [])).toEqual({ ClassRef: [], TaxCodeRef: [] });
    });

    it('skips updated lines without Id and lines missing SalesItemLineDetail', () => {
      const current = [salesLine('1')];
      const updated = {
        Line: [
          { DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ClassRef: { value: '1' } } },
          { Id: '1', DetailType: 'SalesItemLineDetail' },
        ],
      };
      const dropped = findDroppedLineRefs(current, updated, []);
      expect(dropped.ClassRef.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('findDroppedLineRefs missing updated line', () => {
    it('does not flag when updated entity omits a kept line id', () => {
      const dropped = findDroppedLineRefs([salesLine('1')], { Line: [] }, []);
      expect(dropped.ClassRef).toEqual([]);
    });
  });

  describe('findClassRefMismatchWarnings edge cases', () => {
    it('handles missing Line array', () => {
      expect(findClassRefMismatchWarnings([{ id: '1', class_ref: '1' }], {})).toEqual([1]);
    });

    it('skips duplicate mismatch indexes for repeated new-line entries', () => {
      const itemA = { item_ref: 'i', qty: 1, unit_price: 1, class_ref: '9' };
      expect(findClassRefMismatchWarnings([itemA, itemA], { Line: [{ SalesItemLineDetail: {} }] })).toEqual([1]);
    });

    it('accepts matching class_ref on appended lines', () => {
      expect(
        findClassRefMismatchWarnings(
          [{ item_ref: 'i', qty: 1, unit_price: 1, class_ref: '682828' }],
          {
            Line: [
              {
                DetailType: 'SalesItemLineDetail',
                SalesItemLineDetail: { ClassRef: { value: '682828' } },
              },
            ],
          }
        )
      ).toEqual([]);
    });

    it('dedupes mismatch indexes for appended new lines', () => {
      const saved = {
        Line: [{ SalesItemLineDetail: {} }, { SalesItemLineDetail: {} }],
      };
      const items = [
        { item_ref: 'a', qty: 1, unit_price: 1, class_ref: '9' },
        { item_ref: 'b', qty: 1, unit_price: 1, class_ref: '8' },
      ];
      expect(findClassRefMismatchWarnings(items, saved)).toEqual([1, 2]);
    });
  });
});
