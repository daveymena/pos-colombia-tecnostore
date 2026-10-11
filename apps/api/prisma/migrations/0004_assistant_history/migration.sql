-- CreateTable
CREATE TABLE "AssistantTurn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantTurn_companyId_userId_createdAt_idx" ON "AssistantTurn"("companyId", "userId", "createdAt");
