-- CreateTable
CREATE TABLE "hands" (
    "id" SERIAL NOT NULL,
    "game_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hands_created_at_idx" ON "hands"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "hands_game_id_number_key" ON "hands"("game_id", "number");
