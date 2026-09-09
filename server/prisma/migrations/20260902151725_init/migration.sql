/*
  Warnings:

  - The values [OPEN] on the enum `OrderStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `currency` on the `Balance` table. All the data in the column will be lost.
  - The primary key for the `Fill` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `marketId` on the `Fill` table. All the data in the column will be lost.
  - The `id` column on the `Fill` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `buyOrderId` column on the `Fill` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `sellOrderId` column on the `Fill` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `Order` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `marketId` on the `Order` table. All the data in the column will be lost.
  - The `id` column on the `Order` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `Market` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[userId,asset]` on the table `Balance` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `asset` to the `Balance` table without a default value. This is not possible if the table is not empty.
  - Added the required column `symbol` to the `Fill` table without a default value. This is not possible if the table is not empty.
  - Added the required column `symbol` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Asset" AS ENUM ('USD', 'BTC');

-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED');
ALTER TABLE "public"."Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "public"."OrderStatus_old";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- DropForeignKey
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_buyOrderId_fkey";

-- DropForeignKey
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_marketId_fkey";

-- DropForeignKey
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_sellOrderId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_marketId_fkey";

-- DropIndex
DROP INDEX "Balance_userId_currency_key";

-- DropIndex
DROP INDEX "Fill_marketId_createdAt_idx";

-- DropIndex
DROP INDEX "Order_marketId_status_idx";

-- AlterTable
ALTER TABLE "Balance" DROP COLUMN "currency",
ADD COLUMN     "asset" "Asset" NOT NULL;

-- AlterTable
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_pkey",
DROP COLUMN "marketId",
ADD COLUMN     "symbol" TEXT NOT NULL,
ADD COLUMN     "userId" INTEGER,
DROP COLUMN "id",
ADD COLUMN     "id" BIGSERIAL NOT NULL,
DROP COLUMN "buyOrderId",
ADD COLUMN     "buyOrderId" BIGINT,
DROP COLUMN "sellOrderId",
ADD COLUMN     "sellOrderId" BIGINT,
ADD CONSTRAINT "Fill_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Order" DROP CONSTRAINT "Order_pkey",
DROP COLUMN "marketId",
ADD COLUMN     "symbol" TEXT NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" BIGSERIAL NOT NULL,
ADD CONSTRAINT "Order_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "Market";

-- CreateIndex
CREATE UNIQUE INDEX "Balance_userId_asset_key" ON "Balance"("userId", "asset");

-- CreateIndex
CREATE INDEX "Fill_symbol_createdAt_idx" ON "Fill"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "Fill_buyOrderId_idx" ON "Fill"("buyOrderId");

-- CreateIndex
CREATE INDEX "Fill_sellOrderId_idx" ON "Fill"("sellOrderId");

-- CreateIndex
CREATE INDEX "Order_symbol_status_idx" ON "Order"("symbol", "status");

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_buyOrderId_fkey" FOREIGN KEY ("buyOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_sellOrderId_fkey" FOREIGN KEY ("sellOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
