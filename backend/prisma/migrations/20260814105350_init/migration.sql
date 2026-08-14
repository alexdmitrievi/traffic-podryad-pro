-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin', 'editor', 'viewer');

-- CreateEnum
CREATE TYPE "region_kind" AS ENUM ('country', 'federal_district', 'subject', 'city');

-- CreateEnum
CREATE TYPE "measurement_unit" AS ENUM ('tonne', 'litre', 'cubic_metre', 'kilogram', 'piece');

-- CreateEnum
CREATE TYPE "service_line" AS ENUM ('seo_content', 'b2b_outreach', 'telegram_marketing', 'complex_package');

-- CreateEnum
CREATE TYPE "service_request_status" AS ENUM ('draft', 'submitted', 'triage', 'accepted', 'rejected', 'planning', 'plan_approved', 'in_delivery', 'delivered', 'planned_awaiting_capability', 'partially_delivered', 'on_hold', 'cancelled');

-- CreateEnum
CREATE TYPE "plan_status" AS ENUM ('draft', 'approved');

-- CreateEnum
CREATE TYPE "author_kind" AS ENUM ('human', 'llm');

-- CreateEnum
CREATE TYPE "keyword_intent" AS ENUM ('informational', 'commercial', 'transactional', 'navigational', 'unknown');

-- CreateEnum
CREATE TYPE "keyword_source" AS ENUM ('csv_import', 'manual');

-- CreateEnum
CREATE TYPE "topic_cluster_status" AS ENUM ('draft', 'selected', 'briefed', 'published', 'archived');

-- CreateEnum
CREATE TYPE "brief_status" AS ENUM ('draft', 'in_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "content_status" AS ENUM ('draft', 'in_review', 'approved', 'published', 'archived');

-- CreateEnum
CREATE TYPE "publication_target" AS ENUM ('internal_website', 'export');

-- CreateEnum
CREATE TYPE "publication_status" AS ENUM ('pending', 'published', 'unpublished', 'failed');

-- CreateEnum
CREATE TYPE "approval_subject_type" AS ENUM ('service_request_plan', 'content_revision', 'publication');

-- CreateEnum
CREATE TYPE "approval_decision" AS ENUM ('approved', 'rejected');

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('new', 'qualified', 'contacted', 'converted', 'rejected', 'spam');

-- CreateEnum
CREATE TYPE "touch_position" AS ENUM ('first', 'last', 'middle');

-- CreateEnum
CREATE TYPE "task_outbox_status" AS ENUM ('pending', 'running', 'dead');

-- CreateEnum
CREATE TYPE "llm_run_purpose" AS ENUM ('brief_generation', 'draft_generation', 'plan_generation');

-- CreateEnum
CREATE TYPE "llm_run_status" AS ENUM ('succeeded', 'failed', 'timed_out', 'skipped');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "display_name" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'viewer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "previous_refresh_token_hash" TEXT,
    "refresh_rotated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verticals" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verticals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "region_kind" NOT NULL,
    "parent_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "vertical_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "unit" "measurement_unit" NOT NULL,
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_bases" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "vertical_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "request_number" TEXT NOT NULL,
    "service_line" "service_line" NOT NULL,
    "vertical_id" UUID,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "target_region_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "status" "service_request_status" NOT NULL DEFAULT 'draft',
    "status_reason" TEXT,
    "requested_by_id" UUID NOT NULL,
    "parent_request_id" UUID,
    "origin_lead_id" UUID,
    "deadline_hint" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_request_plans" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "plan_kind" "service_line" NOT NULL,
    "content" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "author_kind" "author_kind" NOT NULL,
    "author_id" UUID,
    "llm_run_id" UUID,
    "status" "plan_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_request_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "from_status" "service_request_status",
    "to_status" "service_request_status" NOT NULL,
    "reason" TEXT,
    "actor_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keywords" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "request_id" UUID,
    "phrase" TEXT NOT NULL,
    "normalized_phrase" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "intent" "keyword_intent" NOT NULL DEFAULT 'unknown',
    "product_id" UUID,
    "region_id" UUID,
    "source" "keyword_source" NOT NULL DEFAULT 'csv_import',
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_metrics" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "keyword_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "volume" INTEGER,
    "difficulty" DECIMAL(5,2),
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_clusters" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "pillar_keyword_id" UUID,
    "product_id" UUID,
    "region_id" UUID,
    "status" "topic_cluster_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topic_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cluster_keywords" (
    "cluster_id" UUID NOT NULL,
    "keyword_id" UUID NOT NULL,
    "relevance" DECIMAL(4,3) NOT NULL,

    CONSTRAINT "cluster_keywords_pkey" PRIMARY KEY ("cluster_id","keyword_id")
);

-- CreateTable
CREATE TABLE "content_briefs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "outline" JSONB NOT NULL,
    "target_keyword_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "audience" TEXT,
    "tone" TEXT,
    "status" "brief_status" NOT NULL DEFAULT 'draft',
    "author_kind" "author_kind" NOT NULL,
    "llm_run_id" UUID,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "brief_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "product_id" UUID,
    "region_id" UUID,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "current_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_revisions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "meta_title" TEXT,
    "meta_description" TEXT,
    "content_hash" TEXT NOT NULL,
    "author_kind" "author_kind" NOT NULL,
    "author_id" UUID,
    "llm_run_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "approval_id" UUID NOT NULL,
    "target" "publication_target" NOT NULL DEFAULT 'internal_website',
    "status" "publication_status" NOT NULL DEFAULT 'pending',
    "public_url" TEXT,
    "published_at" TIMESTAMP(3),
    "published_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cta_placements" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "variant" TEXT NOT NULL,
    "form_slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cta_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "subject_type" "approval_subject_type" NOT NULL,
    "subject_id" UUID NOT NULL,
    "content_hash" TEXT NOT NULL,
    "decision" "approval_decision" NOT NULL,
    "decided_by_id" UUID NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "product_id" UUID,
    "volume" DECIMAL(14,3),
    "volume_unit" "measurement_unit",
    "delivery_region_id" UUID,
    "delivery_basis_id" UUID,
    "company_name" TEXT,
    "inn" TEXT,
    "contact_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "message" TEXT,
    "landing_path" TEXT,
    "content_item_id" UUID,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "utm_term" TEXT,
    "consent_at" TIMESTAMP(3) NOT NULL,
    "consent_text_version" TEXT NOT NULL,
    "privacy_policy_version" TEXT NOT NULL,
    "dedupe_hash" TEXT NOT NULL,
    "status" "lead_status" NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribution_touches" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "visitor_id" UUID NOT NULL,
    "lead_id" UUID,
    "content_item_id" UUID,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "utm_term" TEXT,
    "position" "touch_position",
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribution_touches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_outbox" (
    "id" UUID NOT NULL,
    "task_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "task_outbox_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMP(3),
    "fencing_token" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "purpose" "llm_run_purpose" NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_minor_units" INTEGER,
    "cost_currency" TEXT,
    "latency_ms" INTEGER,
    "status" "llm_run_status" NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_previous_refresh_token_hash_key" ON "auth_sessions"("previous_refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_created_at_idx" ON "password_reset_tokens"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "verticals_workspace_id_code_key" ON "verticals"("workspace_id", "code");

-- CreateIndex
CREATE INDEX "regions_workspace_id_kind_idx" ON "regions"("workspace_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "regions_workspace_id_code_key" ON "regions"("workspace_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_workspace_id_code_key" ON "product_categories"("workspace_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_workspace_id_slug_key" ON "product_categories"("workspace_id", "slug");

-- CreateIndex
CREATE INDEX "products_workspace_id_category_id_idx" ON "products"("workspace_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_workspace_id_slug_key" ON "products"("workspace_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_bases_workspace_id_code_key" ON "delivery_bases"("workspace_id", "code");

-- CreateIndex
CREATE INDEX "service_requests_workspace_id_status_idx" ON "service_requests"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "service_requests_workspace_id_service_line_idx" ON "service_requests"("workspace_id", "service_line");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_workspace_id_request_number_key" ON "service_requests"("workspace_id", "request_number");

-- CreateIndex
CREATE INDEX "service_request_plans_workspace_id_status_idx" ON "service_request_plans"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_request_plans_request_id_version_key" ON "service_request_plans"("request_id", "version");

-- CreateIndex
CREATE INDEX "service_request_events_request_id_occurred_at_idx" ON "service_request_events"("request_id", "occurred_at");

-- CreateIndex
CREATE INDEX "keywords_workspace_id_product_id_idx" ON "keywords"("workspace_id", "product_id");

-- CreateIndex
CREATE INDEX "keywords_workspace_id_region_id_idx" ON "keywords"("workspace_id", "region_id");

-- CreateIndex
CREATE UNIQUE INDEX "keywords_workspace_id_normalized_phrase_locale_key" ON "keywords"("workspace_id", "normalized_phrase", "locale");

-- CreateIndex
CREATE INDEX "keyword_metrics_keyword_id_captured_at_idx" ON "keyword_metrics"("keyword_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "keyword_metrics_keyword_id_provider_captured_at_key" ON "keyword_metrics"("keyword_id", "provider", "captured_at");

-- CreateIndex
CREATE INDEX "topic_clusters_workspace_id_status_idx" ON "topic_clusters"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "topic_clusters_request_id_idx" ON "topic_clusters"("request_id");

-- CreateIndex
CREATE INDEX "cluster_keywords_keyword_id_idx" ON "cluster_keywords"("keyword_id");

-- CreateIndex
CREATE INDEX "content_briefs_workspace_id_status_idx" ON "content_briefs"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "content_items_current_revision_id_key" ON "content_items"("current_revision_id");

-- CreateIndex
CREATE INDEX "content_items_workspace_id_status_idx" ON "content_items"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "content_items_workspace_id_slug_locale_key" ON "content_items"("workspace_id", "slug", "locale");

-- CreateIndex
CREATE INDEX "content_revisions_content_item_id_created_at_idx" ON "content_revisions"("content_item_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_revisions_content_item_id_revision_number_key" ON "content_revisions"("content_item_id", "revision_number");

-- CreateIndex
CREATE INDEX "publications_workspace_id_status_idx" ON "publications"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "publications_content_item_id_idx" ON "publications"("content_item_id");

-- CreateIndex
CREATE INDEX "cta_placements_content_item_id_idx" ON "cta_placements"("content_item_id");

-- CreateIndex
CREATE INDEX "approvals_subject_type_subject_id_idx" ON "approvals"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "approvals_workspace_id_decided_at_idx" ON "approvals"("workspace_id", "decided_at");

-- CreateIndex
CREATE INDEX "leads_workspace_id_created_at_idx" ON "leads"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_workspace_id_status_idx" ON "leads"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "leads_workspace_id_dedupe_hash_key" ON "leads"("workspace_id", "dedupe_hash");

-- CreateIndex
CREATE INDEX "attribution_touches_visitor_id_occurred_at_idx" ON "attribution_touches"("visitor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "attribution_touches_lead_id_idx" ON "attribution_touches"("lead_id");

-- CreateIndex
CREATE INDEX "attribution_touches_workspace_id_content_item_id_idx" ON "attribution_touches"("workspace_id", "content_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_outbox_dedupe_key_key" ON "task_outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "task_outbox_status_available_at_idx" ON "task_outbox"("status", "available_at");

-- CreateIndex
CREATE INDEX "llm_runs_workspace_id_created_at_idx" ON "llm_runs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "llm_runs_workspace_id_purpose_idx" ON "llm_runs"("workspace_id", "purpose");

-- CreateIndex
CREATE INDEX "audit_log_workspace_id_occurred_at_idx" ON "audit_log"("workspace_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_subject_type_subject_id_idx" ON "audit_log"("subject_type", "subject_id");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verticals" ADD CONSTRAINT "verticals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_bases" ADD CONSTRAINT "delivery_bases_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_bases" ADD CONSTRAINT "delivery_bases_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_parent_request_id_fkey" FOREIGN KEY ("parent_request_id") REFERENCES "service_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_origin_lead_id_fkey" FOREIGN KEY ("origin_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_plans" ADD CONSTRAINT "service_request_plans_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_plans" ADD CONSTRAINT "service_request_plans_llm_run_id_fkey" FOREIGN KEY ("llm_run_id") REFERENCES "llm_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_metrics" ADD CONSTRAINT "keyword_metrics_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_clusters" ADD CONSTRAINT "topic_clusters_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_clusters" ADD CONSTRAINT "topic_clusters_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_clusters" ADD CONSTRAINT "topic_clusters_pillar_keyword_id_fkey" FOREIGN KEY ("pillar_keyword_id") REFERENCES "keywords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_clusters" ADD CONSTRAINT "topic_clusters_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_clusters" ADD CONSTRAINT "topic_clusters_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cluster_keywords" ADD CONSTRAINT "cluster_keywords_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "topic_clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cluster_keywords" ADD CONSTRAINT "cluster_keywords_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "topic_clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_llm_run_id_fkey" FOREIGN KEY ("llm_run_id") REFERENCES "llm_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "content_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "content_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_llm_run_id_fkey" FOREIGN KEY ("llm_run_id") REFERENCES "llm_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "content_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "approvals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cta_placements" ADD CONSTRAINT "cta_placements_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_delivery_region_id_fkey" FOREIGN KEY ("delivery_region_id") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_delivery_basis_id_fkey" FOREIGN KEY ("delivery_basis_id") REFERENCES "delivery_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribution_touches" ADD CONSTRAINT "attribution_touches_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribution_touches" ADD CONSTRAINT "attribution_touches_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
