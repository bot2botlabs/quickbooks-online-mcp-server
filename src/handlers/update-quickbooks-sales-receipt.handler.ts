import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import {
  buildMergedLines,
  evaluateSalesLinePostWrite,
  staleSyncTokenMessage,
  type SalesLineItemInput,
} from "../helpers/sales-line-update.js";
import { validateLineClassRefs } from "../helpers/sales-line-class-ref.js";

export interface UpdateSalesReceiptInput {
  id: string;
  sync_token: string;
  customer_ref?: string;
  private_note?: string;
  doc_number?: string;
  line_items?: SalesLineItemInput[];
}

export async function updateQuickbooksSalesReceipt(data: UpdateSalesReceiptInput): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await QuickbooksClient.getInstance();

    if (data.line_items && data.line_items.length > 0) {
      const classRefError = validateLineClassRefs(data.line_items);
      if (classRefError) {
        return { result: null, isError: true, error: classRefError };
      }

      const current: any = await new Promise((res, rej) => {
        (quickbooks as any).getSalesReceipt(data.id, (e: any, sr: any) => (e ? rej(e) : res(sr)));
      });

      if (String(current.SyncToken) !== String(data.sync_token)) {
        return {
          result: null,
          isError: true,
          error: staleSyncTokenMessage(String(current.SyncToken)),
        };
      }

      const merged = buildMergedLines(current.Line ?? [], data.line_items);
      if ("error" in merged) {
        return { result: null, isError: true, error: merged.error };
      }

      const payload: any = {
        Id: data.id,
        SyncToken: data.sync_token,
        sparse: true,
        Line: merged.lines,
      };
      if (data.customer_ref) {
        payload.CustomerRef = { value: data.customer_ref };
      }
      if (data.private_note) {
        payload.PrivateNote = data.private_note;
      }
      if (data.doc_number) {
        payload.DocNumber = data.doc_number;
      }

      const updated: any = await new Promise((res, rej) => {
        (quickbooks as any).updateSalesReceipt(payload, (e: any, sr: any) => (e ? rej(e) : res(sr)));
      });

      const postWrite = await evaluateSalesLinePostWrite(
        quickbooks,
        current.Line ?? [],
        updated,
        data.line_items,
        `Sales receipt ${data.id}`
      );

      if (postWrite.kind === "error") {
        return { result: postWrite.entity, isError: true, error: postWrite.message };
      }
      if (postWrite.kind === "warning") {
        return { result: postWrite.entity, isError: false, error: null };
      }
      return { result: postWrite.entity, isError: false, error: null };
    }

    const payload: any = {
      Id: data.id,
      SyncToken: data.sync_token,
      sparse: true,
    };

    if (data.customer_ref) {
      payload.CustomerRef = { value: data.customer_ref };
    }
    if (data.private_note) {
      payload.PrivateNote = data.private_note;
    }
    if (data.doc_number) {
      payload.DocNumber = data.doc_number;
    }

    return new Promise((resolve) => {
      (quickbooks as any).updateSalesReceipt(payload, (err: any, updated: any) => {
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
