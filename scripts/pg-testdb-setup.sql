-- ============================================================
-- CostCore Test Database Setup for PostgreSQL Performance Analyzer
-- Creates tables matching costcore's EF Core models,
-- seeds ~50k rows of realistic data, and creates conditions
-- that the analyzer will detect.
-- ============================================================
-- Usage:
--   createdb costcore_test
--   psql costcore_test -f scripts/pg-testdb-setup.sql
-- ============================================================

-- Enable pg_stat_statements (needs to be in shared_preload_libraries)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Reset stats so our generated queries are the only ones
SELECT pg_stat_statements_reset();

-- ============================================================
-- SCHEMA: mirrors costcore EF Core models
-- ============================================================

CREATE TABLE IF NOT EXISTS "Tenants" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "Name" text NOT NULL,
    "Subdomain" text,
    "LogoUrl" text,
    "IsActive" boolean NOT NULL DEFAULT true,
    "Settings" jsonb DEFAULT '{}',
    "Plan" text,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "Units" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "Name" text NOT NULL,
    "Symbol" text NOT NULL,
    "Description" text,
    "Type" text NOT NULL,  -- Length, Area, Volume, Weight, Count, Time, Packaging
    "IsBase" boolean NOT NULL DEFAULT false,
    "ConversionFactor" double precision NOT NULL DEFAULT 1.0,
    "IsSystem" boolean NOT NULL DEFAULT false,
    "BaseUnitId" uuid REFERENCES "Units"("Id"),
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "CreatedBy" text,
    "UpdatedBy" text,
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "Materials" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "Name" text NOT NULL,
    "Code" text,
    "Description" text,
    "Category" text,
    "Tags" jsonb DEFAULT '[]',
    "UnitPrice" numeric(18,4) NOT NULL DEFAULT 0,
    "WasteRate" numeric(5,2) NOT NULL DEFAULT 0,
    "ConsumptionUnitId" uuid REFERENCES "Units"("Id"),
    "PackageQuantity" numeric(18,4),
    "IsSheetMaterial" boolean NOT NULL DEFAULT false,
    "Length" numeric(18,4),
    "LengthUnit" text,
    "Width" numeric(18,4),
    "WidthUnit" text,
    "Height" numeric(18,4),
    "HeightUnit" text,
    "Diameter" numeric(18,4),
    "DiameterUnit" text,
    "Thickness" numeric(18,4),
    "ThicknessUnit" text,
    "Density" numeric(18,6),
    "Weight" numeric(18,4),
    "UnitId" uuid REFERENCES "Units"("Id"),
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "CreatedBy" text,
    "UpdatedBy" text,
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "Projects" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "Name" text NOT NULL,
    "Code" text,
    "Description" text,
    "Status" text NOT NULL DEFAULT 'Draft',
    "ClientName" text,
    "Location" text,
    "StartDate" timestamptz,
    "EndDate" timestamptz,
    "Budget" numeric(18,2),
    "Currency" text NOT NULL DEFAULT 'TRY',
    "PriceOverrideType" text DEFAULT 'None',
    "PriceOverrideValue" numeric(18,4),
    "LaborCostType" text DEFAULT 'None',
    "LaborCostValue" numeric(18,4),
    "OverheadCostType" text DEFAULT 'None',
    "OverheadCostValue" numeric(18,4),
    "ProfitMarginType" text DEFAULT 'None',
    "ProfitMarginValue" numeric(18,4),
    "CalculatedPrice" numeric(18,4),
    "PriceCalculatedAt" timestamptz,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "CreatedBy" text,
    "UpdatedBy" text,
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "SectionDefinitions" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "Name" text NOT NULL,
    "Code" text,
    "Description" text,
    "Category" text,
    "IsActive" boolean NOT NULL DEFAULT true,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "Sections" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "Name" text NOT NULL,
    "Code" text,
    "Description" text,
    "Order" int NOT NULL DEFAULT 0,
    "SectionDefinitionId" uuid REFERENCES "SectionDefinitions"("Id"),
    "PriceOverrideType" text DEFAULT 'None',
    "PriceOverrideValue" numeric(18,4),
    "LaborCostType" text DEFAULT 'None',
    "LaborCostValue" numeric(18,4),
    "OverheadCostType" text DEFAULT 'None',
    "OverheadCostValue" numeric(18,4),
    "ProfitMarginType" text DEFAULT 'None',
    "ProfitMarginValue" numeric(18,4),
    "CalculatedPrice" numeric(18,4),
    "PriceCalculatedAt" timestamptz,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "CreatedBy" text,
    "UpdatedBy" text,
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "ProductDefinitions" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "Name" text NOT NULL,
    "Code" text,
    "Description" text,
    "Category" text,
    "IsActive" boolean NOT NULL DEFAULT true,
    "DefaultQuantity" numeric(18,4),
    "DefaultQuantityFormula" text,
    "UnitId" uuid REFERENCES "Units"("Id"),
    "SectionDefinitionId" uuid REFERENCES "SectionDefinitions"("Id"),
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "Products" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "Name" text NOT NULL,
    "Code" text,
    "Description" text,
    "Order" int NOT NULL DEFAULT 0,
    "Quantity" numeric(18,4),
    "QuantityFormula" text,
    "UnitId" uuid REFERENCES "Units"("Id"),
    "ProductDefinitionId" uuid REFERENCES "ProductDefinitions"("Id"),
    "PriceOverrideType" text DEFAULT 'None',
    "PriceOverrideValue" numeric(18,4),
    "LaborCostType" text DEFAULT 'None',
    "LaborCostValue" numeric(18,4),
    "OverheadCostType" text DEFAULT 'None',
    "OverheadCostValue" numeric(18,4),
    "ProfitMarginType" text DEFAULT 'None',
    "ProfitMarginValue" numeric(18,4),
    "CalculatedPrice" numeric(18,4),
    "PriceCalculatedAt" timestamptz,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "CreatedBy" text,
    "UpdatedBy" text,
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "PartDefinitions" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "Name" text NOT NULL,
    "Code" text,
    "Description" text,
    "Category" text,
    "IsActive" boolean NOT NULL DEFAULT true,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "Parts" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "Name" text NOT NULL,
    "Code" text,
    "Description" text,
    "Order" int NOT NULL DEFAULT 0,
    "Quantity" numeric(18,4),
    "QuantityFormula" text,
    "Length" numeric(18,4),
    "LengthUnit" text,
    "Width" numeric(18,4),
    "WidthUnit" text,
    "Height" numeric(18,4),
    "HeightUnit" text,
    "Diameter" numeric(18,4),
    "DiameterUnit" text,
    "Thickness" numeric(18,4),
    "ThicknessUnit" text,
    "UnitId" uuid REFERENCES "Units"("Id"),
    "PartDefinitionId" uuid REFERENCES "PartDefinitions"("Id"),
    "PriceOverrideType" text DEFAULT 'None',
    "PriceOverrideValue" numeric(18,4),
    "LaborCostType" text DEFAULT 'None',
    "LaborCostValue" numeric(18,4),
    "OverheadCostType" text DEFAULT 'None',
    "OverheadCostValue" numeric(18,4),
    "ProfitMarginType" text DEFAULT 'None',
    "ProfitMarginValue" numeric(18,4),
    "CalculatedPrice" numeric(18,4),
    "PriceCalculatedAt" timestamptz,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "CreatedBy" text,
    "UpdatedBy" text,
    "IsDeleted" boolean NOT NULL DEFAULT false
);

-- Junction tables
CREATE TABLE IF NOT EXISTS "ProjectSections" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "ProjectId" uuid NOT NULL REFERENCES "Projects"("Id"),
    "SectionId" uuid NOT NULL REFERENCES "Sections"("Id"),
    "Order" int NOT NULL DEFAULT 0,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "ProjectProducts" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "ProjectId" uuid NOT NULL REFERENCES "Projects"("Id"),
    "ProductId" uuid NOT NULL REFERENCES "Products"("Id"),
    "Order" int NOT NULL DEFAULT 0,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "ProjectMaterials" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "ProjectId" uuid NOT NULL REFERENCES "Projects"("Id"),
    "MaterialId" uuid NOT NULL REFERENCES "Materials"("Id"),
    "Quantity" numeric(18,4),
    "ConsumptionFormula" text,
    "Notes" text,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "SectionProducts" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "SectionId" uuid NOT NULL REFERENCES "Sections"("Id"),
    "ProductId" uuid NOT NULL REFERENCES "Products"("Id"),
    "Order" int NOT NULL DEFAULT 0,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "SectionMaterials" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "SectionId" uuid NOT NULL REFERENCES "Sections"("Id"),
    "MaterialId" uuid NOT NULL REFERENCES "Materials"("Id"),
    "Quantity" numeric(18,4),
    "ConsumptionFormula" text,
    "Notes" text,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "ProductParts" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "ProductId" uuid NOT NULL REFERENCES "Products"("Id"),
    "PartId" uuid NOT NULL REFERENCES "Parts"("Id"),
    "Order" int NOT NULL DEFAULT 0,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "ProductMaterials" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "ProductId" uuid NOT NULL REFERENCES "Products"("Id"),
    "MaterialId" uuid NOT NULL REFERENCES "Materials"("Id"),
    "Quantity" numeric(18,4),
    "ConsumptionFormula" text,
    "Notes" text,
    "CustomWasteRate" numeric(5,2),
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "PartMaterials" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "PartId" uuid NOT NULL REFERENCES "Parts"("Id"),
    "MaterialId" uuid NOT NULL REFERENCES "Materials"("Id"),
    "Quantity" numeric(18,4),
    "ConsumptionFormula" text,
    "Notes" text,
    "CustomWasteRate" numeric(5,2),
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

-- Inventory & Production
CREATE TABLE IF NOT EXISTS "InventoryItems" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "EntityType" text NOT NULL,
    "EntityId" uuid NOT NULL,
    "OnHandQty" numeric(18,4) NOT NULL DEFAULT 0,
    "ReservedQty" numeric(18,4) NOT NULL DEFAULT 0,
    "MinStockLevel" numeric(18,4),
    "UnitId" uuid REFERENCES "Units"("Id"),
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "StockTransactions" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "InventoryItemId" uuid NOT NULL REFERENCES "InventoryItems"("Id"),
    "Type" text NOT NULL,
    "Quantity" numeric(18,4) NOT NULL,
    "UnitId" uuid REFERENCES "Units"("Id"),
    "ReferenceType" text DEFAULT 'None',
    "ReferenceId" uuid,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "ProductionOrders" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "TargetEntityType" text NOT NULL,
    "TargetEntityId" uuid NOT NULL,
    "TargetQty" numeric(18,4) NOT NULL,
    "Status" text NOT NULL DEFAULT 'Draft',
    "RowVersion" uuid NOT NULL DEFAULT gen_random_uuid(),
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "ProductionOrderRequirements" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "ProductionOrderId" uuid NOT NULL REFERENCES "ProductionOrders"("Id"),
    "MaterialId" uuid REFERENCES "Materials"("Id"),
    "RequiredQty" numeric(18,4) NOT NULL,
    "Status" text NOT NULL DEFAULT 'Pending',
    "Notes" text,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

-- Template system
CREATE TABLE IF NOT EXISTS "ProductTemplates" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "Name" text NOT NULL,
    "Code" text,
    "Description" text,
    "Category" text,
    "ThumbnailUrl" text,
    "IsPublished" boolean NOT NULL DEFAULT false,
    "Version" int NOT NULL DEFAULT 1,
    "GltfModelPath" text,
    "StepModelPath" text,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "TemplateParameters" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "ProductTemplateId" uuid NOT NULL REFERENCES "ProductTemplates"("Id"),
    "Name" text NOT NULL,
    "DisplayName" text,
    "Description" text,
    "Type" text NOT NULL,
    "Order" int NOT NULL DEFAULT 0,
    "Group" text,
    "MinValue" numeric(18,4),
    "MaxValue" numeric(18,4),
    "Step" numeric(18,4),
    "DefaultValue" text,
    "EnumValues" jsonb,
    "ComputedFormula" text,
    "IsUserEditable" boolean NOT NULL DEFAULT true,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

-- Ikas integration
CREATE TABLE IF NOT EXISTS "IkasOrders" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "IkasOrderId" text,
    "OrderNumber" text,
    "Status" text,
    "OrderPaymentStatus" text,
    "OrderPackageStatus" text,
    "CurrencyCode" text DEFAULT 'TRY',
    "TotalPrice" numeric(18,2),
    "TotalFinalPrice" numeric(18,2),
    "ItemCount" int,
    "OrderedAt" timestamptz,
    "ShippingMethod" text,
    "ShippingCity" text,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "IkasOrderLines" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "IkasOrderId" uuid NOT NULL REFERENCES "IkasOrders"("Id"),
    "ProductName" text,
    "Quantity" int NOT NULL DEFAULT 1,
    "UnitPrice" numeric(18,2),
    "TotalPrice" numeric(18,2),
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

-- Project snapshots (large jsonb data)
CREATE TABLE IF NOT EXISTS "ProjectSnapshots" (
    "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId" uuid NOT NULL REFERENCES "Tenants"("Id"),
    "ProjectId" uuid NOT NULL REFERENCES "Projects"("Id"),
    "SnapshotData" jsonb NOT NULL DEFAULT '{}',
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    "IsDeleted" boolean NOT NULL DEFAULT false
);

-- ============================================================
-- INTENTIONAL: Create some unused indexes (analyzer should detect)
-- ============================================================
CREATE INDEX idx_materials_category ON "Materials"("Category");
CREATE INDEX idx_materials_code ON "Materials"("Code");
CREATE INDEX idx_materials_wasterate ON "Materials"("WasteRate");
CREATE INDEX idx_projects_clientname ON "Projects"("ClientName");
CREATE INDEX idx_projects_location ON "Projects"("Location");
CREATE INDEX idx_projects_currency ON "Projects"("Currency");
CREATE INDEX idx_sections_order ON "Sections"("Order");
CREATE INDEX idx_parts_code ON "Parts"("Code");
CREATE INDEX idx_products_code ON "Products"("Code");
CREATE INDEX idx_stocktx_reftype ON "StockTransactions"("ReferenceType");
CREATE INDEX idx_orders_city ON "IkasOrders"("ShippingCity");
CREATE INDEX idx_orders_currency ON "IkasOrders"("CurrencyCode");

-- ============================================================
-- SEED DATA
-- ============================================================

DO $$
DECLARE
    tid uuid;
    uid uuid;
    mat_ids uuid[];
    proj_ids uuid[];
    sec_ids uuid[];
    prod_ids uuid[];
    part_ids uuid[];
    inv_ids uuid[];
    po_ids uuid[];
    order_ids uuid[];
    tmp_id uuid;
    i int;
    j int;
    categories text[] := ARRAY['Ahsap','Metal','Boya','Vida','Cila','Cam','Plastik','Kumas','Deri','Sunger','MDF','Sunta','Laminat','Akrilik','Mermer'];
    proj_statuses text[] := ARRAY['Draft','Active','Active','Active','OnHold','Completed','Completed'];
    cities text[] := ARRAY['Istanbul','Ankara','Izmir','Bursa','Antalya','Konya','Adana','Gaziantep','Kayseri','Mersin'];
    mat_names text[] := ARRAY['18mm MDF Panel','Mesin Masif','Ceviz Kaplama','Lake Boya RAL9010','Su Bazli Cila','4mm Cam','Laminat HPL','Suni Deri Kahve','Sunger D28','Metal Profil 40x20','Paslanmaz Vida 4x30','Menteşe 35mm','Ray Sistemi 45cm','Kenar Bandi 2mm','Mermer Plaka 2cm'];
    prod_names text[] := ARRAY['Mutfak Dolabi','Banyo Dolabi','Vestiyer','TV Unitesi','Kitaplik','Yatak Basi','Komodin','Gardrop','Masa','Sandalye','Sehpa','Konsol','Ayakkabilik','Portmanto','Raf Sistemi'];
    part_names text[] := ARRAY['Govde Yan','Govde Ust','Govde Alt','Raf','Kapak','Cekmece On','Cekmece Yan','Cekmece Alt','Arka Panel','Ayak','Bölme','Tezgah','Süpürgelik','Kornish','Cam Raf'];
BEGIN
    -- Create tenant
    INSERT INTO "Tenants" ("Id","Name","Subdomain","IsActive","Plan")
    VALUES (gen_random_uuid(), 'Mobilya Imalat A.S.', 'mobilya', true, 'pro')
    RETURNING "Id" INTO tid;

    -- Seed units
    INSERT INTO "Units" ("TenantId","Name","Symbol","Type","IsBase","IsSystem") VALUES
        (tid,'Milimetre','mm','Length',true,true),
        (tid,'Santimetre','cm','Length',false,true),
        (tid,'Metre','m','Length',false,true),
        (tid,'Gram','g','Weight',true,true),
        (tid,'Kilogram','kg','Weight',false,true),
        (tid,'Adet','adet','Count',true,true),
        (tid,'Metrekare','m2','Area',true,true),
        (tid,'Paket','pkt','Packaging',true,true);

    SELECT "Id" INTO uid FROM "Units" WHERE "TenantId" = tid AND "Symbol" = 'adet' LIMIT 1;

    -- ========================================
    -- Materials: 15k rows (trigger missing index detection)
    -- ========================================
    RAISE NOTICE 'Seeding materials...';
    mat_ids := ARRAY[]::uuid[];
    FOR i IN 1..15000 LOOP
        INSERT INTO "Materials" ("TenantId","Name","Code","Category","UnitPrice","WasteRate","UnitId","Description","Tags","CreatedAt")
        VALUES (
            tid,
            mat_names[1 + (i % 15)] || ' - V' || i,
            'MAT-' || lpad(i::text, 5, '0'),
            categories[1 + (i % 15)],
            (random() * 500 + 5)::numeric(18,4),
            (random() * 15)::numeric(5,2),
            uid,
            'Malzeme aciklamasi #' || i,
            '["stok","uretim"]'::jsonb,
            now() - (random() * interval '365 days')
        )
        RETURNING "Id" INTO tmp_id;
        IF i <= 200 THEN
            mat_ids := mat_ids || tmp_id;
        END IF;
    END LOOP;

    -- ========================================
    -- Projects: 500
    -- ========================================
    RAISE NOTICE 'Seeding projects...';
    proj_ids := ARRAY[]::uuid[];
    FOR i IN 1..500 LOOP
        INSERT INTO "Projects" ("TenantId","Name","Code","Status","ClientName","Location","Budget","Currency","StartDate","CreatedAt")
        VALUES (
            tid,
            'Proje ' || i || ' - ' || cities[1 + (i % 10)],
            'PRJ-' || lpad(i::text, 4, '0'),
            proj_statuses[1 + (i % 7)],
            'Musteri ' || (i % 50 + 1),
            cities[1 + (i % 10)],
            (random() * 500000 + 10000)::numeric(18,2),
            'TRY',
            now() - (random() * interval '180 days'),
            now() - (random() * interval '365 days')
        )
        RETURNING "Id" INTO tmp_id;
        proj_ids := proj_ids || tmp_id;
    END LOOP;

    -- ========================================
    -- SectionDefinitions: 20
    -- ========================================
    RAISE NOTICE 'Seeding section definitions...';
    FOR i IN 1..20 LOOP
        INSERT INTO "SectionDefinitions" ("TenantId","Name","Code","Category","IsActive")
        VALUES (tid, 'Bolum Def ' || i, 'SD-' || lpad(i::text,3,'0'), categories[1 + (i % 15)], true);
    END LOOP;

    -- ========================================
    -- Sections: 2000
    -- ========================================
    RAISE NOTICE 'Seeding sections...';
    sec_ids := ARRAY[]::uuid[];
    FOR i IN 1..2000 LOOP
        INSERT INTO "Sections" ("TenantId","Name","Code","Order","CreatedAt")
        VALUES (
            tid,
            'Bolum ' || i,
            'SEC-' || lpad(i::text, 4, '0'),
            i % 10,
            now() - (random() * interval '300 days')
        )
        RETURNING "Id" INTO tmp_id;
        sec_ids := sec_ids || tmp_id;
    END LOOP;

    -- ========================================
    -- Products: 5000
    -- ========================================
    RAISE NOTICE 'Seeding products...';
    prod_ids := ARRAY[]::uuid[];
    FOR i IN 1..5000 LOOP
        INSERT INTO "Products" ("TenantId","Name","Code","Order","Quantity","UnitId","CreatedAt")
        VALUES (
            tid,
            prod_names[1 + (i % 15)] || ' #' || i,
            'PROD-' || lpad(i::text, 5, '0'),
            i % 20,
            (random() * 10 + 1)::numeric(18,4),
            uid,
            now() - (random() * interval '300 days')
        )
        RETURNING "Id" INTO tmp_id;
        prod_ids := prod_ids || tmp_id;
    END LOOP;

    -- ========================================
    -- Parts: 10000
    -- ========================================
    RAISE NOTICE 'Seeding parts...';
    part_ids := ARRAY[]::uuid[];
    FOR i IN 1..10000 LOOP
        INSERT INTO "Parts" ("TenantId","Name","Code","Order","Quantity","UnitId","Length","LengthUnit","Width","WidthUnit","Thickness","ThicknessUnit","CreatedAt")
        VALUES (
            tid,
            part_names[1 + (i % 15)] || ' #' || i,
            'PRT-' || lpad(i::text, 5, '0'),
            i % 20,
            (random() * 5 + 1)::numeric(18,4),
            uid,
            (random() * 2400 + 100)::numeric(18,4), 'mm',
            (random() * 600 + 50)::numeric(18,4), 'mm',
            (random() * 36 + 4)::numeric(18,4), 'mm',
            now() - (random() * interval '300 days')
        )
        RETURNING "Id" INTO tmp_id;
        part_ids := part_ids || tmp_id;
    END LOOP;

    -- ========================================
    -- Junction: ProjectSections (3000)
    -- ========================================
    RAISE NOTICE 'Seeding project-sections...';
    FOR i IN 1..3000 LOOP
        INSERT INTO "ProjectSections" ("TenantId","ProjectId","SectionId","Order")
        VALUES (tid, proj_ids[1 + (i % array_length(proj_ids,1))], sec_ids[1 + (i % array_length(sec_ids,1))], i % 10)
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- ========================================
    -- Junction: ProjectProducts (5000)
    -- ========================================
    RAISE NOTICE 'Seeding project-products...';
    FOR i IN 1..5000 LOOP
        INSERT INTO "ProjectProducts" ("TenantId","ProjectId","ProductId","Order")
        VALUES (tid, proj_ids[1 + (i % array_length(proj_ids,1))], prod_ids[1 + (i % array_length(prod_ids,1))], i % 20)
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- ========================================
    -- Junction: ProductParts (15000)
    -- ========================================
    RAISE NOTICE 'Seeding product-parts...';
    FOR i IN 1..15000 LOOP
        INSERT INTO "ProductParts" ("TenantId","ProductId","PartId","Order")
        VALUES (tid, prod_ids[1 + (i % array_length(prod_ids,1))], part_ids[1 + (i % array_length(part_ids,1))], i % 15)
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- ========================================
    -- Junction: ProductMaterials (8000)
    -- ========================================
    RAISE NOTICE 'Seeding product-materials...';
    FOR i IN 1..8000 LOOP
        INSERT INTO "ProductMaterials" ("TenantId","ProductId","MaterialId","Quantity","Notes")
        VALUES (
            tid,
            prod_ids[1 + (i % array_length(prod_ids,1))],
            mat_ids[1 + (i % array_length(mat_ids,1))],
            (random() * 20 + 0.5)::numeric(18,4),
            CASE WHEN random() > 0.7 THEN 'Not: birim dikkat' ELSE NULL END
        )
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- ========================================
    -- Junction: PartMaterials (12000)
    -- ========================================
    RAISE NOTICE 'Seeding part-materials...';
    FOR i IN 1..12000 LOOP
        INSERT INTO "PartMaterials" ("TenantId","PartId","MaterialId","Quantity","Notes")
        VALUES (
            tid,
            part_ids[1 + (i % array_length(part_ids,1))],
            mat_ids[1 + (i % array_length(mat_ids,1))],
            (random() * 10 + 0.1)::numeric(18,4),
            NULL
        )
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- ========================================
    -- Inventory: 3000 items
    -- ========================================
    RAISE NOTICE 'Seeding inventory...';
    inv_ids := ARRAY[]::uuid[];
    FOR i IN 1..3000 LOOP
        INSERT INTO "InventoryItems" ("TenantId","EntityType","EntityId","OnHandQty","ReservedQty","MinStockLevel","UnitId")
        VALUES (
            tid,
            CASE WHEN i % 3 = 0 THEN 'Material' WHEN i % 3 = 1 THEN 'Part' ELSE 'Product' END,
            CASE WHEN i % 3 = 0 THEN mat_ids[1 + (i % array_length(mat_ids,1))]
                 WHEN i % 3 = 1 THEN part_ids[1 + (i % array_length(part_ids,1))]
                 ELSE prod_ids[1 + (i % array_length(prod_ids,1))] END,
            (random() * 1000)::numeric(18,4),
            (random() * 100)::numeric(18,4),
            (random() * 50)::numeric(18,4),
            uid
        )
        RETURNING "Id" INTO tmp_id;
        inv_ids := inv_ids || tmp_id;
    END LOOP;

    -- ========================================
    -- Stock transactions: 20000 (trigger missing index on InventoryItemId)
    -- ========================================
    RAISE NOTICE 'Seeding stock transactions...';
    FOR i IN 1..20000 LOOP
        INSERT INTO "StockTransactions" ("TenantId","InventoryItemId","Type","Quantity","UnitId","CreatedAt")
        VALUES (
            tid,
            inv_ids[1 + (i % array_length(inv_ids,1))],
            (ARRAY['In','Out','Adjust','Reserve','Consume','Produce'])[1 + (i % 6)],
            (random() * 100 + 1)::numeric(18,4),
            uid,
            now() - (random() * interval '180 days')
        );
    END LOOP;

    -- ========================================
    -- Production orders: 800
    -- ========================================
    RAISE NOTICE 'Seeding production orders...';
    po_ids := ARRAY[]::uuid[];
    FOR i IN 1..800 LOOP
        INSERT INTO "ProductionOrders" ("TenantId","TargetEntityType","TargetEntityId","TargetQty","Status","CreatedAt")
        VALUES (
            tid,
            CASE WHEN i % 2 = 0 THEN 'Product' ELSE 'Part' END,
            CASE WHEN i % 2 = 0 THEN prod_ids[1 + (i % array_length(prod_ids,1))]
                 ELSE part_ids[1 + (i % array_length(part_ids,1))] END,
            (random() * 50 + 1)::numeric(18,4),
            (ARRAY['Draft','Ready','InProduction','Completed','Cancelled'])[1 + (i % 5)],
            now() - (random() * interval '90 days')
        )
        RETURNING "Id" INTO tmp_id;
        po_ids := po_ids || tmp_id;
    END LOOP;

    -- Production order requirements: 3000
    RAISE NOTICE 'Seeding production order requirements...';
    FOR i IN 1..3000 LOOP
        INSERT INTO "ProductionOrderRequirements" ("TenantId","ProductionOrderId","MaterialId","RequiredQty","Status")
        VALUES (
            tid,
            po_ids[1 + (i % array_length(po_ids,1))],
            mat_ids[1 + (i % array_length(mat_ids,1))],
            (random() * 200 + 1)::numeric(18,4),
            (ARRAY['Pending','Allocated','Consumed'])[1 + (i % 3)]
        );
    END LOOP;

    -- ========================================
    -- Ikas Orders: 5000
    -- ========================================
    RAISE NOTICE 'Seeding orders...';
    order_ids := ARRAY[]::uuid[];
    FOR i IN 1..5000 LOOP
        INSERT INTO "IkasOrders" ("TenantId","IkasOrderId","OrderNumber","Status","TotalPrice","TotalFinalPrice","ItemCount","ShippingCity","OrderedAt","CreatedAt")
        VALUES (
            tid,
            'ikas-' || i,
            'ORD-' || lpad(i::text, 6, '0'),
            (ARRAY['Pending','Processing','Shipped','Delivered','Cancelled'])[1 + (i % 5)],
            (random() * 10000 + 100)::numeric(18,2),
            (random() * 10000 + 100)::numeric(18,2),
            (random() * 8 + 1)::int,
            cities[1 + (i % 10)],
            now() - (random() * interval '365 days'),
            now() - (random() * interval '365 days')
        )
        RETURNING "Id" INTO tmp_id;
        order_ids := order_ids || tmp_id;
    END LOOP;

    -- Order lines: 15000
    RAISE NOTICE 'Seeding order lines...';
    FOR i IN 1..15000 LOOP
        INSERT INTO "IkasOrderLines" ("TenantId","IkasOrderId","ProductName","Quantity","UnitPrice","TotalPrice")
        VALUES (
            tid,
            order_ids[1 + (i % array_length(order_ids,1))],
            prod_names[1 + (i % 15)] || ' ' || (i % 100),
            (random() * 5 + 1)::int,
            (random() * 5000 + 50)::numeric(18,2),
            (random() * 25000 + 50)::numeric(18,2)
        );
    END LOOP;

    -- ========================================
    -- Project snapshots: 1000 (large jsonb)
    -- ========================================
    RAISE NOTICE 'Seeding snapshots...';
    FOR i IN 1..1000 LOOP
        INSERT INTO "ProjectSnapshots" ("TenantId","ProjectId","SnapshotData","CreatedAt")
        VALUES (
            tid,
            proj_ids[1 + (i % array_length(proj_ids,1))],
            jsonb_build_object(
                'version', i,
                'totalCost', (random() * 500000)::numeric(18,2),
                'materials', (SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'name', 'mat-'||n, 'qty', (random()*100)::int)) FROM generate_series(1, 20) n),
                'sections', (SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'name', 'sec-'||n, 'products', (random()*10)::int)) FROM generate_series(1, 10) n)
            ),
            now() - (random() * interval '180 days')
        );
    END LOOP;

    RAISE NOTICE 'Seed data complete!';
END $$;

-- ============================================================
-- SIMULATE QUERIES (to populate pg_stat_statements)
-- ============================================================

-- Slow query: full table scan on Materials with complex filtering
-- Run multiple times to register in pg_stat_statements
DO $$
BEGIN
    FOR i IN 1..20 LOOP
        PERFORM count(*) FROM "Materials"
        WHERE "Category" IN ('Ahsap','Metal','Cam')
          AND "UnitPrice" > 100
          AND "WasteRate" < 10
          AND "IsDeleted" = false
          AND "Description" LIKE '%malzeme%';
    END LOOP;
END $$;

-- Slow query: cross join-like on ProjectMaterials without proper index
DO $$
BEGIN
    FOR i IN 1..20 LOOP
        PERFORM m."Name", pm."Quantity"
        FROM "ProjectMaterials" pm
        JOIN "Materials" m ON m."Id" = pm."MaterialId"
        JOIN "Projects" p ON p."Id" = pm."ProjectId"
        WHERE p."Status" = 'Active'
          AND m."Category" = 'Ahsap'
          AND pm."IsDeleted" = false
        ORDER BY pm."Quantity" DESC;
    END LOOP;
END $$;

-- Slow query: aggregation over StockTransactions
DO $$
BEGIN
    FOR i IN 1..20 LOOP
        PERFORM "InventoryItemId", sum("Quantity"), count(*)
        FROM "StockTransactions"
        WHERE "Type" IN ('In','Out','Consume')
          AND "CreatedAt" > now() - interval '30 days'
          AND "IsDeleted" = false
        GROUP BY "InventoryItemId"
        HAVING sum("Quantity") > 50;
    END LOOP;
END $$;

-- N+1 pattern: individual material lookups (simulating ORM lazy loading)
DO $$
DECLARE
    mid uuid;
BEGIN
    FOR mid IN SELECT "MaterialId" FROM "ProductMaterials" LIMIT 2000 LOOP
        PERFORM "Name","UnitPrice" FROM "Materials" WHERE "Id" = mid;
    END LOOP;
END $$;

-- N+1 pattern: individual part lookups
DO $$
DECLARE
    pid uuid;
BEGIN
    FOR pid IN SELECT "PartId" FROM "ProductParts" LIMIT 2000 LOOP
        PERFORM "Name","Code" FROM "Parts" WHERE "Id" = pid;
    END LOOP;
END $$;

-- N+1 pattern: order line lookups per order
DO $$
DECLARE
    oid uuid;
BEGIN
    FOR oid IN SELECT "Id" FROM "IkasOrders" LIMIT 1500 LOOP
        PERFORM count(*) FROM "IkasOrderLines" WHERE "IkasOrderId" = oid;
    END LOOP;
END $$;

-- Force sequential scans on large tables (disable index usage temporarily)
SET enable_indexscan = off;
SET enable_bitmapscan = off;

DO $$
BEGIN
    FOR i IN 1..30 LOOP
        PERFORM count(*) FROM "Materials" WHERE "TenantId" IS NOT NULL;
        PERFORM count(*) FROM "Parts" WHERE "TenantId" IS NOT NULL;
        PERFORM count(*) FROM "StockTransactions" WHERE "TenantId" IS NOT NULL;
        PERFORM count(*) FROM "IkasOrderLines" WHERE "TenantId" IS NOT NULL;
    END LOOP;
END $$;

SET enable_indexscan = on;
SET enable_bitmapscan = on;

-- ============================================================
-- GENERATE DEAD TUPLES (for vacuum detection)
-- ============================================================

-- Update lots of rows to create dead tuples in Materials
UPDATE "Materials" SET "UpdatedAt" = now() WHERE "Id" IN (
    SELECT "Id" FROM "Materials" ORDER BY random() LIMIT 5000
);
UPDATE "Materials" SET "UpdatedAt" = now() WHERE "Id" IN (
    SELECT "Id" FROM "Materials" ORDER BY random() LIMIT 5000
);

-- Update StockTransactions to create dead tuples
UPDATE "StockTransactions" SET "UpdatedAt" = now() WHERE "Id" IN (
    SELECT "Id" FROM "StockTransactions" ORDER BY random() LIMIT 8000
);
UPDATE "StockTransactions" SET "UpdatedAt" = now() WHERE "Id" IN (
    SELECT "Id" FROM "StockTransactions" ORDER BY random() LIMIT 8000
);

-- Update Parts to create dead tuples
UPDATE "Parts" SET "UpdatedAt" = now() WHERE "Id" IN (
    SELECT "Id" FROM "Parts" ORDER BY random() LIMIT 4000
);

-- Delete + re-insert some rows to amplify dead tuples
DELETE FROM "ProjectSnapshots" WHERE "Id" IN (
    SELECT "Id" FROM "ProjectSnapshots" ORDER BY random() LIMIT 500
);

-- ============================================================
-- SUMMARY
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Test database setup complete!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Tables seeded:';
    RAISE NOTICE '  Tenants:          1';
    RAISE NOTICE '  Materials:        15,000';
    RAISE NOTICE '  Projects:         500';
    RAISE NOTICE '  Sections:         2,000';
    RAISE NOTICE '  Products:         5,000';
    RAISE NOTICE '  Parts:            10,000';
    RAISE NOTICE '  StockTransactions: 20,000';
    RAISE NOTICE '  IkasOrders:       5,000';
    RAISE NOTICE '  IkasOrderLines:   15,000';
    RAISE NOTICE '  + junction tables, inventory, production orders';
    RAISE NOTICE '';
    RAISE NOTICE 'Performance issues created:';
    RAISE NOTICE '  - 12 unused indexes (never queried)';
    RAISE NOTICE '  - N+1 patterns in pg_stat_statements';
    RAISE NOTICE '  - Slow aggregate queries';
    RAISE NOTICE '  - Sequential scans on large tables';
    RAISE NOTICE '  - Dead tuples from mass updates';
    RAISE NOTICE '';
    RAISE NOTICE 'Connect with: postgresql://localhost/costcore_test';
    RAISE NOTICE '========================================';
END $$;
