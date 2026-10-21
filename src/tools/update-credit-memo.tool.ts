import { updateQuickbooksCreditMemo } from "../handlers/update-quickbooks-credit-memo.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";
import { LINE_ITEMS_TOOL_DESCRIPTION, salesLineItemSchema } from "../helpers/sales-line-update.js";

const toolName = "update_credit_memo";
const toolDescription = "Update an existing credit memo in QuickBooks Online. " + LINE_ITEMS_TOOL_DESCRIPTION;

const toolSchema = z.object({
  id: z.string().min(1).describe("Credit Memo ID"),
  sync_token: z.string().min(1).describe("Sync token for optimistic locking"),
  customer_ref: z.string().optional().describe("Customer ID"),
  private_note: z.string().optional().describe("Private note"),
  doc_number: z.string().optional().describe("Document number"),
  line_items: z.array(salesLineItemSchema).optional(),
});

const toolHandler = async ({ params }: any) => {
  const response = await updateQuickbooksCreditMemo(params);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error updating credit memo: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: `Credit memo updated successfully:` },
      { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
    ],
  };
};

export const UpdateCreditMemoTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
