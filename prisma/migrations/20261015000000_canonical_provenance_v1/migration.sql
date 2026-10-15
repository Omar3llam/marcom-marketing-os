-- 02B-1: additive, capture remains unwired. Native DDL owns all guards and deferral.
BEGIN;
CREATE TABLE public.canonical_refreshes(
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 id uuid NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), record_version smallint NOT NULL DEFAULT 1 CHECK(record_version=1),
 platform text NOT NULL DEFAULT 'META' CHECK(platform='META'), provider_account_id text NOT NULL CHECK(length(provider_account_id) BETWEEN 1 AND 128),
 measurement_window text NOT NULL DEFAULT 'CUMULATIVE_30D' CHECK(measurement_window='CUMULATIVE_30D'), requested_start date NOT NULL, requested_end date NOT NULL CHECK(requested_end>=requested_start),
 scope_descriptor jsonb NOT NULL, scope_hash bytea NOT NULL CHECK(octet_length(scope_hash)=32), account_set_hash bytea NOT NULL CHECK(octet_length(account_set_hash)=32),
 retry_of_refresh_id uuid, correlation_id text CHECK(length(correlation_id)<=128),
 selected_campaign_id uuid, selected_adset_id uuid, selected_ad_id uuid,
 not_started_levels jsonb NOT NULL DEFAULT '[]', attempt_dispositions jsonb, selection_hash bytea CHECK(octet_length(selection_hash)=32), source_sealed_at timestamptz(3),
 retain_until timestamptz(3) NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,retry_of_refresh_id) REFERENCES public.canonical_refreshes(workspace_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
 CHECK((selection_hash IS NULL AND source_sealed_at IS NULL AND attempt_dispositions IS NULL) OR (selection_hash IS NOT NULL AND source_sealed_at IS NOT NULL AND attempt_dispositions IS NOT NULL))
);
CREATE INDEX ON public.canonical_refreshes(workspace_id,created_at);
CREATE INDEX ON public.canonical_refreshes(retain_until,workspace_id,id);
CREATE INDEX ON public.canonical_refreshes(workspace_id,retry_of_refresh_id);
CREATE TABLE public.canonical_level_attempts(
 workspace_id uuid NOT NULL, refresh_id uuid NOT NULL, id uuid NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), record_version smallint NOT NULL DEFAULT 1 CHECK(record_version=1),
 level text NOT NULL CHECK(level IN ('campaign','adset','ad')), ordinal integer NOT NULL CHECK(ordinal>0), retry_of_attempt_id uuid,
 request_descriptor jsonb NOT NULL, request_hash bytea NOT NULL CHECK(octet_length(request_hash)=32), call_intent_at timestamptz(3) NOT NULL,
 source_receipt jsonb, receipt_hash bytea CHECK(octet_length(receipt_hash)=32), source_sealed_at timestamptz(3),
 PRIMARY KEY(workspace_id,refresh_id,id), UNIQUE(workspace_id,id), UNIQUE(workspace_id,refresh_id,level,ordinal),
 FOREIGN KEY(workspace_id,refresh_id) REFERENCES public.canonical_refreshes(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,refresh_id,retry_of_attempt_id) REFERENCES public.canonical_level_attempts(workspace_id,refresh_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
 CHECK((source_receipt IS NULL AND receipt_hash IS NULL AND source_sealed_at IS NULL) OR (source_receipt IS NOT NULL AND receipt_hash IS NOT NULL AND source_sealed_at IS NOT NULL)),
 CHECK(source_receipt IS NULL OR (source_receipt->>'outcome' IN ('EXHAUSTED','CAPPED','FAILED','UNPROVEN')) IS TRUE)
);
CREATE INDEX ON public.canonical_level_attempts(workspace_id,refresh_id,retry_of_attempt_id);
ALTER TABLE public.canonical_refreshes ADD CONSTRAINT canonical_selection_campaign_fk FOREIGN KEY(workspace_id,id,selected_campaign_id) REFERENCES public.canonical_level_attempts(workspace_id,refresh_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.canonical_refreshes ADD CONSTRAINT canonical_selection_adset_fk FOREIGN KEY(workspace_id,id,selected_adset_id) REFERENCES public.canonical_level_attempts(workspace_id,refresh_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.canonical_refreshes ADD CONSTRAINT canonical_selection_ad_fk FOREIGN KEY(workspace_id,id,selected_ad_id) REFERENCES public.canonical_level_attempts(workspace_id,refresh_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.canonical_write_attempts(
 workspace_id uuid NOT NULL, refresh_id uuid NOT NULL, id uuid NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), record_version smallint NOT NULL DEFAULT 1 CHECK(record_version=1),
 ordinal integer NOT NULL CHECK(ordinal>0), retry_of_write_id uuid, source_selection_hash bytea NOT NULL CHECK(octet_length(source_selection_hash)=32),
 planned_payload_hash bytea CHECK(octet_length(planned_payload_hash)=32), planned_at timestamptz(3), outcome text CHECK(outcome IN ('COMMITTED','FAILED')), error_code text CHECK(length(error_code)<=64),
 commit_manifest jsonb, outcome_hash bytea CHECK(octet_length(outcome_hash)=32), sealed_at timestamptz(3), committed_at timestamptz(3),
 PRIMARY KEY(workspace_id,refresh_id,id), UNIQUE(workspace_id,id), UNIQUE(workspace_id,refresh_id,ordinal),
 FOREIGN KEY(workspace_id,refresh_id) REFERENCES public.canonical_refreshes(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,refresh_id,retry_of_write_id) REFERENCES public.canonical_write_attempts(workspace_id,refresh_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
 CHECK((planned_payload_hash IS NULL)=(planned_at IS NULL)),
 CHECK((outcome IS NULL AND error_code IS NULL AND commit_manifest IS NULL AND outcome_hash IS NULL AND sealed_at IS NULL AND committed_at IS NULL)
 OR (outcome='FAILED' AND error_code IS NOT NULL AND commit_manifest IS NULL AND outcome_hash IS NOT NULL AND sealed_at IS NOT NULL AND committed_at IS NULL)
 OR (outcome='COMMITTED' AND planned_at IS NOT NULL AND error_code IS NULL AND commit_manifest IS NOT NULL AND outcome_hash IS NOT NULL AND sealed_at IS NOT NULL AND committed_at IS NOT NULL))
);
CREATE INDEX ON public.canonical_write_attempts(workspace_id,refresh_id,retry_of_write_id);
CREATE TABLE public.canonical_observations(
 workspace_id uuid NOT NULL, id uuid NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), record_version smallint NOT NULL DEFAULT 1 CHECK(record_version=1),
 refresh_id uuid NOT NULL, write_id uuid NOT NULL, source_attempt_id uuid NOT NULL, entity_id uuid NOT NULL, entity_level text NOT NULL CHECK(entity_level IN ('ACCOUNT','CAMPAIGN','ADSET','AD')),
 external_entity_id text CHECK(length(external_entity_id)<=128), date timestamp(3) NOT NULL,
 granularity text NOT NULL CHECK(granularity='DAILY'), source text NOT NULL CHECK(source='META'), measurement_window text NOT NULL CHECK(measurement_window='CUMULATIVE_30D'),
 window_start timestamp(3), window_end timestamp(3), materialized_snapshot_id uuid,
 committed_projection jsonb NOT NULL, source_facts jsonb NOT NULL, content_hash bytea NOT NULL CHECK(octet_length(content_hash)=32),
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,refresh_id,write_id,entity_id,entity_level,date,granularity,source,measurement_window),
 FOREIGN KEY(workspace_id,refresh_id,write_id) REFERENCES public.canonical_write_attempts(workspace_id,refresh_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,refresh_id,source_attempt_id) REFERENCES public.canonical_level_attempts(workspace_id,refresh_id,id) ON DELETE CASCADE
);
CREATE INDEX ON public.canonical_observations(workspace_id,refresh_id,source_attempt_id);

-- Never allow SQL's UNKNOWN result to admit a malformed terminal group.
ALTER TABLE public.canonical_write_attempts ADD CONSTRAINT canonical_write_shape CHECK (
 CASE WHEN outcome IS NULL THEN error_code IS NULL AND commit_manifest IS NULL AND outcome_hash IS NULL AND sealed_at IS NULL AND committed_at IS NULL
 WHEN outcome='FAILED' THEN error_code IS NOT NULL AND commit_manifest IS NULL AND outcome_hash IS NOT NULL AND sealed_at IS NOT NULL AND committed_at IS NULL
 WHEN outcome='COMMITTED' THEN planned_at IS NOT NULL AND error_code IS NULL AND commit_manifest IS NOT NULL AND outcome_hash IS NOT NULL AND sealed_at IS NOT NULL AND committed_at IS NOT NULL
 ELSE false END IS TRUE);

-- Pure v1 shape predicates. No extension, provider call or cross-language hash
-- recomputation. SHA-256 bytes are checked and cross-references bind those bytes;
-- content canonicalization belongs to the separately authorized capture writer.
-- Roles are cluster-wide, NOLOGIN capability groups. Runtime logins are NOT
-- enrolled by this migration. Use a distinct trusted migrator; production DBA
-- approval/provisioning is a deployment prerequisite, never assumed here.
DO $$DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['lumi_canonical_owner','lumi_canonical_app','lumi_canonical_retention'] LOOP
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',r); END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'unsafe preexisting canonical role: %',r; END IF;
 END LOOP;
 IF pg_has_role('lumi_canonical_app','lumi_canonical_owner','MEMBER') OR pg_has_role('lumi_canonical_app','lumi_canonical_retention','MEMBER') OR pg_has_role('lumi_canonical_retention','lumi_canonical_owner','MEMBER') THEN RAISE EXCEPTION 'canonical capability groups have unsafe membership'; END IF;
 -- Never enroll the migration login automatically: an old deployment might use
 -- the same login for runtime. DBA must provide a DISTINCT trusted migrator.
 IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AND NOT pg_has_role(current_user,'lumi_canonical_owner','MEMBER') THEN
  RAISE EXCEPTION 'canonical migration requires explicit DBA owner membership for dedicated migrator' USING ERRCODE='42501';
 END IF;
END $$;
CREATE SCHEMA canonical_provenance AUTHORIZATION lumi_canonical_owner;
REVOKE ALL ON SCHEMA canonical_provenance FROM PUBLIC;
-- Default privileges must not silently enroll a legacy runtime in CREATE or
-- privileged EXECUTE. Sanitize ONLY these new objects, never legacy ACLs.
DO $$DECLARE g record; BEGIN
 FOR g IN SELECT DISTINCT r.rolname FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='canonical_provenance' AND a.grantee<>n.nspowner LOOP
  EXECUTE format('REVOKE ALL ON SCHEMA canonical_provenance FROM %I CASCADE',g.rolname);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA canonical_provenance TO lumi_canonical_app,lumi_canonical_retention;

CREATE FUNCTION canonical_provenance.canonical_v1_assert(ok boolean, reason text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'canonical provenance: %',reason USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION canonical_provenance.canonical_v1_keys(j jsonb, required text[], optional text[] DEFAULT '{}') RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(j)='object' THEN j ?& required AND NOT EXISTS(SELECT FROM jsonb_object_keys(j) k WHERE NOT k=ANY(required||optional)) ELSE false END
$$;
CREATE FUNCTION canonical_provenance.canonical_v1_string(j jsonb, maximum integer, nullable boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce((nullable AND j='null') OR (jsonb_typeof(j)='string' AND length(j#>>'{}') BETWEEN 1 AND maximum),false)
$$;
CREATE FUNCTION canonical_provenance.canonical_v1_uint(j jsonb, nullable boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN nullable AND j='null' THEN true WHEN jsonb_typeof(j)='number' THEN (j#>>'{}')::numeric BETWEEN 0 AND 2147483647 AND trunc((j#>>'{}')::numeric)=(j#>>'{}')::numeric ELSE false END
$$;
CREATE FUNCTION canonical_provenance.canonical_v1_label(j jsonb, allowed text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT coalesce(jsonb_typeof(j)='string' AND (j#>>'{}')=ANY(allowed),false)$$;
CREATE FUNCTION canonical_provenance.canonical_v1_date(j jsonb, instant boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$DECLARE s text; BEGIN
 IF jsonb_typeof(j) IS DISTINCT FROM 'string' THEN RETURN false; END IF; s=j#>>'{}';
 IF instant THEN RETURN s ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' AND isfinite(s::timestamptz);
 ELSE RETURN s ~ '^\d{4}-\d{2}-\d{2}$' AND isfinite(s::date); END IF;
 EXCEPTION WHEN data_exception THEN RETURN false;
END $$;
CREATE FUNCTION canonical_provenance.canonical_v1_id(j jsonb, uuid_only boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_typeof(j)='string' AND CASE WHEN uuid_only THEN (j#>>'{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' ELSE (j#>>'{}') ~ '^[A-Za-z0-9_.:-]{1,128}$' END,false)
$$;
CREATE FUNCTION canonical_provenance.canonical_v1_hash(j jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT coalesce(jsonb_typeof(j)='string' AND (j#>>'{}') ~ '^[0-9a-f]{64}$',false)$$;
CREATE FUNCTION canonical_provenance.canonical_v1_origin(j jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT canonical_provenance.canonical_v1_keys(j,ARRAY['value','origin']) AND canonical_provenance.canonical_v1_label(j->'origin',ARRAY['UNKNOWN','PROVIDER','CONFIGURED','REQUEST_FALLBACK','OBSERVED'])
 AND CASE WHEN j->>'origin'='UNKNOWN' THEN j->'value'='null' ELSE canonical_provenance.canonical_v1_string(j->'value',128) END
$$;
CREATE FUNCTION canonical_provenance.canonical_v1_request(j jsonb, lvl text, since date, until_date date) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE x jsonb; BEGIN
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j,ARRAY['level','fields','params']) AND j->>'level'=lvl,'level specification');
 PERFORM canonical_provenance.canonical_v1_assert(jsonb_typeof(j->'fields')='array','fields array');
 PERFORM canonical_provenance.canonical_v1_assert(jsonb_array_length(j->'fields') BETWEEN 1 AND 128,'field identifier count');
 FOR x IN SELECT value FROM jsonb_array_elements(j->'fields') LOOP
  PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_string(x,64) AND (x#>>'{}') ~ '^[a-z_]+$','field identifier');
 END LOOP;
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j->'params',ARRAY['level','time_range'],ARRAY['limit']) AND j->'params'->>'level'=lvl,'canonical params');
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j->'params'->'time_range',ARRAY['since','until']) AND j->'params'->'time_range'->>'since'=since::text AND j->'params'->'time_range'->>'until'=until_date::text,'request DATE bounds');
 IF j->'params' ? 'limit' THEN PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_uint(j->'params'->'limit') AND (j->'params'->>'limit')::numeric>0,'page limit'); END IF;
END $$;
CREATE FUNCTION canonical_provenance.canonical_v1_scope(j jsonb, ws uuid, account_id text, since date, until_date date) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE x jsonb; BEGIN
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j,ARRAY['formatVersion','workspaceId','platform','providerAccountId','accountSet','requestedStart','requestedEnd','levels','endpoint','sdkVersion','accountTimezone','credentialBinding']) AND j->'formatVersion'='1' AND j->>'workspaceId'=ws::text AND j->>'platform'='META' AND j->>'providerAccountId'=account_id AND j->>'requestedStart'=since::text AND j->>'requestedEnd'=until_date::text AND j->>'endpoint'='AD_ACCOUNT_INSIGHTS','scope identity');
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j->'accountSet',ARRAY['ids','revision']) AND jsonb_typeof(j->'accountSet'->'ids')='array' AND canonical_provenance.canonical_v1_string(j->'accountSet'->'revision',128,true),'account set');
 PERFORM canonical_provenance.canonical_v1_assert(j->'accountSet'->'ids' ? account_id AND (SELECT count(*)=count(DISTINCT value) FROM jsonb_array_elements(j->'accountSet'->'ids')),'account set membership/uniqueness');
 FOR x IN SELECT value FROM jsonb_array_elements(j->'accountSet'->'ids') LOOP PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_id(x),'account identity'); END LOOP;
 PERFORM canonical_provenance.canonical_v1_assert(jsonb_typeof(j->'levels')='array' AND jsonb_array_length(j->'levels')=3 AND (SELECT count(DISTINCT value->>'level')=3 AND bool_and(value->>'level'=ANY(ARRAY['campaign','adset','ad'])) FROM jsonb_array_elements(j->'levels')),'three source levels');
 FOR x IN SELECT value FROM jsonb_array_elements(j->'levels') LOOP PERFORM canonical_provenance.canonical_v1_request(x,x->>'level',since,until_date); END LOOP;
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_origin(j->'sdkVersion') AND canonical_provenance.canonical_v1_origin(j->'accountTimezone'),'scope origins');
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_label(j->'sdkVersion'->'origin',ARRAY['OBSERVED','UNKNOWN']),'SDK version must be observed or unknown');
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j->'credentialBinding',ARRAY['workspaceId','platform','accountId','origin']) AND j->'credentialBinding'->>'workspaceId'=ws::text AND j->'credentialBinding'->>'platform'='meta_ads' AND j->'credentialBinding'->>'accountId'=account_id AND j->'credentialBinding'->>'origin'='CONFIGURED_ACTIVE_CREDENTIAL','binding attestation');
END $$;
CREATE FUNCTION canonical_provenance.canonical_v1_receipt(j jsonb, lvl text, request_hash bytea, max_pages integer) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE x jsonb; n integer; distinct_n integer; BEGIN
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j,ARRAY['formatVersion','level','requestHash','outcome','finishedAt','pagesObserved','rowsObserved','distinctIdsObserved','hasNextAtStop','truncated','returnedEntityIds','fieldPresence','errorCode']) AND j->'formatVersion'='1' AND j->>'level'=lvl AND j->>'requestHash'=encode(request_hash,'hex'),'receipt binding');
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_label(j->'outcome',ARRAY['EXHAUSTED','CAPPED','FAILED','UNPROVEN']) AND canonical_provenance.canonical_v1_date(j->'finishedAt',true),'receipt outcome/time');
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_uint(j->'pagesObserved',true) AND canonical_provenance.canonical_v1_uint(j->'rowsObserved',true) AND canonical_provenance.canonical_v1_uint(j->'distinctIdsObserved',true),'observed counters');
 PERFORM canonical_provenance.canonical_v1_assert(jsonb_typeof(j->'hasNextAtStop') IN ('boolean','null') AND jsonb_typeof(j->'truncated') IN ('boolean','null'),'nullable traversal facts');
 IF j->>'outcome'='EXHAUSTED' THEN PERFORM canonical_provenance.canonical_v1_assert(j->'hasNextAtStop'='false' AND j->'truncated'='false' AND (j->>'pagesObserved')::integer BETWEEN 1 AND max_pages,'positive exhaustion'); END IF;
 IF j->>'outcome'='CAPPED' THEN PERFORM canonical_provenance.canonical_v1_assert(j->'hasNextAtStop'='true' AND j->'truncated'='true' AND (j->>'pagesObserved')::integer=max_pages,'positive cap'); END IF;
 IF j->>'outcome'='FAILED' THEN PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_label(j->'errorCode',ARRAY['PROVIDER_READ_FAILED','PAGE_READ_FAILED','AUTH_UNAVAILABLE','PERMISSION_DENIED','RATE_LIMITED','UNKNOWN_SOURCE_ERROR']),'safe failure code');
 ELSE PERFORM canonical_provenance.canonical_v1_assert(j->'errorCode'='null','nonfailure error'); END IF;
 IF j->'returnedEntityIds'<>'null' THEN
  PERFORM canonical_provenance.canonical_v1_assert(jsonb_typeof(j->'returnedEntityIds')='array','returned identities');
  SELECT count(*),count(DISTINCT value) INTO n,distinct_n FROM jsonb_array_elements(j->'returnedEntityIds');
  PERFORM canonical_provenance.canonical_v1_assert((j->>'rowsObserved')::integer=n AND (j->>'distinctIdsObserved')::integer=distinct_n,'observed identity counts');
  FOR x IN SELECT value FROM jsonb_array_elements(j->'returnedEntityIds') LOOP PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_id(x),'returned identity'); END LOOP;
 END IF;
 PERFORM canonical_provenance.canonical_v1_assert(j->'rowsObserved'='null' OR j->'distinctIdsObserved'='null' OR (j->>'distinctIdsObserved')::integer<=(j->>'rowsObserved')::integer,'distinct count');
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j->'fieldPresence',ARRAY['sourceDates','metrics']) AND canonical_provenance.canonical_v1_label(j->'fieldPresence'->'sourceDates',ARRAY['REPORTED','MISSING','MIXED','UNKNOWN']) AND canonical_provenance.canonical_v1_label(j->'fieldPresence'->'metrics',ARRAY['REPORTED','MISSING','MIXED','UNKNOWN']),'field presence summary');
END $$;

CREATE FUNCTION canonical_provenance.canonical_validate_selection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.canonical_refreshes; a public.canonical_level_attempts; lvl text; chosen uuid; BEGIN
 SELECT * INTO r FROM public.canonical_refreshes WHERE workspace_id=NEW.workspace_id AND id=NEW.id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 FOREACH lvl IN ARRAY ARRAY['campaign','adset','ad'] LOOP
  chosen=CASE lvl WHEN 'campaign' THEN r.selected_campaign_id WHEN 'adset' THEN r.selected_adset_id ELSE r.selected_ad_id END;
  IF chosen IS NULL THEN
   PERFORM canonical_provenance.canonical_v1_assert(r.not_started_levels ? lvl AND NOT EXISTS(SELECT FROM public.canonical_level_attempts WHERE workspace_id=r.workspace_id AND refresh_id=r.id AND level=lvl),'missing-source is not not-started');
  ELSE
   SELECT * INTO a FROM public.canonical_level_attempts WHERE workspace_id=r.workspace_id AND refresh_id=r.id AND id=chosen;
   IF NOT FOUND THEN RAISE EXCEPTION 'canonical selected attempt unavailable' USING ERRCODE='23503'; END IF;
   PERFORM canonical_provenance.canonical_v1_assert(a.level=lvl AND a.source_sealed_at IS NOT NULL AND NOT r.not_started_levels ? lvl AND EXISTS(SELECT FROM jsonb_array_elements(r.attempt_dispositions) d WHERE d->>'attemptId'=chosen::text AND d->'selected'='true' AND d->>'receiptHash'=encode(a.receipt_hash,'hex') AND d->'unknownAtSeal'='false'),'terminal selected source');
  END IF;
 END LOOP;
 RETURN NULL;
END $$;

CREATE FUNCTION canonical_provenance.canonical_validate_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w public.canonical_write_attempts; r public.canonical_refreshes; expected jsonb; actual_counts jsonb; BEGIN
 SELECT * INTO w FROM public.canonical_write_attempts WHERE workspace_id=NEW.workspace_id AND refresh_id=NEW.refresh_id AND id=NEW.id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.canonical_refreshes WHERE workspace_id=w.workspace_id AND id=w.refresh_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF w.outcome IS DISTINCT FROM 'COMMITTED' THEN
  PERFORM canonical_provenance.canonical_v1_assert(NOT EXISTS(SELECT FROM public.canonical_observations WHERE workspace_id=w.workspace_id AND refresh_id=w.refresh_id AND write_id=w.id),'failed/open write cannot own observations'); RETURN NULL;
 END IF;
 PERFORM canonical_provenance.canonical_v1_assert(w.source_selection_hash=r.selection_hash,'frozen write selection');
 SELECT coalesce(jsonb_agg(jsonb_build_object('level',level,'attemptId',id,'receiptHash',encode(receipt_hash,'hex')) ORDER BY level),'[]') INTO expected
 FROM public.canonical_level_attempts WHERE workspace_id=w.workspace_id AND refresh_id=w.refresh_id AND id=ANY(array_remove(ARRAY[r.selected_campaign_id,r.selected_adset_id,r.selected_ad_id],NULL));
 PERFORM canonical_provenance.canonical_v1_assert(expected=(SELECT coalesce(jsonb_agg(value ORDER BY value->>'level'),'[]') FROM jsonb_array_elements(w.commit_manifest->'selectedSources')),'manifest selected source set/hashes');
 SELECT source_receipt->'returnedEntityIds' INTO expected FROM public.canonical_level_attempts WHERE workspace_id=w.workspace_id AND refresh_id=w.refresh_id AND id=r.selected_campaign_id;
 PERFORM canonical_provenance.canonical_v1_assert(w.commit_manifest->'returnedCampaignIds'=coalesce(expected,'null'::jsonb),'campaign returned identities');
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'contentHash',encode(content_hash,'hex')) ORDER BY id),'[]') INTO expected FROM public.canonical_observations WHERE workspace_id=w.workspace_id AND refresh_id=w.refresh_id AND write_id=w.id;
 PERFORM canonical_provenance.canonical_v1_assert(expected=(SELECT coalesce(jsonb_agg(value ORDER BY value->>'id'),'[]') FROM jsonb_array_elements(w.commit_manifest->'observations')),'manifest observation set/hashes');
 SELECT jsonb_object_agg(level,n) INTO actual_counts FROM (
  SELECT levels.level,count(o.id) AS n FROM (VALUES('ACCOUNT'),('CAMPAIGN'),('ADSET'),('AD')) levels(level)
  LEFT JOIN public.canonical_observations o ON o.workspace_id=w.workspace_id AND o.refresh_id=w.refresh_id AND o.write_id=w.id AND o.entity_level=levels.level GROUP BY levels.level) counts;
 PERFORM canonical_provenance.canonical_v1_assert(w.commit_manifest->'committedCounts'=actual_counts,'manifest actual counts');
 -- Check exact final materialization once at commit, including within-transaction
 -- restatement/deletion after O insertion. No mutable snapshot FK is introduced.
 PERFORM canonical_provenance.canonical_v1_assert(NOT EXISTS(
  SELECT FROM public.canonical_observations o LEFT JOIN public.metric_snapshots m ON m.id=(o.committed_projection->'snapshot'->>'id')::uuid AND m."workspaceId"=o.workspace_id
  WHERE o.workspace_id=w.workspace_id AND o.refresh_id=w.refresh_id AND o.write_id=w.id AND (m.id IS NULL OR to_jsonb(m)<>o.committed_projection->'snapshot')),'final materialization changed before commit');
 -- One materialized set reconciliation, never a whole-manifest scan per O.
 -- No generate_series from a claimed provider count: a malicious count cannot
 -- amplify a small JSON receipt into billions of synthetic validation rows.
 PERFORM canonical_provenance.canonical_v1_assert(NOT EXISTS(
  WITH sources AS MATERIALIZED (
   SELECT id,source_receipt->'returnedEntityIds' AS ids,(source_receipt->>'rowsObserved')::integer AS n,source_receipt->>'outcome' AS outcome FROM public.canonical_level_attempts
   WHERE workspace_id=w.workspace_id AND refresh_id=w.refresh_id AND id=ANY(array_remove(ARRAY[r.selected_campaign_id,r.selected_adset_id,r.selected_ad_id],NULL))),
  mapped AS MATERIALIZED (
   SELECT o.source_attempt_id AS source_id,(i.value#>>'{}')::integer AS idx,to_jsonb(o.external_entity_id) AS external_id FROM public.canonical_observations o
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.source_facts->'sourceRowIndices')='array' THEN o.source_facts->'sourceRowIndices' ELSE '[]' END) i
   WHERE o.workspace_id=w.workspace_id AND o.refresh_id=w.refresh_id AND o.write_id=w.id AND o.entity_level<>'ACCOUNT'
   UNION ALL SELECT (e->>'sourceAttemptId')::uuid,(e->>'rowIndex')::integer,e->'externalEntityId' FROM jsonb_array_elements(w.commit_manifest->'exclusions') e),
  covered AS (SELECT source_id,count(*) AS n,count(DISTINCT idx) AS unique_n FROM mapped GROUP BY source_id)
  SELECT FROM mapped m LEFT JOIN sources s ON s.id=m.source_id WHERE s.id IS NULL OR (s.n IS NOT NULL AND m.idx>=s.n) OR (s.ids<>'null' AND m.external_id IS DISTINCT FROM s.ids->m.idx)
  UNION ALL SELECT FROM sources s LEFT JOIN covered c ON c.source_id=s.id WHERE (s.n IS NOT NULL AND coalesce(c.n,0)<>s.n) OR coalesce(c.n,0)<>coalesce(c.unique_n,0)
  UNION ALL SELECT FROM sources s WHERE s.outcome='FAILED' AND EXISTS(SELECT FROM public.canonical_observations o WHERE o.workspace_id=w.workspace_id AND o.refresh_id=w.refresh_id AND o.write_id=w.id AND o.source_attempt_id=s.id)),
  'source rows require unique observation/exclusion disposition');
 PERFORM canonical_provenance.canonical_v1_assert(NOT EXISTS(
  SELECT FROM public.canonical_observations o CROSS JOIN LATERAL jsonb_array_elements(o.source_facts->'contributorIds') c
  WHERE o.workspace_id=w.workspace_id AND o.refresh_id=w.refresh_id AND o.write_id=w.id AND o.entity_level='ACCOUNT'
  AND NOT EXISTS(SELECT FROM public.canonical_observations p WHERE p.workspace_id=w.workspace_id AND p.refresh_id=w.refresh_id AND p.write_id=w.id AND p.entity_level='CAMPAIGN' AND to_jsonb(p.external_entity_id)=c.value)),'derived account contributors must be committed campaigns');
 RETURN NULL;
END $$;
CREATE FUNCTION canonical_provenance.canonical_validate_observation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF EXISTS(SELECT FROM public.canonical_refreshes WHERE workspace_id=NEW.workspace_id AND id=NEW.refresh_id) THEN
  PERFORM canonical_provenance.canonical_v1_assert(EXISTS(SELECT FROM public.canonical_write_attempts WHERE workspace_id=NEW.workspace_id AND refresh_id=NEW.refresh_id AND id=NEW.write_id AND outcome='COMMITTED'),'observation requires committed write');
 END IF; RETURN NULL;
END $$;
CREATE FUNCTION canonical_provenance.canonical_extend_retention() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE event_at timestamptz(3); data jsonb; BEGIN
 data=to_jsonb(NEW);
 event_at=greatest(clock_timestamp(),NEW.created_at,(data->>'source_sealed_at')::timestamptz,(data->>'planned_at')::timestamptz,(data->>'sealed_at')::timestamptz);
 UPDATE public.canonical_refreshes SET retain_until=greatest(retain_until,event_at+interval '2160 hours') WHERE workspace_id=NEW.workspace_id AND id=NEW.refresh_id;
 RETURN NULL;
END $$;


CREATE FUNCTION canonical_provenance.canonical_v1_facts(j jsonb, account_id text, entity_level text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE x jsonb; k text; BEGIN
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j,ARRAY['formatVersion','rawDates','metricFields','providerAccountId','providerBinding','currency','timezone','rowKind','contributorIds','binding','sourceRowIndices']) AND j->'formatVersion'='1' AND j->>'providerAccountId'=account_id AND j->>'providerBinding'='CONFIGURED_CREDENTIAL','source facts identity');
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j->'rawDates',ARRAY['start','stop']),'raw date keys');
 FOR x IN SELECT value FROM jsonb_each(j->'rawDates') LOOP
  PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(x,ARRAY['presence','value']) AND canonical_provenance.canonical_v1_label(x->'presence',ARRAY['VALID','MISSING','INVALID']),'raw date presence');
  IF x->>'presence'='VALID' THEN PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_date(x->'value'),'reported DATE'); ELSE PERFORM canonical_provenance.canonical_v1_assert(x->'value'='null','missing/invalid date stays null'); END IF;
 END LOOP;
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j->'metricFields',ARRAY['spend','revenue','impressions','clicks','conversions','reach','frequency','actions','actionValues']),'metric presence keys');
 FOR x IN SELECT value FROM jsonb_each(j->'metricFields') LOOP PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_label(x,ARRAY['VALID','MISSING','INVALID']),'metric presence'); END LOOP;
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_origin(j->'currency') AND canonical_provenance.canonical_v1_origin(j->'timezone'),'source origins');
 PERFORM canonical_provenance.canonical_v1_assert(j->'currency'->'value'='null' OR j->'currency'->>'value' ~ '^[A-Z]{3}$','currency value');
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_label(j->'binding',ARRAY['EXACT','AMBIGUOUS','UNKNOWN']) AND jsonb_typeof(j->'contributorIds')='array','binding facts');
 FOR x IN SELECT value FROM jsonb_array_elements(j->'contributorIds') LOOP PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_id(x),'contributor identity'); END LOOP;
 IF j->'sourceRowIndices'<>'null' THEN
  PERFORM canonical_provenance.canonical_v1_assert(jsonb_typeof(j->'sourceRowIndices')='array' AND (SELECT count(*)=count(DISTINCT value) FROM jsonb_array_elements(j->'sourceRowIndices')),'source row index set');
  FOR x IN SELECT value FROM jsonb_array_elements(j->'sourceRowIndices') LOOP PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_uint(x),'row index'); END LOOP;
 END IF;
 IF entity_level='ACCOUNT' THEN
  PERFORM canonical_provenance.canonical_v1_assert(j->>'rowKind'='DERIVED_ACCOUNT_ROLLUP' AND j->'sourceRowIndices'='[]' AND jsonb_array_length(j->'contributorIds')>0,'derived account origin');
 ELSE
  PERFORM canonical_provenance.canonical_v1_assert(j->>'rowKind'='DIRECT' AND j->'contributorIds'='[]','direct origin');
  IF j->>'binding' IN ('EXACT','AMBIGUOUS') THEN PERFORM canonical_provenance.canonical_v1_assert(jsonb_typeof(j->'sourceRowIndices')='array' AND jsonb_array_length(j->'sourceRowIndices')>0,'bound row indices'); END IF;
  IF j->>'binding'='EXACT' THEN PERFORM canonical_provenance.canonical_v1_assert(jsonb_array_length(j->'sourceRowIndices')=1,'exact source binding has one row'); END IF;
 END IF;
END $$;
CREATE FUNCTION canonical_provenance.canonical_v1_manifest(j jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE x jsonb; BEGIN
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j,ARRAY['formatVersion','selectedSources','returnedCampaignIds','observations','committedCounts','exclusions','membershipCoverage','membershipProofRef','membershipEvidence']) AND j->'formatVersion'='1' AND j->>'membershipCoverage'='UNKNOWN' AND j->'membershipProofRef'='null' AND j->'membershipEvidence'='null','capture-v1 membership/manifest');
 PERFORM canonical_provenance.canonical_v1_assert(jsonb_typeof(j->'selectedSources')='array' AND jsonb_typeof(j->'observations')='array' AND jsonb_typeof(j->'exclusions')='array' AND jsonb_typeof(j->'returnedCampaignIds') IN ('array','null'),'manifest collections');
 FOR x IN SELECT value FROM jsonb_array_elements(j->'selectedSources') LOOP PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(x,ARRAY['level','attemptId','receiptHash']) AND canonical_provenance.canonical_v1_label(x->'level',ARRAY['campaign','adset','ad']) AND canonical_provenance.canonical_v1_id(x->'attemptId',true) AND canonical_provenance.canonical_v1_hash(x->'receiptHash'),'selected source'); END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(j->'observations') LOOP PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(x,ARRAY['id','contentHash']) AND canonical_provenance.canonical_v1_id(x->'id',true) AND canonical_provenance.canonical_v1_hash(x->'contentHash'),'manifest observation'); END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(j->'exclusions') LOOP PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(x,ARRAY['sourceAttemptId','rowIndex','externalEntityId','reason']) AND canonical_provenance.canonical_v1_id(x->'sourceAttemptId',true) AND canonical_provenance.canonical_v1_uint(x->'rowIndex') AND (x->'externalEntityId'='null' OR canonical_provenance.canonical_v1_id(x->'externalEntityId')) AND canonical_provenance.canonical_v1_label(x->'reason',ARRAY['NORMALIZATION_REJECTED','ORPHAN','ZERO_SHADOW','DUPLICATE_KEY','UNBOUND']),'source exclusion'); END LOOP;
 PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(j->'committedCounts',ARRAY['ACCOUNT','CAMPAIGN','ADSET','AD']),'committed count levels');
 FOR x IN SELECT value FROM jsonb_each(j->'committedCounts') LOOP PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_uint(x),'committed count'); END LOOP;
END $$;

CREATE FUNCTION canonical_provenance.canonical_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.canonical_refreshes; a public.canonical_level_attempts; w public.canonical_write_attempts;
 old_row jsonb; immutable text[]; stamp timestamptz(3); x jsonb; expected jsonb; account_uuid uuid; campaign_uuid uuid; adset_uuid uuid;
 graph_external text; graph_objective text; stored jsonb; projection public.metric_snapshots; keys text[]; key_name text;
BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='canonical_refreshes' THEN
   IF EXISTS(SELECT FROM public.workspaces WHERE id=OLD.workspace_id) THEN
    IF NOT pg_has_role(session_user,'lumi_canonical_retention','USAGE') OR OLD.retain_until>clock_timestamp() THEN RAISE EXCEPTION 'canonical retention deletion unauthorized or premature' USING ERRCODE='42501'; END IF;
   END IF;
  ELSIF EXISTS(SELECT FROM public.canonical_refreshes WHERE workspace_id=OLD.workspace_id AND id=OLD.refresh_id) THEN
   RAISE EXCEPTION 'canonical child delete requires absent root' USING ERRCODE='42501';
  END IF;
  RETURN OLD;
 END IF;
 stamp=clock_timestamp();
 IF TG_TABLE_NAME='canonical_refreshes' THEN
  PERFORM id FROM public.workspaces WHERE id=NEW.workspace_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'canonical workspace unavailable' USING ERRCODE='23503'; END IF;
  IF TG_OP='INSERT' THEN
   PERFORM canonical_provenance.canonical_v1_assert(NEW.source_sealed_at IS NULL AND NEW.selection_hash IS NULL AND NEW.attempt_dispositions IS NULL AND NEW.selected_campaign_id IS NULL AND NEW.selected_adset_id IS NULL AND NEW.selected_ad_id IS NULL AND NEW.not_started_levels='[]','root admission must be open');
   SELECT to_jsonb(t) INTO old_row FROM public.canonical_refreshes t WHERE workspace_id=NEW.workspace_id AND id=NEW.id FOR UPDATE;
   IF FOUND THEN
    PERFORM canonical_provenance.canonical_v1_assert((old_row-ARRAY['created_at','retain_until','source_sealed_at','selection_hash','attempt_dispositions','selected_campaign_id','selected_adset_id','selected_ad_id','not_started_levels'])=(to_jsonb(NEW)-ARRAY['created_at','retain_until','source_sealed_at','selection_hash','attempt_dispositions','selected_campaign_id','selected_adset_id','selected_ad_id','not_started_levels']),'root identity replay conflict'); RETURN NULL;
   END IF;
   PERFORM canonical_provenance.canonical_v1_scope(NEW.scope_descriptor,NEW.workspace_id,NEW.provider_account_id,NEW.requested_start,NEW.requested_end);
   -- Unmanaged vault is intentionally not created/modified. Missing table or
   -- least-privilege grant fails closed; no token column is read or persisted.
   IF to_regclass('public.marcom_credentials') IS NULL THEN RAISE EXCEPTION 'canonical credential binding unavailable' USING ERRCODE='23503'; END IF;
   EXECUTE 'SELECT account_id FROM public.marcom_credentials WHERE workspace_id=$1 AND platform=''meta_ads'' AND is_active=true ORDER BY updated_at DESC LIMIT 1 FOR SHARE' INTO graph_external USING NEW.workspace_id::text;
   IF graph_external IS DISTINCT FROM NEW.provider_account_id THEN RAISE EXCEPTION 'canonical selected credential binding unavailable' USING ERRCODE='23503'; END IF;
   IF NEW.retry_of_refresh_id IS NOT NULL THEN
    PERFORM id FROM public.canonical_refreshes WHERE workspace_id=NEW.workspace_id AND id=NEW.retry_of_refresh_id;
    IF NOT FOUND OR NEW.retry_of_refresh_id=NEW.id THEN RAISE EXCEPTION 'canonical retry predecessor unavailable' USING ERRCODE='23503'; END IF;
   END IF;
   stamp=clock_timestamp(); NEW.created_at=stamp; NEW.retain_until=stamp+interval '2160 hours';
  ELSE
   immutable=ARRAY['retain_until','selected_campaign_id','selected_adset_id','selected_ad_id','not_started_levels','attempt_dispositions','selection_hash','source_sealed_at'];
   PERFORM canonical_provenance.canonical_v1_assert((to_jsonb(NEW)-immutable)=(to_jsonb(OLD)-immutable),'immutable root admission');
   IF to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NULL; END IF;
   IF NEW.retain_until<OLD.retain_until OR NEW.retain_until IS NULL THEN RAISE EXCEPTION 'canonical retention cannot shorten' USING ERRCODE='42501'; END IF;
   IF (to_jsonb(NEW)-'retain_until') IS DISTINCT FROM (to_jsonb(OLD)-'retain_until') THEN
    PERFORM canonical_provenance.canonical_v1_assert(OLD.source_sealed_at IS NULL AND NEW.source_sealed_at IS NOT NULL AND NEW.selection_hash IS NOT NULL AND NEW.attempt_dispositions IS NOT NULL,'once-only root seal');
    PERFORM canonical_provenance.canonical_v1_assert(jsonb_typeof(NEW.not_started_levels)='array' AND (SELECT count(*)=count(DISTINCT value) AND coalesce(bool_and(value#>>'{}'=ANY(ARRAY['campaign','adset','ad'])),true) FROM jsonb_array_elements(NEW.not_started_levels)),'not-started levels');
    PERFORM canonical_provenance.canonical_v1_assert(jsonb_typeof(NEW.attempt_dispositions)='array','attempt dispositions');
    FOR x IN SELECT value FROM jsonb_array_elements(NEW.attempt_dispositions) LOOP
     PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(x,ARRAY['attemptId','level','selected','receiptHash','unknownAtSeal']) AND canonical_provenance.canonical_v1_id(x->'attemptId',true) AND canonical_provenance.canonical_v1_label(x->'level',ARRAY['campaign','adset','ad']) AND jsonb_typeof(x->'selected')='boolean' AND jsonb_typeof(x->'unknownAtSeal')='boolean' AND (x->'receiptHash'='null' OR canonical_provenance.canonical_v1_hash(x->'receiptHash')),'disposition shape');
    END LOOP;
    SELECT coalesce(jsonb_agg(jsonb_build_object('attemptId',id,'level',level,'selected',id IN (NEW.selected_campaign_id,NEW.selected_adset_id,NEW.selected_ad_id),'receiptHash',CASE WHEN receipt_hash IS NULL THEN NULL ELSE encode(receipt_hash,'hex') END,'unknownAtSeal',receipt_hash IS NULL) ORDER BY id),'[]') INTO expected FROM public.canonical_level_attempts WHERE workspace_id=NEW.workspace_id AND refresh_id=NEW.id;
    -- SQL IN containing NULL must not become a manufactured null selected flag.
    SELECT coalesce(jsonb_agg(jsonb_set(value,'{selected}',to_jsonb(coalesce((value->>'attemptId')::uuid=ANY(array_remove(ARRAY[NEW.selected_campaign_id,NEW.selected_adset_id,NEW.selected_ad_id],NULL)),false))) ORDER BY value->>'attemptId'),'[]') INTO expected FROM jsonb_array_elements(expected);
    PERFORM canonical_provenance.canonical_v1_assert(expected=(SELECT coalesce(jsonb_agg(value ORDER BY value->>'attemptId'),'[]') FROM jsonb_array_elements(NEW.attempt_dispositions)),'frozen disposition set');
    NEW.source_sealed_at=stamp; NEW.retain_until=greatest(NEW.retain_until,stamp+interval '2160 hours');
   END IF;
  END IF;
  RETURN NEW;
 END IF;

 -- Future callers prelock parent -> refresh -> sources -> write before UPDATE.
 -- Triggers enforce liveness/serialization even for raw SQL, but cannot reorder
 -- PostgreSQL's implicit target-row lock. A conflicting misuse aborts, never
 -- bypasses an invariant. No network work belongs in these transactions.
 IF TG_TABLE_NAME='canonical_observations' OR (TG_TABLE_NAME='canonical_write_attempts' AND TG_OP='UPDATE' AND to_jsonb(NEW)->>'outcome'='COMMITTED') THEN
  PERFORM id FROM public.workspaces WHERE id=NEW.workspace_id FOR NO KEY UPDATE;
 ELSE PERFORM id FROM public.workspaces WHERE id=NEW.workspace_id FOR KEY SHARE; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'canonical workspace unavailable' USING ERRCODE='23503'; END IF;
 SELECT * INTO r FROM public.canonical_refreshes WHERE workspace_id=NEW.workspace_id AND id=NEW.refresh_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'canonical refresh unavailable' USING ERRCODE='23503'; END IF;
 stamp=clock_timestamp();
 IF TG_OP='INSERT' THEN NEW.created_at=stamp; END IF;

 IF TG_TABLE_NAME='canonical_level_attempts' THEN
  IF TG_OP='INSERT' THEN
   PERFORM canonical_provenance.canonical_v1_assert(NEW.source_receipt IS NULL AND NEW.receipt_hash IS NULL AND NEW.source_sealed_at IS NULL,'source admission open');
   SELECT to_jsonb(t) INTO old_row FROM public.canonical_level_attempts t WHERE workspace_id=NEW.workspace_id AND id=NEW.id;
   IF FOUND THEN PERFORM canonical_provenance.canonical_v1_assert((old_row-ARRAY['created_at','source_receipt','receipt_hash','source_sealed_at'])=(to_jsonb(NEW)-ARRAY['created_at','source_receipt','receipt_hash','source_sealed_at']),'source identity replay conflict'); RETURN NULL; END IF;
   PERFORM canonical_provenance.canonical_v1_assert(r.source_sealed_at IS NULL,'source admission closed');
   PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(NEW.request_descriptor,ARRAY['formatVersion','scopeHash','level','fields','params','maxPages']) AND NEW.request_descriptor->'formatVersion'='1' AND NEW.request_descriptor->>'scopeHash'=encode(r.scope_hash,'hex') AND NEW.request_descriptor->'maxPages'='50','request binding/cap');
   PERFORM canonical_provenance.canonical_v1_request(NEW.request_descriptor-ARRAY['formatVersion','scopeHash','maxPages'],NEW.level,r.requested_start,r.requested_end);
   PERFORM canonical_provenance.canonical_v1_assert((NEW.request_descriptor-ARRAY['formatVersion','scopeHash','maxPages'])=(SELECT value FROM jsonb_array_elements(r.scope_descriptor->'levels') WHERE value->>'level'=NEW.level),'request equals frozen level specification');
   IF NEW.retry_of_attempt_id IS NOT NULL THEN PERFORM canonical_provenance.canonical_v1_assert(EXISTS(SELECT FROM public.canonical_level_attempts WHERE workspace_id=NEW.workspace_id AND refresh_id=NEW.refresh_id AND id=NEW.retry_of_attempt_id AND level=NEW.level AND ordinal<NEW.ordinal),'source retry ancestry'); END IF;
  ELSE
   immutable=ARRAY['source_receipt','receipt_hash','source_sealed_at'];
   PERFORM canonical_provenance.canonical_v1_assert((to_jsonb(NEW)-immutable)=(to_jsonb(OLD)-immutable),'immutable source admission');
   IF to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NULL; END IF;
   PERFORM canonical_provenance.canonical_v1_assert(OLD.source_sealed_at IS NULL AND NEW.source_sealed_at IS NOT NULL AND NEW.source_receipt IS NOT NULL AND NEW.receipt_hash IS NOT NULL,'once-only source seal');
   PERFORM canonical_provenance.canonical_v1_receipt(NEW.source_receipt,NEW.level,NEW.request_hash,(NEW.request_descriptor->>'maxPages')::integer);
   NEW.source_sealed_at=stamp;
  END IF;
 ELSIF TG_TABLE_NAME='canonical_write_attempts' THEN
  IF TG_OP='INSERT' THEN
   PERFORM canonical_provenance.canonical_v1_assert(NEW.planned_payload_hash IS NULL AND NEW.planned_at IS NULL AND NEW.outcome IS NULL AND NEW.error_code IS NULL AND NEW.commit_manifest IS NULL AND NEW.outcome_hash IS NULL AND NEW.sealed_at IS NULL AND NEW.committed_at IS NULL,'write admission open');
   SELECT to_jsonb(t) INTO old_row FROM public.canonical_write_attempts t WHERE workspace_id=NEW.workspace_id AND id=NEW.id;
   IF FOUND THEN PERFORM canonical_provenance.canonical_v1_assert((old_row-ARRAY['created_at','planned_payload_hash','planned_at','outcome','error_code','commit_manifest','outcome_hash','sealed_at','committed_at'])=(to_jsonb(NEW)-ARRAY['created_at','planned_payload_hash','planned_at','outcome','error_code','commit_manifest','outcome_hash','sealed_at','committed_at']),'write identity replay conflict'); RETURN NULL; END IF;
   PERFORM canonical_provenance.canonical_v1_assert(r.source_sealed_at IS NOT NULL AND r.selection_hash=NEW.source_selection_hash,'write selected source binding');
   IF NEW.retry_of_write_id IS NOT NULL THEN PERFORM canonical_provenance.canonical_v1_assert(EXISTS(SELECT FROM public.canonical_write_attempts WHERE workspace_id=NEW.workspace_id AND refresh_id=NEW.refresh_id AND id=NEW.retry_of_write_id AND ordinal<NEW.ordinal),'write retry ancestry'); END IF;
  ELSE
   immutable=ARRAY['planned_payload_hash','planned_at','outcome','error_code','commit_manifest','outcome_hash','sealed_at','committed_at'];
   PERFORM canonical_provenance.canonical_v1_assert((to_jsonb(NEW)-immutable)=(to_jsonb(OLD)-immutable),'immutable write admission');
   IF to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NULL; END IF;
   PERFORM canonical_provenance.canonical_v1_assert(OLD.sealed_at IS NULL,'once-only write seal');
   IF OLD.planned_at IS NOT NULL THEN PERFORM canonical_provenance.canonical_v1_assert(NEW.planned_at=OLD.planned_at AND NEW.planned_payload_hash=OLD.planned_payload_hash,'immutable plan seal');
   ELSIF NEW.planned_at IS NOT NULL THEN NEW.planned_at=stamp; END IF;
   IF NEW.outcome IS NOT NULL THEN
    PERFORM canonical_provenance.canonical_v1_assert(NEW.sealed_at IS NOT NULL AND NEW.outcome_hash IS NOT NULL,'terminal write group');
    NEW.sealed_at=stamp;
    IF NEW.outcome='COMMITTED' THEN PERFORM canonical_provenance.canonical_v1_manifest(NEW.commit_manifest); NEW.committed_at=stamp;
    ELSE PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_label(to_jsonb(NEW.error_code),ARRAY['NORMALIZATION_FAILED','ENTITY_WRITE_FAILED','METRIC_WRITE_FAILED','CAPTURE_CONSTRAINT_FAILED','WORKSPACE_UNAVAILABLE','TRANSACTION_ABORTED']),'safe write failure'); END IF;
   END IF;
  END IF;
 ELSE
  IF TG_OP='UPDATE' THEN PERFORM canonical_provenance.canonical_v1_assert(to_jsonb(NEW)=to_jsonb(OLD),'immutable observation'); RETURN NULL; END IF;
  SELECT to_jsonb(t) INTO old_row FROM public.canonical_observations t WHERE workspace_id=NEW.workspace_id AND id=NEW.id;
  IF FOUND THEN PERFORM canonical_provenance.canonical_v1_assert((old_row-'created_at')=(to_jsonb(NEW)-'created_at'),'observation replay conflict'); RETURN NULL; END IF;
  PERFORM id FROM public.canonical_level_attempts WHERE workspace_id=NEW.workspace_id AND refresh_id=NEW.refresh_id AND id=NEW.source_attempt_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'canonical source unavailable' USING ERRCODE='23503'; END IF;
  PERFORM canonical_provenance.canonical_v1_assert(NEW.source_attempt_id IS NOT DISTINCT FROM (CASE NEW.entity_level WHEN 'CAMPAIGN' THEN r.selected_campaign_id WHEN 'ADSET' THEN r.selected_adset_id WHEN 'AD' THEN r.selected_ad_id WHEN 'ACCOUNT' THEN r.selected_campaign_id END),'selected observation source');
  SELECT * INTO w FROM public.canonical_write_attempts WHERE workspace_id=NEW.workspace_id AND refresh_id=NEW.refresh_id AND id=NEW.write_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'canonical write unavailable' USING ERRCODE='23503'; END IF;
  PERFORM canonical_provenance.canonical_v1_assert(w.sealed_at IS NULL,'observation requires open write');
  -- Resolve path first, then lock each actual entity in Account/Campaign/AdSet/Ad
  -- order. Re-read all ownership joins after those locks, not a stale graph ID.
  IF NEW.entity_level='ACCOUNT' THEN account_uuid=NEW.entity_id;
  ELSIF NEW.entity_level='CAMPAIGN' THEN SELECT "accountId" INTO account_uuid FROM public.campaign_entities WHERE id=NEW.entity_id; campaign_uuid=NEW.entity_id;
  ELSIF NEW.entity_level='ADSET' THEN SELECT "campaignId" INTO campaign_uuid FROM public.ad_sets WHERE id=NEW.entity_id; adset_uuid=NEW.entity_id; SELECT "accountId" INTO account_uuid FROM public.campaign_entities WHERE id=campaign_uuid;
  ELSE SELECT "adSetId" INTO adset_uuid FROM public.ads WHERE id=NEW.entity_id; SELECT "campaignId" INTO campaign_uuid FROM public.ad_sets WHERE id=adset_uuid; SELECT "accountId" INTO account_uuid FROM public.campaign_entities WHERE id=campaign_uuid; END IF;
  PERFORM id FROM public.accounts WHERE id=account_uuid AND "workspaceId"=NEW.workspace_id AND channel='META' AND "externalId"=r.provider_account_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'canonical account ownership unavailable' USING ERRCODE='23503'; END IF;
  IF campaign_uuid IS NOT NULL THEN SELECT "externalId",objective INTO graph_external,graph_objective FROM public.campaign_entities WHERE id=campaign_uuid AND "accountId"=account_uuid AND "workspaceId"=NEW.workspace_id AND channel='META' FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'canonical campaign ownership unavailable' USING ERRCODE='23503'; END IF; END IF;
  IF adset_uuid IS NOT NULL THEN SELECT "externalId" INTO graph_external FROM public.ad_sets WHERE id=adset_uuid AND "campaignId"=campaign_uuid AND "workspaceId"=NEW.workspace_id AND channel='META' FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'canonical adset ownership unavailable' USING ERRCODE='23503'; END IF; END IF;
  IF NEW.entity_level='AD' THEN SELECT "externalId" INTO graph_external FROM public.ads WHERE id=NEW.entity_id AND "adSetId"=adset_uuid AND "workspaceId"=NEW.workspace_id AND channel='META' FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'canonical ad ownership unavailable' USING ERRCODE='23503'; END IF; END IF;
  IF NEW.entity_level='ACCOUNT' THEN graph_external=r.provider_account_id; END IF;
  PERFORM canonical_provenance.canonical_v1_assert(NEW.external_entity_id IS NULL OR NEW.external_entity_id=graph_external,'external entity binding');
  PERFORM canonical_provenance.canonical_v1_facts(NEW.source_facts,r.provider_account_id,NEW.entity_level);
  PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(NEW.committed_projection,ARRAY['formatVersion','snapshot','attributes']) AND NEW.committed_projection->'formatVersion'='1' AND canonical_provenance.canonical_v1_keys(NEW.committed_projection->'attributes',ARRAY['objective','optimizationGoal']),'projection envelope');
  PERFORM canonical_provenance.canonical_v1_assert(NEW.committed_projection->'attributes'->'optimizationGoal'='null' AND (NEW.committed_projection->'attributes'->'objective'='null' OR NEW.committed_projection->'attributes'->>'objective'=graph_objective),'observed partition attributes');
  keys=ARRAY['id','workspaceId','entityId','entityLevel','date','source','granularity','spendMinor','revenueMinor','cpaMinor','impressions','clicks','conversions','ctr','roas','frequency','currency','reach','actionMetrics','dailyBudgetMinor','measurementWindow','windowStart','windowEnd','currencyProvenance','spendWindowStartUtc','spendWindowEndUtc'];
  PERFORM canonical_provenance.canonical_v1_assert(canonical_provenance.canonical_v1_keys(NEW.committed_projection->'snapshot',keys),'complete snapshot projection keys');
  -- SQL float8 NaN/Infinity encode as JSON strings. They are not finite JSON
  -- measurements and cannot enter the v1 hash/projection contract as numbers.
  FOREACH key_name IN ARRAY ARRAY['ctr','roas','frequency'] LOOP
   PERFORM canonical_provenance.canonical_v1_assert(jsonb_typeof(NEW.committed_projection->'snapshot'->key_name) IN ('number','null'),'finite ratio projection');
  END LOOP;
  IF NEW.committed_projection->'snapshot'->'actionMetrics'<>'null' THEN
   PERFORM canonical_provenance.canonical_v1_assert(jsonb_typeof(NEW.committed_projection->'snapshot'->'actionMetrics')='object','normalized action metric bag');
   FOR x IN SELECT value FROM jsonb_each(NEW.committed_projection->'snapshot'->'actionMetrics') LOOP
    PERFORM canonical_provenance.canonical_v1_assert(jsonb_typeof(x) IN ('number','null'),'numeric action metric value');
   END LOOP;
  END IF;
  SELECT to_jsonb(m) INTO stored FROM public.metric_snapshots m WHERE "workspaceId"=NEW.workspace_id AND "entityId"=NEW.entity_id AND "entityLevel"::text=NEW.entity_level AND date=NEW.date AND granularity::text=NEW.granularity AND source::text=NEW.source AND "measurementWindow"::text=NEW.measurement_window FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'canonical materialization unavailable' USING ERRCODE='23503'; END IF;
  SELECT * INTO projection FROM jsonb_populate_record(NULL::public.metric_snapshots,NEW.committed_projection->'snapshot');
  PERFORM canonical_provenance.canonical_v1_assert(NEW.committed_projection->'snapshot'=stored AND to_jsonb(projection)=stored AND projection."windowStart" IS NOT DISTINCT FROM NEW.window_start AND projection."windowEnd" IS NOT DISTINCT FROM NEW.window_end AND (NEW.materialized_snapshot_id IS NULL OR NEW.materialized_snapshot_id=projection.id),'exact committed projection');
 END IF;
 RETURN NEW;
END $$;

-- Explicit operator capability, not a scanner/scheduler. Caller supplies the
-- complete candidate set; time guards and all inbound restrictive FKs still
-- apply. Parent first avoids a target-row-first DELETE lock inversion.
CREATE FUNCTION canonical_provenance.canonical_delete_retained(ws uuid, roots uuid[]) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE n bigint; BEGIN
 PERFORM canonical_provenance.canonical_v1_assert(cardinality(roots)>0 AND cardinality(roots)=(SELECT count(DISTINCT id) FROM unnest(roots) id),'explicit unique retention set');
 PERFORM id FROM public.workspaces WHERE id=ws FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'canonical workspace unavailable' USING ERRCODE='23503'; END IF;
 PERFORM id FROM public.canonical_refreshes WHERE workspace_id=ws AND id=ANY(roots) ORDER BY id FOR UPDATE;
 PERFORM canonical_provenance.canonical_v1_assert((SELECT count(*) FROM public.canonical_refreshes WHERE workspace_id=ws AND id=ANY(roots))=cardinality(roots),'retention set ownership');
 DELETE FROM public.canonical_refreshes WHERE workspace_id=ws AND id=ANY(roots);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;

CREATE TRIGGER canonical_guard BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_refreshes FOR EACH ROW EXECUTE FUNCTION canonical_provenance.canonical_guard();
CREATE TRIGGER canonical_guard BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_level_attempts FOR EACH ROW EXECUTE FUNCTION canonical_provenance.canonical_guard();
CREATE TRIGGER canonical_guard BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_write_attempts FOR EACH ROW EXECUTE FUNCTION canonical_provenance.canonical_guard();
CREATE TRIGGER canonical_guard BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_observations FOR EACH ROW EXECUTE FUNCTION canonical_provenance.canonical_guard();
CREATE CONSTRAINT TRIGGER canonical_selection_seal AFTER UPDATE ON public.canonical_refreshes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(OLD.source_sealed_at IS NULL AND NEW.source_sealed_at IS NOT NULL) EXECUTE FUNCTION canonical_provenance.canonical_validate_selection();
CREATE CONSTRAINT TRIGGER canonical_write_seal AFTER UPDATE ON public.canonical_write_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(OLD.sealed_at IS NULL AND NEW.sealed_at IS NOT NULL) EXECUTE FUNCTION canonical_provenance.canonical_validate_write();
CREATE CONSTRAINT TRIGGER canonical_observation_commit AFTER INSERT ON public.canonical_observations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION canonical_provenance.canonical_validate_observation();
CREATE TRIGGER canonical_retention_event AFTER INSERT OR UPDATE ON public.canonical_level_attempts FOR EACH ROW EXECUTE FUNCTION canonical_provenance.canonical_extend_retention();
CREATE TRIGGER canonical_retention_event AFTER INSERT OR UPDATE ON public.canonical_write_attempts FOR EACH ROW EXECUTE FUNCTION canonical_provenance.canonical_extend_retention();

-- No new runtime login, no enrollment, no maintenance scheduler. Group grants
-- are dormant until separately approved migration/runtime credential rollout.
GRANT USAGE,CREATE ON SCHEMA public TO lumi_canonical_owner;
GRANT USAGE ON SCHEMA public TO lumi_canonical_app,lumi_canonical_retention;
GRANT SELECT(id),UPDATE(id) ON public.workspaces TO lumi_canonical_owner;
GRANT SELECT(id,"workspaceId",channel,"externalId"),UPDATE(id) ON public.accounts TO lumi_canonical_owner;
GRANT SELECT(id,"accountId","workspaceId",channel,"externalId",objective),UPDATE(id) ON public.campaign_entities TO lumi_canonical_owner;
GRANT SELECT(id,"campaignId","workspaceId",channel,"externalId"),UPDATE(id) ON public.ad_sets TO lumi_canonical_owner;
GRANT SELECT(id,"adSetId","workspaceId",channel,"externalId"),UPDATE(id) ON public.ads TO lumi_canonical_owner;
GRANT SELECT,UPDATE(id) ON public.metric_snapshots TO lumi_canonical_owner;
DO $$DECLARE t text; f record; g record; BEGIN
 FOREACH t IN ARRAY ARRAY['canonical_refreshes','canonical_level_attempts','canonical_write_attempts','canonical_observations'] LOOP
  EXECUTE format('ALTER TABLE public.%I OWNER TO lumi_canonical_owner',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  FOR g IN SELECT DISTINCT r.rolname FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=format('public.%I',t)::regclass AND a.grantee<>c.relowner LOOP
   EXECUTE format('REVOKE ALL ON public.%I FROM %I CASCADE',t,g.rolname);
  END LOOP;
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO lumi_canonical_app',t);
  EXECUTE format('GRANT SELECT ON public.%I TO lumi_canonical_retention',t);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p WHERE p.pronamespace='canonical_provenance'::regnamespace AND (p.proname LIKE 'canonical_v1_%' OR p.proname IN ('canonical_guard','canonical_validate_selection','canonical_validate_write','canonical_validate_observation','canonical_extend_retention','canonical_delete_retained')) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO lumi_canonical_owner',f.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  FOR g IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=f.signature::oid AND a.grantee<>p.proowner LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I CASCADE',f.signature,g.rolname);
  END LOOP;
 END LOOP;
 IF to_regclass('public.marcom_credentials') IS NOT NULL THEN
  GRANT SELECT(workspace_id,platform,account_id,is_active,updated_at),UPDATE(account_id) ON public.marcom_credentials TO lumi_canonical_owner;
 END IF;
END $$;
GRANT UPDATE(selected_campaign_id,selected_adset_id,selected_ad_id,not_started_levels,attempt_dispositions,selection_hash,source_sealed_at) ON public.canonical_refreshes TO lumi_canonical_app;
GRANT UPDATE(source_receipt,receipt_hash,source_sealed_at) ON public.canonical_level_attempts TO lumi_canonical_app;
GRANT UPDATE(planned_payload_hash,planned_at,outcome,error_code,commit_manifest,outcome_hash,sealed_at,committed_at) ON public.canonical_write_attempts TO lumi_canonical_app;
GRANT UPDATE(retain_until) ON public.canonical_refreshes TO lumi_canonical_retention;
GRANT EXECUTE ON FUNCTION canonical_provenance.canonical_delete_retained(uuid,uuid[]) TO lumi_canonical_retention;
COMMIT;
