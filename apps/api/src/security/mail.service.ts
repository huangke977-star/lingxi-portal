import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";
import { MailJobStatus, MailJobType, Prisma } from "../generated/prisma/client";
import { createTransport } from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";
import { SecurityConfigurationService } from "./security-configuration.service";

interface MailInput {
  type: MailJobType;
  recipient: string;
  subject: string;
  text: string;
  html?: string;
  userId?: number;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class MailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: SecurityConfigurationService,
  ) {}

  async send(input: MailInput): Promise<{ id: number; status: MailJobStatus }> {
    const job = await this.prisma.mailJob.create({
      data: {
        userId: input.userId,
        type: input.type,
        recipient: input.recipient,
        subject: input.subject,
        metadata: input.metadata,
      },
      select: { id: true },
    });
    try {
      await this.prisma.mailJob.update({
        where: { id: job.id },
        data: { status: MailJobStatus.sending, attempts: { increment: 1 }, lastError: null },
      });
      const config = await this.configuration.getConfiguration();
      if (!config.smtpEnabled) throw new BadRequestException("SMTP 尚未启用。");
      await this.createTransport(config).sendMail({
        from: { name: config.smtpFromName, address: config.smtpFromEmail ?? config.smtpUsername ?? "" },
        to: input.recipient,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      await this.prisma.mailJob.update({
        where: { id: job.id },
        data: { status: MailJobStatus.sent, sentAt: new Date(), lastError: null },
      });
      return { id: job.id, status: MailJobStatus.sent };
    } catch (error) {
      const message = this.errorMessage(error);
      await this.prisma.mailJob.update({
        where: { id: job.id },
        data: { status: MailJobStatus.failed, lastError: message.slice(0, 1000) },
      });
      throw new BadGatewayException(`邮件发送失败：${message}`);
    }
  }

  async testConnection(): Promise<{ success: true; message: string }> {
    const config = await this.configuration.getConfiguration();
    if (!config.smtpHost || !config.smtpUsername || !config.smtpPasswordEncrypted || !config.smtpFromEmail) {
      throw new BadRequestException("请先保存完整的 SMTP 配置。");
    }
    try {
      await this.createTransport(config).verify();
      return { success: true, message: "SMTP 连接与身份验证正常。" };
    } catch (error) {
      throw new BadGatewayException(`SMTP 测试失败：${this.errorMessage(error)}`);
    }
  }

  private createTransport(config: Awaited<ReturnType<SecurityConfigurationService["getConfiguration"]>>) {
    return createTransport({
      host: config.smtpHost ?? "",
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.smtpUsername ?? "",
        pass: this.configuration.decryptSmtpPassword(config),
      },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 12_000,
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error && error.message ? error.message : "未知错误";
  }
}
