import { formatError } from "./format-error.js";

export type LineWithOptionalClassRef = { class_ref?: string };

const CLASS_ID_PATTERN = /^\d+$/;

export const NON_NUMERIC_CLASS_REF_ERROR =
  "Error: line_items[].class_ref must be a QuickBooks Class Id (numeric), not a class name. Use search_classes to look up the Id for each class. Per-line class_ref requires per-line class tracking (ClassTrackingPerTxnLine) in QuickBooks Plus or Advanced.";

export function lineItemsIncludeClassRef(lineItems: LineWithOptionalClassRef[]): boolean {
  return lineItems.some((line) => Boolean(line.class_ref));
}

export function validateLineClassRefs(lineItems: LineWithOptionalClassRef[]): string | null {
  for (const line of lineItems) {
    if (line.class_ref && !CLASS_ID_PATTERN.test(line.class_ref)) {
      return NON_NUMERIC_CLASS_REF_ERROR;
    }
  }
  return null;
}

export function describeClassTrackingPreferenceHint(preferences: unknown): string | null {
  if (!preferences || typeof preferences !== "object") {
    return null;
  }
  const prefs = preferences as Record<string, unknown>;
  const accounting =
    (prefs.AccountingInfoPrefs as Record<string, unknown> | undefined) ??
    ((prefs.Preferences as Record<string, unknown> | undefined)?.AccountingInfoPrefs as
      | Record<string, unknown>
      | undefined);

  if (!accounting) {
    return null;
  }

  const perLine = accounting.ClassTrackingPerTxnLine === true;
  const perTxn = accounting.ClassTrackingPerTxn === true;

  if (!perLine && !perTxn) {
    return (
      "Class tracking note: Class tracking appears to be off or unavailable on this company " +
      "(QuickBooks Plus or Advanced with class tracking enabled is required). " +
      "Line-level class_ref is not applicable."
    );
  }

  if (perTxn && !perLine) {
    return (
      "Class tracking note: This company is set to one class per transaction, not per line. " +
      "Line-level class_ref is not valid — assign a transaction-level ClassRef instead, or enable " +
      '"Track class" per row in QuickBooks company settings (ClassTrackingPerTxnLine).'
    );
  }

  return null;
}

function getPreferences(quickbooks: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    (quickbooks as { getPreferences: (cb: (err: unknown, prefs: unknown) => void) => void }).getPreferences(
      (err, preferences) => {
        if (err) {
          reject(err);
        } else {
          resolve(preferences);
        }
      }
    );
  });
}

export async function formatSalesCreateError(
  quickbooks: unknown,
  err: unknown,
  lineItems: LineWithOptionalClassRef[]
): Promise<string> {
  let message = formatError(err);
  if (!lineItemsIncludeClassRef(lineItems)) {
    return message;
  }
  try {
    const preferences = await getPreferences(quickbooks);
    const hint = describeClassTrackingPreferenceHint(preferences);
    if (hint) {
      message = `${message}\n\n${hint}`;
    }
  } catch {
    // Preferences lookup is best-effort on the failure path only.
  }
  return message;
}
