import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

describe("admin.overview", () => {
  it("rejects non-admin users before touching platform data", async () => {
    const ctx: TrpcContext = {
      user: {
        id: 7,
        openId: "regular-user",
        email: "user@example.com",
        name: "Regular User",
        loginMethod: "manus",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };

    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.overview()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "You do not have required permission (10002)",
    });
  });
});
