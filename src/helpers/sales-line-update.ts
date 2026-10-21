import { z } from "zod";
import {
  validateLineClassRefs,
  describeClassTrackingPreferenceHint,
  type LineWithOptionalClassRef,
} from "./sales-line-class-ref.js";

/** Prior art: upstream #86 (bill read-merge-write); JoJa84 fork (append-only line_items_to_add, SubTotal filter). */

export const salesLineItemSchema = z.object({
  id: z.string().min(1).optional(),
  remove: z.boolean().optional(),
  item_ref: z.string().min(1).optional(),
  qty: z.number().positive().optional(),
  unit_price: z.number().min(0).optional(),
  description: z.string().optional(),
  tax_code_ref: z.string().min(1).optional(),
  class_ref: z.string().min(1).optional(),
  service_date: z.string().optional(),
});

export type SalesLineItemInput = z.infer<typeof salesLineItemSchema>;

const EDIT_FIELD_KEYS = [
  "item_ref",
  "qty",
  "unit_price",
  "description",
  "tax_code_ref",
  "class_ref",
  "service_date",
] as const;

const PRESERVED_REFS = ["ClassRef", "TaxCodeRef"] as const;

function isSubTotalLine(line: any): boolean {
  return line?.DetailType === "SubTotalLineDetail";
}

function isSalesItemLine(line: any): boolean {
  return line?.DetailType === "SalesItemLineDetail";
}

function lineHasEditFields(item: SalesLineItemInput): boolean {
  return EDIT_FIELD_KEYS.some((k) => item[k] !== undefined);
}

export function computeLineAmount(qty: number, unitPrice: number): number {
  return Math.round(qty * unitPrice * 100) / 100;
}

function buildNewSalesLine(item: SalesLineItemInput): any {
  const qty = item.qty!;
  const unitPrice = item.unit_price!;
  const detail: any = {
    ItemRef: { value: item.item_ref },
    Qty: qty,
    UnitPrice: unitPrice,
  };
  if (item.tax_code_ref) {
    detail.TaxCodeRef = { value: item.tax_code_ref };
  }
  if (item.class_ref) {
    detail.ClassRef = { value: item.class_ref };
  }
  if (item.service_date) {
    detail.ServiceDate = item.service_date;
  }
  return {
    ...(item.description !== undefined ? { Description: item.description } : {}),
    Amount: computeLineAmount(qty, unitPrice),
    DetailType: "SalesItemLineDetail",
    SalesItemLineDetail: detail,
  };
}

function mergeSalesLineEdit(currentLine: any, item: SalesLineItemInput): any {
  const detail = { ...currentLine.SalesItemLineDetail };
  if (item.item_ref !== undefined) {
    detail.ItemRef = { value: item.item_ref };
  }
  if (item.qty !== undefined) {
    detail.Qty = item.qty;
  }
  if (item.unit_price !== undefined) {
    detail.UnitPrice = item.unit_price;
  }
  if (item.tax_code_ref !== undefined) {
    detail.TaxCodeRef = { value: item.tax_code_ref };
  }
  if (item.class_ref !== undefined) {
    detail.ClassRef = { value: item.class_ref };
  }
  if (item.service_date !== undefined) {
    detail.ServiceDate = item.service_date;
  }

  const merged: any = {
    ...currentLine,
    SalesItemLineDetail: detail,
  };
  if (item.description !== undefined) {
    merged.Description = item.description;
  }

  if (item.qty !== undefined || item.unit_price !== undefined) {
    const qty = detail.Qty;
    const unitPrice = detail.UnitPrice;
    if (typeof qty !== "number" || !Number.isFinite(qty) || typeof unitPrice !== "number" || !Number.isFinite(unitPrice)) {
      return merged;
    }
    merged.Amount = computeLineAmount(qty, unitPrice);
  }

  return merged;
}

function validateEditedLineAmount(line: any, item: SalesLineItemInput, lineId: string): string | null {
  if (item.qty === undefined && item.unit_price === undefined) {
    return null;
  }
  const detail = line.SalesItemLineDetail;
  const qty = detail?.Qty;
  const unitPrice = detail?.UnitPrice;
  if (typeof qty !== "number" || !Number.isFinite(qty) || typeof unitPrice !== "number" || !Number.isFinite(unitPrice)) {
    return (
      `Line ${lineId} requires finite Qty and UnitPrice when editing qty or unit_price; ` +
      `supply both values on the line_items entry.`
    );
  }
  return null;
}

function stripSparseControlFieldsExceptLine(record: Record<string, any>): Record<string, any> {
  const { Id: _id, SyncToken: _sync, sync_token: _syncSnake, sparse: _sparse, ...rest } = record;
  return rest;
}

/** Strip fields that must not be taken from caller patch/header bodies on sparse updates. */
export function sparseUpdateBodyFromRecord(record: Record<string, any>): Record<string, any> {
  const { Line: _line, ...rest } = stripSparseControlFieldsExceptLine(record);
  return rest;
}

/** Legacy patch.Line / estimate.Line paths: keep Line, drop Id/SyncToken/sync_token/sparse from caller body. */
export function legacyLineUpdateBodyFromRecord(record: Record<string, any>): Record<string, any> {
  return stripSparseControlFieldsExceptLine(record);
}

/** Estimate-only update: never send sync_token; map it to SyncToken when SyncToken is absent. */
export function normalizeLegacyEstimateOnlyPayload(estimateData: any): any {
  if (!estimateData || typeof estimateData !== "object") {
    return estimateData;
  }
  if (estimateData.sync_token === undefined) {
    return estimateData;
  }
  const { sync_token, ...rest } = estimateData;
  if (rest.SyncToken !== undefined) {
    return rest;
  }
  return { ...rest, SyncToken: sync_token };
}

export function validatePatchEntityId(
  patchId: unknown,
  expectedId: string,
  fieldLabel: string
): string | null {
  if (patchId === undefined || patchId === null) {
    return null;
  }
  if (String(patchId) !== String(expectedId)) {
    return `${fieldLabel}.Id must match ${expectedId}; omit Id or use the same value.`;
  }
  return null;
}

function filterBaseLines(currentLines: any[]): any[] {
  return currentLines.filter((line) => !isSubTotalLine(line));
}

export function buildMergedLines(
  currentLines: any[],
  lineItems: SalesLineItemInput[]
): { lines: any[] } | { error: string } {
  const classRefError = validateLineClassRefs(lineItems as LineWithOptionalClassRef[]);
  if (classRefError) {
    return { error: classRefError };
  }

  const baseLines = filterBaseLines(Array.isArray(currentLines) ? currentLines : []);

  const byId = new Map<string, SalesLineItemInput>();
  for (const item of lineItems) {
    if (item.id) {
      if (byId.has(item.id)) {
        return { error: "Duplicate line id in line_items request." };
      }
      byId.set(item.id, item);
    }
  }

  for (const item of lineItems) {
    if (item.remove) {
      if (!item.id) {
        return { error: "remove: true requires an existing line id." };
      }
      if (lineHasEditFields(item)) {
        return { error: "remove: true cannot be combined with other line edit fields." };
      }
    }
  }

  const currentById = new Map<string, any>();
  for (const line of baseLines) {
    if (line.Id != null) {
      currentById.set(String(line.Id), line);
    }
  }

  for (const item of lineItems) {
    if (item.id && !currentById.has(item.id)) {
      return { error: `Line id ${item.id} does not exist on this transaction.` };
    }
  }

  for (const item of lineItems) {
    if (!item.id || item.remove) {
      continue;
    }
    const current = currentById.get(item.id)!;
    if (!isSalesItemLine(current) && lineHasEditFields(item)) {
      return {
        error: `Line ${item.id} is ${current.DetailType} and cannot be edited with line_items; use remove: true to delete it.`,
      };
    }
  }

  const newLines = lineItems.filter((item) => !item.id && !item.remove);
  for (const item of newLines) {
    if (!item.item_ref || item.qty === undefined || item.unit_price === undefined) {
      return { error: "New lines require item_ref, qty, and unit_price." };
    }
  }

  const output: any[] = [];

  for (const line of baseLines) {
    const id = line.Id != null ? String(line.Id) : undefined;
    const item = id ? byId.get(id) : undefined;

    if (item?.remove) {
      continue;
    }

    if (item && !item.remove && isSalesItemLine(line)) {
      const mergedLine = mergeSalesLineEdit(line, item);
      const amountError = validateEditedLineAmount(mergedLine, item, id!);
      if (amountError) {
        return { error: amountError };
      }
      output.push(mergedLine);
    } else {
      output.push(line);
    }
  }

  for (const item of newLines) {
    output.push(buildNewSalesLine(item));
  }

  const salesCount = output.filter(isSalesItemLine).length;
  if (salesCount === 0) {
    return { error: "At least one SalesItemLineDetail line is required." };
  }

  return { lines: output };
}

function callerChangedRef(item: SalesLineItemInput | undefined, ref: "class_ref" | "tax_code_ref"): boolean {
  if (!item) {
    return false;
  }
  return item[ref] !== undefined;
}

export function findDroppedLineRefs(
  currentLines: any[],
  updatedEntity: any,
  lineItems: SalesLineItemInput[]
): Record<(typeof PRESERVED_REFS)[number], string[]> {
  const dropped: Record<string, string[]> = { ClassRef: [], TaxCodeRef: [] };

  const updatedById = new Map<string, any>();
  for (const line of updatedEntity?.Line ?? []) {
    if (line?.Id != null) {
      updatedById.set(String(line.Id), line);
    }
  }

  const itemsById = new Map<string, SalesLineItemInput>();
  for (const item of lineItems) {
    if (item.id) {
      itemsById.set(item.id, item);
    }
  }

  const baseLines = filterBaseLines(Array.isArray(currentLines) ? currentLines : []);

  for (const cur of baseLines) {
    if (!isSalesItemLine(cur) || cur.Id == null) {
      continue;
    }
    const id = String(cur.Id);
    const item = itemsById.get(id);
    if (item?.remove) {
      continue;
    }

    const upd = updatedById.get(id);
    if (!upd) {
      continue;
    }

    const curDetail = cur.SalesItemLineDetail ?? {};
    const updDetail = upd.SalesItemLineDetail ?? {};

    for (const ref of PRESERVED_REFS) {
      if (callerChangedRef(item, ref === "ClassRef" ? "class_ref" : "tax_code_ref")) {
        continue;
      }
      if (curDetail[ref] && !updDetail[ref]) {
        dropped[ref].push(`Line ${id}`);
      }
    }
  }

  return dropped as Record<(typeof PRESERVED_REFS)[number], string[]>;
}

export function isAutomatedSalesTax(preferences: any): boolean {
  const taxPrefs = preferences?.TaxPrefs;
  return !!taxPrefs && Object.prototype.hasOwnProperty.call(taxPrefs, "PartnerTaxEnabled");
}

function getSalesItemLinesFromEntity(entity: any): any[] {
  const lines = entity?.Line;
  if (!Array.isArray(lines)) {
    return [];
  }
  return lines.filter(isSalesItemLine);
}

/** Lines where caller requested class_ref but saved entity does not match (by line id or append order). */
export function findClassRefMismatchWarnings(
  lineItems: SalesLineItemInput[],
  updatedEntity: any
): number[] {
  const savedSales = getSalesItemLinesFromEntity(updatedEntity);
  const mismatches: number[] = [];

  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i]!;
    if (!item.class_ref) {
      continue;
    }
    if (item.id && !item.remove) {
      const savedLine = (updatedEntity?.Line ?? []).find((l: any) => String(l.Id) === item.id);
      const saved = savedLine?.SalesItemLineDetail?.ClassRef?.value;
      if (String(saved ?? "") !== item.class_ref) {
        mismatches.push(i + 1);
      }
    }
  }

  const newItems = lineItems.filter((i) => !i.id && !i.remove && i.class_ref);
  if (newItems.length > 0) {
    const appendedSaved = savedSales.slice(-newItems.length);
    for (let j = 0; j < newItems.length; j++) {
      const requested = newItems[j]!.class_ref!;
      const saved = appendedSaved[j]?.SalesItemLineDetail?.ClassRef?.value;
      if (String(saved ?? "") !== requested) {
        const idx = lineItems.indexOf(newItems[j]!);
        if (!mismatches.includes(idx + 1)) {
          mismatches.push(idx + 1);
        }
      }
    }
  }

  return mismatches.sort((a, b) => a - b);
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

const GENERIC_CLASS_REF_DROPPED_SUFFIX =
  "Line-level class tracking may be disabled or misconfigured in this company.";

export async function applyClassRefRequestWarnings(
  quickbooks: unknown,
  lineItems: SalesLineItemInput[],
  updatedEntity: any
): Promise<any> {
  const mismatched = findClassRefMismatchWarnings(lineItems, updatedEntity);
  if (mismatched.length === 0) {
    return updatedEntity;
  }

  let suffix = GENERIC_CLASS_REF_DROPPED_SUFFIX;
  try {
    const preferences = await getPreferences(quickbooks);
    const hint = describeClassTrackingPreferenceHint(preferences);
    if (hint) {
      suffix = hint.replace(/^Class tracking note: /, "");
    }
  } catch {
    // Best-effort preferences lookup when class_ref was not saved as requested.
  }

  const lineList = mismatched.join(", ");
  const warning =
    `Warning: QuickBooks saved this transaction but did not apply class_ref on line(s) ${lineList}. ${suffix}`;

  return { ...updatedEntity, _warning: warning };
}

export type SalesLinePostWriteResult =
  | { kind: "ok"; entity: any }
  | { kind: "error"; entity: any; message: string }
  | { kind: "warning"; entity: any; message: string };

export async function evaluateSalesLinePostWrite(
  quickbooks: unknown,
  currentLines: any[],
  updatedEntity: any,
  lineItems: SalesLineItemInput[],
  entityLabel: string
): Promise<SalesLinePostWriteResult> {
  const dropped = findDroppedLineRefs(currentLines, updatedEntity, lineItems);

  let astEnabled = false;
  if (dropped.TaxCodeRef.length > 0) {
    try {
      const preferences = await getPreferences(quickbooks);
      astEnabled = isAutomatedSalesTax(preferences);
    } catch (err) {
      return {
        kind: "error",
        entity: updatedEntity,
        message: formatErrorPreferences(err),
      };
    }
  }

  const errorRefs: string[] = [];
  for (const line of dropped.ClassRef) {
    errorRefs.push(`${line}: ClassRef`);
  }
  if (!astEnabled) {
    for (const line of dropped.TaxCodeRef) {
      errorRefs.push(`${line}: TaxCodeRef`);
    }
  }

  if (errorRefs.length > 0) {
    return {
      kind: "error",
      entity: updatedEntity,
      message:
        `${entityLabel} was updated but QuickBooks dropped these tracking fields: ` +
        `${errorRefs.join(", ")}. The transaction's class/tax coding may now be wrong — ` +
        `investigate before relying on it.`,
    };
  }

  if (astEnabled && dropped.TaxCodeRef.length > 0) {
    const withClassWarnings = await applyClassRefRequestWarnings(quickbooks, lineItems, updatedEntity);
    const astWarning =
      `Automated Sales Tax is enabled for this company, so QuickBooks removed the ` +
      `line-level TaxCodeRef on ${dropped.TaxCodeRef.join(", ")}. This is expected — ` +
      `tax is managed centrally under AST — and the update otherwise succeeded.`;
    const existing = (withClassWarnings as { _warning?: string })._warning;
    return {
      kind: "warning",
      entity: { ...withClassWarnings, _warning: existing ? `${existing}\n\n${astWarning}` : astWarning },
      message: astWarning,
    };
  }

  const withClassWarnings = await applyClassRefRequestWarnings(quickbooks, lineItems, updatedEntity);
  if ((withClassWarnings as { _warning?: string })._warning) {
    return {
      kind: "warning",
      entity: withClassWarnings,
      message: (withClassWarnings as { _warning: string })._warning,
    };
  }

  return { kind: "ok", entity: updatedEntity };
}

function formatErrorPreferences(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `Preferences read failed: ${msg}`;
}

export function validatePatchLineAgainstCurrent(
  currentLines: any[],
  patchLine: any[],
  replaceAllLines: boolean | undefined
): string | null {
  if (replaceAllLines) {
    return null;
  }
  const baseLines = filterBaseLines(Array.isArray(currentLines) ? currentLines : []);
  const patchIds = new Set(
    patchLine.filter((l) => l?.Id != null).map((l) => String(l.Id))
  );
  const missing: string[] = [];
  for (const line of baseLines) {
    if (line.Id != null && !patchIds.has(String(line.Id))) {
      missing.push(String(line.Id));
    }
  }
  if (missing.length > 0) {
    return (
      `patch.Line omits existing line id(s) ${missing.join(", ")}, which would delete those lines in QuickBooks. ` +
      `Use line_items to add, edit, or remove lines safely, or set replace_all_lines: true to replace the full Line array intentionally.`
    );
  }
  return null;
}

export function staleSyncTokenMessage(currentToken: string): string {
  return (
    `stale sync_token: the transaction changed since you read it (current SyncToken ${currentToken}); ` +
    `re-read and retry`
  );
}

/** When caller supplied SyncToken or sync_token, it must match the freshly read token. */
export function staleSyncTokenIfCallerMismatch(
  callerBody: Record<string, unknown>,
  currentSyncToken: string
): string | null {
  const supplied = callerBody.SyncToken ?? callerBody.sync_token;
  if (supplied === undefined || supplied === null) {
    return null;
  }
  if (String(supplied) !== String(currentSyncToken)) {
    return staleSyncTokenMessage(String(currentSyncToken));
  }
  return null;
}

export const LINE_ITEMS_TOOL_DESCRIPTION =
  "Optional line_items: lines you do not mention are kept unchanged. Use id from the read tool to edit a line; omit id to add one; set remove: true with id to delete one. Use search_classes for class Ids.";
