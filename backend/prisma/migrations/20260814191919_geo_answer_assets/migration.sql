-- AlterEnum
ALTER TYPE "approval_subject_type" ADD VALUE 'geo_answer_asset';

-- CreateTable
CREATE TABLE "geo_answer_assets" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "query_id" UUID NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "linked_claim_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_answer_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "geo_answer_assets_query_id_key" ON "geo_answer_assets"("query_id");

-- AddForeignKey
ALTER TABLE "geo_answer_assets" ADD CONSTRAINT "geo_answer_assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_answer_assets" ADD CONSTRAINT "geo_answer_assets_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "geo_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
