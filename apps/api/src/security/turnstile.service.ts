import { HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { SecurityConfigurationService } from "./security-configuration.service";

@Injectable()
export class TurnstileService {
  constructor(private readonly configuration: SecurityConfigurationService) {}

  async verify(token: string | undefined, ip: string, enabled: boolean): Promise<void> {
    if (!enabled) return;
    if (!token?.trim()) {
      throw new HttpException({ message: "请完成人机验证。", code: "TURNSTILE_REQUIRED" }, 428);
    }
    const config = await this.configuration.getConfiguration();
    const secret = this.configuration.decryptTurnstileSecret(config);
    const body = new URLSearchParams({ secret, response: token.trim(), remoteip: ip });
    let response: Response;
    try {
      response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new ServiceUnavailableException("人机验证服务暂时不可用，请稍后重试。");
    }
    const result = await response.json().catch(() => null) as { success?: boolean } | null;
    if (!response.ok || !result?.success) {
      throw new HttpException({ message: "人机验证未通过，请重试。", code: "TURNSTILE_FAILED" }, 428);
    }
  }
}
