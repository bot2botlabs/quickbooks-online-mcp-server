import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import {
  buildMergedLines,
  evaluateSalesLinePostWrite,
  sparseUpdateBodyFromRecord,
  validatePatchLineAgainstCurrent,
  type SalesLineItemInput,
} from "../helpers/sales-line-update.js";
import { validateLineClassRefs } from "../helpers/sales-line-class-ref.js";

export interface UpdateEstimateInput {
  estimate: any;
  line_items?: SalesLineItemInput[];
  replace_all_lines?: boolean;
}

/**
 * Update an estimate in QuickBooks Online (must include Id and SyncToken in estimate when not using line_items)
 */
export async function updateQuickbooksEstimate(input: UpdateEstimateInput | any): Promise<ToolResponse<any>> {
  const normalized: UpdateEstimateInput =
    input && typeof input === "object" && "estimate" in input
      ? (input as UpdateEstimateInput)
      : { estimate: input };

  const { estimate: estimateData, line_items, replace_all_lines } = normalized;

  try {
    const quickbooks = await QuickbooksClient.getInstance();

    if (line_items && line_items.length > 0) {
      if (!estimateData?.Id) {
        return { result: null, isError: true, error: "line_items updates require estimate.Id." };
      }
      if (estimateData?.Line !== undefined) {
        return {
          result: null,
          isError: true,
          error: "Cannot use estimate.Line together with line_items; use one or the other.",
        };
      }

      const classRefError = validateLineClassRefs(line_items);
      if (classRefError) {
        return { result: null, isError: true, error: classRefError };
      }

      const current: any = await new Promise((res, rej) => {
        (quickbooks as any).getEstimate(String(estimateData.Id), (e: any, est: any) => (e ? rej(e) : res(est)));
      });

      if (
        estimateData.SyncToken !== undefined &&
        String(estimateData.SyncToken) !== String(current.SyncToken)
      ) {
        return {
          result: null,
          isError: true,
          error: `stale sync_token: the transaction changed since you read it (current SyncToken ${current.SyncToken}); re-read and retry`,
        };
      }

      const merged = buildMergedLines(current.Line ?? [], line_items);
      if ("error" in merged) {
        return { result: null, isError: true, error: merged.error };
      }

      const estimateBody = sparseUpdateBodyFromRecord(estimateData);
      const updatePayload = {
        ...estimateBody,
        Id: estimateData.Id,
        SyncToken: current.SyncToken,
        sparse: true,
        Line: merged.lines,
      };

      const updated: any = await new Promise((res, rej) => {
        quickbooks.updateEstimate(updatePayload, (e: any, est: any) => (e ? rej(e) : res(est)));
      });

      const postWrite = await evaluateSalesLinePostWrite(
        quickbooks,
        current.Line ?? [],
        updated,
        line_items,
        `Estimate ${estimateData.Id}`
      );

      if (postWrite.kind === "error") {
        return { result: postWrite.entity, isError: true, error: postWrite.message };
      }
      return { result: postWrite.entity, isError: false, error: null };
    }

    if (estimateData?.Line !== undefined) {
      const current: any = await new Promise((res, rej) => {
        (quickbooks as any).getEstimate(String(estimateData.Id), (e: any, est: any) => (e ? rej(e) : res(est)));
      });

      const patchLineError = validatePatchLineAgainstCurrent(
        current.Line ?? [],
        estimateData.Line,
        replace_all_lines
      );
      if (patchLineError) {
        return { result: null, isError: true, error: patchLineError.replace("patch.Line", "estimate.Line") };
      }

      const updatePayload = { ...current, ...estimateData, sparse: true };

      return new Promise((resolve) => {
        quickbooks.updateEstimate(updatePayload, (err: any, estimate: any) => {
          if (err) {
            resolve({ result: null, isError: true, error: formatError(err) });
          } else {
            resolve({ result: estimate, isError: false, error: null });
          }
        });
      });
    }

    return new Promise((resolve) => {
      quickbooks.updateEstimate(estimateData, (err: any, estimate: any) => {
        if (err) {
          resolve({
            result: null,
            isError: true,
            error: formatError(err),
          });
        } else {
          resolve({
            result: estimate,
            isError: false,
            error: null,
          });
        }
      });
    });
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
