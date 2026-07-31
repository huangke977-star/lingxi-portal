import { BadRequestException } from "@nestjs/common";
import { SiteAssetKind } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { SiteAssetsService } from "../src/site-settings/site-assets.service";

describe("site asset deletion protection", () => {
  it("rejects deletion when the uploaded resource is currently configured", async () => {
    const prisma = {
      siteAsset: {
        findUnique: jest.fn(async () => ({
          kind: SiteAssetKind.logo,
          storedName: "logo-12345678-1234-1234-1234-123456789abc.png",
        })),
        delete: jest.fn(),
      },
      siteSetting: {
        findUnique: jest.fn(async () => ({
          logoPath: "/api/site-settings/assets/files/logo-12345678-1234-1234-1234-123456789abc.png",
          pwaIconPath: "/icon-192.png",
        })),
      },
    };
    const service = new SiteAssetsService(prisma as unknown as PrismaService);

    await expect(service.delete(1)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.siteAsset.delete).not.toHaveBeenCalled();
  });
});
