/// <reference types="jest" />

import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { CloudflareContentService } from "./cloudflare-content.service.js";

function service() {
  const values: Record<string, string> = {
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN: "token",
    CLOUDFLARE_IMAGE_MODEL: "@cf/black-forest-labs/flux-1-schnell",
    CLOUDFLARE_IMAGE_STEPS: "4",
  };
  const config = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!values[key]) throw new Error(`Missing ${key}`);
      return values[key];
    },
  } as ConfigService;
  return new CloudflareContentService(config);
}

describe("CloudflareContentService image generation", () => {
  afterEach(() => jest.restoreAllMocks());

  it("uses steps instead of the unsupported num_steps for FLUX schnell", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, result: { image: Buffer.from("image").toString("base64") } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(service().generateImage("A calm sunrise")).resolves.toEqual(Buffer.from("image"));
    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body.steps).toBe(4);
    expect(body).not.toHaveProperty("num_steps");
  });

  it("returns a controlled error when Cloudflare rejects the input schema", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ message: "Additional property not allowed" }],
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );

    try {
      await service().generateImage("A calm sunrise");
      throw new Error("Expected image generation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: "AI_IMAGE_BAD_INPUT",
        message: expect.stringContaining("configuración"),
      });
    }
  });
});
