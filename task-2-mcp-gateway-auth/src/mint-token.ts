import "dotenv/config";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const role = process.argv[2];

if (role !== "admin" && role !== "viewer") {
  console.error("Usage: tsx src/mint-token.ts <admin|viewer>");
  process.exit(1);
}

console.log(jwt.sign({ role }, JWT_SECRET, { expiresIn: "1h" }));
