import "dotenv/config";
import { migrationChildEnvironment, selectMigrationTarget } from "./guarded-operation-prisma";
import { repositoryRoot, runLocalPrisma } from "./local-prisma-runner";

const mode = process.argv[2];
const action = process.argv[3] ?? "deploy";
if (action !== "deploy" && action !== "status") throw new Error("MIGRATION_ACTION_REQUIRED");
const selected = selectMigrationTarget(process.env, mode);
const env = migrationChildEnvironment(process.env, selected);
runLocalPrisma({ root: repositoryRoot(), action, env: env as unknown as NodeJS.ProcessEnv });
