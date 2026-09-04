import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { lookupCustomer } from "./customers.js";
import { getCustomerRecordSchema, triggerRefundSchema } from "./schemas.js";

const server = new Server(
  { name: "quillr-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: "get_customer_record",
    description: "Look up a mock customer record by customer_id.",
    inputSchema: zodToJsonSchema(getCustomerRecordSchema) as Record<string, unknown>,
  },
  {
    name: "trigger_refund",
    description: "Trigger a mock refund for a customer.",
    inputSchema: zodToJsonSchema(triggerRefundSchema) as Record<string, unknown>,
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Schema violations must surface as protocol-level JSON-RPC errors
  // (-32602), not as a tool-result payload, so invalid input never reaches
  // handler logic below this point.
  switch (name) {
    case "get_customer_record": {
      const parsed = getCustomerRecordSchema.safeParse(args);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, parsed.error.issues.map((i) => i.message).join("; "));
      }
      const record = lookupCustomer(parsed.data.customer_id);
      logger.info({ customer_id: parsed.data.customer_id }, "get_customer_record");
      return { content: [{ type: "text", text: JSON.stringify(record) }] };
    }

    case "trigger_refund": {
      const parsed = triggerRefundSchema.safeParse(args);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, parsed.error.issues.map((i) => i.message).join("; "));
      }
      const { customer_id, amount, reason } = parsed.data;
      const confirmation = {
        refund_id: `REF-${randomUUID().slice(0, 8).toUpperCase()}`,
        status: "confirmed",
        amount,
        customer_id,
      };
      logger.info({ customer_id, amount, reason }, "trigger_refund");
      return { content: [{ type: "text", text: JSON.stringify(confirmation) }] };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("quillr-mcp-server listening on stdio");
}

main().catch((err) => {
  logger.error({ err }, "fatal error starting MCP server");
  process.exit(1);
});
