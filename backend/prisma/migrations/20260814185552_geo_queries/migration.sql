-- CreateEnum
CREATE TYPE "geo_query_priority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "geo_query_status" AS ENUM ('open', 'planned', 'answered', 'dismissed');

-- CreateTable
CREATE TABLE "geo_queries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "cluster_id" UUID,
    "product_id" UUID,
    "region_id" UUID,
    "priority" "geo_query_priority" NOT NULL DEFAULT 'medium',
    "status" "geo_query_status" NOT NULL DEFAULT 'open',
    "status_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_queries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geo_queries_workspace_id_status_idx" ON "geo_queries"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "geo_queries_workspace_id_cluster_id_idx" ON "geo_queries"("workspace_id", "cluster_id");

-- AddForeignKey
ALTER TABLE "geo_queries" ADD CONSTRAINT "geo_queries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_queries" ADD CONSTRAINT "geo_queries_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "topic_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_queries" ADD CONSTRAINT "geo_queries_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_queries" ADD CONSTRAINT "geo_queries_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
