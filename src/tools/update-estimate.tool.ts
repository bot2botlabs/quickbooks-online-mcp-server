import { updateQuickbooksEstimate } from "../handlers/update-quickbooks-estimate.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";
import { LINE_ITEMS_TOOL_DESCRIPTION, salesLineItemSchema } from "../helpers/sales-line-update.js";

const toolName = "update_estimate";
const toolDescription = "Update an estimate in QuickBooks Online. " + LINE_ITEMS_TOOL_DESCRIPTION;
const toolSchema = z.object({
  estimate: z.any(),
  line_items: z.array(salesLineItemSchema).optional(),
  replace_all_lines: z
    .boolean()
    .optional()
    .describe("When using estimate.Line, set true to intentionally replace the full Line array."),
});

const toolHandler = async (args: any) => {
  const response = await updateQuickbooksEstimate(args.params);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error updating estimate: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: `Estimate updated:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const UpdateEstimateTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
