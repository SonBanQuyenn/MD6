-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- CreateTable
CREATE TABLE "verification_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_codes_user_id_purpose_created_at_idx" ON "verification_codes"("user_id", "purpose", "created_at");

-- AddForeignKey
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
