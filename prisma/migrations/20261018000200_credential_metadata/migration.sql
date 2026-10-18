-- PostgreSQL CHECK treats NULL as passing; require the environment-key name explicitly.
ALTER TABLE ai_provider_configurations ADD CONSTRAINT provider_environment_name_required
  CHECK ("credentialSource" <> 'environment' OR "credentialEnvName" IS NOT NULL);
