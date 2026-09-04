import { z } from "zod";

export const customerIdSchema = z
  .string()
  .regex(/^CUST-[A-Z0-9]{5}$/, "customer_id must match ^CUST-[A-Z0-9]{5}$");

export const getCustomerRecordSchema = z.object({
  customer_id: customerIdSchema,
});

export const triggerRefundSchema = z.object({
  customer_id: customerIdSchema,
  amount: z.number().positive("amount must be greater than 0"),
  reason: z.string().min(10, "reason must be at least 10 characters"),
});
