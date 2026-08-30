import "dotenv/config";
import { migrationChildEnvironment, selectMigrationTarget } from "./guarded-operation-prisma";
import { repositoryRoot, runLocalPrisma } from "./local-prisma-runner";
import { hydrateVerifiedTestEnvironment } from "./local-test-environment";

const mode = process.argv[2];
const action = process.argv[3] ?? "deploy";
if (action !== "deploy" && action !== "status") throw new Error("MIGRATION_ACTION_REQUIRED");
const root = repositoryRoot();
const sourceEnv = mode === "test" ? hydrateVerifiedTestEnvironment(process.env, root) : process.env;
const selected = selectMigrationTarget(sourceEnv, mode);
const env = migrationChildEnvironment(sourceEnv, selected);
runLocalPrisma({ root, action, env: env as unknown as NodeJS.ProcessEnv });
