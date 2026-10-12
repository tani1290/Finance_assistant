-- CreateTable
CREATE TABLE IF NOT EXISTS "mobile_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceModel" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "fcmToken" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pending_sms_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "transactionType" "TransactionType" NOT NULL DEFAULT 'EXPENSE',
    "merchant" TEXT,
    "accountHint" TEXT,
    "matchedAccountId" TEXT,
    "suggestedCategory" TEXT,
    "confidence" DECIMAL(5,4),
    "categoryReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'BANK_SMS',
    "rawSender" TEXT,
    "rawMessageHash" TEXT,
    "bankReference" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedTransactionId" TEXT,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_sms_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fcm_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL DEFAULT 'default',
    "platform" TEXT NOT NULL DEFAULT 'android',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fcm_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "mobile_devices_userId_deviceId_key" ON "mobile_devices"("userId", "deviceId");
CREATE INDEX IF NOT EXISTS "mobile_devices_userId_idx" ON "mobile_devices"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pending_sms_transactions_userId_idx" ON "pending_sms_transactions"("userId");
CREATE INDEX IF NOT EXISTS "pending_sms_transactions_userId_status_idx" ON "pending_sms_transactions"("userId", "status");
CREATE INDEX IF NOT EXISTS "pending_sms_transactions_userId_rawMessageHash_idx" ON "pending_sms_transactions"("userId", "rawMessageHash");
CREATE INDEX IF NOT EXISTS "pending_sms_transactions_userId_bankReference_idx" ON "pending_sms_transactions"("userId", "bankReference");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fcm_tokens_userId_deviceId_key" ON "fcm_tokens"("userId", "deviceId");
CREATE INDEX IF NOT EXISTS "fcm_tokens_userId_idx" ON "fcm_tokens"("userId");

-- AddForeignKey
ALTER TABLE "mobile_devices" DROP CONSTRAINT IF EXISTS "mobile_devices_userId_fkey";
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_sms_transactions" DROP CONSTRAINT IF EXISTS "pending_sms_transactions_userId_fkey";
ALTER TABLE "pending_sms_transactions" ADD CONSTRAINT "pending_sms_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_sms_transactions" DROP CONSTRAINT IF EXISTS "pending_sms_transactions_matchedAccountId_fkey";
ALTER TABLE "pending_sms_transactions" ADD CONSTRAINT "pending_sms_transactions_matchedAccountId_fkey" FOREIGN KEY ("matchedAccountId") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fcm_tokens" DROP CONSTRAINT IF EXISTS "fcm_tokens_userId_fkey";
ALTER TABLE "fcm_tokens" ADD CONSTRAINT "fcm_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

