-- Preserve immutable config history after deletion of an unused set.
-- History snapshots retain the former set UID and complete definition; no cascading history loss.
alter table app.parameter_set_config_revisions drop constraint parameter_set_config_revisions_set_id_fkey;
create function app.research_config_set_delete() returns trigger language plpgsql as $$
begin
 insert into app.parameter_set_config_revisions(set_id,version,snapshot,created_by)
 values(old.id,old.config_version+1,app.parameter_set_config_snapshot(old.id)||jsonb_build_object('deleted',true),nullif(current_setting('app.contributor_id',true),'')::uuid);
 return old;
end $$;
create trigger research_config_set_delete before delete on app.parameter_sets for each row execute function app.research_config_set_delete();

revoke update,delete,truncate on app.parameter_set_config_revisions from app_api;
