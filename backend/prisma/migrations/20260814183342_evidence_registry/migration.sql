-- CreateEnum
CREATE TYPE "evidence_source_kind" AS ENUM ('official_standard', 'producer_document', 'regulatory_document', 'price_list', 'industry_publication', 'expert_statement', 'other');

-- CreateTable
CREATE TABLE "evidence_sources" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "evidence_source_kind" NOT NULL,
    "url" TEXT,
    "published_at" TIMESTAMP(3),
    "retrieved_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "verified_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "statement" TEXT NOT NULL,
    "statement_hash" TEXT NOT NULL,
    "category" TEXT,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" UUID,
    "superseded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_citations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "location" TEXT NOT NULL,
    "quote" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_citations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evidence_sources_workspace_id_kind_idx" ON "evidence_sources"("workspace_id", "kind");

-- CreateIndex
CREATE INDEX "claims_workspace_id_created_at_idx" ON "claims"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "claims_workspace_id_source_id_statement_hash_key" ON "claims"("workspace_id", "source_id", "statement_hash");

-- CreateIndex
CREATE INDEX "claim_citations_claim_id_idx" ON "claim_citations"("claim_id");

-- AddForeignKey
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_sources" ADD CONSTRAINT "evidence_sources_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "evidence_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_citations" ADD CONSTRAINT "claim_citations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_citations" ADD CONSTRAINT "claim_citations_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
