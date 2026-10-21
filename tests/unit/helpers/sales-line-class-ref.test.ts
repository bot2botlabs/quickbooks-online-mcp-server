import { describe, it, expect, jest } from '@jest/globals';
import {
  describeClassTrackingPreferenceHint,
  formatSalesCreateError,
  lineItemsIncludeClassRef,
  NON_NUMERIC_CLASS_REF_ERROR,
  validateLineClassRefs,
} from '../../../src/helpers/sales-line-class-ref';

describe('sales-line-class-ref helpers', () => {
  describe('validateLineClassRefs', () => {
    it('returns null when class_ref is numeric or absent', () => {
      expect(validateLineClassRefs([{ class_ref: '682828' }, {}])).toBeNull();
    });

    it('rejects non-numeric class_ref values', () => {
      expect(validateLineClassRefs([{ class_ref: 'Restoration' }])).toBe(NON_NUMERIC_CLASS_REF_ERROR);
    });
  });

  describe('lineItemsIncludeClassRef', () => {
    it('detects when any line has class_ref', () => {
      expect(lineItemsIncludeClassRef([{}])).toBe(false);
      expect(lineItemsIncludeClassRef([{ class_ref: '1' }])).toBe(true);
    });
  });

  describe('describeClassTrackingPreferenceHint', () => {
    it('returns null when per-line tracking is enabled', () => {
      expect(
        describeClassTrackingPreferenceHint({ AccountingInfoPrefs: { ClassTrackingPerTxnLine: true } })
      ).toBeNull();
    });

    it('explains when class tracking is off', () => {
      const hint = describeClassTrackingPreferenceHint({
        AccountingInfoPrefs: { ClassTrackingPerTxn: false, ClassTrackingPerTxnLine: false },
      });
      expect(hint).toContain('Class tracking appears to be off');
    });

    it('explains per-transaction-only tracking', () => {
      const hint = describeClassTrackingPreferenceHint({
        AccountingInfoPrefs: { ClassTrackingPerTxn: true, ClassTrackingPerTxnLine: false },
      });
      expect(hint).toContain('one class per transaction');
    });

    it('reads nested Preferences.AccountingInfoPrefs', () => {
      const hint = describeClassTrackingPreferenceHint({
        Preferences: { AccountingInfoPrefs: { ClassTrackingPerTxn: true, ClassTrackingPerTxnLine: false } },
      });
      expect(hint).toContain('one class per transaction');
    });

    it('returns null for unrecognized preference shapes', () => {
      expect(describeClassTrackingPreferenceHint(null)).toBeNull();
      expect(describeClassTrackingPreferenceHint({})).toBeNull();
    });
  });

  describe('formatSalesCreateError', () => {
    const qboFault = {
      Fault: {
        Error: [{ Message: 'Invalid Reference Id', Detail: 'Invalid Reference Id : ClassRef', code: '2500' }],
      },
    };

    it('formats QuickBooks Fault details from axios-style errors', async () => {
      const getPreferences = jest.fn((cb: (err: null, prefs: unknown) => void) =>
        cb(null, { AccountingInfoPrefs: { ClassTrackingPerTxnLine: true } })
      );
      const quickbooks = { getPreferences };
      const err = Object.assign(new Error('Request failed with status code 400'), { response: { data: qboFault } });

      const message = await formatSalesCreateError(quickbooks, err, [{ class_ref: '999999' }]);

      expect(message).toContain('Invalid Reference Id');
      expect(message).toContain('code=2500');
      expect(getPreferences).toHaveBeenCalledTimes(1);
    });

    it('skips preferences lookup when no class_ref was sent', async () => {
      const quickbooks = { getPreferences: jest.fn() };
      const err = Object.assign(new Error('Request failed with status code 400'), { response: { data: qboFault } });

      await formatSalesCreateError(quickbooks, err, [{}]);

      expect(quickbooks.getPreferences).not.toHaveBeenCalled();
    });

    it('appends a class tracking hint when preferences show tracking is off', async () => {
      const quickbooks = {
        getPreferences: (cb: (err: null, prefs: unknown) => void) =>
          cb(null, { AccountingInfoPrefs: { ClassTrackingPerTxn: false, ClassTrackingPerTxnLine: false } }),
      };
      const err = Object.assign(new Error('Request failed with status code 400'), { response: { data: qboFault } });

      const message = await formatSalesCreateError(quickbooks, err, [{ class_ref: '999999' }]);

      expect(message).toContain('Class tracking note');
      expect(message).toContain('Class tracking appears to be off');
    });

    it('returns the base fault message when preferences lookup fails', async () => {
      const quickbooks = {
        getPreferences: (cb: (err: Error, prefs: null) => void) => cb(new Error('prefs failed'), null),
      };
      const err = Object.assign(new Error('Request failed with status code 400'), { response: { data: qboFault } });

      const message = await formatSalesCreateError(quickbooks, err, [{ class_ref: '999999' }]);

      expect(message).toBe('Error: Invalid Reference Id — Invalid Reference Id : ClassRef — code=2500');
    });
  });
});
