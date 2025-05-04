import { db } from "../../db";
import { apps, chats } from "../../db/schema";
import { desc, eq, and } from "drizzle-orm";
import type { App, CreateAppParams } from "../ipc_types";
import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath } from "../../paths/paths";
import { promises as fsPromises } from "node:fs";
import git from "isomorphic-git";
import { getGitAuthor } from "../utils/git_author";
import log from "electron-log";
import { getSupabaseProjectName } from "../../supabase_admin/supabase_management_client";
import { copyDirectoryRecursive } from "../utils/file_utils";

const logger = log.scope("app_service");

/**
 * Creates a new app with an initial chat and initializes a git repository.
 */
export async function createAppService(params: CreateAppParams): Promise<{ app: App, chatId: number }> {
  const appPath = params.name; // Using name as path for now
  const fullAppPath = getDyadAppPath(appPath);

  if (fs.existsSync(fullAppPath)) {
    throw new Error(`App already exists at: ${fullAppPath}`);
  }

  // Create a new app in the database
  const [app] = await db
    .insert(apps)
    .values({
      name: params.name,
      path: appPath,
    })
    .returning();

  // Create an initial chat for this app
  const [chat] = await db
    .insert(chats)
    .values({
      appId: app.id,
    })
    .returning();

  // Start async operations in background (copy scaffold, init git)
  // We don't need to await these for the IPC response, but we should handle errors.
  (async () => {
    try {
      // Copy scaffold
      await copyDirectoryRecursive(
        path.join(__dirname, "..", "..", "scaffold"),
        fullAppPath
      );
      logger.log(`Copied scaffold to ${fullAppPath}`);

      // Initialize git repo and create first commit
      await git.init({
        fs: fs,
        dir: fullAppPath,
        defaultBranch: "main",
      });
      logger.log(`Initialized git repo in ${fullAppPath}`);

      // Stage all files
      await git.add({
        fs: fs,
        dir: fullAppPath,
        filepath: ".",
      });
      logger.log(`Staged initial files in ${fullAppPath}`);

      // Create initial commit
      await git.commit({
        fs: fs,
        dir: fullAppPath,
        message: "Init from react vite template",
        author: await getGitAuthor(),
      });
      logger.log(`Created initial commit in ${fullAppPath}`);

    } catch (error) {
      logger.error("Error during background app initialization:", error);
      // TODO: Consider how to surface this error to the user or log it persistently
    }
  })();


  // Return the app and initial chat ID immediately
  return { app: app as App, chatId: chat.id };
}

/**
 * Gets details for a specific app, including its files and Supabase project name.
 */
export async function getAppService(appId: number): Promise<App> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error("App not found");
  }

  // Get app files
  const appPath = getDyadAppPath(app.path);
  let files: string[] = [];

  try {
    files = getFilesRecursively(appPath, appPath);
  } catch (error) {
    logger.error(`Error reading files for app ${appId}:`, error);
    // Return app even if files couldn't be read
  }

  let supabaseProjectName: string | null = null;

  if (app.supabaseProjectId) {
    try {
      supabaseProjectName = await getSupabaseProjectName(app.supabaseProjectId);
    } catch (error) {
      logger.error(`Error fetching Supabase project name for ${app.supabaseProjectId}:`, error);
      supabaseProjectName = `<Error fetching project name>`;
    }
  }

  return {
    ...app,
    files,
    supabaseProjectName,
  };
}

/**
 * Lists all apps in the database.
 */
export async function listAppsService(): Promise<{ apps: App[]; appBasePath: string }> {
  const allApps = await db.query.apps.findMany({
    orderBy: [desc(apps.createdAt)],
  });
  return {
    apps: allApps as App[],
    appBasePath: getDyadAppPath("$APP_BASE_PATH"),
  };
}

/**
 * Deletes an app and its files.
 */
export async function deleteAppService(appId: number): Promise<{ success: boolean }> {
  // Check if app exists
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error("App not found");
  }

  // Delete app files
  const appPath = getDyadAppPath(app.path);
  try {
    if (fs.existsSync(appPath)) {
      await fsPromises.rm(appPath, { recursive: true, force: true });
      logger.log(`Successfully deleted app files for app ${appId} at ${appPath}`);
    } else {
      logger.log(`App directory not found for deletion: ${appPath}`);
    }
  } catch (error: any) {
    logger.error(`Error deleting app files for app ${appId}:`, error);
    throw new Error(`Failed to delete app files: ${error.message}`);
  }

  // Delete app from database
  try {
    await db.delete(apps).where(eq(apps.id, appId));
    // Note: Associated chats will cascade delete if that's set up in the schema
    logger.log(`Successfully deleted app ${appId} from database.`);
    return { success: true };
  } catch (error: any) {
    logger.error(`Error deleting app ${appId} from database:`, error);
    throw new Error(`Failed to delete app from database: ${error.message}`);
  }
}

/**
 * Renames an app (updates name and optionally folder path).
 */
export async function renameAppService({
  appId,
  appName,
  appPath,
}: {
  appId: number;
  appName: string;
  appPath: string;
}): Promise<{ success: boolean; app: App }> {
  // Check if app exists
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error("App not found");
  }

  // Check for conflicts with existing apps
  const nameConflict = await db.query.apps.findFirst({
    where: eq(apps.name, appName),
  });

  const pathConflict = await db.query.apps.findFirst({
    where: eq(apps.path, appPath),
  });

  if (nameConflict && nameConflict.id !== appId) {
    throw new Error(`An app with the name '${appName}' already exists`);
  }

  if (pathConflict && pathConflict.id !== appId) {
    throw new Error(`An app with the path '${appPath}' already exists`);
  }

  const oldAppPath = getDyadAppPath(app.path);
  const newAppPath = getDyadAppPath(appPath);

  // Only move files if needed
  if (newAppPath !== oldAppPath) {
    // Move app files
    try {
      // Check if destination directory already exists
      if (fs.existsSync(newAppPath)) {
        throw new Error(
          `Destination path '${newAppPath}' already exists`
        );
      }

      // Create parent directory if it doesn't exist
      await fsPromises.mkdir(path.dirname(newAppPath), {
        recursive: true,
      });

      // Move the files
      await fsPromises.rename(oldAppPath, newAppPath);
      logger.log(`Successfully moved app files from ${oldAppPath} to ${newAppPath}`);
    } catch (error: any) {
      logger.error(
        `Error moving app files from ${oldAppPath} to ${newAppPath}:`,
        error
      );
      throw new Error(`Failed to move app files: ${error.message}`);
    }
  }

  // Update app in database
  try {
    const [updatedApp] = await db
      .update(apps)
      .set({
        name: appName,
        path: appPath,
      })
      .where(eq(apps.id, appId))
      .returning();

    logger.log(`Successfully updated app ${appId} in database.`);
    return { success: true, app: updatedApp as App };
  } catch (error: any) {
    // Attempt to rollback the file move if it happened and DB update failed
    if (newAppPath !== oldAppPath) {
      try {
        await fsPromises.rename(newAppPath, oldAppPath);
        logger.warn(`Rolled back file move for app ${appId} due to DB error.`);
      } catch (rollbackError) {
        logger.error(
          `Failed to rollback file move during rename error for app ${appId}:`,
          rollbackError
        );
      }
    }

    logger.error(`Error updating app ${appId} in database during rename:`, error);
    throw new Error(`Failed to update app in database: ${error.message}`);
  }
}

/**
 * Resets all Dyad data (apps, settings, database).
 */
export async function resetAllService(): Promise<{ success: boolean; message: string }> {
  logger.log("start: resetting all apps and settings.");

  // 1. Drop the database by deleting the SQLite file
  logger.log("deleting database...");
  const dbPath = getDatabasePath();
  if (fs.existsSync(dbPath)) {
    // Close database connections first
    if (db.$client) {
      db.$client.close();
    }
    await fsPromises.unlink(dbPath);
    logger.log(`Database file deleted: ${dbPath}`);
  } else {
    logger.log("Database file not found, skipping deletion.");
  }
  logger.log("database deleted.");

  // 2. Remove settings
  logger.log("deleting settings...");
  const userDataPath = getUserDataPath();
  const settingsPath = path.join(userDataPath, "user-settings.json");

  if (fs.existsSync(settingsPath)) {
    await fsPromises.unlink(settingsPath);
    logger.log(`Settings file deleted: ${settingsPath}`);
  } else {
    logger.log("Settings file not found, skipping deletion.");
  }
  logger.log("settings deleted.");

  // 3. Remove all app files recursively
  // Doing this last because it's the most time-consuming and the least important
  // in terms of resetting the app state.
  logger.log("removing all app files...");
  const dyadAppPath = getDyadAppPath(".");
  if (fs.existsSync(dyadAppPath)) {
    await fsPromises.rm(dyadAppPath, { recursive: true, force: true });
    // Recreate the base directory
    await fsPromises.mkdir(dyadAppPath, { recursive: true });
    logger.log(`Removed all app files and recreated base directory: ${dyadAppPath}`);
  } else {
    logger.log(`Dyad apps base directory not found: ${dyadAppPath}`);
    // Still recreate the base directory in case it was just the contents missing
     await fsPromises.mkdir(dyadAppPath, { recursive: true });
     logger.log(`Recreated base directory: ${dyadAppPath}`);
  }
  logger.log("all app files removed.");
  logger.log("reset all complete.");
  return { success: true, message: "Successfully reset everything" };
}

/**
 * Gets the current application version from package.json.
 */
export async function getAppVersionService(): Promise<string> {
  try {
    // Read version from package.json at project root
    const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    return packageJson.version;
  } catch (error) {
    logger.error("Error reading app version from package.json:", error);
    throw new Error("Failed to get app version");
  }
}