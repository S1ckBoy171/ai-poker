-- Settings, API keys and hands now belong to an account. Rows saved before accounts existed can't be
-- assigned to anyone, so they are cleared (at migration time: 1 settings row, 0 keys, 16 hands).
DELETE FROM "hands";
DELETE FROM "api_keys";
DELETE FROM "settings";

-- DropIndex
DROP INDEX "hands_created_at_idx";

-- AlterTable
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_pkey",
ADD COLUMN     "user_id" TEXT NOT NULL,
ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("user_id", "id");

-- AlterTable
ALTER TABLE "hands" ADD COLUMN     "user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "settings" DROP CONSTRAINT "settings_pkey",
DROP COLUMN "id",
ADD COLUMN     "user_id" TEXT NOT NULL,
ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("user_id");

-- CreateIndex
CREATE INDEX "hands_user_id_created_at_idx" ON "hands"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hands" ADD CONSTRAINT "hands_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

