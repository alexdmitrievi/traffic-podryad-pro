-- CreateTable
CREATE TABLE "geo_visibility_snapshots" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "query_id" UUID NOT NULL,
    "search_engine" TEXT NOT NULL,
    "search_phrase" TEXT,
    "brand_mentioned" BOOLEAN NOT NULL,
    "mention_position" INTEGER,
    "answer_excerpt" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geo_visibility_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geo_visibility_snapshots_query_id_captured_at_idx" ON "geo_visibility_snapshots"("query_id", "captured_at");

-- AddForeignKey
ALTER TABLE "geo_visibility_snapshots" ADD CONSTRAINT "geo_visibility_snapshots_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_visibility_snapshots" ADD CONSTRAINT "geo_visibility_snapshots_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "geo_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
