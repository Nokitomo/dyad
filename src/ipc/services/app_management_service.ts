import { db } from "../../db";
import { apps, chats } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath } from "../../paths/paths";
import { promises as fsPromises } from "node:fs";
import git from "isomorphic-git";
import { getGitAuthor } from "../utils/git_author";
import log from "electron-log";
import { copyDirectoryRecursive } from "../utils/file_utils";

const logger = log.scope("app_management_service");

/**
 * Scans the default dyad-apps directory and adds any missing app directories to the database.
 */
export async function scanForAppsService(): Promise<{
  addedApps: { name: string; path: string }[];
  errors: string[];
}> {
  logger.log("Scanning for existing apps in dyad-apps directory...");
  const dyadAppsBaseDir = getDyadAppPath(".");
  const addedApps: { name: string; path: string }[] = [];
  const errors: string[] = [];

  try {
    // Ensure the base directory exists
    await fsPromises.mkdir(dyadAppsBaseDir, { recursive: true });

    // Get all entries in the dyad-apps base directory
    const entries = await fsPromises.readdir(dyadAppsBaseDir, {
      withFileTypes: true,
    });
    const directories = entries
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    // Get all app paths currently in the database
    const existingApps = await db.query.apps.findMany({
      columns: { path: true },
    });
    const existingAppPaths = new Set(existingApps.map((app) => app.path));

    // Identify directories that are not in the database
    const missingAppPaths = directories.filter(
      (dirName) => !existingAppPaths.has(dirName)
    );

    logger.log(`Found ${missingAppPaths.length} missing apps.`);

    // Add missing apps to the database
    for (const appPath of missingAppPaths) {
      try {
        // Generate a unique name based on the folder name
        let appName = appPath;
        let counter = 1;
        // Check for name conflicts
        while (
          await db.query.apps.findFirst({ where: eq(apps.name, appName) })
        ) {
          appName = `${appPath}-${counter}`;
          counter++;
        }

        const [newApp] = await db
          .insert(apps)
          .values({
            name: appName,
            path: appPath,
          })
          .returning();

        // Create an initial chat for the scanned app
        await db.insert(chats).values({
          appId: newApp.id,
        });

        addedApps.push({ name: newApp.name, path: newApp.path });
        logger.log(`Added app: ${newApp.name} (path: ${newApp.path})`);
      } catch (error: any) {
        logger.error(`Error adding app ${appPath} to DB:`, error);
        errors.push(`Failed to add app '${appPath}': ${error.message}`);
      }
    }
    // If there were errors during processing, throw an error containing all messages
    if (errors.length > 0) {
      throw new Error(`Scan completed with errors:\n${errors.join("\n")}`);
    }
    // Return the result object if no errors occurred
    return { addedApps, errors: [] };
  } catch (error: any) {
    // Catch errors during the initial directory scan (e.g., permission issues)
    logger.error("Error scanning dyad-apps directory:", error);
    errors.push(`Failed to scan directory: ${error.message}`);
    // Throw the error so the caller can handle it
    throw new Error(`Failed to scan for apps: ${error.message}`);
  }
}

/**
 * Imports a project from a user-selected directory into the dyad-apps directory and adds it to the database.
 */
export async function importProjectService(sourcePath: string): Promise<{
  success: boolean;
  appId?: number;
  error?: string;
  appName?: string;
}> {
  logger.log(`Importing project from: ${sourcePath}`);

  try {
    // Check if source path exists and is a directory
    const stats = await fsPromises.stat(sourcePath);
    if (!stats.isDirectory()) {
      throw new Error("Source path is not a directory.");
    }

    // Generate a default app name and path based on the source folder name
    const sourceFolderName = path.basename(sourcePath);
    let appName = sourceFolderName;
    let appPath = sourceFolderName;
    let counter = 1;

    // Check for conflicts in the database
    while (
      await db.query.apps.findFirst({
        where: and(eq(apps.name, appName), eq(apps.path, appPath)),
      })
    ) {
      appName = `${sourceFolderName}-${counter}`;
      appPath = `${sourceFolderName}-${counter}`;
      counter++;
    }

    const fullDestPath = getDyadAppPath(appPath);

    // Check if destination path already exists on disk (shouldn't if DB check passed, but double-check)
    if (fs.existsSync(fullDestPath)) {
      throw new Error(
        `Destination path '${fullDestPath}' already exists on disk.`
      );
    }

    // Copy the project files
    await copyDirectoryRecursive(sourcePath, fullDestPath);
    logger.log(`Successfully copied project to: ${fullDestPath}`);

    // Initialize git repo if it doesn't exist
    const gitRepoPath = path.join(fullDestPath, ".git");
    if (!fs.existsSync(gitRepoPath)) {
      try {
        await git.init({
          fs: fs,
          dir: fullDestPath,
          defaultBranch: "main",
        });
        // Stage all files
        await git.add({
          fs: fs,
          dir: fullDestPath,
          filepath: ".",
        });
        // Create initial commit
        await git.commit({
          fs: fs,
          dir: fullDestPath,
          message: "Initial import",
          author: await getGitAuthor(),
        });
        logger.log(`Initialized git repo and created initial commit.`);
      } catch (gitError) {
        logger.warn(`Failed to initialize git repo in ${fullDestPath}:`, gitError);
        // Continue even if git init fails
      }
    } else {
       logger.log(`Git repo already exists in ${fullDestPath}. Skipping init.`);
    }


    // Add the new app to the database
    const [newApp] = await db
      .insert(apps)
      .values({
        name: appName,
        path: appPath,
      })
      .returning();

    // Create an initial chat for the imported app
    await db.insert(chats).values({
      appId: newApp.id,
    });

    logger.log(`Successfully imported app: ${newApp.name} (ID: ${newApp.id})`);

    return { success: true, appId: newApp.id, appName: newApp.name };
  } catch (error: any) {
    logger.error(`Error importing project from ${sourcePath}:`, error);
    // Throw the error so the caller can handle it
    throw new Error(`Failed to import project: ${error.message}`);
  }
}