import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath } from "../../paths/paths";
import { promises as fsPromises } from "node:fs";
import git from "isomorphic-git";
import { getGitAuthor } from "../utils/git_author";
import log from "electron-log";

const logger = log.scope("file_service");

/**
 * Reads the content of a specific file within an app's directory.
 */
export async function readAppFileService({ appId, filePath }: { appId: number; filePath: string }): Promise<string> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error("App not found");
  }

  const appPath = getDyadAppPath(app.path);
  const fullPath = path.join(appPath, filePath);

  // Check if the path is within the app directory (security check)
  if (!fullPath.startsWith(appPath)) {
    throw new Error("Invalid file path");
  }

  if (!fs.existsSync(fullPath)) {
    throw new Error("File not found");
  }

  try {
    const contents = fs.readFileSync(fullPath, "utf-8");
    return contents;
  } catch (error) {
    logger.error(`Error reading file ${filePath} for app ${appId}:`, error);
    throw new Error("Failed to read file");
  }
}

/**
 * Writes content to a specific file within an app's directory and commits the change.
 */
export async function editAppFileService({
  appId,
  filePath,
  content,
}: {
  appId: number;
  filePath: string;
  content: string;
}): Promise<{ success: boolean }> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error("App not found");
  }

  const appPath = getDyadAppPath(app.path);
  const fullPath = path.join(appPath, filePath);

  // Check if the path is within the app directory (security check)
  if (!fullPath.startsWith(appPath)) {
    throw new Error("Invalid file path");
  }

  // Ensure directory exists
  const dirPath = path.dirname(fullPath);
  await fsPromises.mkdir(dirPath, { recursive: true });

  try {
    await fsPromises.writeFile(fullPath, content, "utf-8");
    logger.log(`Successfully wrote file: ${fullPath}`);

    // Check if git repository exists and commit the change
    if (fs.existsSync(path.join(appPath, ".git"))) {
      await git.add({
        fs,
        dir: appPath,
        filepath: filePath,
      });
      logger.log(`Staged file for commit: ${filePath}`);

      await git.commit({
        fs,
        dir: appPath,
        message: `Updated ${filePath}`,
        author: await getGitAuthor(),
      });
      logger.log(`Created commit for file update: ${filePath}`);
    } else {
      logger.log(`No git repo found in ${appPath}, skipping commit.`);
    }

    return { success: true };
  } catch (error: any) {
    logger.error(`Error writing file ${filePath} for app ${appId}:`, error);
    throw new Error(`Failed to write file: ${error.message}`);
  }
}