import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { PrismaService } from "../prisma/prisma.service";
import { ArticlesController } from "./articles.controller";
import { ArticlesService } from "./articles.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [ArticlesController],
  providers: [PrismaService, ArticlesService],
})
export class ArticlesModule {}
