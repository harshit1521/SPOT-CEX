/*
  Warnings:

  - You are about to drop the column `userId` on the `Fill` table. All the data in the column will be lost.
  - Made the column `buyOrderId` on table `Fill` required. This step will fail if there are existing NULL values in that column.
  - Made the column `sellOrderId` on table `Fill` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'OPEN';

-- DropForeignKey
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_buyOrderId_fkey";

-- DropForeignKey
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_sellOrderId_fkey";

-- DropForeignKey
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_userId_fkey";

-- AlterTable
ALTER TABLE "Fill" DROP COLUMN "userId",
ALTER COLUMN "buyOrderId" SET NOT NULL,
ALTER COLUMN "sellOrderId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Fill_buyOrderId_idx" ON "Fill"("buyOrderId");

-- CreateIndex
CREATE INDEX "Fill_sellOrderId_idx" ON "Fill"("sellOrderId");

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_buyOrderId_fkey" FOREIGN KEY ("buyOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_sellOrderId_fkey" FOREIGN KEY ("sellOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
