// Small HTTP utilities shared by modules: async-handler wrapping (Express 4 does
// not catch async throws), Zod body validation → 400 VALIDATION_FAILED, and typed
// access to the authenticated principal.
import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, output } from "zod";
import { ApiError } from "./errors.js";
import type { AccessClaims } from "../modules/identity/tokens.js";

export interface Principal {
  userId: string;
  role: AccessClaims["role"];
  congregationId: string | null;
  mfa?: boolean; // a second factor was verified for the presenting token (§5.3)
  mfaAt?: number; // unix seconds of that verification
  pwdAt?: number; // unix seconds of a PASSWORD re-confirmation on this token (§5.3)
}

// Augment Express Request with our principal.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

export type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;

/** Wrap an async handler so thrown errors reach the error middleware. */
export function handler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

export function requirePrincipal(req: Request): Principal {
  if (!req.principal) throw new ApiError("AUTH_REQUIRED", "Authentication required");
  return req.principal;
}

/**
 * The unplaced-member rule (2026-08-21, after cong:"" reached uuid-typed SQL
 * as a 500): READS take a null congregation and come back empty — an unplaced
 * member simply has nothing scoped to see. WRITES land here instead: creating
 * or changing congregation-scoped state with no congregation is a question
 * with no right answer, so it gets a named refusal a human can act on, not an
 * orphan row and not a 500.
 */
export function requirePlacement(principal: Principal): string {
  if (!principal.congregationId) {
    throw new ApiError("UNPROCESSABLE", "Your account is not placed in a congregation yet — ask an admin to place you");
  }
  return principal.congregationId;
}

export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): output<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError("VALIDATION_FAILED", "Request body failed validation", {
      fields: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}
