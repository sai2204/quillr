import jwt from "jsonwebtoken";
import type { Role } from "./types.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

export class AuthError extends Error {}

export function extractRole(authHeader: string | undefined): Role {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError("Missing or malformed Authorization header");
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new AuthError("Missing bearer token");
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
  } catch {
    throw new AuthError("Invalid or expired token");
  }

  if (payload.role !== "admin" && payload.role !== "viewer") {
    throw new AuthError("Token missing valid role claim");
  }

  return payload.role;
}
