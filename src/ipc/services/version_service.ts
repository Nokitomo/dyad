import { db } from "../../db";
import { apps, messages } from "../../db/schema";
import { desc, eq, and, gt } from "drizzle-orm";
import type { Version } from "../ipc_types";
import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath } from "../../paths/paths";
import git from "isomorphic-git";
import { promises as fsPromises } from "node:fs";
import { getGitAuthor } from "../utils/git_author";
import log from "electron-log";

const logger = log.scope("version_service");

/**
 * Lists all versions (commits) for a given app.
 */
export async function listVersionsService({ appId }: { appId: number }): Promise<Version[]> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error("App not found");
  }

  const appPath = getDyadAppPath(app.path);

  // Just return an empty array if the app is not a git repo.
  if (!fs.existsSync(path.join(appPath, ".git"))) {
    logger.log(`No git repo found for app ${appId}, returning empty versions list.`);
    return [];
  }

  try {
    const commits = await git.log({
      fs,
      dir: appPath,
      depth: 1000, // Limit to last 1000 commits for performance
    });

    return commits.map((commit) => ({
      oid: commit.oid,
      message: commit.commit.message,
      timestamp: commit.commit.author.timestamp,
    })) satisfies Version[];
  } catch (error: any) {
    logger.error(`Error listing versions for app ${appId}:`, error);
    throw new Error(`Failed to list versions: ${error.message}`);
  }
}

/**
 * Reverts the app's codebase to a previous version and cleans up subsequent chat messages.
 */
export async function revertVersionService({ appId, previousVersionId }: { appId: number; previousVersionId: string }): Promise<{ success: boolean }> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error("App not found");
  }

  const appPath = getDyadAppPath(app.path);

  try {
    // Ensure we are on the main branch before attempting to revert
    await git.checkout({
      fs,
      dir: appPath,
      ref: "main",
      force: true, // Force checkout to handle potential conflicts
    });
    logger.log(`Checked out main branch for app ${appId} before revert.`);

    // Get status matrix comparing the target commit (previousVersionId as HEAD) with current working directory
    const matrix = await git.statusMatrix({
      fs,
      dir: appPath,
      ref: previousVersionId,
    });
    logger.log(`Generated status matrix for revert to ${previousVersionId} for app ${appId}.`);

    // Process each file to revert to the state in previousVersionId
    for (const [
      filepath,
      headStatus, // Status in the target commit (previousVersionId)
      workdirStatus, // Status in the working directory
      stageStatus, // Status in the staging area
    ] of matrix) {
      const fullPath = path.join(appPath, filepath);

      // If file exists in HEAD (previous version)
      if (headStatus === 1) {
        // If file doesn't exist or has changed in working directory, restore it from the target commit
        if (workdirStatus !== 1) {
          logger.debug(`Restoring file ${filepath} from commit ${previousVersionId}`);
          const { blob } = await git.readBlob({
            fs,
            dir: appPath,
            oid: previousVersionId,
            filepath,
          });
          await fsPromises.mkdir(path.dirname(fullPath), {
            recursive: true,
          });
          await fsPromises.writeFile(fullPath, Buffer.from(blob));
        }
      }
      // If file doesn't exist in HEAD but exists in working directory, delete it
      else if (headStatus === 0 && workdirStatus !== 0) {
        logger.debug(`Deleting file ${filepath} not present in commit ${previousVersionId}`);
        if (fs.existsSync(fullPath)) {
          await fsPromises.unlink(fullPath);
          // Also remove from git index if it was staged
          try {
             await git.remove({
               fs,
               dir: appPath,
               filepath: filepath,
             });
             logger.debug(`Removed ${filepath} from git index.`);
          } catch (removeError) {
             logger.warn(`Failed to remove ${filepath} from git index:`, removeError);
          }
        }
      }
      // If file exists in HEAD and working directory but is different, restore it
      else if (headStatus === 1 && workdirStatus === 2) {
         logger.debug(`Restoring modified file ${filepath} from commit ${previousVersionId}`);
         const { blob } = await git.readBlob({
           fs,
           dir: appPath,
           oid: previousVersionId,
           filepath,
         });
         await fsPromises.writeFile(fullPath, Buffer.from(blob));
      }
    }

    // Stage all changes (restored and deleted files)
    await git.add({
      fs,
      dir: appPath,
      filepath: ".",
    });
    logger.log(`Staged all changes for revert commit in ${appPath}.`);


    // Create a revert commit
    const commitHash = await git.commit({
      fs,
      dir: appPath,
      message: `Reverted all changes back to version ${previousVersionId}`,
      author: await getGitAuthor(),
    });
    logger.log(`Created revert commit ${commitHash} for app ${appId}.`);


    // Find the chat and message associated with the commit hash we reverted *to*
    const messageWithCommit = await db.query.messages.findFirst({
      where: eq(messages.commitHash, previousVersionId),
      with: {
        chat: true,
      },
    });

    // If we found a message with this commit hash, delete all subsequent messages (but keep this message)
    if (messageWithCommit) {
      const chatId = messageWithCommit.chatId;

      // Find all messages in this chat with IDs > the one with our commit hash
      const messagesToDelete = await db.query.messages.findMany({
        where: and(
          eq(messages.chatId, chatId),
          gt(messages.id, messageWithCommit.id)
        ),
        orderBy: desc(messages.id),
      });

      logger.log(
        `Deleting ${messagesToDelete.length} messages after commit ${previousVersionId} from chat ${chatId}`
      );

      // Delete the messages
      if (messagesToDelete.length > 0) {
        await db
          .delete(messages)
          .where(
            and(
              eq(messages.chatId, chatId),
              gt(messages.id, messageWithCommit.id)
            )
          );
          logger.log(`Deleted messages after message ID ${messageWithCommit.id} in chat ${chatId}.`);
      }
    } else {
       logger.log(`No message found with commit hash ${previousVersionId} to determine messages to delete.`);
    }


    return { success: true };
  } catch (error: any) {
    logger.error(
      `Error reverting to version ${previousVersionId} for app ${appId}:`,
      error
    );
    throw new Error(`Failed to revert version: ${error.message}`);
  }
}

/**
 * Checks out a specific version of the app's codebase without creating a new commit.
 */
export async function checkoutVersionService({ appId, versionId }: { appId: number; versionId: string }): Promise<{ success: boolean }> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error("App not found");
  }

  const appPath = getDyadAppPath(app.path);

  try {
    // Checkout the target commit
    await git.checkout({
      fs,
      dir: appPath,
      ref: versionId,
      force: true, // Force checkout to discard local changes
    });
    logger.log(`Successfully checked out version ${versionId} for app ${appId}.`);

    return { success: true };
  } catch (error: any) {
    logger.error(
      `Error checking out version ${versionId} for app ${appId}:`,
      error
    );
    throw new Error(`Failed to checkout version: ${error.message}`);
  }
}