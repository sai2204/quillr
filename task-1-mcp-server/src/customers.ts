export interface CustomerRecord {
  id: string;
  name: string;
  email: string;
  status: "active" | "suspended" | "closed";
}

const MOCK_CUSTOMERS: Record<string, CustomerRecord> = {
  "CUST-A1B2C": { id: "CUST-A1B2C", name: "Priya Sharma", email: "priya.sharma@example.com", status: "active" },
  "CUST-X9Y8Z": { id: "CUST-X9Y8Z", name: "Daniel Osei", email: "daniel.osei@example.com", status: "suspended" },
};

export function lookupCustomer(customerId: string): CustomerRecord {
  return (
    MOCK_CUSTOMERS[customerId] ?? {
      id: customerId,
      name: "Unknown Customer",
      email: "unknown@example.com",
      status: "active",
    }
  );
}
