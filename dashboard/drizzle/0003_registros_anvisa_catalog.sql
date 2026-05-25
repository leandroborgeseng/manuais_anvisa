CREATE TABLE "catalog_syncs" (
	"id" serial PRIMARY KEY NOT NULL,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"finishedAt" timestamp,
	"status" "execution_status" DEFAULT 'running' NOT NULL,
	"queryTerm" varchar(64) DEFAULT 'a' NOT NULL,
	"pageSize" integer DEFAULT 50 NOT NULL,
	"startPage" integer DEFAULT 0 NOT NULL,
	"currentPage" integer DEFAULT 0 NOT NULL,
	"totalElements" integer DEFAULT 0 NOT NULL,
	"totalPages" integer DEFAULT 0 NOT NULL,
	"recordsUpserted" integer DEFAULT 0 NOT NULL,
	"recordsErrors" integer DEFAULT 0 NOT NULL,
	"lastError" text
);
--> statement-breakpoint
CREATE TABLE "registros_anvisa" (
	"id" serial PRIMARY KEY NOT NULL,
	"processo" varchar(32) NOT NULL,
	"numeroRegistro" varchar(64),
	"nomeProduto" varchar(512),
	"nomeTecnico" text,
	"situacao" varchar(128),
	"cnpjEmpresa" varchar(18),
	"razaoSocial" text,
	"autorizacaoEmpresa" varchar(32),
	"riscoSigla" varchar(16),
	"riscoDescricao" varchar(128),
	"vencimentoDescricao" varchar(128),
	"dataInicioVigencia" timestamp,
	"dataVencimento" timestamp,
	"dataCancelamento" timestamp,
	"cancelado" varchar(8),
	"catalogSyncId" integer,
	"metadataJson" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "registros_anvisa_processo_unique" UNIQUE("processo")
);
--> statement-breakpoint
CREATE INDEX "registros_anvisa_situacao_idx" ON "registros_anvisa" USING btree ("situacao");
--> statement-breakpoint
CREATE INDEX "registros_anvisa_numeroRegistro_idx" ON "registros_anvisa" USING btree ("numeroRegistro");
--> statement-breakpoint
CREATE INDEX "registros_anvisa_nomeProduto_idx" ON "registros_anvisa" USING btree ("nomeProduto");
