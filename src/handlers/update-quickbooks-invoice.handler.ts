import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import {
  buildMergedLines,
  evaluateSalesLinePostWrite,
  sparseUpdateBodyFromRecord,
  staleSyncTokenIfCallerMismatch,
  validatePatchEntityId,
  validatePatchLineAgainstCurrent,
  type SalesLineItemInput,
} from "../helpers/sales-line-update.js";
import { validateLineClassRefs } from "../helpers/sales-line-class-ref.js";

export interface UpdateInvoiceInput {
  invoice_id: string;
  patch?: Record<string, any>;
  line_items?: SalesLineItemInput[];
  replace_all_lines?: boolean;
}

export async function updateQuickbooksInvoice(input: UpdateInvoiceInput): Promise<ToolResponse<any>> {
  const { invoice_id, line_items, replace_all_lines } = input;
  const patch = input.patch ?? {};
  try {
    const quickbooks = await QuickbooksClient.getInstance();

    const patchIdError = validatePatchEntityId(patch.Id, invoice_id, "patch");
    if (patchIdError) {
      return { result: null, isError: true, error: patchIdError };
    }

    const existing: any = await new Promise((res, rej) => {
      (quickbooks as any).getInvoice(invoice_id, (e: any, inv: any) => (e ? rej(e) : res(inv)));
    });

    const staleSyncError = staleSyncTokenIfCallerMismatch(patch, String(existing.SyncToken));
    if (staleSyncError) {
      return { result: null, isError: true, error: staleSyncError };
    }

    if (line_items && line_items.length > 0) {
      if (patch?.Line !== undefined) {
        return {
          result: null,
          isError: true,
          error: "Cannot use patch.Line together with line_items; use one or the other.",
        };
      }

      const classRefError = validateLineClassRefs(line_items);
      if (classRefError) {
        return { result: null, isError: true, error: classRefError };
      }

      const merged = buildMergedLines(existing.Line ?? [], line_items);
      if ("error" in merged) {
        return { result: null, isError: true, error: merged.error };
      }

      const patchBody = sparseUpdateBodyFromRecord(patch);
      const updatePayload = {
        ...patchBody,
        Id: invoice_id,
        SyncToken: existing.SyncToken,
        sparse: true,
        Line: merged.lines,
      };

      const updated: any = await new Promise((res, rej) => {
        (quickbooks as any).updateInvoice(updatePayload, (e: any, inv: any) => (e ? rej(e) : res(inv)));
      });

      const postWrite = await evaluateSalesLinePostWrite(
        quickbooks,
        existing.Line ?? [],
        updated,
        line_items,
        `Invoice ${invoice_id}`
      );

      if (postWrite.kind === "error") {
        return { result: postWrite.entity, isError: true, error: postWrite.message };
      }
      return { result: postWrite.entity, isError: false, error: null };
    }

    if (patch?.Line !== undefined) {
      const patchLineError = validatePatchLineAgainstCurrent(
        existing.Line ?? [],
        patch.Line,
        replace_all_lines
      );
      if (patchLineError) {
        return { result: null, isError: true, error: patchLineError };
      }

      const updatePayload = { ...existing, ...patch, Id: invoice_id, sparse: true };

      return new Promise((resolve) => {
        (quickbooks as any).updateInvoice(updatePayload, (err: any, updated: any) => {
          if (err) {
            resolve({ result: null, isError: true, error: formatError(err) });
          } else {
            resolve({ result: updated, isError: false, error: null });
          }
        });
      });
    }

    const patchBody = sparseUpdateBodyFromRecord(patch);
    const updatePayload = {
      ...patchBody,
      Id: invoice_id,
      SyncToken: existing.SyncToken,
      sparse: true,
    };

    return new Promise((resolve) => {
      (quickbooks as any).updateInvoice(updatePayload, (err: any, updated: any) => {
        if (err) {
          resolve({ result: null, isError: true, error: formatError(err) });
        } else {
          resolve({ result: updated, isError: false, error: null });
        }
      });
    });
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
