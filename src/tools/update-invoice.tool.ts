import { updateQuickbooksInvoice } from "../handlers/update-quickbooks-invoice.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";
import { LINE_ITEMS_TOOL_DESCRIPTION, salesLineItemSchema } from "../helpers/sales-line-update.js";

const toolName = "update_invoice";
const toolDescription =
  "Update an existing invoice in Quickbooks by ID (sparse update). " + LINE_ITEMS_TOOL_DESCRIPTION;

const toolSchema = z.object({
  invoice_id: z.string().min(1),
  patch: z.record(z.any()),
  line_items: z.array(salesLineItemSchema).optional(),
  replace_all_lines: z
    .boolean()
    .optional()
    .describe("When using patch.Line, set true to intentionally replace the full Line array."),
});

const toolHandler = async ({ params }: any) => {
  const response = await updateQuickbooksInvoice(params);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error updating invoice: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: `Invoice updated successfully:` },
      { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
    ],
  };
};

export const UpdateInvoiceTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
